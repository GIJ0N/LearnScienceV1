"""graded_hints_v1 backend: criterion evaluation, lesson adaptation and durable
store. Controlled provider only (app_legacy.gemini is replaced); SQLite in tempdir."""
import copy
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy
from memory_store import DurableMemory, normalize_hint_level, validate_store

# 1. Normalización conservadora.
assert normalize_hint_level(None) is None
assert normalize_hint_level(0) == 0
assert normalize_hint_level(3) == 3
assert normalize_hint_level('4') == 4
assert normalize_hint_level(2.2) == 3
assert normalize_hint_level(-1) == 0
assert normalize_hint_level(12) == 5
for bad in ('alto', float('nan'), float('inf'), True, {}, []):
    assert normalize_hint_level(bad) == 5, bad

app_legacy.set_memory_for_tests(DurableMemory(tempfile.mkdtemp(prefix='graded-hints-') + '/hints.sqlite3'))
PROFILE = app_legacy.memory().create_profile('graded-hints')['profile_id']

activity = {
    'schema_version': 'criterion_assessment_v1', 'activity_id': 'activity-hints',
    'type': 'multiple_choice_explanation', 'phase': 'INDEPENDENT',
    'prompt': '¿Qué conserva una operación inversa aplicada a ambos lados?',
    'options': [{'id': 'a', 'text': 'La igualdad'}, {'id': 'b', 'text': 'Solo un lado'}],
    'correct_option_id': 'a',
    'explanation_reference': 'Aplicar la misma operación reversible a ambos miembros conserva el conjunto de soluciones.',
    'criteria': [
        {'criterion_id': 'option_choice', 'observable_dimension': 'recognition', 'required': True, 'description': 'Elegir la propiedad.'},
        {'criterion_id': 'explanation', 'observable_dimension': 'conceptual', 'required': True, 'description': 'Explicar la conservación.'},
    ],
    'help': {'enabled': True, 'critical': True}, 'variant': 'v1', 'context': 'sintetico',
}
original = app_legacy.gemini
seen_prompts = []
try:
    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: copy.deepcopy(activity)
    public = app_legacy.make_criterion_activity({'profile_id': PROFILE, 'goal_id': 'goal-h', 'goal': 'Álgebra', 'concept': 'Inversas'})
    aid = public['activity_id']

    def controlled(prompt, schema, max_tokens=2000):
        seen_prompts.append(prompt)
        return {'status': 'SATISFIED', 'observation': 'Explica la conservación.'}
    app_legacy.gemini = controlled
    base = {'profile_id': PROFILE, 'goal_id': 'goal-h', 'activity_id': aid, 'selected_option_id': 'a',
            'explanation': 'La misma operación en ambos lados mantiene el equilibrio.', 'criterion_description': 'Explicar la conservación.'}

    # 2. Sin pista: independiente y nivel null (compatibilidad).
    clean = app_legacy.evaluate_criterion_activity({**base, 'attempt_id': 'h-0', 'help_used': 0})
    assert clean['independent'] is True and clean['hint_level_max'] is None and clean['help_used'] == 0

    # 3. Pista P0 con help_used=0 reportado: igual impide independencia y cuenta como ayuda.
    p0 = app_legacy.evaluate_criterion_activity({**base, 'attempt_id': 'h-1', 'help_used': 0, 'hint_level_max': 0})
    assert p0['overall'] == 'CORRECT', 'la corrección sobrevive a la ayuda'
    assert p0['independent'] is False and p0['hint_level_max'] == 0 and p0['help_used'] >= 1
    assert '"hint_level_max": 0' in seen_prompts[-1], 'el evaluador recibe el nivel como dato de asistencia'

    # 4. Nivel ilegible se trata como el más revelador.
    weird = app_legacy.evaluate_criterion_activity({**base, 'attempt_id': 'h-2', 'help_used': 1, 'hint_level_max': 'mucho'})
    assert weird['hint_level_max'] == 5 and weird['independent'] is False

    # 5. Idempotencia: el mismo intento con el mismo nivel se recupera; con otro nivel es otro contenido.
    app_legacy.gemini = lambda *a, **k: (_ for _ in ()).throw(AssertionError('sin llamada al proveedor en recuperación'))
    again = app_legacy.evaluate_criterion_activity({**base, 'attempt_id': 'h-1', 'help_used': 0, 'hint_level_max': 0})
    assert again['fingerprint'] == p0['fingerprint']
    try:
        app_legacy.evaluate_criterion_activity({**base, 'attempt_id': 'h-1', 'help_used': 1, 'hint_level_max': 4})
    except ValueError as exc:
        assert 'attempt_id' in str(exc)
    else:
        raise AssertionError('Se reutilizó attempt_id con otro nivel de pista')
    # Huella legacy estable: sin nivel no cambia el payload histórico.
    legacy_fp = app_legacy._criterion_fingerprint('p', 'g', 'a', 't', 'a', 'x', 0, 'r', 'd')
    assert legacy_fp == app_legacy._criterion_fingerprint('p', 'g', 'a', 't', 'a', 'x', 0, 'r', 'd', None)
    assert legacy_fp != app_legacy._criterion_fingerprint('p', 'g', 'a', 't', 'a', 'x', 0, 'r', 'd', 0)

    # 6. Otro perfil no accede a la actividad aunque declare nivel.
    other = app_legacy.memory().create_profile('graded-other')['profile_id']
    try:
        app_legacy.evaluate_criterion_activity({**base, 'profile_id': other, 'attempt_id': 'h-x', 'help_used': 0, 'hint_level_max': 0})
    except ValueError:
        pass
    else:
        raise AssertionError('Otro perfil evaluó la actividad')
finally:
    app_legacy.gemini = original

# 7. Adaptación de lección: un acierto marcado independiente pero con pista registrada no consolida.
attempt = {'attempt_id': 'a1', 'phase': 'INDEPENDENT', 'result': 'CORRECT', 'help_used': 0,
           'event': {'observed_dimensions': ['units'], 'is_independent': True, 'hint_level_max': 1}}
mode, _, _ = app_legacy.lesson_adaptation([attempt], 'units')
assert mode == 'scaffold', mode
legacy_attempt = {**attempt, 'event': {'observed_dimensions': ['units'], 'is_independent': True}}
assert app_legacy.lesson_adaptation([legacy_attempt], 'units')[0] == 'consolidate', 'legacy sin nivel se comporta igual que antes'

# 8. Store durable: validate_store normaliza el nivel y fuerza no-independencia; legacy intacto.
def store(events):
    return {'goals': [{'id': 'goal-s', 'goal': 'Meta', 'nodes': [{'id': 'n1', 'name': 'n1'}], 'events': events,
                       'session': {'mode': 'DIAGNOSTIC', 'node': None, 'stack': [], 'stage': 'teach', 'tries': 0}}], 'active': 'goal-s'}
validated, _ = validate_store(store([
    {'type': 'EVIDENCE', 'attempt_id': 's-1', 'node_id': 'n1', 'result': 'CORRECT', 'help_used': 0, 'is_independent': True, 'independent': True, 'hint_level_max': '2'},
    {'type': 'EVIDENCE', 'attempt_id': 's-2', 'node_id': 'n1', 'result': 'CORRECT', 'help_used': 0, 'is_independent': True},
    {'type': 'EVIDENCE', 'attempt_id': 's-3', 'node_id': 'n1', 'result': 'CORRECT', 'help_used': 0, 'is_independent': True, 'hint_level_max': None},
]), PROFILE)
e1, e2, e3 = validated['goals'][0]['events']
assert e1['hint_level_max'] == 2 and e1['is_independent'] is False and e1['independent'] is False and e1['help_used'] == 1
assert 'hint_level_max' not in e2 and e2['is_independent'] is True, 'legacy: no se inventa nivel ni se cambia independencia'
assert e3['hint_level_max'] is None and e3['is_independent'] is True

# 9. Persistencia: el nivel sobrevive guardado/recarga y llega a la memoria relevante.
mem = app_legacy.memory()
saved = store([{'type': 'EVIDENCE', 'attempt_id': 'p-1', 'node_id': 'n1', 'phase': 'GUIDED', 'result': 'CORRECT', 'help_used': 2, 'is_independent': False, 'hint_level_max': 4, 'at': 10}])
mem.save(PROFILE, saved, mem.load(PROFILE)['revision'])
reloaded = DurableMemory(mem.path).load(PROFILE)['store']['goals'][0]['events'][0]
assert reloaded['hint_level_max'] == 4
sources = mem.relevant_memory(PROFILE, 'goal-s', 'n1')['sources']
assert sources[0]['hint_level_max'] == 4 and sources[0]['help_used'] == 2

print('OK: backend de pistas graduadas — criterio, adaptación, store durable y compatibilidad legacy.')
