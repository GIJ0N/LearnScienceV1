"""topic_closure_v1 (servidor): /api/graph/get con node_id devuelve solo el tema, en orden determinista;
validate_store recorta los eventos de cierre y fuerza creates_evidence=false. SQLite temporal, sin proveedor."""
import copy
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app
from memory_store import DurableMemory, validate_store


class TopicClosureBackend(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'k.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.other = self.memory.create_profile('Otro')['profile_id']
        self.patch = patch.object(app, 'memory', return_value=self.memory)
        self.patch.start()
        self.memory.save_graph(self.profile, 'g1', 'n1', [{'statement': 'La densidad es masa entre volumen.', 'norm': 'la densidad es masa entre volumen'},
                                                          {'statement': 'Un objeto flota si es menos denso.', 'norm': 'un objeto flota si es menos denso'},
                                                          {'statement': 'Agua salada es más densa.', 'norm': 'agua salada es mas densa'}],
                               [{'premises': [0, 1], 'conclusion': 2}], {'node_id': 'n1', 'kind': 'lesson', 'lesson_ref': 'l1'})
        self.memory.save_graph(self.profile, 'g1', 'n2', [{'statement': 'La presión sube con la profundidad.', 'norm': 'la presion sube con la profundidad'},
                                                          {'statement': 'El fondo soporta más peso de agua.', 'norm': 'el fondo soporta mas peso de agua'}],
                               [], {'node_id': 'n2', 'kind': 'lesson', 'lesson_ref': 'l2'})

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def payload(self, **extra):
        return app.get_graph({'profile_id': self.profile, 'goal_id': 'g1', **extra})

    def test_without_node_id_returns_the_whole_goal_as_before(self):
        out = self.payload()
        self.assertEqual(len(out['propositions']), 5)
        self.assertEqual(len(out['chains']), 1)

    def test_with_node_id_returns_only_that_topic_with_node_ids_and_lesson_refs(self):
        out = self.payload(node_id='n1')
        self.assertEqual([c['node_id'] for c in out['chains']], ['n1'])
        statements = [p['statement'] for p in out['propositions']]
        self.assertNotIn('La presión sube con la profundidad.', statements)
        dens = next(p for p in out['propositions'] if p['statement'].startswith('La densidad'))
        self.assertEqual(dens['node_ids'], ['n1'])
        self.assertEqual(dens['lesson_refs'], ['l1'])

    def test_node_payload_order_is_deterministic_by_created_at_then_prop_id(self):
        # Fuerza created_at: la densidad es la más reciente; las otras dos empatan y desempatan por prop_id.
        with sqlite3.connect(str(self.memory.path)) as db:
            db.execute("UPDATE knowledge_props SET created_at = 5 WHERE statement LIKE 'La densidad%'")
            db.execute("UPDATE knowledge_props SET created_at = 1 WHERE statement LIKE 'Un objeto%' OR statement LIKE 'Agua%'")
            db.commit()
        first = [p['statement'] for p in self.payload(node_id='n1')['propositions']]
        second = [p['statement'] for p in self.payload(node_id='n1')['propositions']]
        self.assertEqual(first, second, 'mismo orden en cada lectura')
        self.assertEqual(first[-1], 'La densidad es masa entre volumen.', 'created_at mayor va al final')
        self.assertEqual(set(first[:2]), {'Un objeto flota si es menos denso.', 'Agua salada es más densa.'})

    def test_other_profile_or_goal_gets_an_empty_topic(self):
        out = app.get_graph({'profile_id': self.other, 'goal_id': 'g1', 'node_id': 'n1'})
        self.assertEqual(out, {'schema_version': out['schema_version'], 'propositions': [], 'chains': []})
        out2 = app.get_graph({'profile_id': self.profile, 'goal_id': 'otra', 'node_id': 'n1'})
        self.assertEqual(out2['propositions'], [])

    def test_unknown_node_returns_empty_not_error(self):
        out = self.payload(node_id='no-existe')
        self.assertEqual(out['chains'], [])
        self.assertEqual(out['propositions'], [])

    def store(self, events):
        return {'goals': [{'id': 'g1', 'goal': 'Meta', 'learner': {}, 'lessons': {}, 'reviews': [], 'repairEpisodes': [], 'contextStack': [],
                           'nodes': [{'id': 'n1', 'name': 'Tema', 'outcome': 'Resolver', 'prerequisites': []}],
                           'coverage': [{'id': 'n1', 'name': 'Tema', 'dimensions': [{'id': 'direct_application', 'required': True, 'evidence': []}]}],
                           'events': events, 'session': {'mode': 'DIAGNOSTIC', 'node': None, 'stack': [], 'stage': 'teach', 'tries': 0}}]}

    def test_validate_store_clamps_text_and_forces_no_evidence(self):
        events = [
            {'type': 'TOPIC_SELF_EXPLANATION', 'node_id': 'n1', 'closure_id': 'c', 'source': 'closure', 'text': 'x' * 900, 'at': 1700000000000, 'creates_evidence': True},
            {'type': 'TOPIC_CLOSURE_OPENED', 'node_id': 'n1', 'source': 'map', 'at': 1700000000100, 'creates_evidence': True},
        ]
        out = validate_store(self.store(copy.deepcopy(events)), self.profile)
        saved = [e for e in out['goals'][0]['events'] if e['type'].startswith('TOPIC_')]
        self.assertEqual(len(saved), 2)
        self.assertEqual(len(saved[0]['text']), 600)
        self.assertTrue(all(e['creates_evidence'] is False for e in saved))

    def test_validate_store_rejects_unknown_node_in_closure_events(self):
        bad = [{'type': 'TOPIC_CLOSURE_OPENED', 'node_id': 'fantasma', 'source': 'map', 'at': 1700000000100, 'creates_evidence': False}]
        with self.assertRaises(ValueError):
            validate_store(self.store(bad), self.profile)


if __name__ == '__main__':
    unittest.main()
