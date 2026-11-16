"""judge_model_v1: roles de modelo (generar / auditar / calificar), fallos conservadores y herramienta de muestra.

Proveedor controlado (urlopen simulado), SQLite temporal, sin red.
"""
import copy
import hashlib
import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools'))
import app_legacy as app
import sample_for_review
from memory_store import DurableMemory

SECRET = 'clave-secreta-de-prueba-123'
QUESTION = {'prompt': '¿Por qué flota el hielo?', 'reference': 'Densidad menor que el agua líquida.'}
EVAL_OK = {'status': 'CORRECT', 'feedback': 'Bien.', 'error_type': 'none', 'hint': ''}
AUDIT_OK = {'issues': []}


class FakeProvider:
    """Sustituye urlopen: registra el modelo de cada URL y responde según `answers` o falla según `fail`."""

    def __init__(self, answers=None, fail=None):
        self.answers = answers or {}
        self.fail = fail or {}
        self.models = []

    def __call__(self, req, timeout=None):
        model = req.full_url.split('/models/')[1].split(':')[0]
        self.models.append(model)
        if model in self.fail:
            raise urllib.error.HTTPError(req.full_url, self.fail[model], 'error', {}, io.BytesIO(json.dumps({'error': {'message': f'modelo {model} no disponible {SECRET}'}}).encode()))
        body = {'candidates': [{'content': {'parts': [{'text': json.dumps(self.answers.get(model, self.answers.get('*', {})))}]}}], 'usageMetadata': {}}
        return io.BytesIO(json.dumps(body).encode())


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_memory = (app._MEMORY, app._EVALUATION_OWNER, app._TEST_MEMORY)
        app.set_memory_for_tests(DurableMemory(os.path.join(self.tmp.name, 'm.sqlite3')))
        self.env = patch.dict(os.environ, {'GEMINI_API_KEY': SECRET}, clear=False)
        self.env.start()
        for name in ('LEARNSCIENCE_JUDGE_MODEL', 'LEARNSCIENCE_AUDIT_MODEL'):
            os.environ.pop(name, None)
        self.patches = [patch.object(app, 'PROVIDER', 'gemini'), patch.object(app, 'MODEL', 'base-model'), patch.object(app, 'LIMIT', 1000)]
        for p in self.patches:
            p.start()
        app.AUDIT_FAILURES.update({'open': 0, 'last_model': None})

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.env.stop()
        app._MEMORY, app._EVALUATION_OWNER, app._TEST_MEMORY = self.old_memory
        self.tmp.cleanup()

    def run_with(self, provider, fn):
        with patch.object(app.urllib.request, 'urlopen', provider):
            return fn()


class Roles(Base):
    def test_defaults_are_identical_to_the_single_model(self):
        for role in ('generate', 'judge', 'audit'):
            self.assertEqual(app.role_model(role), 'base-model')
        provider = FakeProvider({'*': EVAL_OK})
        out = self.run_with(provider, lambda: app.evaluate({'question': QUESTION, 'answer': 'Menor densidad', 'phase': 'INDEPENDENT'}))
        self.assertEqual(provider.models, ['base-model'])
        self.assertEqual(out['judge_model'], 'base-model')
        info = app.models_info()
        self.assertTrue(info['all_same'] and info['same_generate_judge'] and info['same_generate_audit'])
        self.assertFalse(info['judge_configured'] or info['audit_configured'])

    def test_each_role_is_routed_to_its_model(self):
        os.environ['LEARNSCIENCE_JUDGE_MODEL'] = 'juez-fuerte'
        os.environ['LEARNSCIENCE_AUDIT_MODEL'] = 'auditor-fuerte'
        provider = FakeProvider({'juez-fuerte': EVAL_OK, 'auditor-fuerte': AUDIT_OK, 'base-model': {'ok': 1}})

        def work():
            graded = app.evaluate({'question': QUESTION, 'answer': 'Menor densidad', 'phase': 'INDEPENDENT'})
            audit = app.audit_content('Física', 'Flotación', 'material')
            generated = app.gemini('genera', {}, 100)
            micro = app.micro_step({'context': {'status': 'ACTIVE', 'question': QUESTION}, 'answer': 'Menor densidad'})
            return graded, audit, generated, micro
        graded, audit, generated, micro = self.run_with(provider, work)
        self.assertEqual(provider.models, ['juez-fuerte', 'auditor-fuerte', 'base-model', 'juez-fuerte'])
        self.assertEqual(graded['judge_model'], 'juez-fuerte')
        self.assertEqual(micro['judge_model'], 'juez-fuerte')
        self.assertTrue(audit['checked'])
        info = app.models_info()
        self.assertEqual((info['generate'], info['audit'], info['judge']), ('base-model', 'auditor-fuerte', 'juez-fuerte'))
        self.assertFalse(info['all_same'])
        self.assertNotIn(SECRET, json.dumps(info))

    def test_role_scope_does_not_leak_to_later_generation_calls(self):
        os.environ['LEARNSCIENCE_JUDGE_MODEL'] = 'juez-fuerte'
        provider = FakeProvider({'*': EVAL_OK})
        self.run_with(provider, lambda: (app.evaluate({'question': QUESTION, 'answer': 'x y z', 'phase': 'INDEPENDENT'}), app.gemini('genera', {}, 100)))
        self.assertEqual(provider.models, ['juez-fuerte', 'base-model'])

    def test_every_judge_function_uses_the_judge_role(self):
        import inspect
        judges = ('evaluate', 'evaluate_criterion_activity', 'grade_error_fix', 'challenge_report', 'beto_turn')
        for name in judges:
            src = inspect.getsource(getattr(app, name))
            self.assertIn('judge_gemini(', src, name)
            self.assertNotRegex(src, r'(?<![_a-z])gemini\(', name + ' no debe llamar al modelo generador')
        self.assertIn('audit_gemini(', inspect.getsource(app.audit_content))
        self.assertNotRegex(inspect.getsource(app.audit_content), r'(?<![_a-z])gemini\(')

    def test_invalid_model_names_are_rejected_without_calling_the_provider(self):
        for bad in ('modelo con espacios', 'a' * 65, '../x', 'x/y', 'x?key=1', 'ñandú', 'a\nb', '.oculto'):
            with self.subTest(bad=bad):
                self.assertRaises(ValueError, app.validate_model_name, bad)
        self.assertEqual(app.validate_model_name('gemini-3.1-pro_v2'), 'gemini-3.1-pro_v2')
        os.environ['LEARNSCIENCE_JUDGE_MODEL'] = 'x y'
        os.environ['LEARNSCIENCE_AUDIT_MODEL'] = '../x'
        provider = FakeProvider({'*': EVAL_OK})
        with self.assertRaises(ValueError) as ctx:
            self.run_with(provider, lambda: app.evaluate({'question': QUESTION, 'answer': 'Menor densidad', 'phase': 'INDEPENDENT'}))
        self.assertIn('LEARNSCIENCE_JUDGE_MODEL', str(ctx.exception))
        audit = self.run_with(provider, lambda: app.audit_content('M', 'T', 'material'))
        self.assertEqual(audit, {'checked': False, 'issues': [], 'items': []})
        self.assertEqual(provider.models, [])
        self.assertEqual(app.AUDIT_FAILURES['open'], 1)
        info = app.models_info()
        self.assertEqual(len(info['errors']), 2)
        self.assertIsNone(info['judge'])

    def test_anthropic_provider_ignores_roles(self):
        os.environ['LEARNSCIENCE_JUDGE_MODEL'] = 'juez-fuerte'
        with patch.object(app, 'PROVIDER', 'anthropic'), patch.object(app, 'ANTHROPIC_MODEL', 'claude-x'):
            info = app.models_info()
            self.assertEqual((info['generate'], info['audit'], info['judge']), ('claude-x',) * 3)
            self.assertFalse(info['roles_configurable'])
            self.assertFalse(info['judge_configured'])

    def test_models_route_is_read_only_and_registered(self):
        self.assertIs(app.ROUTES['/api/models'], app.models_info)
        os.environ['LEARNSCIENCE_JUDGE_MODEL'] = 'juez-fuerte'
        self.assertEqual(app.models_info({})['judge'], 'juez-fuerte')
        self.assertNotIn('GEMINI_API_KEY', json.dumps(app.models_info()))


class Failures(Base):
    def test_judge_failure_does_not_fall_back_to_the_base_model(self):
        os.environ['LEARNSCIENCE_JUDGE_MODEL'] = 'juez-fuerte'
        provider = FakeProvider({'base-model': EVAL_OK}, fail={'juez-fuerte': 404})
        with self.assertRaises(ValueError) as ctx:
            self.run_with(provider, lambda: app.evaluate({'question': QUESTION, 'answer': 'Menor densidad', 'phase': 'INDEPENDENT'}))
        self.assertEqual(provider.models, ['juez-fuerte'])
        text = str(ctx.exception)
        self.assertIn('calificador', text)
        self.assertIn('juez-fuerte', text)
        self.assertNotIn(SECRET, text)

    def test_micro_step_judge_failure_returns_no_verdict(self):
        os.environ['LEARNSCIENCE_JUDGE_MODEL'] = 'juez-fuerte'
        provider = FakeProvider({'base-model': EVAL_OK}, fail={'juez-fuerte': 429})
        with self.assertRaises(ValueError):
            self.run_with(provider, lambda: app.micro_step({'context': {'status': 'ACTIVE', 'question': QUESTION}, 'answer': 'Menor densidad'}))
        self.assertEqual(provider.models, ['juez-fuerte'])

    def test_audit_failure_fails_open_and_is_recorded(self):
        os.environ['LEARNSCIENCE_AUDIT_MODEL'] = 'auditor-fuerte'
        provider = FakeProvider({'base-model': AUDIT_OK}, fail={'auditor-fuerte': 404})
        out = self.run_with(provider, lambda: app.audit_content('M', 'T', 'material'))
        self.assertEqual(out, {'checked': False, 'issues': [], 'items': []})
        self.assertEqual(provider.models, ['auditor-fuerte'])
        self.assertEqual((app.AUDIT_FAILURES['open'], app.AUDIT_FAILURES['last_model']), (1, 'auditor-fuerte'))
        self.assertEqual(app.models_info()['audit_failed_open'], 1)

    def test_api_key_is_never_printed(self):
        os.environ['LEARNSCIENCE_AUDIT_MODEL'] = 'auditor-fuerte'
        provider = FakeProvider(fail={'auditor-fuerte': 404})
        out, err = io.StringIO(), io.StringIO()
        with patch('sys.stdout', out), patch('sys.stderr', err):
            self.run_with(provider, lambda: app.audit_content('M', 'T', 'material'))
        self.assertNotIn(SECRET, out.getvalue() + err.getvalue())

    def test_criterion_judge_failure_is_unknown_never_positive(self):
        os.environ['LEARNSCIENCE_JUDGE_MODEL'] = 'juez-fuerte'
        profile = app.memory().create_profile('p')['profile_id']
        activity = {'schema_version': 'criterion_assessment_v1', 'activity_id': 'act-1', 'type': 'multiple_choice_explanation', 'phase': 'INDEPENDENT',
                    'prompt': '¿Qué cambia al invertir una ecuación?', 'options': [{'id': 'a', 'text': 'Se conserva la igualdad'}, {'id': 'b', 'text': 'Solo un lado'}],
                    'correct_option_id': 'a', 'explanation_reference': 'Aplicar la misma operación reversible a ambos miembros conserva las soluciones; operar en un solo miembro rompe la equivalencia.',
                    'criteria': [{'criterion_id': 'option_choice', 'observable_dimension': 'recognition', 'required': True, 'description': 'Elegir la propiedad.'},
                                 {'criterion_id': 'explanation', 'observable_dimension': 'conceptual', 'required': True, 'description': 'Explicar por qué.'}],
                    'help': {'enabled': True, 'critical': True}, 'variant': 'v1', 'context': 'sintetico'}
        with patch.object(app, 'gemini', return_value=copy.deepcopy(activity)):
            public = app.make_criterion_activity({'profile_id': profile, 'goal_id': 'g1', 'goal': 'Álgebra', 'concept': 'Inversas'})
        provider = FakeProvider(fail={'juez-fuerte': 404})
        result = self.run_with(provider, lambda: app.evaluate_criterion_activity({'profile_id': profile, 'goal_id': 'g1', 'activity_id': public['activity_id'], 'attempt_id': 'at-1',
                                                                                  'selected_option_id': 'b', 'explanation': 'porque sí'}))
        self.assertEqual(provider.models, ['juez-fuerte'])
        explanation = next(c for c in result['criteria'] if c['criterion_id'] == 'explanation')
        self.assertEqual(explanation['status'], 'NOT_EVALUATED')
        self.assertNotIn('judge_model', explanation)
        self.assertNotIn('judge_model', result)
        self.assertNotEqual(result['overall'], 'CORRECT')
        # Un acierto con juez caído tampoco es CORRECT: la explicación no se evaluó.
        provider2 = FakeProvider(fail={'juez-fuerte': 404})
        ok = self.run_with(provider2, lambda: app.evaluate_criterion_activity({'profile_id': profile, 'goal_id': 'g1', 'activity_id': public['activity_id'], 'attempt_id': 'at-2',
                                                                               'selected_option_id': 'a', 'explanation': 'misma operación en ambos lados'}))
        self.assertNotEqual(ok['overall'], 'CORRECT')
        self.assertFalse(any(c['status'] == 'SATISFIED' for c in ok['criteria'] if c['criterion_id'] == 'explanation'))

    def test_criterion_success_records_the_judge_model(self):
        os.environ['LEARNSCIENCE_JUDGE_MODEL'] = 'juez-fuerte'
        profile = app.memory().create_profile('p2')['profile_id']
        activity = {'schema_version': 'criterion_assessment_v1', 'activity_id': 'act-2', 'type': 'multiple_choice_explanation', 'phase': 'INDEPENDENT',
                    'prompt': '¿Qué cambia al invertir una ecuación?', 'options': [{'id': 'a', 'text': 'Se conserva la igualdad'}, {'id': 'b', 'text': 'Solo un lado'}],
                    'correct_option_id': 'a', 'explanation_reference': 'Aplicar la misma operación reversible a ambos miembros conserva las soluciones; operar en un solo miembro rompe la equivalencia.',
                    'criteria': [{'criterion_id': 'option_choice', 'observable_dimension': 'recognition', 'required': True, 'description': 'Elegir la propiedad.'},
                                 {'criterion_id': 'explanation', 'observable_dimension': 'conceptual', 'required': True, 'description': 'Explicar por qué.'}],
                    'help': {'enabled': True, 'critical': True}, 'variant': 'v1', 'context': 'sintetico'}
        with patch.object(app, 'gemini', return_value=copy.deepcopy(activity)):
            public = app.make_criterion_activity({'profile_id': profile, 'goal_id': 'g1', 'goal': 'Álgebra', 'concept': 'Inversas'})
        provider = FakeProvider({'juez-fuerte': {'status': 'SATISFIED', 'observation': 'Explicas la conservación.'}})
        result = self.run_with(provider, lambda: app.evaluate_criterion_activity({'profile_id': profile, 'goal_id': 'g1', 'activity_id': public['activity_id'], 'attempt_id': 'at-1',
                                                                                  'selected_option_id': 'a', 'explanation': 'misma operación en ambos lados'}))
        self.assertEqual(result['judge_model'], 'juez-fuerte')

    def test_dont_know_makes_no_call_and_records_no_judge(self):
        provider = FakeProvider()
        out = self.run_with(provider, lambda: app.evaluate({'question': QUESTION, 'answer': 'No sé', 'phase': 'INDEPENDENT'}))
        self.assertEqual(out['status'], 'UNKNOWN')
        self.assertNotIn('judge_model', out)
        self.assertEqual(provider.models, [])


class SampleTool(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp.name, 'u.sqlite3')
        mem = DurableMemory(self.db_path)
        self.a = mem.create_profile('A')['profile_id']
        self.b = mem.create_profile('B')['profile_id']
        node = {'id': 'n1', 'name': 'Densidad', 'outcome': 'Explicar', 'level': 0, 'prerequisites': [], 'kind': 'concept'}
        q = {'prompt': '¿Por qué flota el hielo?', 'reference': 'Menor densidad.', 'kind': 'explanation', 'observable_dimensions': ['conceptual']}

        def store(tag, with_judge):
            events = [{'type': 'EVIDENCE', 'attempt_id': f'{tag}-1', 'activity_id': f'{tag}-act', 'node_id': 'n1', 'phase': 'INDEPENDENT', 'result': 'CORRECT', 'help_used': 0,
                       'answer': f'respuesta {tag}', 'observed_dimensions': ['conceptual'], 'at': 1000, 'feedback': f'feedback {tag}', **({'judge_model': 'juez-fuerte'} if with_judge else {})}]
            lesson = {'explanation': f'Explicación {tag}', 'example': 'ej', 'common_error': 'err', 'check': q, 'guided': q, 'independent': q, 'integration': q}
            return {'goals': [{'id': 'g1', 'goal': f'Meta {tag}', 'nodes': [node], 'events': events, 'coverage': [], 'reviews': [], 'lessons': {'n1': lesson},
                               'session': {'mode': 'DIAGNOSTIC', 'node': None, 'stack': [], 'stage': 'teach', 'tries': 0,
                                           'direct': {'rung': 2, 'status': 'ready', 'package': {'model_answer': f'Respuesta comentada {tag}', 'why': ['a', 'b']}},
                                           'ladder': {'k': {'rung': 1, 'avoid': [f'Explicación previa {tag}']}}}}], 'active': 'g1'}
        mem.save(self.a, store('PERFILA', True))
        mem.save(self.b, store('PERFILB', False))
        self.out = os.path.join(self.tmp.name, 'muestra.md')

    def tearDown(self):
        self.tmp.cleanup()

    def digest(self):
        with open(self.db_path, 'rb') as fh:
            return hashlib.sha256(fh.read()).hexdigest(), os.path.getmtime(self.db_path)

    def test_export_is_read_only_scoped_to_the_profile_and_limited(self):
        before = self.digest()
        self.assertEqual(sample_for_review.main(['--db', self.db_path, '--profile', self.a, '--out', self.out]), 0)
        self.assertEqual(self.digest(), before, 'la herramienta no debe escribir en la base')
        text = Path(self.out).read_text(encoding='utf-8')
        self.assertIn('PERFILA', text)
        self.assertNotIn('PERFILB', text)
        self.assertIn('Modelo juez:** juez-fuerte', text)
        for box in ('¿Correcto?', '¿Claro?', 'Nota:'):
            self.assertIn(box, text)
        for kind in ('Lección', 'Veredicto del juez', 'Explicación de la escalera'):
            self.assertIn(kind, text)
        self.assertIn('Referencia/clave', text)
        sample_for_review.main(['--db', self.db_path, '--profile', self.a, '--out', self.out, '--n', '2'])
        self.assertEqual(Path(self.out).read_text(encoding='utf-8').count('¿Correcto?'), 2)

    def test_legacy_events_do_not_get_an_invented_judge_model(self):
        sample_for_review.main(['--db', self.db_path, '--profile', self.b, '--out', self.out])
        text = Path(self.out).read_text(encoding='utf-8')
        self.assertIn('no registrado (dato anterior)', text)
        self.assertNotIn('juez-fuerte', text)
        self.assertNotIn('PERFILA', text)

    def test_database_stays_untouched_even_if_the_file_is_read_only(self):
        con = sample_for_review.open_readonly(self.db_path)
        with self.assertRaises(sqlite3.OperationalError):
            con.execute("UPDATE profiles SET name='x'")
        con.close()

    def test_unknown_profile_and_missing_database_exit_cleanly(self):
        with self.assertRaises(SystemExit):
            sample_for_review.main(['--db', self.db_path, '--profile', 'no-existe', '--out', self.out])
        with self.assertRaises(SystemExit):
            sample_for_review.main(['--db', self.db_path, '--out', self.out])
        with self.assertRaises(SystemExit):
            sample_for_review.main(['--db', os.path.join(self.tmp.name, 'nada.sqlite3'), '--profile', self.a])
        self.assertFalse(os.path.exists(self.out))

    def test_tool_runs_as_a_script_without_a_provider_key(self):
        env = {k: v for k, v in os.environ.items() if 'KEY' not in k}
        done = subprocess.run([sys.executable, str(ROOT / 'tools' / 'sample_for_review.py'), '--db', self.db_path, '--profile', self.a, '--out', self.out], env=env, capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertTrue(os.path.exists(self.out))


if __name__ == '__main__':
    unittest.main()
