"""Local-only visual demonstration with a fixed, explicitly simulated judgement.

No production route or client payload can enable this provider. It is installed
only by this separate executable. The real provider is never called.
"""
import argparse
import copy
import os
import sys
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import app_legacy as app
from memory_store import DurableMemory,LocalDatabaseServerLock
from tools.seed_visual_demo import seed,_criterion_contract


def _repair_diagnosis():
    return {
        'plan_version':app.REPAIR_TEACHING_VERSION,
        'suspected_gaps':[{
            'gap_id':'demo-gap-equivalence','node_id':'fundamentos',
            'concept':'operaciones equivalentes en una igualdad',
            'reason':'La respuesta cambia solo un miembro de la igualdad.',
            'motivating_evidence':'El intento padre no conservó la equivalencia.',
            'confidence':0.82,'status':'SUSPECTED',
        }],
        'diagnostic_checks':[{
            'gap_id':'demo-gap-equivalence',
            'question':{
                'activity_id':'demo-repair-diagnostic',
                'prompt':'Si se resta 3 solo al miembro izquierdo de una igualdad, ¿por qué puede dejar de ser equivalente?',
                'reference':'Porque aplicar una operación a un solo miembro puede romper la igualdad.',
                'kind':'explanation','observable_dimensions':['conceptual'],
            },
        }],
    }


def _repair_teaching():
    def question(activity_id,prompt,reference,kind,dimension):
        return {'activity_id':activity_id,'prompt':prompt,'reference':reference,
                'kind':kind,'observable_dimensions':[dimension]}
    return {
        'plan_version':app.REPAIR_TEACHING_VERSION,'gap_id':'demo-gap-equivalence',
        'explanation':'Una ecuación conserva sus soluciones cuando aplicas la misma operación reversible a ambos miembros.',
        'worked_example':{
            'prompt':'Resuelve 2y + 6 = 14 conservando la igualdad.',
            'steps':['Resta 6 en ambos miembros: 2y = 8.','Divide ambos miembros entre 2: y = 4.'],
            'conclusion':'Comprobar y=4 produce 14=14.',
        },
        'expansion':'Piensa en una balanza: cambiar solo un plato altera el equilibrio; cambiar ambos del mismo modo lo conserva.',
        'guided_hints':['Identifica primero el término que quieres aislar.','Aplica la operación inversa a ambos miembros.'],
        'repair_activities':{
            'CHECK':question('demo-repair-check','¿Cuál opción conserva 5=5: sumar 2 a ambos miembros o solo a uno? Explica brevemente.','Sumar 2 a ambos miembros conserva la igualdad.','recognition','recognition'),
            'GUIDED':question('demo-repair-guided','En 3z + 4 = 19, indica con apoyo el primer paso aplicado a ambos miembros.','Restar 4 a ambos miembros para obtener 3z=15.','application','direct_application'),
            'INDEPENDENT':question('demo-repair-independent','Resuelve de forma independiente 4w - 7 = 21 y justifica cada transformación.','Sumar 7 a ambos miembros y dividir ambos entre 4; w=7.','application','direct_application'),
        },
        'independent_retries':[question('demo-repair-independent-retry','Resuelve sin ayuda 6q + 5 = 29 y justifica las operaciones.','Restar 5 a ambos miembros y dividir ambos entre 6; q=4.','application','direct_application')],
        'parent_retest':question('demo-repair-parent-retest','Resuelve 5p + 10 = 35 explicando por qué conservas la igualdad.','Restar 10 a ambos miembros y dividir ambos entre 5; p=5.','equation_manipulation','equation_manipulation'),
        'transfer_check':question('demo-repair-transfer','Una tarifa total es 3c + 12 = 42. Determina c y explica cómo cambia el contexto, no la regla de equivalencia.','Restar 12 y dividir entre 3; c=10.','transfer','transfer'),
        'transfer_novelty_status':'CONFIRMED',
        'transfer_novelty_basis':'La variante traslada la ecuación simbólica a una decisión de tarifa con interpretación contextual.',
    }


def _controlled_lesson():
    def question(prompt,reference,kind,dimensions):
        return {'prompt':prompt,'reference':reference,'kind':kind,'observable_dimensions':dimensions}
    return {
        'explanation':'Una ecuación conserva sus soluciones al aplicar la misma operación reversible a ambos miembros.',
        'example':'2x + 4 = 10; resta 4 en ambos miembros y después divide ambos entre 2.',
        'common_error':'Modificar solo un miembro rompe la equivalencia.',
        'check':question('¿Por qué se opera en ambos miembros?','Para conservar la igualdad.','explanation',['conceptual']),
        'guided':question('Explica el primer paso en 3x+4=16.','Restar 4 a ambos miembros.','application',['direct_application']),
        'independent':question('Resuelve 5x+3=28 y justifica.','Restar 3 y dividir entre 5; x=5.','application',['direct_application']),
        'integration':question('Aplica el principio a una tarifa 2c+5=19.','Restar 5 y dividir entre 2; c=7.','transfer',['transfer']),
    }


def _controlled_map():
    specs=[
        ('demo-foundation-skill','Equivalencia de ecuaciones','Explicar y aplicar operaciones equivalentes.',[]),
        ('demo-variables','Variables y constantes','Distinguir variables y constantes.',['demo-foundation-skill']),
        ('demo-units','Consistencia de unidades','Comprobar unidades compatibles.',['demo-foundation-skill']),
        ('demo-method','Selección de operación','Elegir una operación reversible.',['demo-variables']),
        ('demo-transfer','Aplicación contextual','Aplicar equivalencia en un caso nuevo.',['demo-method']),
    ]
    nodes=[];coverage=[]
    for node_id,name,outcome,prerequisites in specs:
        nodes.append({'id':node_id,'name':name,'outcome':outcome,'level':0,'prerequisites':prerequisites,'kind':'concept',
          'probe':{'prompt':'Explica brevemente: '+name+'.','reference':outcome,'kind':'explanation','observable_dimensions':['conceptual']}})
        coverage.append({'id':node_id,'name':name,'kind':'concept','priority':'high','prerequisites':prerequisites,
          'contexts':['ecuaciones'],'dimensions':[{'id':'conceptual','name':'Comprensión conceptual','required':True}]})
    return {'nodes':nodes,'coverage':coverage}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db',type=Path,required=True)
    parser.add_argument('--port',type=int,default=8906)
    parser.add_argument('--resume',action='store_true')
    parser.add_argument('--semantic',choices=['SATISFIED','PARTIAL','NOT_SATISFIED','NOT_EVALUATED','unavailable','invalid'],default='SATISFIED')
    parser.add_argument('--hold-evaluation',action='store_true',help='Wait for Enter in terminal after reserving evaluation; Ctrl+C simulates interruption')
    parser.add_argument('--fail-once',choices=['none','diagnose','teach','evaluate'],default='none',help='Controlled one-shot network-style failure for UI recovery checks')
    parser.add_argument('--fail-save-once',action='store_true',help='Reject the first profile save in this harness process')
    args=parser.parse_args();db=args.db.expanduser().resolve()
    if db.is_relative_to(ROOT):parser.error('Use a temporary database outside the repository.')
    marker=db.with_suffix('.demo-marker')
    if args.resume:
        if not db.exists() or not marker.exists() or marker.read_text()!='learnscience-controlled-demo-v1':
            parser.error('Resume accepts only a database created by this harness.')
    else:parser.error('Prepare with --prepare --db NEW_PATH, then start with --resume.')
    os.environ.pop('GEMINI_API_KEY',None)
    with LocalDatabaseServerLock(db) as lock:
        app._MEMORY=DurableMemory(db);app._SERVER_DB_LOCK=lock
        app.HOST='127.0.0.1';app.PORT=args.port
        failures={args.fail_once:1} if args.fail_once!='none' else {}
        def fail_once(name):
            if failures.get(name,0):
                failures[name]-=1
                raise ValueError('DEMO fallo controlado de red en '+name+'; reintenta explícitamente.')
        def provider(prompt,schema,max_tokens=2000):
            if schema is app.MAP_SCHEMA:
                return _controlled_map()
            if schema is app.FOUNDATION_PROPOSAL_SCHEMA:
                return {'statement':'Aplicar la misma operación reversible a ambos miembros conserva el conjunto de soluciones.',
                        'conditions':['La operación debe estar definida','Debe aplicarse a ambos miembros']}
            if schema is app.STAGE_SCHEMA:
                return _controlled_lesson()
            if schema is app.CRITERION_ACTIVITY_PROVIDER_SCHEMA:
                raw=copy.deepcopy(_criterion_contract());raw['activity_id']='demo-'+uuid.uuid4().hex
                raw['correct_option_id']='subtract-both';raw['explanation_reference']='Restar ocho a ambos miembros es reversible y conserva las soluciones de la ecuación.'
                return raw
            if schema is app.REPAIR_DIAGNOSIS_SCHEMA:
                fail_once('diagnose');return _repair_diagnosis()
            if schema is app.REPAIR_TEACHING_SCHEMA:
                fail_once('teach');return _repair_teaching()
            if schema is app.EVAL_SCHEMA:
                fail_once('evaluate')
                answer=prompt.rsplit('intento:',1)[-1].casefold()
                if 'incorrecta' in answer or 'no comprendo' in answer:return {'status':'PARTIAL','feedback':'DEMO: todavía falta conservar la igualdad en ambos miembros.','error_type':'prerequisite','hint':''}
                return {'status':'CORRECT','feedback':'DEMO: resultado controlado correcto.','error_type':'none','hint':''}
            if schema is app.CRITERION_EXPLANATION_SCHEMA:
                if args.hold_evaluation:input('Evaluación reservada. Enter finaliza; detener proceso conserva PENDING: ')
                if args.semantic=='unavailable':raise ValueError('DEMO proveedor no disponible')
                if args.semantic=='invalid':return {'status':'unsupported'}
                return {'status':args.semantic,'observation':'DEMONSTRACIÓN: juicio fijo '+args.semantic+'; no analiza la calidad de tu explicación.'}
            raise ValueError('DEMO: esta operación no tiene proveedor controlado; no se llamó a una API.')
        app.gemini=provider
        app.HTML=app.HTML.replace('<body>','<body><div role="status" style="padding:12px;background:#ffe08a;color:#111">DEMOSTRACIÓN · proveedor controlado · sin llamadas reales · juicio fijo '+args.semantic+'</div>')
        save_failures={'remaining':1 if args.fail_save_once else 0}
        class DemoHandler(app.Handler):
            def do_POST(self):
                if self.path=='/api/profile/save' and save_failures['remaining']:
                    save_failures['remaining']-=1
                    self.respond(503,{'error':'DEMO fallo controlado de guardado; el contenido no fue confirmado.'})
                    return
                super().do_POST()
        server=ThreadingHTTPServer((app.HOST,args.port),DemoHandler)
        print(f'DEMOSTRACIÓN http://127.0.0.1:{args.port}/',flush=True)
        try:server.serve_forever()
        except KeyboardInterrupt:pass
        finally:server.server_close()


if __name__=='__main__':
    # Preparation is deliberately separate: no silently reused user databases.
    if '--prepare' in sys.argv:
        p=argparse.ArgumentParser();p.add_argument('--prepare',action='store_true');p.add_argument('--db',type=Path,required=True)
        a=p.parse_args();seed(a.db);a.db.resolve().with_suffix('.demo-marker').write_text('learnscience-controlled-demo-v1')
        print('Synthetic demonstration created. Start with --resume and the same --db.')
    else:main()
