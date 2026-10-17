import copy
import json
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import assessment_service as a
import app_legacy as app
from memory_store import DurableMemory
TASKS=json.loads((ROOT/'tests/fixtures/authentic_tasks.json').read_text())

def raw_result(task,answer='Selecciono el factor, convierto y compruebo el resultado.',attempt='attempt-1',statuses=None):
    return {'task_id':task['task_id'],'task_version':task['version'],'attempt_id':attempt,
            'criteria':[{'criterion_id':c['id'],'status':(statuses or {}).get(c['id'],'MET'),'quote':answer,'reason':'La respuesta contiene el paso exigido por este criterio.','certainty':'supported','error':''} for c in task['rubric']]}

class ContractTests(unittest.TestCase):
    def test_three_domains_real_local_generation_and_distinct_demands(self):
        domains=[('Convertir unidades de longitud','quantitative'),('Diagnóstico técnico de bombas','diagnosis'),('Analizar fuentes históricas','argumentation')]
        for goal,family in domains:
            with self.subTest(goal=goal),patch.object(a.secrets,'randbelow',return_value=2):
                task=a.generate_task(goal,{'id':'n1','name':goal},lambda *args:self.fail('local pilot must not call provider'))
                self.assertEqual(task['family'],family);self.assertEqual(a.validate_task(task),task)
                self.assertIn('fictic',json.dumps(task,ensure_ascii=False).lower())
        self.assertNotEqual(TASKS['diagnosis']['demands'],TASKS['history']['demands'])

    def test_general_generated_content_is_used_but_cannot_change_rubric_or_novelty(self):
        supplied={'prompt':'Escribe una petición cortés en francés para cambiar una reserva. Justifica una elección y aclara una ambigüedad.',
                  'known_data':['Reserva ficticia para dos personas; se requiere cambiar la hora.'],
                  'constraints':['No inventes disponibilidad.'],'demands':['adaptar registro','explicar elección'],
                  'blueprint':'length_planning_v1','observable_dimensions':['transfer'],'relation':{'status':'VERIFIED_NEAR_TRANSFER'}}
        calls=[]
        def generate(*args):calls.append(args);return supplied
        task=a.generate_task('Escribir en francés',{'id':'n1','name':'Petición cortés'},generate)
        self.assertEqual(task['family'],'communication');self.assertEqual(task['prompt'],supplied['prompt'])
        self.assertIsNone(task['blueprint']);self.assertEqual(task['relation']['status'],'APPLICATION');self.assertNotIn('transfer',task['observable_dimensions']);self.assertEqual(len(calls),1)
        for field,value in [('rubric',[]),('observable_dimensions',['transfer']),('version','invented')]:
            bad=copy.deepcopy(task);bad[field]=value
            with self.assertRaises(ValueError):a.validate_task(bad)

    def test_numeric_and_units_veto_optimistic_model_but_never_rescue_bad_reasoning(self):
        task=TASKS['engineering'];answer='Uso un factor adecuado y compruebo que el pedido conserva la longitud.'
        for value,unit,bad_criterion in [('999','cm','calculation'),('700','m','units')]:
            result=a.evaluate_task(task,{'answer':answer,'final_value':value,'final_unit':unit},'attempt-1',lambda *args:raw_result(task,answer))
            row=next(r for r in result['criteria'] if r['criterion_id']==bad_criterion)
            self.assertEqual(row['status'],'NOT_DEMONSTRATED');self.assertTrue(result['valid'])
        raw=raw_result(task,answer,statuses={'method':'NOT_DEMONSTRATED','units':'PARTIAL'})
        result=a.evaluate_task(task,{'answer':answer,'final_value':'700','final_unit':'cm'},'attempt-1',lambda *args:raw)
        self.assertEqual(result['criteria'][0]['status'],'NOT_DEMONSTRATED')
        self.assertEqual(result['criteria'][2]['status'],'PARTIAL','correct final unit cannot erase incorrect dimensional reasoning')
        for value in ['NaN','Infinity','','1e999']:
            result=a.evaluate_task(task,{'answer':answer,'final_value':value,'final_unit':'cm'},'attempt-1',lambda *args:raw_result(task,answer))
            self.assertFalse(result['valid'])
            self.assertEqual(result['criteria'][1]['status'],'UNCERTAIN')
            self.assertEqual(result['criteria'][0]['status'],'MET','a missing number must not erase a grounded method judgment')

    def test_alternative_method_not_rejected_by_exact_answer_text(self):
        task=TASKS['engineering'];answer='Cada metro son diez decímetros y cada decímetro diez centímetros: 7 × 10 × 10 = 700 cm; conservo la longitud pedida.'
        result=a.evaluate_task(task,{'answer':answer,'final_value':'700.00','final_unit':'centímetros'},'attempt-1',lambda *args:raw_result(task,answer))
        self.assertTrue(result['valid']);self.assertTrue(all(r['status']=='MET' for r in result['criteria']))

    def test_invalid_unsupported_uncertain_and_contradictory_results_never_credit(self):
        task=TASKS['history'];answer='Los registros muestran visitas, no alfabetización.'
        changes=[lambda r:r.update(task_id='wrong'),lambda r:r['criteria'].pop(),lambda r:r['criteria'].append(r['criteria'][0]),
                 lambda r:r['criteria'][0].update(criterion_id='expertise'),lambda r:r['criteria'][0].update(quote='Cita inventada'),
                 lambda r:r['criteria'][0].update(certainty='uncertain'),lambda r:r['criteria'][0].update(status='UNCERTAIN'),
                 lambda r:r['criteria'][0].update(quote=''),lambda r:r['criteria'][0].update(error='wrong method'),lambda r:r.update(attempt_id='another')]
        for change in changes:
            raw=raw_result(task,answer);change(raw)
            result=a.normalize_evaluation(task,answer,'attempt-1',raw)
            self.assertFalse(result['valid']);self.assertTrue(any(r['status']=='UNCERTAIN' for r in result['criteria']))
            self.assertTrue(result['diagnostics'] or any(r['diagnostics'] for r in result['criteria']))
            self.assertFalse(a.all_met({'evaluation':result,'independent':True}))
        result=a.evaluate_task(task,{'answer':task['prompt']},'attempt-1',lambda *args:self.fail('copying prompt is not evaluable performance'))
        self.assertFalse(result['valid'])

    def test_transfer_registry_and_superficial_variants(self):
        self.assertEqual(a.novelty(TASKS['transfer'],TASKS['engineering'])['status'],'VERIFIED_NEAR_TRANSFER')
        self.assertEqual(a.novelty(TASKS['superficial'],TASKS['transfer'])['status'],'PRACTICE')
        candidate=copy.deepcopy(TASKS['history']);candidate.update(purpose='transfer',blueprint=None,prompt='Compara un nuevo expediente sobre una reforma escolar.',demands=['contrastar otras fuentes'])
        self.assertEqual(a.novelty(candidate,TASKS['history'])['status'],'CANDIDATE')
        counterfeit=copy.deepcopy(TASKS['transfer']);counterfeit['prompt']='Solo convierte siete metros.'
        with self.assertRaises(ValueError):a.validate_task(counterfeit)

class DurableEndpointTests(unittest.TestCase):
    def test_actual_http_identity_idempotence_persistence_and_provider_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            memory=DurableMemory(Path(directory)/'db.sqlite3');app.set_memory_for_tests(memory);app._ASSESSMENT_CACHE.clear()
            server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            def post(route,payload):
                request=urllib.request.Request('http://127.0.0.1:%d%s'%(server.server_address[1],route),data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
                with urllib.request.urlopen(request,timeout=10) as response:return json.load(response)
            try:
                profile=post('/api/profile/create',{'name':'Rubricas'});other=post('/api/profile/create',{'name':'Aislado'})
                task=copy.deepcopy(TASKS['engineering'])
                goal={'id':'g','goal':'Convertir unidades','nodes':[{'id':'n1','name':'Unidades','prerequisites':[]}],'events':[],'coverage':[],'learner':{},'lessons':{},'reviews':[],'session':{'mode':'AUTHENTIC','node':'n1','authentic':{'task_id':task['task_id']}},'authentic_tasks':[task],'authentic_attempts':[]}
                state={'goals':[goal],'active':'g'}
                saved=post('/api/profile/save',{'profile_id':profile['profile_id'],'store':state,'expected_revision':profile['revision']})
                payload={'profile_id':profile['profile_id'],'goal_id':'g','task_id':task['task_id'],'attempt_id':'attempt-1','submission':{'answer':'Multiplico por cien y conservo la longitud original.','final_value':'700','final_unit':'cm'}}
                with patch.object(app,'gemini',return_value=raw_result(task,payload['submission']['answer'])) as provider:
                    first=post('/api/assessment/evaluate',payload);second=post('/api/assessment/evaluate',payload)
                    self.assertEqual(first,second);self.assertEqual(provider.call_count,1)
                    with self.assertRaises(urllib.error.HTTPError):post('/api/assessment/evaluate',{**payload,'submission':{**payload['submission'],'answer':'Otra respuesta'}})
                    with self.assertRaises(urllib.error.HTTPError):post('/api/assessment/evaluate',{**payload,'profile_id':other['profile_id']})
                with patch.object(app,'gemini',side_effect=ValueError('Proveedor no disponible')):
                    unavailable=post('/api/assessment/evaluate',{**payload,'attempt_id':'failure'})['evaluation']
                    self.assertEqual(unavailable['evaluation_state'],'UNAVAILABLE')
                    self.assertEqual(unavailable['diagnostics'][0]['code'],'PROVIDER_UNAVAILABLE')
                self.assertEqual(memory.history(profile['profile_id']),[],'endpoint evaluation alone never fabricates learning evidence')
                app.set_memory_for_tests(DurableMemory(Path(directory)/'db.sqlite3'))
                self.assertEqual(post('/api/profile/load',{'profile_id':profile['profile_id']})['store']['goals'][0]['authentic_tasks'],[task])
                backup=post('/api/profile/export',{'profile_id':profile['profile_id']});post('/api/profile/restore',{'profile_id':other['profile_id'],'backup':backup})
                self.assertEqual(post('/api/profile/load',{'profile_id':other['profile_id']})['store']['goals'][0]['authentic_tasks'],[task])
                with self.assertRaises(urllib.error.HTTPError):post('/api/assessment/task',{'profile_id':profile['profile_id'],'goal_id':'g','node_id':'n1','source_task_id':task['task_id'],'purpose':'transfer'})
            finally:server.shutdown();server.server_close();thread.join(5);app.set_memory_for_tests(None)

    def test_frontend_generated_results_restore_without_losing_task_rubric_or_repair(self):
        run=subprocess.run(['node','tests/authentic_assessment.test.js','--snapshot'],cwd=ROOT,text=True,capture_output=True,check=True)
        state=json.loads(run.stdout)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'db.sqlite3';memory=DurableMemory(path);first=memory.create_profile('A');other=memory.create_profile('B')
            memory.save(first['profile_id'],state,first['revision']);reopened=DurableMemory(path)
            loaded=reopened.load(first['profile_id']);reopened.restore(other['profile_id'],reopened.export(first['profile_id']));restored=reopened.load(other['profile_id'])
            for key in ['authentic_tasks','authentic_attempts','session','repairEpisodes']:
                # Ownership changes are expected when importing into another local profile.
                def without_owner(value):
                    if isinstance(value,dict):return {k:without_owner(v) for k,v in value.items() if k!='profile_id'}
                    if isinstance(value,list):return [without_owner(v) for v in value]
                    return value
                self.assertEqual(without_owner(loaded['store']['goals'][0][key]),without_owner(restored['store']['goals'][0][key]))
            self.assertEqual(reopened.load(first['profile_id']),loaded)

if __name__=='__main__':unittest.main()
