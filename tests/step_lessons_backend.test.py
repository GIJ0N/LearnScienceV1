"""step_lessons_v1: generation contract, shared grading, repair guarded by the stored answer."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory


def check(n=1, key='a'):
    return {'prompt': f'Caso nuevo {n}', 'correct_option_id': key, 'explanation': 'Porque sí.',
            'options': [{'id': 'a', 'text': 'correcta', 'misconception': ''},
                        {'id': 'b', 'text': 'error uno', 'misconception': 'Confunde masa con volumen.'},
                        {'id': 'c', 'text': 'error dos', 'misconception': 'Ignora el medio.'}]}


def step(n=1, **extra):
    base = {'predict': f'¿Qué crees que pasa {n}?', 'resolution': 'Lo cierto es esto.', 'body': f'Cuerpo del paso {n}.', 'check': check(n)}
    base.update(extra)
    return base


class StepLessons(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 's.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.other = self.memory.create_profile('Otro')['profile_id']
        self.patch = patch.object(app, 'memory', return_value=self.memory)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def payload(self, **extra):
        base = {'profile_id': self.profile, 'goal_id': 'g1', 'node_id': 'n1', 'goal': 'Flotar', 'name': 'Densidad', 'parent': 'Flotar',
                'explanation': 'e', 'example': 'x', 'common_error': 'c'}
        base.update(extra)
        return base

    def generate(self, steps):
        with patch.object(app, 'gemini', return_value={'steps': steps}) as g:
            out = app.make_lesson_steps(self.payload())
        self.assertEqual(g.call_count, 1)
        return out

    def by_text(self, public):
        return {o['text']: o['id'] for o in public['options']}

    def test_valid_steps_hide_the_key_and_get_ids(self):
        out = self.generate([step(1), step(2), step(3)])
        self.assertEqual(out['schema_version'], app.STEP_VERSION)
        self.assertEqual([s['step_id'] for s in out['steps']], ['step-1', 'step-2', 'step-3'])
        for s in out['steps']:
            self.assertEqual(set(s['check']), {'schema_version', 'item_id', 'node_id', 'prompt', 'options'})
            self.assertTrue(s['check']['item_id'].startswith('step-'))
            self.assertTrue(all(set(o) == {'id', 'text'} for o in s['check']['options']))

    def test_invalid_steps_are_dropped_and_fewer_than_two_fails(self):
        bad_check = step(2, check={**check(2), 'correct_option_id': 'zzz'})
        no_body = step(3, body='')
        with self.assertRaises(ValueError):
            self.generate([step(1), bad_check, no_body])
        out = self.generate([step(1), bad_check, step(4), no_body])
        self.assertEqual(len(out['steps']), 2)
        self.assertEqual([s['step_id'] for s in out['steps']], ['step-1', 'step-2'])

    def test_missing_identity_is_rejected_before_any_model_call(self):
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamarse')):
            with self.assertRaises(ValueError):
                app.make_lesson_steps(self.payload(profile_id=''))
            with self.assertRaises(ValueError):
                app.make_lesson_steps(self.payload(node_id=''))

    def test_grading_needs_no_provider_and_is_idempotent(self):
        public = self.generate([step(1), step(2)])['steps'][0]['check']
        ids = self.by_text(public)
        base = {'profile_id': self.profile, 'goal_id': 'g1', 'item_id': public['item_id']}
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamarse')):
            right = app.answer_step_item({**base, 'attempt_id': 't1', 'selected_option_id': ids['correcta']})
            wrong = app.answer_step_item({**base, 'attempt_id': 't2', 'selected_option_id': ids['error uno']})
            self.assertEqual(app.answer_step_item({**base, 'attempt_id': 't2', 'selected_option_id': ids['error uno']}), wrong)
            with self.assertRaises(ValueError):
                app.answer_step_item({**base, 'attempt_id': 't2', 'selected_option_id': ids['error dos']})
        self.assertEqual(right['status'], 'CORRECT')
        self.assertEqual(wrong['status'], 'MISCONCEPTION')
        self.assertIn('masa con volumen', wrong['selected_misconception'])

    def test_step_and_placement_items_are_not_interchangeable(self):
        public = self.generate([step(1), step(2)])['steps'][0]['check']
        with self.assertRaises(ValueError):
            app.answer_placement_item({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': public['item_id'], 'attempt_id': 'x', 'selected_option_id': 'a'})
        nodes = [{'id': 'n1', 'name': 'Densidad', 'outcome': 'o', 'prerequisites': []}]
        placement = {'node_id': 'n1', **check(9)}
        with patch.object(app, 'gemini', return_value={'items': [placement]}):
            item = app.make_placement_items({'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Flotar', 'nodes': nodes, 'node_ids': ['n1']})['items'][0]
        with self.assertRaises(ValueError):
            app.answer_step_item({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': 'x', 'selected_option_id': 'a'})

    def test_isolation_by_profile(self):
        public = self.generate([step(1), step(2)])['steps'][0]['check']
        with self.assertRaises(ValueError):
            app.answer_step_item({'profile_id': self.other, 'goal_id': 'g1', 'item_id': public['item_id'], 'attempt_id': 'x', 'selected_option_id': 'a'})

    def repair_payload(self, public, attempt='t1'):
        return {'profile_id': self.profile, 'goal_id': 'g1', 'node_id': 'n1', 'item_id': public['item_id'], 'attempt_id': attempt,
                'goal': 'Flotar', 'name': 'Densidad', 'body': 'Cuerpo'}

    def test_repair_requires_a_recorded_failure_and_uses_the_server_misconception(self):
        public = self.generate([step(1), step(2)])['steps'][0]['check']
        ids = self.by_text(public)
        base = {'profile_id': self.profile, 'goal_id': 'g1', 'item_id': public['item_id']}
        with patch.object(app, 'gemini', side_effect=AssertionError('sin respuesta no se llama')):
            with self.assertRaises(ValueError):
                app.make_step_repair(self.repair_payload(public))
        app.answer_step_item({**base, 'attempt_id': 'ok', 'selected_option_id': ids['correcta']})
        with patch.object(app, 'gemini', side_effect=AssertionError('un acierto no se repara')):
            with self.assertRaises(ValueError):
                app.make_step_repair(self.repair_payload(public, 'ok'))
        app.answer_step_item({**base, 'attempt_id': 'bad', 'selected_option_id': ids['error uno']})
        prompts = []
        def fake(prompt, schema, max_tokens):
            prompts.append(prompt)
            return {'body': 'Otra forma de verlo.', 'check': check(5)}
        with patch.object(app, 'gemini', side_effect=fake):
            out = app.make_step_repair({**self.repair_payload(public, 'bad'), 'misconception': 'inventada por el cliente'})
        self.assertIn('masa con volumen', prompts[0])
        self.assertNotIn('inventada por el cliente', prompts[0])
        self.assertEqual(out['body'], 'Otra forma de verlo.')
        self.assertNotIn('correct_option_id', out['check'])
        # La comprobación nueva también se puede corregir.
        new_ids = self.by_text(out['check'])
        result = app.answer_step_item({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': out['check']['item_id'], 'attempt_id': 'n1', 'selected_option_id': new_ids['correcta']})
        self.assertEqual(result['status'], 'CORRECT')

    def test_repair_refuses_placement_items_and_other_nodes(self):
        public = self.generate([step(1), step(2)])['steps'][0]['check']
        ids = self.by_text(public)
        app.answer_step_item({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': public['item_id'], 'attempt_id': 'bad', 'selected_option_id': ids['error uno']})
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamarse')):
            with self.assertRaises(ValueError):
                app.make_step_repair({**self.repair_payload(public, 'bad'), 'node_id': 'otro'})
            with self.assertRaises(ValueError):
                app.make_step_repair({**self.repair_payload(public, 'bad'), 'goal_id': 'g2'})

    def test_routes_are_registered(self):
        for route in ('/api/lesson/steps', '/api/lesson/step/answer', '/api/lesson/step/repair'):
            self.assertIn(route, app.ROUTES)


if __name__ == '__main__':
    unittest.main()
