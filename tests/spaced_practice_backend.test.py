"""spaced_practice_v1: discrimination generation contract and provider-free grading."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory

NODES = [{'id': 'a', 'name': 'Densidad', 'outcome': 'Comparar'}, {'id': 'b', 'name': 'Presión', 'outcome': 'Calcular'},
         {'id': 'c', 'name': 'Empuje', 'outcome': 'Predecir'}]


def item(node_id, key='a', **extra):
    base = {'node_id': node_id, 'prompt': f'Situación para {node_id}', 'correct_option_id': key, 'explanation': 'Aplica esta y no las otras.',
            'options': [{'id': 'a', 'text': 'idea correcta', 'misconception': ''},
                        {'id': 'b', 'text': 'idea hermana', 'misconception': 'Aplica la idea hermana por parecido.'},
                        {'id': 'c', 'text': 'otra', 'misconception': 'Mezcla ambas.'}]}
    base.update(extra)
    return base


class Discrimination(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'd.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.patch = patch.object(app, 'memory', return_value=self.memory)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def generate(self, items, nodes=NODES[:2]):
        with patch.object(app, 'gemini', return_value={'items': items}) as g:
            out = app.make_discrimination_items({'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Flotar', 'nodes': nodes})
        self.assertEqual(g.call_count, 1)
        return out

    def test_one_call_hides_the_key_and_prefixes_ids(self):
        out = self.generate([item('a'), item('b')])
        self.assertEqual(out['schema_version'], app.DISC_VERSION)
        self.assertEqual({x['node_id'] for x in out['items']}, {'a', 'b'})
        for it in out['items']:
            self.assertTrue(it['item_id'].startswith('disc-'))
            self.assertEqual(set(it), {'schema_version', 'item_id', 'node_id', 'prompt', 'options'})

    def test_needs_two_distinct_topics_before_any_model_call(self):
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamarse')):
            with self.assertRaises(ValueError):
                app.make_discrimination_items({'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'x', 'nodes': NODES[:1]})
            with self.assertRaises(ValueError):
                app.make_discrimination_items({'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'x', 'nodes': [NODES[0], NODES[0]]})

    def test_invalid_items_dropped_and_fewer_than_two_fails(self):
        with self.assertRaises(ValueError):
            self.generate([item('a'), item('zzz'), item('b', key='q')])
        out = self.generate([item('a'), item('zzz'), item('a'), item('b')])
        self.assertEqual(sorted(x['node_id'] for x in out['items']), ['a', 'b'])

    def test_topics_beyond_the_cap_are_ignored(self):
        many = [{'id': f'n{i}', 'name': f'T{i}', 'outcome': ''} for i in range(8)]
        out = self.generate([item(f'n{i}') for i in range(8)], nodes=many)
        self.assertEqual(len(out['items']), app.DISC_MAX)

    def test_grading_is_provider_free_and_isolated_by_version(self):
        out = self.generate([item('a'), item('b')])
        first = out['items'][0]
        ids = {o['text']: o['id'] for o in first['options']}
        base = {'profile_id': self.profile, 'goal_id': 'g1', 'item_id': first['item_id']}
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamarse')):
            ok = app.answer_discrimination_item({**base, 'attempt_id': 't1', 'selected_option_id': ids['idea correcta']})
            bad = app.answer_discrimination_item({**base, 'attempt_id': 't2', 'selected_option_id': ids['idea hermana']})
            self.assertEqual(app.answer_discrimination_item({**base, 'attempt_id': 't2', 'selected_option_id': ids['idea hermana']}), bad)
            with self.assertRaises(ValueError):
                app.answer_placement_item({**base, 'attempt_id': 't3', 'selected_option_id': 'a'})
            with self.assertRaises(ValueError):
                app.answer_step_item({**base, 'attempt_id': 't4', 'selected_option_id': 'a'})
        self.assertEqual(ok['status'], 'CORRECT')
        self.assertEqual(bad['status'], 'MISCONCEPTION')
        self.assertIn('idea hermana', bad['selected_misconception'])

    def test_routes_registered(self):
        for r in ('/api/practice/discriminate', '/api/practice/discriminate/answer'):
            self.assertIn(r, app.ROUTES)


if __name__ == '__main__':
    unittest.main()
