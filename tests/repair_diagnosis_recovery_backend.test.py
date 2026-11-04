import copy
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from memory_store import validate_store


def store_with_pending():
    question = {"prompt": "Resuelve 2x + 3 = 7", "reference": "x = 2", "kind": "application", "observable_dimensions": ["direct_application"]}
    event = {"type": "EVIDENCE", "evidence_id": "e1", "attempt_id": "a1", "activity_id": "parent-activity", "node_id": "n1", "phase": "INDEPENDENT", "result": "PARTIAL", "status": "PARTIAL", "error_type": "prerequisite", "help_used": 0}
    pending = {"version": "repair_diagnosis_recovery_v1", "request_id": "request-1", "profile_id": "profile-test", "goal_id": "goal-1", "parent_activity_id": "parent-activity", "parent_attempt_id": "a1", "parent_node_id": "n1", "status": "ERROR", "request": {"operation": "diagnose", "plan_version": "repair_teaching_v2", "question": question}}
    return {"goals": [{"id": "goal-1", "goal": "Álgebra", "nodes": [{"id": "n1", "name": "Ecuaciones", "outcome": "Resolver", "kind": "procedure", "prerequisites": [], "probe": question}], "coverage": [], "learner": {}, "lessons": {"n1": {"independent": question}}, "reviews": [], "events": [event], "session": {"mode": "INDEPENDENT", "node": "n1", "stack": [], "stage": "teach", "tries": 0}, "repairEpisodes": [], "contextStack": [], "pending_repair_diagnosis": pending}], "active": "goal-1"}


class RepairDiagnosisRecoveryBackendTests(unittest.TestCase):
    def test_valid_pending_diagnosis_preserves_profile_and_parent(self):
        validated, counts = validate_store(store_with_pending(), "profile-test")
        pending = validated["goals"][0]["pending_repair_diagnosis"]
        self.assertEqual(pending["profile_id"], "profile-test")
        self.assertEqual(pending["parent_attempt_id"], "a1")
        self.assertEqual(counts["repair_episodes"], 0)

    def test_unknown_parent_attempt_is_rejected(self):
        raw = store_with_pending()
        raw["goals"][0]["pending_repair_diagnosis"]["parent_attempt_id"] = "missing"
        with self.assertRaisesRegex(ValueError, "intento padre inexistente"):
            validate_store(raw, "profile-test")

    def test_parent_activity_mismatch_is_rejected(self):
        raw = copy.deepcopy(store_with_pending())
        raw["goals"][0]["pending_repair_diagnosis"]["parent_activity_id"] = "other"
        with self.assertRaisesRegex(ValueError, "actividad padre"):
            validate_store(raw, "profile-test")


if __name__ == "__main__":
    unittest.main()
