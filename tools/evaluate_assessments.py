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
    parser.add_argument('--reproduce',action='store_true',help='Use four synthetic 8 m cases: expression, full answer, wrong unit and wrong number.')
    args=parser.parse_args()
    tasks=json.loads((ROOT/'tests/fixtures/authentic_tasks.json').read_text())
    cases=json.loads((ROOT/'tests/fixtures/evaluation_cases.json').read_text())['cases']
    if args.reproduce:
        # Keep the checked-in fixture immutable. The four cases intentionally use
        # a fresh, validated 8 m contract so the command is deterministic.
        import copy
        reproduced=copy.deepcopy(tasks['engineering'])
        reproduced['parameters']['total_m']=8
        reproduced['prompt'],reproduced['known_data'],reproduced['demands']=assessment.quantitative_content(reproduced['blueprint'],reproduced['parameters'])
        tasks['engineering']=reproduced
        expression='8 m × 100 cm/m = 800 cm'
        cases=[{'id':'expression_8m','task':'engineering','submission':{'answer':expression,'final_value':'800','final_unit':'cm'},
                'expected':{'method':['MET'],'calculation':['MET'],'units':['MET'],'interpretation':['PARTIAL','NOT_DEMONSTRATED']}},
               {'id':'complete_8m','task':'engineering','submission':{'answer':expression+'. El factor conserva la longitud: el pedido representa ocho metros expresados en centímetros. Compruebo que al dividir 800 cm entre 100 cm/m recupero los 8 m pedidos.','final_value':'800','final_unit':'cm'},
                'expected':{'method':['MET'],'calculation':['MET'],'units':['MET'],'interpretation':['MET']}},
               {'id':'wrong_unit_8m','task':'engineering','submission':{'answer':expression,'final_value':'800','final_unit':'m'},
                'expected':{'units':['NOT_DEMONSTRATED']},'deterministic_veto':['units']},
               {'id':'wrong_number_8m','task':'engineering','submission':{'answer':expression,'final_value':'799','final_unit':'cm'},
                'expected':{'calculation':['NOT_DEMONSTRATED']},'deterministic_veto':['calculation']}]
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
            deviations={cid:observed[cid] for cid,allowed in case['expected'].items() if observed[cid]!='UNCERTAIN' and observed[cid] not in allowed}
            uncertain=[cid for cid in case['expected'] if observed[cid]=='UNCERTAIN']
            report.append({'case':case['id'],'classification':'DEVIATION' if deviations else 'UNRESOLVED' if uncertain else 'MATCH',
                           'deviations':deviations,'uncertain_criteria':uncertain,'evaluation':result})
    assert args.reproduce or len(families)>=3
    if args.live:
        print(json.dumps({'note':'Resultados exploratorios por caso; no son una estimación de precisión ni una certificación. Revisar citas y razones manualmente.','results':report},ensure_ascii=False,indent=2))
        # Uncertainty is not a test pass, even when it correctly avoids false learning evidence.
        return 1 if any(r['classification']=='DEVIATION' for r in report) else 2 if any(r['classification']=='UNRESOLVED' for r in report) else 0
    print(f'{len(cases)} reference cases across {len(families)} families validated; deterministic vetoes passed. Live semantic evaluation NOT RUN.')
    return 0

if __name__=='__main__':sys.exit(main())
