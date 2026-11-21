"""contrast_interleave_v1: enlaces de contraste validados en servidor y evento CONTRAST_SHOWN formativo.

SQLite temporal y proveedor controlado; no llama a Gemini real.
"""
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory

NODES = [{'id': 'a', 'name': 'Densidad', 'outcome': 'Comparar'}, {'id': 'b', 'name': 'Presión', 'outcome': 'Calcular'}]
GOAL_NODES = ['a', 'b', 'c']


def item(node_id, key='a', link=None):
    """Una pregunta válida; `link` añade confused_with a la opción distractora 'b'."""
    opts = [{'id': 'a', 'text': 'idea correcta', 'misconception': ''},
            {'id': 'b', 'text': 'idea hermana', 'misconception': 'Aplica la idea hermana por parecido.'},
            {'id': 'c', 'text': 'otra', 'misconception': 'Mezcla ambas.'}]
    if link is not None:
        opts[1]['confused_with'] = link
    return {'node_id': node_id, 'prompt': f'Situación para {node_id}', 'correct_option_id': key,
            'explanation': 'Aplica esta y no las otras.', 'options': opts}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'c.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.patch = patch.object(app, 'memory', return_value=self.memory)
        self.patch.start()
        self.memory.save(self.profile, {'goals': [{'id': 'g1', 'goal': 'Flotar', 'nodes': [
            {'id': n, 'name': n.upper(), 'outcome': '', 'prerequisites': []} for n in GOAL_NODES],
            'coverage': [], 'learner': {}, 'lessons': {}, 'reviews': [], 'events': []}]})
        # Cadena real del grafo de la meta, anclada al tema 'b' (no está en la sesión de NODES[:2] de 'a').
        self.chain = self.memory.save_graph(self.profile, 'g1', 'b',
                                            [{'statement': 'p1', 'norm': 'p1'}, {'statement': 'p2', 'norm': 'p2'}, {'statement': 'q', 'norm': 'q'}],
                                            [{'premises': [0, 1], 'conclusion': 2}], 'test')['chain_ids'][0]

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def generate(self, items, nodes=NODES):
        with patch.object(app, 'gemini', return_value={'items': items}) as g:
            out = app.make_discrimination_items({'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Flotar', 'nodes': nodes})
        self.assertEqual(g.call_count, 1)
        return out


class ContrastLinks(Base):
    def test_no_link_means_no_contrast_and_the_old_public_shape(self):
        out = self.generate([item('a'), item('b')])
        for it in out['items']:
            self.assertNotIn('contrast', it)
            self.assertEqual(set(it), {'schema_version', 'item_id', 'node_id', 'prompt', 'options'})

    def test_invented_link_discards_only_that_pair_and_saves_nothing_partial(self):
        with patch.object(app.DurableMemory, 'save_placement_items', autospec=True, side_effect=DurableMemory.save_placement_items) as spy:
            out = self.generate([item('a', link='inventado-zzz'), item('b'), item('c')], nodes=NODES + [{'id': 'c', 'name': 'C', 'outcome': ''}])
        self.assertEqual(sorted(x['node_id'] for x in out['items']), ['b', 'c'])
        self.assertEqual(spy.call_count, 1)
        saved_items = spy.call_args[0][3]  # (self, profile, goal, items)
        self.assertEqual(sorted(public['node_id'] for public, _ in saved_items), ['b', 'c'], 'solo se guardan las preguntas válidas')

    def test_invented_link_everywhere_is_rejected_with_nothing_saved(self):
        with patch.object(app.DurableMemory, 'save_placement_items', autospec=True, side_effect=DurableMemory.save_placement_items) as spy:
            with self.assertRaises(ValueError):
                self.generate([item('a', link='nope-1'), item('b', link='nope-2')])
        self.assertEqual(spy.call_count, 0, 'enlace inventado: no se guarda nada')

    def test_self_link_to_the_own_topic_is_rejected(self):
        with self.assertRaises(ValueError):
            self.generate([item('a', link='a'), item('b', link='b')])

    def test_valid_node_and_chain_links_are_public_and_resolved_by_the_server(self):
        # 'c' pertenece a la meta pero no a la sesión; la cadena apunta a 'b'.
        # La cadena pertenece al tema 'b': sirve como enlace desde la pregunta de 'a', no desde la de 'b'.
        out = self.generate([item('a', link=self.chain), item('b', link='c')])
        by = {x['node_id']: x for x in out['items']}
        self.assertEqual(by['a']['contrast'][0]['confused_ref'], self.chain)
        self.assertEqual(by['a']['contrast'][0]['confused_node_id'], 'b')
        self.assertEqual(by['b']['contrast'][0]['confused_ref'], 'c')
        self.assertEqual(by['b']['contrast'][0]['confused_node_id'], 'c')
        for x in out['items']:
            for pair in x['contrast']:
                self.assertTrue(pair['pair_id'].startswith(x['item_id']))
            self.assertNotIn('correct_option_id', x)
            self.assertNotIn('misconceptions', x)


class ContrastStore(Base):
    def event(self, **extra):
        base = {'type': 'CONTRAST_SHOWN', 'version': 'contrast_interleave_v1', 'node_id': 'a', 'pair_id': 'p1',
                'confused_node_id': 'b', 'confused_ref': 'b', 'attempt_id': 't1', 'at': 1, 'creates_evidence': True}
        base.update(extra)
        return base

    def store_with(self, events):
        raw = copy.deepcopy(self.memory.load(self.profile)['store'])
        raw['goals'][0]['events'] = events
        return raw

    def test_validate_store_forces_creates_evidence_false(self):
        self.memory.save(self.profile, self.store_with([self.event(creates_evidence=True)]))
        saved = self.memory.load(self.profile)['store']['goals'][0]['events'][0]
        self.assertIs(saved['creates_evidence'], False)

    def test_contrast_event_does_not_touch_evidence_fields(self):
        self.memory.save(self.profile, self.store_with([self.event()]))
        saved = self.memory.load(self.profile)['store']['goals'][0]
        self.assertEqual(saved['events'][0]['type'], 'CONTRAST_SHOWN')
        self.assertEqual(saved['coverage'], [])
        self.assertEqual(saved['reviews'], [])

    def test_invalid_confused_node_is_rejected(self):
        with self.assertRaises(ValueError):
            self.memory.save(self.profile, self.store_with([self.event(confused_node_id='fantasma')]))


if __name__ == '__main__':
    unittest.main()
