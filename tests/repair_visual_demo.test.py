import tempfile
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app
from tools.seed_visual_demo import seed
from tools.serve_controlled_demo import _repair_diagnosis, _repair_teaching


class RepairVisualDemoTest(unittest.TestCase):
    def test_controlled_repair_contracts_pass_production_validation(self):
        diagnosis = _repair_diagnosis()
        old = app.gemini
        try:
            app.gemini = lambda prompt, schema, max_tokens=0: diagnosis
            cleaned = app.repair_diagnosis({
                'question': {'prompt': 'Resuelve 7x + 6 = 34.', 'reference': 'x=4'},
                'answer': 'respuesta incorrecta', 'feedback': 'falta equivalencia',
                'error_type': 'prerequisite',
                'nearby_prerequisites': [{'id': 'fundamentos'}],
            })
            self.assertEqual(cleaned['diagnostic_checks'][0]['question']['observable_dimensions'], ['conceptual'])
            teaching = _repair_teaching()
            app.gemini = lambda prompt, schema, max_tokens=0: teaching
            package = app.repair_teaching({
                'plan_version': app.REPAIR_TEACHING_VERSION,
                'selected_gap': {**cleaned['suspected_gaps'][0], 'status': 'CONFIRMED'},
                'parent_question': {'prompt': 'Resuelve 7x + 6 = 34.', 'reference': 'x=4'},
                'parent_response': 'respuesta incorrecta', 'parent_evaluation': {'status': 'PARTIAL'},
                'diagnostic_checks': cleaned['diagnostic_checks'],
            })
            self.assertEqual(package['gap_id'], 'demo-gap-equivalence')
            self.assertEqual(package['repair_activities']['GUIDED']['observable_dimensions'], ['direct_application'])
            self.assertEqual(package['transfer_check']['observable_dimensions'], ['transfer'])
        finally:
            app.gemini = old

    def test_seed_contains_real_parent_activity_without_repair_evidence(self):
        with tempfile.TemporaryDirectory() as td:
            result = seed(Path(td) / 'demo.sqlite3')
            from memory_store import DurableMemory
            loaded = DurableMemory(Path(result['database'])).load(result['profile_id'])['store']
            goal = loaded['goals'][0]
            self.assertEqual(goal['session']['mode'], 'INDEPENDENT')
            self.assertEqual(goal['lessons']['ecuaciones']['independent']['activity_id'], 'demo-parent-independent')
            self.assertEqual(goal['repairEpisodes'], [])
            self.assertIsNone(goal['pending_repair_diagnosis'])
            self.assertFalse(any(event.get('episode_id') for event in goal['events']))
            serialized = str(loaded)
            self.assertNotIn('correct_option_id', serialized)
            self.assertNotIn('Restar ocho a ambos miembros es reversible y conserva las soluciones de la ecuación.', serialized)


if __name__ == '__main__':
    unittest.main()
