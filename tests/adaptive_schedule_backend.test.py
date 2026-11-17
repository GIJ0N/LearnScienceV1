"""adaptive_schedule_v1: el servidor descarta (sin rechazar) metadatos de calendario malformados y conserva los válidos."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from memory_store import DurableMemory, validate_store


def store(reviews):
    node = {"id": "n1", "name": "Unidades", "outcome": "Convertir", "level": 0, "kind": "concept", "prerequisites": [], "probe": None}
    return {"goals": [{
        "id": "goal-1", "goal": "Meta", "nodes": [node], "coverage": [], "learner": {}, "lessons": {},
        "reviews": reviews, "events": [{"type": "REVIEW_DEFERRED", "review_node_id": "n1", "source_node_id": "n1", "at": 1, "creates_evidence": False}],
        "session": {"mode": "DIAGNOSTIC", "node": None, "stack": [], "stage": "teach", "tries": 0},
        "repairEpisodes": [], "contextStack": [], "map_updates": [],
    }], "active": "goal-1"}


class AdaptiveScheduleStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.temp.name) / "memory.sqlite3")
        self.profile = self.memory.create_profile("Ada")["profile_id"]

    def tearDown(self):
        self.temp.cleanup()

    def reviews_after(self, reviews):
        self.memory.save(self.profile, store(reviews))
        return self.memory.load(self.profile)["store"]["goals"][0]["reviews"]

    def test_malformed_values_are_discarded_not_rejected(self):
        for bad in ({}, "x", 7, None, [None], [{"from_due": "x", "to_due": 2, "days": 1, "at": 3}], [[1, 2]]):
            out = self.reviews_after([{"id": "n1", "due": 5, "step": 0, "history": [], "deferrals": bad, "schedule_note": bad}])
            self.assertEqual(out[0]["deferrals"], [], repr(bad))
            self.assertNotIn("schedule_note", out[0] if not isinstance(bad, dict) else {}, repr(bad))

    def test_valid_values_survive_the_round_trip_and_text_is_bounded(self):
        deferral = {"from_due": 1, "to_due": 2, "days": 1, "at": 3, "reason": "y" * 900, "source_attempt_id": "a1"}
        out = self.reviews_after([{"id": "n1", "due": 5, "step": 0, "history": [], "deferrals": [deferral] * 15, "schedule_note": {"attempt_id": "a", "due": "mañana", "reason": "z" * 900}}])
        self.assertEqual(len(out[0]["deferrals"]), 10)
        self.assertEqual(len(out[0]["deferrals"][0]["reason"]), 200)
        self.assertEqual(out[0]["deferrals"][0]["source_attempt_id"], "a1")
        self.assertEqual(len(out[0]["schedule_note"]["reason"]), 200)
        self.assertNotIn("due", out[0]["schedule_note"])

    def test_legacy_reviews_are_not_given_new_fields_and_ledger_event_is_kept(self):
        out = self.reviews_after([{"id": "n1", "due": 5, "step": 0, "history": []}])
        self.assertNotIn("deferrals", out[0])
        self.assertNotIn("schedule_note", out[0])
        loaded = self.memory.load(self.profile)["store"]["goals"][0]["events"]
        self.assertEqual(loaded[0]["type"], "REVIEW_DEFERRED")

    def test_unknown_node_reference_is_still_rejected(self):
        with self.assertRaises(ValueError):
            validate_store(store([{"id": "otro", "due": 1, "step": 0, "history": []}]), self.profile)


if __name__ == "__main__":
    unittest.main()
