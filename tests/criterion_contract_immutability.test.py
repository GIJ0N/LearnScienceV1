"""Atomic immutable identity for durable criterion activity contracts."""
import copy
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory


def contracts(activity_id="criterion-fixed"):
    public = {
        "schema_version": "criterion_assessment_v1", "activity_id": activity_id,
        "type": "multiple_choice_explanation", "phase": "INDEPENDENT",
        "prompt": "Elige y explica.",
        "options": [{"id": "a", "text": "A"}, {"id": "b", "text": "B"}],
        "criteria": [
            {"criterion_id": "option_choice", "observable_dimension": "recognition", "required": True, "description": "Elegir."},
            {"criterion_id": "explanation", "observable_dimension": "conceptual", "required": True, "description": "Explicar."},
        ],
        "required_criteria": ["option_choice", "explanation"],
        "help": {"enabled": True, "critical": True}, "variant": "immutable-v1", "context": "synthetic",
    }
    private = {
        "correct_option_id": "a", "criteria": copy.deepcopy(public["criteria"]),
        "rubric_version": "criterion_assessment_v1", "contract_digest": "immutable-digest",
        "references": {"explanation": "A es válida por el principio autorizado."},
    }
    return public, private


class ImmutableContract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="criterion-immutable-")
        self.path = Path(self.tmp.name) / "memory.sqlite3"
        self.store = DurableMemory(self.path)
        self.profile = self.store.create_profile("synthetic-a")["profile_id"]
        self.other = self.store.create_profile("synthetic-b")["profile_id"]
        self.public, self.private = contracts()
        self.first = self.store.save_criterion_activity(self.profile, "goal-a", self.public, self.private)
        self.original = self.store.load_criterion_activity(self.profile, self.public["activity_id"])

    def tearDown(self):
        self.tmp.cleanup()

    def assert_conflict(self, public=None, private=None, goal="goal-a"):
        with self.assertRaisesRegex(ValueError, "CRITERION_ACTIVITY_CONFLICT"):
            self.store.save_criterion_activity(self.profile, goal, public or self.public, private or self.private)
        self.assertEqual(self.store.load_criterion_activity(self.profile, self.public["activity_id"]), self.original)

    def test_equivalent_is_noop_and_key_order_is_semantic(self):
        reordered_public = dict(reversed(list(self.public.items())))
        reordered_private = dict(reversed(list(self.private.items())))
        result = self.store.save_criterion_activity(self.profile, "goal-a", reordered_public, reordered_private)
        after = self.store.load_criterion_activity(self.profile, self.public["activity_id"])
        self.assertFalse(result["saved"]); self.assertTrue(result["reused"])
        self.assertEqual((after["created_at"], after["updated_at"], after["status"]),
                         (self.original["created_at"], self.original["updated_at"], self.original["status"]))
        self.assertEqual(after, self.original)

    def test_public_private_rubric_reference_and_goal_conflicts(self):
        changed = copy.deepcopy(self.public); changed["options"][0]["text"] = "changed"
        self.assert_conflict(public=changed)
        changed = copy.deepcopy(self.private); changed["correct_option_id"] = "b"
        self.assert_conflict(private=changed)
        changed = copy.deepcopy(self.private); changed["rubric_version"] = "v2"
        self.assert_conflict(private=changed)
        changed = copy.deepcopy(self.private); changed["references"]["explanation"] = "changed"
        self.assert_conflict(private=changed)
        self.assert_conflict(goal="goal-b")

    def test_profile_scope_and_existing_evaluation_survive_conflict_and_restart(self):
        other_result = self.store.save_criterion_activity(self.other, "goal-other", self.public, self.private)
        self.assertTrue(other_result["saved"])
        fingerprint = "original-fingerprint"
        self.store.begin_criterion_evaluation(self.profile, "goal-a", self.public["activity_id"], "attempt-existing", fingerprint, "owner")
        assessment = {"schema_version": "criterion_assessment_v1", "attempt_id": "attempt-existing", "activity_id": self.public["activity_id"], "overall": "PARTIAL", "criteria": []}
        self.store.finish_criterion_evaluation(self.profile, "attempt-existing", fingerprint, assessment, "owner")
        changed = copy.deepcopy(self.private); changed["correct_option_id"] = "b"
        self.assert_conflict(private=changed)
        restarted = DurableMemory(self.path)
        self.assertEqual(restarted.load_criterion_activity(self.profile, self.public["activity_id"]), self.original)
        self.assertEqual(restarted.load_criterion_evaluation(self.profile, "attempt-existing")["assessment"], assessment)

    def test_concurrent_identical_and_different_contracts_are_atomic(self):
        def race(activity_id, second_private):
            first_store, second_store = DurableMemory(self.path), DurableMemory(self.path)
            public, private = contracts(activity_id)
            barrier = threading.Barrier(2); results = []
            def write(store, value):
                try:
                    barrier.wait(timeout=2)
                    results.append(("ok", store.save_criterion_activity(self.profile, "goal-a", public, value)))
                except Exception as error:
                    results.append(("error", str(error)))
            threads = [threading.Thread(target=write, args=(first_store, private)), threading.Thread(target=write, args=(second_store, second_private))]
            for thread in threads: thread.start()
            for thread in threads: thread.join(timeout=10)
            self.assertTrue(all(not thread.is_alive() for thread in threads))
            return results
        public, private = contracts("criterion-race-identical")
        identical = race(public["activity_id"], copy.deepcopy(private))
        self.assertEqual(sorted(item[0] for item in identical), ["ok", "ok"])
        self.assertEqual(sum(item[1]["saved"] for item in identical), 1)
        public, private = contracts("criterion-race-conflict")
        different = copy.deepcopy(private); different["correct_option_id"] = "b"
        conflict = race(public["activity_id"], different)
        self.assertEqual(sorted(item[0] for item in conflict), ["error", "ok"])
        self.assertIn("CRITERION_ACTIVITY_CONFLICT", next(item[1] for item in conflict if item[0] == "error"))

    def test_server_identity_ignores_provider_id_and_collision_cannot_replace(self):
        self.assertNotIn("activity_id", app.CRITERION_ACTIVITY_PROVIDER_SCHEMA["properties"])
        self.assertNotIn("activity_id", app.CRITERION_ACTIVITY_PROVIDER_SCHEMA["required"])
        app.set_memory_for_tests(self.store)
        generated = {
            "schema_version": "criterion_assessment_v1", "activity_id": "provider-reused-id",
            "type": "multiple_choice_explanation", "phase": "INDEPENDENT", "prompt": "Original",
            "options": [{"id": "a", "text": "A"}, {"id": "b", "text": "B"}], "correct_option_id": "a",
            "explanation_reference": "A conserva el principio autorizado.",
            "criteria": copy.deepcopy(self.public["criteria"]), "help": {"enabled": True, "critical": True},
            "variant": "provider-v1", "context": "synthetic",
        }
        fixed_uuid = SimpleNamespace(hex="0" * 32)
        with patch.object(app.uuid, "uuid4", return_value=fixed_uuid), patch.object(app, "gemini", return_value=copy.deepcopy(generated)):
            first = app.make_criterion_activity({"profile_id": self.profile, "goal_id": "goal-generated", "goal": "Goal", "concept": "Concept"})
            same = app.make_criterion_activity({"profile_id": self.profile, "goal_id": "goal-generated", "goal": "Goal", "concept": "Concept"})
        self.assertEqual(first, same)
        self.assertEqual(first["activity_id"], "criterion-" + "0" * 32)
        self.assertNotEqual(first["activity_id"], generated["activity_id"])
        changed = copy.deepcopy(generated); changed["correct_option_id"] = "b"
        with patch.object(app.uuid, "uuid4", return_value=fixed_uuid), patch.object(app, "gemini", return_value=changed):
            with self.assertRaisesRegex(ValueError, "CRITERION_ACTIVITY_CONFLICT"):
                app.make_criterion_activity({"profile_id": self.profile, "goal_id": "goal-generated", "goal": "Goal", "concept": "Concept"})
        db = sqlite3.connect(self.path)
        try:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM criterion_evaluations").fetchone()[0], 0)
        finally:
            db.close()
        preserved = self.store.load_criterion_activity(self.profile, first["activity_id"])
        self.assertEqual(preserved["private_contract"]["correct_option_id"], "a")


if __name__ == "__main__":
    unittest.main()
