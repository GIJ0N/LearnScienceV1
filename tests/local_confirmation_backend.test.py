"""local_confirmation_v1: pregunta de confirmación con clave privada, reintento con motivo y calificación local."""
import contextlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory

NODE = {'id': 'b', 'name': 'Proporciones', 'outcome': 'Resolver problemas de proporción'}


def good(node_id='b'):
    return {'node_id': node_id, 'prompt': 'Una receta usa 3 tazas de harina para 12 galletas. ¿Cuántas tazas para 20 galletas?', 'correct_option_id': 'a',
            'explanation': 'Son 0.25 tazas por galleta; 20 × 0.25 = 5.',
            'options': [{'id': 'a', 'text': '5 tazas', 'misconception': ''},
                        {'id': 'b', 'text': '8 tazas', 'misconception': 'Suma la diferencia de galletas en lugar de escalar.'},
                        {'id': 'c', 'text': '7 tazas', 'misconception': 'Redondea la razón antes de multiplicar.'}]}


class LocalConfirmation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'c.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.prompts = []
        self.replies = []
        self.verify = False
        self.patches = [patch.object(app, 'memory', return_value=self.memory), patch.object(app, 'CONTENT_VERIFY', self.verify), patch.object(app, 'gemini', side_effect=self.fake)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def fake(self, prompt, schema, max_tokens):
        if 'revisor técnico' in prompt:
            return self.audit
        self.prompts.append(prompt)
        return {'items': [self.replies.pop(0)]}

    audit = {'issues': []}

    def req(self, **over):
        data = {'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Proporciones', 'node': NODE, 'source_type': 'BETO_SESSION'}
        data.update(over)
        return data

    def make(self, **over):
        return app.make_confirmation_item(self.req(**over))

    def answer(self, item, selected, attempt='t1'):
        return app.answer_confirmation_item({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': attempt, 'selected_option_id': selected})

    def key(self, item):
        return self.memory.load_placement_item(self.profile, item['item_id'])['private']['correct_option_id']

    def test_generates_conf_item_with_source(self):
        self.replies = [good()]
        out = self.make(source_type='CHALLENGE_REPORT')
        item = out['items'][0]
        self.assertTrue(item['item_id'].startswith('conf-'))
        self.assertEqual(item['source_type'], 'CHALLENGE_REPORT')
        self.assertEqual(item['schema_version'], app.CONF_VERSION)
        self.assertNotIn('correct_option_id', item)
        stored = self.memory.load_placement_item(self.profile, item['item_id'])
        self.assertEqual(stored['public']['source_type'], 'CHALLENGE_REPORT')

    def test_invalid_input_raises(self):
        self.replies = [good()]
        with self.assertRaises(ValueError):
            self.make(source_type='DISCRIMINATION')
        with self.assertRaises(ValueError):
            self.make(node={})
        with self.assertRaises(ValueError):
            self.make(source_type=None)
        self.assertEqual(self.prompts, [])

    def test_retry_with_reason(self):
        bad = good()
        del bad['correct_option_id']
        self.replies = [bad, good()]
        out = self.make()
        self.assertEqual(len(self.prompts), 2)
        self.assertNotIn('Corrección', self.prompts[0])
        self.assertIn('Corrección', self.prompts[1])
        self.assertEqual(len(out['items']), 1)

    def test_fails_twice_saves_nothing(self):
        bad = good()
        del bad['correct_option_id']
        self.replies = [bad, dict(bad)]
        with self.assertRaisesRegex(ValueError, 'no se guardó nada'):
            self.make()

    def test_wrong_node_is_rejected(self):
        self.replies = [good('zzz'), good('zzz')]
        with self.assertRaises(ValueError):
            self.make()

    def test_audit_issue_discards_and_retries(self):
        self.replies = [good(), good()]
        calls = {'n': 0}
        orig = self.fake

        def audit_then_ok(prompt, schema, max_tokens):
            if 'revisor técnico' in prompt:
                calls['n'] += 1
                return {'issues': [{'item': 1, 'problem': 'La clave es dudosa.'}]} if calls['n'] == 1 else {'issues': []}
            return orig(prompt, schema, max_tokens)
        with patch.object(app, 'CONTENT_VERIFY', True), patch.object(app, 'gemini', side_effect=audit_then_ok):
            out = self.make()
        self.assertEqual(len(self.prompts), 2)
        self.assertIn('dudosa', self.prompts[1])
        self.assertTrue(out['content_check']['checked'])

    def test_grading_is_local_and_idempotent(self):
        self.replies = [good(), good(), good()]
        item = self.make()['items'][0]
        key = self.key(item)
        wrong = next(o['id'] for o in item['options'] if o['id'] != key)
        self.assertEqual(self.answer(item, key, 'a1')['status'], 'CORRECT')
        self.assertEqual(self.answer(item, key, 'a1')['status'], 'CORRECT')
        self.assertEqual(self.answer(item, wrong, 'a2')['status'], 'MISCONCEPTION')
        self.assertEqual(self.answer(item, None, 'a3')['status'], 'UNKNOWN')

    def test_other_activity_cannot_use_confirmation_route(self):
        raw = good()
        public, private = app._build_choice_item(raw, {'b'}, app.DISC_VERSION)
        self.memory.save_placement_items(self.profile, 'g1', [(public, private)])
        with self.assertRaises(ValueError):
            self.answer(public, private['correct_option_id'])

    def test_routes_registered(self):
        self.assertIs(app.ROUTES['/api/practice/confirm'], app.make_confirmation_item)
        self.assertIs(app.ROUTES['/api/practice/confirm/answer'], app.answer_confirmation_item)


if __name__ == '__main__':
    unittest.main()
