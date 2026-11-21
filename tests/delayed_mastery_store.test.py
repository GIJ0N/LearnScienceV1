"""delayed_mastery_v1 (persistencia): los eventos nuevos de L2a sobreviven guardar, cargar, exportar y restaurar
sin reescribirse. El dominio diferido se deriva del ledger al leer; no se guarda ningún campo auxiliar de tiempo."""
import copy
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from memory_store import DurableMemory

NEW_EVENTS = [
    {'type': 'TEACHING_EXPOSURE', 'node_id': 'n1', 'at': 1700000000000, 'policy_version': 'retrieval_gap_v1'},
    {'type': 'EVIDENCE', 'node_id': 'n1', 'evidence_id': 'ev-1', 'attempt_id': 'att-1', 'activity_id': 'act-1', 'phase': 'INDEPENDENT',
     'result': 'CORRECT', 'status': 'CORRECT', 'is_independent': True, 'help_used': 0, 'purpose': 'delayed',
     'evaluator_trust': 'deterministic', 'evaluator_version': 'local-production-v1', 'observed_dimensions': ['direct_application'],
     'timestamp': 1700090000000},
    {'type': 'CURRICULUM_CONTINUED', 'node_id': 'n1', 'source': 'POLICY_NOTICE', 'policy_version': 'delayed_mastery_v1', 'pending_dimensions': ['direct_application'], 'at': 1700090000100},
    {'type': 'POLICY_NOTICE_ACK', 'policy_version': 'delayed_mastery_v1', 'at': 1700090000200},
    {'type': 'ANCHOR_UNAVAILABLE', 'node_id': 'n1', 'kinds': ['numeric', 'ordering'], 'retry_used': False, 'at': 1700090000300, 'policy_version': 'evidence_hardening_v1'},
]


def without_profile(events):
    # El almacenamiento estampa profile_id en cada evento; el resto de campos debe conservarse igual.
    return [{k: v for k, v in e.items() if k != 'profile_id'} for e in events]


def goal(events):
    return {
        'id': 'g1', 'goal': 'Meta de prueba', 'learner': {}, 'lessons': {}, 'reviews': [], 'repairEpisodes': [], 'contextStack': [],
        'nodes': [{'id': 'n1', 'name': 'Tema', 'outcome': 'Resolver', 'prerequisites': []}],
        'coverage': [{'id': 'n1', 'name': 'Tema', 'dimensions': [{'id': 'direct_application', 'required': True, 'evidence': []}]}],
        'events': events,
        'session': {'mode': 'DIAGNOSTIC', 'node': None, 'stack': [], 'stage': 'teach', 'tries': 0},
    }


class DelayedMasteryStore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.mem = DurableMemory(Path(self.tmp.name) / 'p.sqlite')
        self.pid = self.mem.create_profile('Prueba')['profile_id']

    def tearDown(self):
        self.tmp.cleanup()

    def test_new_events_round_trip_through_save_and_load_unchanged(self):
        self.mem.save(self.pid, {'goals': [goal(copy.deepcopy(NEW_EVENTS))], 'active': 'g1'})
        loaded = self.mem.load(self.pid)['store']['goals'][0]
        self.assertEqual(without_profile(loaded['events']), NEW_EVENTS)

    def test_new_events_survive_export_and_restore(self):
        self.mem.save(self.pid, {'goals': [goal(copy.deepcopy(NEW_EVENTS))], 'active': 'g1'})
        backup = self.mem.export(self.pid)
        other = self.mem.create_profile('Otra')['profile_id']
        self.mem.restore(other, backup)
        loaded = self.mem.load(other)['store']['goals'][0]
        self.assertEqual(without_profile(loaded['events']), NEW_EVENTS)

    def test_no_auxiliary_teaching_field_is_stored(self):
        # La referencia de tiempo sale del ledger al leer: no se guarda first_teaching_at ni un campo equivalente.
        self.mem.save(self.pid, {'goals': [goal(copy.deepcopy(NEW_EVENTS))], 'active': 'g1'})
        coverage = self.mem.load(self.pid)['store']['goals'][0]['coverage'][0]
        self.assertNotIn('first_teaching_at', coverage)
        self.assertNotIn('delayed', coverage)


if __name__ == '__main__':
    unittest.main()
