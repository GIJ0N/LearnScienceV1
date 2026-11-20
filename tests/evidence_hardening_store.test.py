"""evidence_hardening_v1 (persistencia): los eventos nuevos sobreviven guardar, cargar, exportar y restaurar,
y un respaldo con marcadores legacy se conserva tal cual (la degradación ocurre al leer, no al guardar)."""
import copy
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from memory_store import DurableMemory

NEW_EVENTS = [
    {'type': 'FORMATIVE_EXPOSURE', 'node_id': 'n1', 'exposure_kind': 'beto', 'source': 'BETO', 'ref_id': 'beto-1', 'evidence': False, 'exposure_version': 'evidence_hardening_v1', 'at': 1700000000000},
    {'type': 'TRUST_ANCHOR', 'node_id': 'n1', 'source': 'PRODUCTION', 'source_attempt_id': 'src-1', 'anchor_basis': 'numeric', 'anchor_policy_version': 'evidence_hardening_v1', 'at': 1700000000100},
    {'type': 'ANCHOR_UNAVAILABLE', 'node_id': 'n1', 'kinds': ['numeric', 'ordering'], 'retry_used': False, 'at': 1700000000200, 'policy_version': 'evidence_hardening_v1'},
    {'type': 'POLICY_NOTICE_ACK', 'policy_version': 'evidence_hardening_v1', 'at': 1700000000300},
]
LEGACY_MARKER = {'type': 'TRUST', 'status': 'CORRECT', 'source_attempt_id': 'old-1', 'timestamp': 1600000000000}


def goal(events, evidence_extra=()):
    return {
        'id': 'g1', 'goal': 'Meta de prueba', 'learner': {}, 'lessons': {}, 'reviews': [], 'repairEpisodes': [], 'contextStack': [],
        'nodes': [{'id': 'n1', 'name': 'Tema', 'outcome': 'Resolver', 'prerequisites': []}],
        'coverage': [{'id': 'n1', 'name': 'Tema', 'dimensions': [{'id': 'conceptual', 'required': True,
                                                                  'evidence': [LEGACY_MARKER, *evidence_extra]}]}],
        'events': events,
        'session': {'mode': 'DIAGNOSTIC', 'node': None, 'stack': [], 'stage': 'teach', 'tries': 0},
    }


class EvidenceHardeningStore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.mem = DurableMemory(Path(self.tmp.name) / 'p.sqlite')
        self.pid = self.mem.create_profile('Prueba')['profile_id']

    def tearDown(self):
        self.tmp.cleanup()

    def test_new_events_round_trip_through_save_and_load(self):
        raw = {'goals': [goal(copy.deepcopy(NEW_EVENTS))], 'active': 'g1'}
        self.mem.save(self.pid, raw)
        loaded = self.mem.load(self.pid)['store']
        types = [e['type'] for e in loaded['goals'][0]['events']]
        self.assertEqual(types, [e['type'] for e in NEW_EVENTS])
        anchor = loaded['goals'][0]['events'][1]
        self.assertEqual(anchor['anchor_policy_version'], 'evidence_hardening_v1')
        self.assertEqual(anchor['anchor_basis'], 'numeric')

    def test_new_events_survive_export_and_restore(self):
        self.mem.save(self.pid, {'goals': [goal(copy.deepcopy(NEW_EVENTS))], 'active': 'g1'})
        backup = self.mem.export(self.pid)
        other = self.mem.create_profile('Otra')['profile_id']
        self.mem.restore(other, backup)
        loaded = self.mem.load(other)['store']
        self.assertEqual(sorted(e['type'] for e in loaded['goals'][0]['events']), sorted(e['type'] for e in NEW_EVENTS))

    def test_legacy_backup_marker_is_kept_unchanged(self):
        # Respaldo antiguo: el marcador TRUST no tiene anchor_policy_version. Guardar/restaurar no lo reescribe.
        self.mem.save(self.pid, {'goals': [goal([])], 'active': 'g1'})
        backup = self.mem.export(self.pid)
        legacy_store = backup['store']
        legacy_store['goals'][0]['coverage'][0]['dimensions'][0]['evidence'] = [copy.deepcopy(LEGACY_MARKER)]
        other = self.mem.create_profile('Antigua')['profile_id']
        self.mem.restore(other, backup)
        loaded = self.mem.load(other)['store']
        marker = loaded['goals'][0]['coverage'][0]['dimensions'][0]['evidence'][0]
        self.assertEqual(marker, LEGACY_MARKER, 'nada se reescribe ni se añade versión')
        self.assertNotIn('anchor_policy_version', marker)


if __name__ == '__main__':
    unittest.main()
