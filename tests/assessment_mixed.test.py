"""Gemini-shaped responses are synthetic fixtures, not captured live-provider accuracy evidence."""
import copy
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import assessment_service as a
import app_legacy as app
from memory_store import DurableMemory

ANSWER = '8 m × 100 cm/m = 800 cm'
FULL_ANSWER = ANSWER + '. El factor conserva la longitud: el pedido debe representar ocho metros, expresados en centímetros.'


def task_eight():
    task = json.loads((ROOT/'tests/fixtures/authentic_tasks.json').read_text())['engineering']
    task['parameters']['total_m'] = 8
    task['prompt'], task['known_data'], task['demands'] = a.quantitative_content(task['blueprint'], task['parameters'])
    return task


def response(task, attempt='attempt-realistic', complete=False):
    return {'task_id': task['task_id'], 'task_version': task['version'], 'attempt_id': attempt,
            'criteria': [
                {'criterion_id': 'method', 'status': 'MET', 'quote': '100 cm/m', 'reason': 'El factor expresa cien centímetros por metro y conecta la longitud con la unidad solicitada.', 'certainty': 'supported', 'error': ''},
                {'criterion_id': 'calculation', 'status': 'MET', 'quote': ANSWER, 'reason': 'Multiplica ocho por cien y obtiene ochocientos.', 'certainty': 'supported', 'error': ''},
                {'criterion_id': 'units', 'status': 'MET', 'quote': 'cm', 'reason': 'Cancela metros con el denominador del factor y expresa el resultado en centímetros.', 'certainty': 'supported', 'error': ''},
                {'criterion_id': 'interpretation', 'status': 'MET' if complete else 'NOT_DEMONSTRATED',
                 'quote': 'El factor conserva la longitud' if complete else '',
                 'reason': 'Explica que el pedido conserva ocho metros de longitud.' if complete else 'No explica cómo comprobar que el pedido conserva la longitud solicitada.',
                 'certainty': 'supported', 'error': '' if complete else 'missing'}]}


def row(result, cid):
    return next(r for r in result['criteria'] if r['criterion_id'] == cid)


class MixedEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.task = task_eight()
        self.submission = {'answer': ANSWER, 'final_value': '800', 'final_unit': 'cm'}

    def evaluate(self, raw, **fields):
        return a.evaluate_task(self.task, {**self.submission, **fields}, 'attempt-realistic', lambda *unused: raw)

    def test_short_unit_quotes_and_omitted_interpretation_are_evaluable_not_all_uncertain(self):
        result = self.evaluate(response(self.task))
        self.assertTrue(result['valid'])
        self.assertEqual(result['evaluation_state'], 'COMPLETE')
        self.assertEqual([r['status'] for r in result['criteria']], ['MET', 'MET', 'MET', 'NOT_DEMONSTRATED'])
        self.assertEqual(row(result, 'units')['quote'], 'cm')
        full = self.evaluate(response(self.task, complete=True), answer=FULL_ANSWER)
        self.assertTrue(a.all_met({'evaluation': full, 'independent': True}))

    def test_format_tolerance_never_accepts_paraphrases_or_empty_reasons(self):
        raw = response(self.task)
        raw['criteria'][0].update(quote='«100   cm/m»', certainty=' SUPPORTED ', status=' met ', error=None)
        result = self.evaluate(raw)
        self.assertEqual(row(result, 'method')['quote'], '100 cm/m')
        self.assertEqual(row(result, 'method')['status'], 'MET')
        for mutation, code in [({'quote': '100 centímetros/metro'}, 'QUOTE_NOT_IN_ANSWER'),
                               ({'reason': '   '}, 'INSUFFICIENT_REASON'),
                               ({'certainty': 'confident'}, 'INVALID_CERTAINTY'),
                               ({'error': 'wrong factor'}, 'CONTRADICTORY_JUDGMENT')]:
            bad = response(self.task); bad['criteria'][0].update(mutation)
            result = self.evaluate(bad)
            self.assertEqual(row(result, 'method')['diagnostics'][0]['code'], code)
            self.assertEqual(row(result, 'method')['status'], 'UNCERTAIN')
            self.assertEqual(row(result, 'units')['status'], 'MET')

    def test_missing_fields_duplicate_ids_and_uncertain_criteria_are_isolated(self):
        for field, code in [('quote', 'MISSING_QUOTE'), ('reason', 'INSUFFICIENT_REASON'), ('certainty', 'INVALID_CERTAINTY')]:
            raw = response(self.task); del raw['criteria'][0][field]
            result = self.evaluate(raw)
            self.assertEqual(row(result, 'method')['diagnostics'][0]['code'], code)
            self.assertEqual(row(result, 'units')['status'], 'MET')
        raw = response(self.task); raw['criteria'][3].update(status='UNCERTAIN', certainty='uncertain', quote='')
        result = self.evaluate(raw)
        self.assertEqual(result['evaluation_state'], 'PARTIAL')
        self.assertFalse(result['valid'])
        self.assertFalse(a.all_met({'evaluation': result, 'independent': True}))
        raw['criteria'].append(copy.deepcopy(raw['criteria'][0]))
        self.assertEqual(row(self.evaluate(raw), 'method')['diagnostics'][0]['code'], 'DUPLICATE_CRITERION')
        raw = response(self.task); raw['criteria'].pop(0)
        self.assertEqual(row(self.evaluate(raw), 'method')['diagnostics'][0]['code'], 'MISSING_CRITERION')
        raw['criteria'].append({'criterion_id': ['invalid']})
        self.assertIn({'code': 'UNKNOWN_CRITERION'}, self.evaluate(raw)['diagnostics'])

    def test_objective_vetoes_run_after_invalid_envelope_and_semantic_uncertainty(self):
        for raw in [None, {}, {'task_id': 'wrong'}, response(self.task)]:
            if raw and 'criteria' in raw:
                for r in raw['criteria']: r.update(status='UNCERTAIN', certainty='uncertain')
            result = self.evaluate(raw, final_value='799', final_unit='m')
            self.assertEqual(result['evaluation_state'], 'PARTIAL')
            self.assertEqual(row(result, 'calculation')['status'], 'NOT_DEMONSTRATED')
            self.assertEqual(row(result, 'calculation')['validator'], 'decimal_exact_v1')
            self.assertEqual(row(result, 'units')['status'], 'NOT_DEMONSTRATED')
            self.assertEqual(row(result, 'method')['status'], 'UNCERTAIN')
            self.assertFalse(a.all_met({'evaluation': result, 'independent': True}))
        raw = response(self.task); raw['criteria'][3].update(status='UNCERTAIN')
        result = self.evaluate(raw, final_unit='m')
        self.assertEqual(row(result, 'units')['status'], 'NOT_DEMONSTRATED')
        self.assertEqual(row(result, 'method')['status'], 'MET')
        self.assertEqual(row(result, 'interpretation')['status'], 'UNCERTAIN')

    def test_matching_final_fields_never_rescue_bad_or_unknown_reasoning(self):
        raw = response(self.task); raw['criteria'][0].update(status='NOT_DEMONSTRATED', error='method')
        self.assertEqual(row(self.evaluate(raw), 'method')['status'], 'NOT_DEMONSTRATED')
        result = self.evaluate(None)
        self.assertTrue(all(r['status'] == 'UNCERTAIN' for r in result['criteria']))
        self.assertEqual(row(result, 'calculation')['checks'][0]['status'], 'PASS')
        self.assertEqual(row(result, 'units')['checks'][0]['status'], 'PASS')
        result = self.evaluate(response(self.task), final_value='', final_unit='m')
        self.assertEqual(row(result, 'calculation')['status'], 'UNCERTAIN')
        self.assertEqual(row(result, 'units')['status'], 'NOT_DEMONSTRATED')

    def test_provider_failure_preserves_objective_checks_without_leaking_exception(self):
        def fail(*unused): raise ValueError('secret-token private-person raw-answer')
        result = a.evaluate_task(self.task, {**self.submission, 'final_unit': 'm'}, 'attempt-realistic', fail)
        self.assertEqual(result['diagnostics'], [{'code': 'PROVIDER_UNAVAILABLE'}])
        self.assertEqual(row(result, 'units')['status'], 'NOT_DEMONSTRATED')
        self.assertEqual(row(result, 'method')['status'], 'UNCERTAIN')
        self.assertNotIn('secret-token', json.dumps(result))


class RealAdapterIntegrationTests(unittest.TestCase):
    def test_actual_adapter_truncated_output_preserves_independent_numeric_veto(self):
        task=task_eight()
        envelope={'candidates':[{'content':{'parts':[{'text':'{"criteria":['}]},'finishReason':'MAX_TOKENS'}]}
        with patch.dict(os.environ,{'GEMINI_API_KEY':'synthetic-test-key'}), patch.object(app.urllib.request,'urlopen',return_value=io.BytesIO(json.dumps(envelope).encode())):
            result=a.evaluate_task(task,{'answer':ANSWER,'final_value':'799','final_unit':'cm'},'attempt-realistic',app.gemini)
        self.assertEqual(result['diagnostics'],[{'code':'PROVIDER_UNAVAILABLE'}])
        self.assertEqual(row(result,'calculation')['status'],'NOT_DEMONSTRATED')
        self.assertEqual(row(result,'units')['status'],'UNCERTAIN')
        self.assertEqual(row(result,'units')['checks'][0]['status'],'PASS')

    def test_endpoint_uses_actual_gemini_adapter_with_realistic_json_and_safe_diagnostics(self):
        task = task_eight()
        with tempfile.TemporaryDirectory() as directory:
            memory = DurableMemory(Path(directory)/'db.sqlite3'); app.set_memory_for_tests(memory); app._ASSESSMENT_CACHE.clear()
            profile = memory.create_profile('Private person'); pid = profile['profile_id']
            state = {'active':'g', 'goals':[{'id':'g','goal':'Convertir unidades de longitud','nodes':[{'id':'n1','name':'Longitudes','prerequisites':[]}],
                     'events':[], 'authentic_tasks':[task], 'authentic_attempts':[]}]}
            memory.save(pid, state, profile['revision'])
            payload = {'profile_id':pid, 'goal_id':'g', 'task_id':task['task_id'], 'attempt_id':'attempt-realistic',
                       'submission':{'answer':ANSWER, 'final_value':'800', 'final_unit':'m'}}
            raw = response(task); raw['criteria'][3].update(status='UNCERTAIN', certainty='uncertain')
            envelope = {'candidates':[{'content':{'parts':[{'text':json.dumps(raw, ensure_ascii=False)}]}, 'finishReason':'STOP'}]}
            requests = []
            def urlopen(request, **unused):
                requests.append(json.loads(request.data))
                return io.BytesIO(json.dumps(envelope).encode())
            try:
                with patch.dict(os.environ, {'GEMINI_API_KEY':'synthetic-test-key'}), patch.object(app.urllib.request,'urlopen',side_effect=urlopen), self.assertLogs('assessment',level='WARNING') as logs:
                    result = app.assessment_evaluate(payload)['evaluation']
                    self.assertEqual(app.assessment_evaluate(payload)['evaluation'],result)
                self.assertEqual(len(requests),1)
                schema = requests[0]['generationConfig']['responseSchema']
                self.assertEqual(schema['properties']['criteria']['items']['properties']['certainty']['enum'], ['supported','uncertain'])
                self.assertEqual(result['evaluation_state'],'PARTIAL')
                self.assertEqual(row(result,'units')['status'],'NOT_DEMONSTRATED')
                self.assertEqual(row(result,'method')['status'],'MET')
                logged = '\n'.join(logs.output)
                for private in ['synthetic-test-key','Private person',pid,ANSWER,task['task_id']]: self.assertNotIn(private,logged)
                self.assertIn('SEMANTIC_UNCERTAINTY',logged)
                with self.assertRaises(ValueError):app.assessment_evaluate({**payload,'submission':{**payload['submission'],'final_unit':'cm'}})
                # Durable mixed result is replayed after server-memory recreation, never re-evaluated implicitly.
                state['goals'][0]['authentic_attempts']=[{'attempt_id':payload['attempt_id'],'task_id':task['task_id'],'submission':payload['submission'],'evaluation':result,'independent':True}]
                loaded=memory.load(pid);memory.save(pid,state,loaded['revision'])
                reopened=DurableMemory(Path(directory)/'db.sqlite3');app.set_memory_for_tests(reopened);app._ASSESSMENT_CACHE.clear()
                with patch.object(app,'gemini',side_effect=AssertionError('must reuse stored evaluation')):
                    self.assertEqual(app.assessment_evaluate(payload)['evaluation'],result)
                other=reopened.create_profile('Other');reopened.restore(other['profile_id'],reopened.export(pid))
                self.assertEqual(reopened.load(other['profile_id'])['store']['goals'][0]['authentic_attempts'][0]['evaluation'],result)
                empty=reopened.create_profile('Empty')
                with self.assertRaises(ValueError):app.assessment_evaluate({**payload,'profile_id':empty['profile_id']})
            finally:app.set_memory_for_tests(None);app._ASSESSMENT_CACHE.clear()

    def test_backend_mixed_result_is_consumed_by_the_active_frontend(self):
        task=task_eight();raw=response(task);raw['criteria'][3].update(status='UNCERTAIN',certainty='uncertain')
        submission={'answer':ANSWER,'final_value':'800','final_unit':'m'}
        result=a.evaluate_task(task,submission,'attempt-realistic',lambda *unused:raw)
        script=subprocess.run(['node','tests/assessment_mixed.test.js'],input=json.dumps({'task':task,'submission':submission,'evaluation':result}),text=True,capture_output=True,cwd=ROOT)
        self.assertEqual(script.returncode,0,script.stdout+script.stderr)


if __name__=='__main__':unittest.main()
