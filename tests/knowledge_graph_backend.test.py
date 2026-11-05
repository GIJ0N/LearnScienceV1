"""knowledge_graph_v1: validated extraction with provenance and composition generated only from stored chains."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory

PROPS = ['La densidad es masa entre volumen.', 'Un objeto flota si su densidad es menor que la del fluido.',
         'El agua de mar es más densa que el agua dulce.', 'Un mismo barco flota más alto en el mar.']


def raw(props=PROPS, chains=None):
    return {'propositions': list(props), 'chains': chains if chains is not None else [{'premises': [0, 1, 2], 'conclusion': 3}]}


class Graph(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'k.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.other = self.memory.create_profile('Otro')['profile_id']
        self.patch = patch.object(app, 'memory', return_value=self.memory)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def extract(self, payload, node='n1', goal='g1', profile=None, ref='l1'):
        with patch.object(app, 'gemini', return_value=payload):
            return app.extract_graph({'profile_id': profile or self.profile, 'goal_id': goal, 'node_id': node, 'goal': 'Flotar', 'name': 'Densidad',
                                      'material': 'Texto de la lección.', 'lesson_ref': ref})

    def test_valid_extraction_stores_with_provenance(self):
        out = self.extract(raw())
        self.assertEqual(len(out['propositions']), 4)
        self.assertEqual(len(out['chains']), 1)
        chain = out['chains'][0]
        self.assertEqual(len(chain['premises']), 3)
        self.assertNotIn(chain['conclusion'], chain['premises'])
        stored = self.memory.load_graph(self.profile, 'g1')
        self.assertEqual(stored['chains'][0]['sources'], [{'node_id': 'n1', 'kind': 'lesson', 'lesson_ref': 'l1'}])

    def test_duplicates_are_merged_by_normalized_statement_and_accumulate_sources(self):
        first = self.extract(raw())
        again = self.extract(raw(props=[PROPS[0].upper(), 'la  densidad es masa entre volumen!!', PROPS[1], PROPS[2], PROPS[3]],
                                chains=[{'premises': [0, 2, 3], 'conclusion': 4}]), node='n2', ref='l2')
        ids = {p['prop_id'] for p in first['propositions']}
        self.assertTrue({p['prop_id'] for p in again['propositions']} <= ids | {p['prop_id'] for p in again['propositions']})
        graph = self.memory.load_graph(self.profile, 'g1')
        self.assertEqual(len(graph['propositions']), 4, 'no se duplican proposiciones')
        dens = next(p for p in graph['propositions'] if p['statement'].startswith('La densidad'))
        self.assertEqual({s['node_id'] for s in dens['sources']}, {'n1', 'n2'})
        self.assertEqual(len(graph['chains']), 1, 'la misma cadena no se duplica')

    def test_same_statement_in_another_goal_or_profile_is_not_merged(self):
        a = self.extract(raw(), goal='g1')
        b = self.extract(raw(), goal='g2')
        c = self.extract(raw(), profile=self.other)
        ids = [{p['prop_id'] for p in x['propositions']} for x in (a, b, c)]
        self.assertFalse(ids[0] & ids[1] or ids[0] & ids[2] or ids[1] & ids[2])

    def test_invalid_chains_are_dropped_but_propositions_kept(self):
        bad = [{'premises': [0], 'conclusion': 3}, {'premises': [0, 1], 'conclusion': 1}, {'premises': [0, 9], 'conclusion': 3},
               {'premises': [0, 0], 'conclusion': 3}, {'premises': 'x', 'conclusion': 3}, {'premises': [0, 1, 2, 3], 'conclusion': 3}]
        out = self.extract(raw(chains=bad))
        self.assertEqual(out['chains'], [])
        self.assertEqual(len(out['propositions']), 4)

    def test_too_few_valid_propositions_fails_and_stores_nothing(self):
        with self.assertRaises(ValueError):
            self.extract(raw(props=['corta', PROPS[0]], chains=[]))
        self.assertEqual(self.memory.load_graph(self.profile, 'g1')['propositions'], [])

    def test_caps(self):
        many = [f'Proposición número {i} con texto suficiente.' for i in range(20)]
        out = self.extract(raw(props=many, chains=[{'premises': [i, i + 1], 'conclusion': i + 2} for i in range(0, 12, 3)]))
        self.assertLessEqual(len(out['propositions']), app.GRAPH_MAX_PROPS)

    def test_empty_material_rejected_before_model_call(self):
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamarse')):
            with self.assertRaises(ValueError):
                app.extract_graph({'profile_id': self.profile, 'goal_id': 'g1', 'node_id': 'n1', 'goal': 'x', 'name': 'y', 'material': ''})

    def test_profile_deletion_cascades(self):
        self.extract(raw())
        self.memory.delete_profile(self.profile)
        self.assertEqual(self.memory.load_graph(self.profile, 'g1')['chains'], [])


class Composition(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'c.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.other = self.memory.create_profile('Otro')['profile_id']
        self.patch = patch.object(app, 'memory', return_value=self.memory)
        self.patch.start()
        with patch.object(app, 'gemini', return_value=raw()):
            self.chain = app.extract_graph({'profile_id': self.profile, 'goal_id': 'g1', 'node_id': 'n1', 'goal': 'F', 'name': 'D', 'material': 'm'})['chains'][0]['chain_id']

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def item(self, chain_id=None, **extra):
        base = {'chain_id': chain_id or self.chain, 'prompt': 'Un barco pasa del río al mar: ¿qué ocurre?', 'correct_option_id': 'a', 'explanation': 'Cadena completa.',
                'options': [{'id': 'a', 'text': 'Flota más alto', 'misconception': ''},
                            {'id': 'b', 'text': 'Igual', 'misconception': 'Omite la premisa de la densidad del fluido.'},
                            {'id': 'c', 'text': 'Se hunde', 'misconception': 'Invierte la comparación de densidades.'}]}
        base.update(extra)
        return base

    def compose(self, items, chain_ids=None, profile=None, goal='g1'):
        with patch.object(app, 'gemini', return_value={'items': items}) as g:
            out = app.make_composition_items({'profile_id': profile or self.profile, 'goal_id': goal, 'goal': 'F', 'chain_ids': chain_ids or [self.chain]})
        return out, g

    def test_prompt_is_built_from_stored_statements_and_key_stays_private(self):
        with patch.object(app, 'gemini', return_value={'items': [self.item()]}) as g:
            out = app.make_composition_items({'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'F', 'chain_ids': [self.chain]})
        self.assertIn(PROPS[0], g.call_args[0][0])
        it = out['items'][0]
        self.assertTrue(it['item_id'].startswith('comp-'))
        self.assertEqual(it['chain_id'], self.chain)
        self.assertNotIn('correct_option_id', it)

    def test_client_cannot_use_chains_of_another_goal_or_profile(self):
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamarse')):
            for kw in ({'goal': 'g2'}, {'profile': self.other}, {'chain_ids': ['chain-inventada']}):
                with self.subTest(kw=kw):
                    with self.assertRaises(ValueError):
                        app.make_composition_items({'profile_id': kw.get('profile', self.profile), 'goal_id': kw.get('goal', 'g1'), 'goal': 'F',
                                                    'chain_ids': kw.get('chain_ids', [self.chain])})

    def test_items_for_unrequested_chains_or_invalid_are_dropped(self):
        with self.assertRaises(ValueError):
            self.compose([self.item('chain-otra'), self.item(correct_option_id='zz')])
        out, _ = self.compose([self.item('chain-otra'), self.item()])
        self.assertEqual(len(out['items']), 1)

    def test_grading_is_provider_free_and_version_isolated(self):
        out, _ = self.compose([self.item()])
        it = out['items'][0]
        ids = {o['text']: o['id'] for o in it['options']}
        base = {'profile_id': self.profile, 'goal_id': 'g1', 'item_id': it['item_id']}
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamarse')):
            ok = app.answer_composition_item({**base, 'attempt_id': 't1', 'selected_option_id': ids['Flota más alto']})
            bad = app.answer_composition_item({**base, 'attempt_id': 't2', 'selected_option_id': ids['Igual']})
            for fn in (app.answer_placement_item, app.answer_step_item, app.answer_discrimination_item):
                with self.assertRaises(ValueError):
                    fn({**base, 'attempt_id': 't3', 'selected_option_id': 'a'})
        self.assertEqual(ok['status'], 'CORRECT')
        self.assertIn('premisa de la densidad', bad['selected_misconception'])

    def test_routes(self):
        for r in ('/api/graph/extract', '/api/graph/get', '/api/practice/compose', '/api/practice/compose/answer'):
            self.assertIn(r, app.ROUTES)


if __name__ == '__main__':
    unittest.main()
