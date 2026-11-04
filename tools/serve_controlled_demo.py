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


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db',type=Path,required=True)
    parser.add_argument('--port',type=int,default=8906)
    parser.add_argument('--resume',action='store_true')
    parser.add_argument('--semantic',choices=['SATISFIED','PARTIAL','NOT_SATISFIED','NOT_EVALUATED','unavailable','invalid'],default='SATISFIED')
    parser.add_argument('--hold-evaluation',action='store_true',help='Wait for Enter in terminal after reserving evaluation; Ctrl+C simulates interruption')
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
        def provider(prompt,schema,max_tokens=2000):
            if schema is app.CRITERION_ACTIVITY_PROVIDER_SCHEMA:
                raw=copy.deepcopy(_criterion_contract());raw['activity_id']='demo-'+uuid.uuid4().hex
                raw['correct_option_id']='subtract-both';raw['explanation_reference']='Restar ocho a ambos miembros es reversible y conserva las soluciones de la ecuación.'
                return raw
            if schema is not app.CRITERION_EXPLANATION_SCHEMA:
                raise ValueError('DEMO: esta operación no tiene proveedor controlado; no se llamó a una API.')
            if args.hold_evaluation:input('Evaluación reservada. Enter finaliza; detener proceso conserva PENDING: ')
            if args.semantic=='unavailable':raise ValueError('DEMO proveedor no disponible')
            if args.semantic=='invalid':return {'status':'unsupported'}
            return {'status':args.semantic,'observation':'DEMONSTRACIÓN: juicio fijo '+args.semantic+'; no analiza la calidad de tu explicación.'}
        app.gemini=provider
        app.HTML=app.HTML.replace('<body>','<body><div role="status" style="padding:12px;background:#ffe08a;color:#111">DEMOSTRACIÓN · proveedor controlado · sin llamadas reales · juicio fijo '+args.semantic+'</div>')
        server=ThreadingHTTPServer((app.HOST,args.port),app.Handler)
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
