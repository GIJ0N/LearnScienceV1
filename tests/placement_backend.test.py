"""placement_v1: batched generation with local contract, private key, provider-free idempotent grading."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory

NODES = [{'id': 'a', 'name': 'Fracciones', 'outcome': 'Operar', 'prerequisites': []},
         {'id': 'b', 'name': 'Proporciones', 'outcome': 'Resolver', 'prerequisites': ['a']}]


def item(node_id='b', key='a', **extra):
    base = {'node_id': node_id, 'prompt': 'Si 2 kg cuestan 30, ¿cuánto cuestan 5 kg?', 'correct_option_id': key,
            'explanation': 'Precio por kg 15; 5 × 15 = 75.',
            'options': [{'id': 'a', 'text': '75', 'misconception': ''},
                        {'id': 'b', 'text': '33', 'misconception': 'Suma la diferencia en lugar de escalar.'},
                        {'id': 'c', 'text': '150', 'misconception': 'Multiplica sin dividir por el tamaño de la base.'}]}
    base.update(extra)
    return base


class PlacementBackend(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'p.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.other = self.memory.create_profile('Otro')['profile_id']
        self.patch = patch.object(app, 'memory', return_value=self.memory)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def generate(self, items, node_ids=('a', 'b'), profile=None):
        calls = []
        def fake(prompt, schema, max_tokens):
            calls.append(prompt)
            return {'items': items}
        with patch.object(app, 'gemini', side_effect=fake):
            out = app.make_placement_items({'profile_id': profile or self.profile, 'goal_id': 'g1', 'goal': 'Aritmética',
                                            'nodes': NODES, 'node_ids': list(node_ids)})
        return out, calls

    def test_one_call_for_a_batch_and_key_stays_private(self):
        out, calls = self.generate([item('a'), item('b')])
        self.assertEqual(len(calls), 1)
        self.assertEqual([x['node_id'] for x in out['items']], ['a', 'b'])
        for public in out['items']:
            self.assertNotIn('correct_option_id', public)
            self.assertNotIn('explanation', public)
            self.assertTrue(all('misconception' not in o for o in public['options']))

    def test_options_are_shuffled_and_relabeled_consistently(self):
        positions = set()
        for _ in range(30):
            public, private = app.validated_placement_item(item('b'), {'b'})
            ids = [o['id'] for o in public['options']]
            self.assertEqual(ids, ['a', 'b', 'c'])
            correct = next(o for o in public['options'] if o['id'] == private['correct_option_id'])
            self.assertEqual(correct['text'], '75')
            wrong = {o['text']: private['misconceptions'][o['id']] for o in public['options'] if o['id'] != private['correct_option_id']}
            self.assertIn('Suma la diferencia', wrong['33'])
            positions.add(private['correct_option_id'])
        self.assertGreater(len(positions), 1, 'La clave no debe quedar siempre en la misma posición')

    def test_invalid_items_are_dropped_and_empty_batch_fails(self):
        bad = [item('zzz'), item('a', key='q'), item('b', options=[{'id': 'a', 'text': '1'}, {'id': 'b', 'text': '2'}]),
               item('a', options=[{'id': 'a', 'text': '75'}, {'id': 'b', 'text': '33', 'misconception': ''}, {'id': 'c', 'text': '1', 'misconception': 'x'}])]
        with self.assertRaises(ValueError):
            self.generate(bad)
        out, _ = self.generate(bad + [item('b')])
        self.assertEqual(len(out['items']), 1)

    def test_grading_is_deterministic_and_needs_no_provider(self):
        out, _ = self.generate([item('b')], node_ids=('b',))
        item_id = out['items'][0]['item_id']
        by_text = {o['text']: o['id'] for o in out['items'][0]['options']}
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamarse')):
            right = app.answer_placement_item({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item_id, 'attempt_id': 't1', 'selected_option_id': by_text['75'], 'learner_confidence': 90})
            wrong = app.answer_placement_item({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item_id, 'attempt_id': 't2', 'selected_option_id': by_text['33'], 'learner_confidence': 95})
            unknown = app.answer_placement_item({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item_id, 'attempt_id': 't3', 'selected_option_id': None, 'learner_confidence': 80})
        self.assertEqual(right['status'], 'CORRECT')
        self.assertEqual(wrong['status'], 'MISCONCEPTION')
        self.assertIn('Suma la diferencia', wrong['selected_misconception'])
        self.assertEqual(unknown['status'], 'UNKNOWN')
        self.assertEqual(unknown['correct_option_id'], by_text['75'])

    def test_idempotent_by_attempt_and_conflict_rejected(self):
        out, _ = self.generate([item('b')], node_ids=('b',))
        item_id = out['items'][0]['item_id']
        payload = {'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item_id, 'attempt_id': 't1', 'selected_option_id': 'a'}
        first = app.answer_placement_item(payload)
        self.assertEqual(app.answer_placement_item(dict(payload)), first)
        with self.assertRaises(ValueError):
            app.answer_placement_item({**payload, 'selected_option_id': 'c'})

    def test_isolation_by_profile_and_goal_and_invalid_input(self):
        out, _ = self.generate([item('b')], node_ids=('b',))
        item_id = out['items'][0]['item_id']
        for bad in ({'profile_id': self.other, 'goal_id': 'g1'}, {'profile_id': self.profile, 'goal_id': 'g2'}):
            with self.assertRaises(ValueError):
                app.answer_placement_item({**bad, 'item_id': item_id, 'attempt_id': 'x', 'selected_option_id': 'a'})
        with self.assertRaises(ValueError):
            app.answer_placement_item({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item_id, 'attempt_id': 'y', 'selected_option_id': 'zz'})
        with self.assertRaises(ValueError):
            app.answer_placement_item({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item_id, 'attempt_id': 'z', 'selected_option_id': 'a', 'learner_confidence': 400})

    def test_profile_deletion_cascades(self):
        out, _ = self.generate([item('b')], node_ids=('b',))
        self.memory.delete_profile(self.profile)
        self.assertIsNone(self.memory.load_placement_item(self.other, out['items'][0]['item_id']))


if __name__ == '__main__':
    unittest.main()
