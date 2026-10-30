"""Offline, versioned policy benchmark. Does not measure model judgement quality."""
import argparse
import copy
import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import app_legacy as app
from memory_store import DurableMemory

CASES=ROOT/'tests/fixtures/criterion_benchmark_v1.json'


def run():
    bank=json.loads(CASES.read_text(encoding='utf-8'))
    rows=[]
    with tempfile.TemporaryDirectory(prefix='criterion-bank-') as directory:
        app.set_memory_for_tests(DurableMemory(Path(directory)/'bank.sqlite3'))
        pid=app.memory().create_profile('BENCHMARK SYNTHETIC')['profile_id']
        for domain in bank['domains']:
            raw=dict(schema_version=app.CRITERION_ASSESSMENT_VERSION,activity_id=domain['id'],type='multiple_choice_explanation',phase='INDEPENDENT',
                prompt=domain['question'],options=domain['options'],correct_option_id=domain['key'],explanation_reference=domain['reference'],
                criteria=[dict(criterion_id='option_choice',observable_dimension='recognition',required=True,description='Seleccionar la opción válida'),
                          dict(criterion_id='explanation',observable_dimension='conceptual',required=True,description='Justificar mediante el principio pertinente')],
                help=dict(enabled=True,critical=True),variant=domain['id'],context=domain['id'])
            with patch.object(app,'gemini',return_value=raw):
                public=app.make_criterion_activity(dict(profile_id=pid,goal_id=domain['id'],goal=domain['id'],concept=domain['id']))
            for case in domain['cases']:
                payload=dict(profile_id=pid,goal_id=domain['id'],activity_id=public['activity_id'],attempt_id=domain['id']+'-'+case['id'],
                    selected_option_id=case['choice'],explanation=case['answer'],help_used=case.get('help',0))
                with patch.object(app,'gemini',return_value=copy.deepcopy(case['provider'])) as model:
                    result=app.evaluate_criterion_activity(payload)
                    recovered=app.evaluate_criterion_activity(payload)
                truth=case['expected']
                row=dict(domain=domain['id'],case=case['id'],overall=result['overall'],explanation_status=result['criteria'][1]['status'],
                    false_accreditation=result['overall']=='CORRECT' and truth['overall']!='CORRECT',
                    abstention=result['criteria'][1]['status']=='NOT_EVALUATED',
                    disagreement=result['overall']!=truth['overall'] or result['criteria'][1]['status']!=truth['explanation'],
                    duplicate=model.call_count!=1 or recovered!=result,
                    assisted_independent=bool(case.get('help')) and result['independent'])
                rows.append(row)
    count=len(rows)
    report={'bank_version':bank['version'],'cases':count,'domains':len(bank['domains']),'real_api_calls':0,
        'metrics':{key:{'count':sum(bool(r[key]) for r in rows),'denominator':count} for key in ['false_accreditation','abstention','disagreement','duplicate','assisted_independent']},'rows':rows}
    assert not any(r['false_accreditation'] or r['disagreement'] or r['duplicate'] or r['assisted_independent'] for r in rows)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--real-review-template',action='store_true',help='Emit a future human review template; never makes API calls')
    args=parser.parse_args()
    if args.real_review_template:
        print(json.dumps({'requires_separate_authorization':True,'cases_file':str(CASES),'fields':['case_id','model_version','response','human_status','rationale','cost','call_count'],'maximum_calls':21,'executed':False},ensure_ascii=False,indent=2))
    else:print(json.dumps(run(),ensure_ascii=False,indent=2))
