"""Controlled tests for criterion_assessment_v1."""
import copy
import json
import sys
import threading
import tempfile
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy
from memory_store import DurableMemory, validate_store

app_legacy.set_memory_for_tests(DurableMemory(tempfile.mkdtemp(prefix='criterion-test-') + '/criteria.sqlite3'))
PROFILE_A = app_legacy.memory().create_profile('criterion-a')['profile_id']
PROFILE_HTTP = app_legacy.memory().create_profile('criterion-http')['profile_id']

activity = {
    'schema_version':'criterion_assessment_v1','activity_id':'activity-1',
    'type':'multiple_choice_explanation','phase':'INDEPENDENT',
    'prompt':'¿Qué cambia al invertir una ecuación?',
    'options':[{'id':'a','text':'Se conserva la igualdad'},{'id':'b','text':'Solo se cambia un lado'}],
    'correct_option_id':'a',
    'criteria':[
        {'criterion_id':'option_choice','observable_dimension':'recognition','required':True,'description':'Elegir la propiedad correcta.'},
        {'criterion_id':'explanation','observable_dimension':'conceptual','required':True,'description':'Explicar por qué se conserva la igualdad.'},
    ],
    'help':{'enabled':True,'critical':True},'variant':'ecuacion-inversa-1','context':'sintetico',
}

original = app_legacy.gemini
db_path = app_legacy.memory().path
try:
    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: copy.deepcopy(activity)
    public = app_legacy.make_criterion_activity({'profile_id':PROFILE_A,'goal_id':'goal-a','goal':'Álgebra','concept':'Operaciones inversas'})
    assert 'correct_option_id' not in public
    assert public['schema_version'] == 'criterion_assessment_v1'
    assert [x['criterion_id'] for x in public['criteria']] == ['option_choice','explanation']

    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: {'status':'SATISFIED','observation':'Explica la conservación.'}
    result = app_legacy.evaluate_criterion_activity({'profile_id':PROFILE_A,'goal_id':'goal-a','activity_id':'activity-1','selected_option_id':'a','explanation':'La misma operación mantiene ambos lados equilibrados.','attempt_id':'attempt-1','criterion_description':'Explicar por qué se conserva la igualdad.','help_used':0})
    assert result['overall'] == 'CORRECT'
    assert all(x['status'] == 'SATISFIED' for x in result['criteria'])

    helped = app_legacy.evaluate_criterion_activity({'profile_id':PROFILE_A,'goal_id':'goal-a','activity_id':'activity-1','selected_option_id':'a','explanation':'La misma operación mantiene ambos lados equilibrados.','attempt_id':'attempt-2','criterion_description':'Explicar por qué se conserva la igualdad.','help_used':1})
    assert helped['overall'] == 'PARTIAL'
    assert helped['independent'] is False

    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: (_ for _ in ()).throw(ValueError('provider unavailable'))
    unknown = app_legacy.evaluate_criterion_activity({'profile_id':PROFILE_A,'goal_id':'goal-a','activity_id':'activity-1','selected_option_id':'a','explanation':'No sé explicarlo.','attempt_id':'attempt-3','criterion_description':'Explicar por qué se conserva la igualdad.','help_used':0})
    assert unknown['overall'] == 'PARTIAL'
    assert next(x for x in unknown['criteria'] if x['criterion_id']=='explanation')['status'] == 'NOT_EVALUATED'

    # Recreate the persistence object to simulate a server restart. The
    # already evaluated attempt is recovered without another provider call.
    app_legacy.set_memory_for_tests(DurableMemory(db_path))
    app_legacy.gemini = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError('no provider call on idempotent recovery'))
    recovered = app_legacy.evaluate_criterion_activity({'profile_id':PROFILE_A,'goal_id':'goal-a','activity_id':'activity-1','selected_option_id':'a','explanation':'La misma operación mantiene ambos lados equilibrados.','attempt_id':'attempt-1','criterion_description':'Explicar por qué se conserva la igualdad.','help_used':0})
    assert recovered['attempt_id'] == 'attempt-1'
    try:
        app_legacy.evaluate_criterion_activity({'profile_id':PROFILE_A,'goal_id':'goal-a','activity_id':'activity-1','selected_option_id':'b','explanation':'Texto distinto.','attempt_id':'attempt-1','criterion_description':'Explicar por qué se conserva la igualdad.','help_used':0})
    except ValueError as exc:
        assert 'attempt_id' in str(exc)
    else:
        raise AssertionError('Se permitió reutilizar attempt_id con contenido distinto')
    try:
        app_legacy.evaluate_criterion_activity({'profile_id':PROFILE_HTTP,'goal_id':'goal-a','activity_id':'activity-1','selected_option_id':'a','explanation':'Texto.','attempt_id':'attempt-other-profile','criterion_description':'Explicar por qué se conserva la igualdad.','help_used':0})
    except ValueError as exc:
        assert 'desconocida' in str(exc) or 'contrato' in str(exc)
    else:
        raise AssertionError('Un perfil distinto accedió a la actividad')
    exported = app_legacy.memory().export(PROFILE_A)
    assert 'correct_option_id' not in json.dumps(exported)
    assert app_legacy.memory().load_criterion_activity(PROFILE_A, 'activity-1') is not None
    app_legacy.memory().delete_profile(PROFILE_A)
    assert app_legacy.memory().load_criterion_activity(PROFILE_A, 'activity-1') is None

    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: copy.deepcopy(activity)
    server = ThreadingHTTPServer(('127.0.0.1', 0), app_legacy.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        def post(path, payload):
            req=urllib.request.Request(f'http://127.0.0.1:{server.server_port}{path}', data=json.dumps(payload).encode(), headers={'Content-Type':'application/json'}, method='POST')
            with urllib.request.urlopen(req) as response: return json.load(response)
        visible=post('/api/criteria/activity', {'profile_id':PROFILE_HTTP,'goal_id':'goal-http','goal':'Álgebra','concept':'Operaciones inversas'})
        assert 'correct_option_id' not in visible
        http_result=post('/api/criteria/evaluate', {'profile_id':PROFILE_HTTP,'goal_id':'goal-http','activity_id':visible['activity_id'],'selected_option_id':'a','explanation':'La igualdad se conserva.','attempt_id':'attempt-http','criterion_description':'Explicar por qué se conserva la igualdad.','help_used':0})
        assert http_result['attempt_id']=='attempt-http'
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=2)

    for bad in [
        {**activity,'options':[{'id':'a','text':'A'},{'id':'a','text':'duplicada'}]},
        {**activity,'correct_option_id':'missing'},
        {**activity,'criteria':[{'criterion_id':'option_choice','observable_dimension':'conceptual','required':True,'description':'incorrecta'}]},
    ]:
        try:
            app_legacy._criterion_activity_public(bad)
        except ValueError:
            pass
        else:
            raise AssertionError('Se aceptó un contrato de criterios inválido')
    durable = {'active':'goal-criteria','goals':[{'id':'goal-criteria','nodes':[{'id':'n1'}],'coverage':[{'id':'n1','dimensions':[]}],'learner':{},'lessons':{'n1':{}},'reviews':[],'events':[{'type':'EVIDENCE','attempt_id':'attempt-durable','activity_id':'activity-1','node_id':'n1','evidence_id':'evidence-durable'}],'criterion_assessments':[{'schema_version':'criterion_assessment_v1','attempt_id':'attempt-durable','activity_id':'activity-1','criteria':[],'overall':'PARTIAL'}]}]}
    validate_store(durable, 'profile-durable')
finally:
    app_legacy.gemini = original

print('criterion_assessment.test.py PASS')
