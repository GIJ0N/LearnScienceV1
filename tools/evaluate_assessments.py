"""Reference corpus checks; --live additionally calls the configured provider (no student data)."""
import argparse
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import assessment_service as assessment

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live',action='store_true',help='Calls Gemini for the synthetic reference corpus; uses configured API key.')
    args=parser.parse_args()
    tasks=json.loads((ROOT/'tests/fixtures/authentic_tasks.json').read_text())
    cases=json.loads((ROOT/'tests/fixtures/evaluation_cases.json').read_text())['cases']
    assert len({c['id'] for c in cases})==len(cases)
    families=set(); report=[]
    for case in cases:
        task=assessment.validate_task(tasks[case['task']]);families.add(task['family'])
        ids={r['id'] for r in task['rubric']}
        assert set(case['expected'])<=ids
        assert all(set(allowed)<={'MET','PARTIAL','NOT_DEMONSTRATED'} and allowed for allowed in case['expected'].values())
        assert case['submission']['answer'].strip()
        if case.get('deterministic_veto'):
            # Optimistic provider cannot override objective numeric/unit constraints.
            def optimistic(*unused):
                return {'task_id':task['task_id'],'task_version':task['version'],'attempt_id':case['id'],
                        'criteria':[{'criterion_id':r['id'],'status':'MET','quote':case['submission']['answer'],'reason':'Juicio optimista simulado para probar el veto determinista.','certainty':'supported','error':''} for r in task['rubric']]}
            result=assessment.evaluate_task(task,case['submission'],case['id'],optimistic)
            assert result['valid']
            assert all(next(r for r in result['criteria'] if r['criterion_id']==cid)['status']=='NOT_DEMONSTRATED' for cid in case['deterministic_veto'])
        if args.live:
            from app_legacy import gemini
            result=assessment.evaluate_task(task,case['submission'],case['id'],gemini)
            observed={r['criterion_id']:r['status'] for r in result['criteria']}
            deviations={cid:observed[cid] for cid,allowed in case['expected'].items() if observed[cid] not in allowed}
            report.append({'case':case['id'],'classification':'UNCERTAIN' if not result['valid'] else 'DEVIATION' if deviations else 'MATCH','deviations':deviations,'evaluation':result})
    assert len(families)>=3
    if args.live:
        print(json.dumps({'note':'Resultados exploratorios por caso; no son una estimación de precisión ni una certificación. Revisar citas y razones manualmente.','results':report},ensure_ascii=False,indent=2))
        return int(any(r['classification']=='DEVIATION' for r in report))
    print(f'{len(cases)} reference cases across {len(families)} families validated; deterministic vetoes passed. Live semantic evaluation NOT RUN.')
    return 0

if __name__=='__main__':sys.exit(main())
