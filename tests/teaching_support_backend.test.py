"""worked_examples_v1 L4a (servidor): /api/lesson/steps responde STEPS_NOT_NEEDED en consolidate sin modelo,
learner_requested lo permite y target_dimension llega a la adaptación. validate_store fuerza creates_evidence=false.
SQLite temporal y modelo simulado; sin proveedor real."""
import copy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app
from memory_store import DurableMemory, validate_store


class TeachingSupportBackend(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'ts.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
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

    def test_consolidate_answers_without_model_unless_learner_requested(self):
        with patch.object(app, 'lesson_adaptation', return_value=('consolidate', 'Dominio inicial', 2)), \
                patch.object(app, 'app_model_steps', side_effect=AssertionError('no debe llamar al modelo')) as model:
            out = app.make_lesson_steps(self.payload())
        self.assertEqual(out, {'code': 'STEPS_NOT_NEEDED', 'steps': []})
        self.assertEqual(model.call_count, 0)

    def test_learner_requested_allows_steps_in_consolidate(self):
        with patch.object(app, 'lesson_adaptation', return_value=('consolidate', 'Dominio inicial', 2)), \
                patch.object(app, 'app_model_steps', side_effect=RuntimeError('llamado')) as model:
            with self.assertRaises(RuntimeError):
                app.make_lesson_steps(self.payload(learner_requested=True))
        self.assertEqual(model.call_count, 1)

    def test_other_modes_still_generate_steps(self):
        for mode in ('initial', 'scaffold', 'repair'):
            with patch.object(app, 'lesson_adaptation', return_value=(mode, 'r', 1)), \
                    patch.object(app, 'app_model_steps', side_effect=RuntimeError('llamado')) as model:
                with self.assertRaises(RuntimeError):
                    app.make_lesson_steps(self.payload())
            self.assertEqual(model.call_count, 1, mode)

    def test_target_dimension_reaches_the_adaptation(self):
        with patch.object(app, 'lesson_adaptation', return_value=('initial', 'r', 1)) as adaptation, \
                patch.object(app, 'app_model_steps', side_effect=RuntimeError('llamado')):
            with self.assertRaises(RuntimeError):
                app.make_lesson_steps(self.payload(target_dimension='variables'))
        self.assertEqual(adaptation.call_args.args[1], 'variables')

    def store(self, events):
        return {'goals': [{'id': 'g1', 'goal': 'Meta', 'learner': {}, 'lessons': {}, 'reviews': [], 'repairEpisodes': [], 'contextStack': [],
                           'nodes': [{'id': 'n1', 'name': 'Tema', 'outcome': 'Resolver', 'prerequisites': []}],
                           'coverage': [{'id': 'n1', 'name': 'Tema', 'dimensions': [{'id': 'direct_application', 'required': True, 'evidence': []}]}],
                           'events': events, 'session': {'mode': 'DIAGNOSTIC', 'node': None, 'stack': [], 'stage': 'teach', 'tries': 0}}]}

    def test_validate_store_forces_no_evidence_for_teaching_support(self):
        events = [{'type': 'TEACHING_SUPPORT', 'version': 'worked_examples_v1', 'node_id': 'n1', 'support': 'lean', 'reasons': ['consolidate'],
                   'at': 1700000000000, 'creates_evidence': True}]
        out, _counts = validate_store(self.store(copy.deepcopy(events)), self.profile)
        saved = [e for e in out['goals'][0]['events'] if e['type'] == 'TEACHING_SUPPORT']
        self.assertEqual(len(saved), 1)
        self.assertIs(saved[0]['creates_evidence'], False)
        self.assertEqual(saved[0]['support'], 'lean')


if __name__ == '__main__':
    unittest.main(verbosity=2)
