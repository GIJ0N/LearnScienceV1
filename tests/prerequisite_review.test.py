"""prerequisite_review_v1 (servidor y persistencia): el disparador se calcula con la lógica real de app.js sobre eventos ya guardados,
sin llamadas al modelo; el servidor tolera, conserva, exporta y restaura los eventos sin node_id. SQLite temporal, sin red."""
import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from memory_store import DurableMemory, validate_store  # noqa: E402

SPEC = importlib.util.spec_from_file_location("prerequisite_review_app", ROOT / "app_legacy.py")
APP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APP)


def run_scenario(scenario, **options):
    payload = {"scenario": scenario, **options}
    done = subprocess.run(["node", str(ROOT / "tests" / "prerequisite_review_runner.js")], input=json.dumps(payload), text=True, capture_output=True, cwd=ROOT, check=False)
    if done.returncode != 0:
        raise AssertionError(done.stderr or done.stdout)
    return json.loads(done.stdout)


def ledger(goal, kind="PREREQUISITE_REVIEW"):
    return [e for e in goal["events"] if e.get("type") == kind]


class PrerequisiteReviewBackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.temp.name) / "memory.sqlite3")
        self.profile = self.memory.create_profile("Ada")["profile_id"]

    def tearDown(self):
        self.temp.cleanup()

    def store_of(self, result):
        goal = copy.deepcopy(result["goal"])
        goal["profile_id"] = self.profile
        return {"goals": [goal], "active": goal["id"]}

    def test_trigger_rules(self):
        two = run_scenario("two_failures")
        self.assertEqual(len(ledger(two["goal"])), 1)
        self.assertFalse(two["skipped"], "P deja de estar saltado")
        self.assertEqual(two["proposals"], 1)
        for name in ("one_failure", "diagnostic_failures", "unknown_results", "duplicate"):
            with self.subTest(name):
                result = run_scenario(name)
                self.assertEqual(ledger(result["goal"]), [], name)
                self.assertTrue(result["skipped"], name)

    def test_event_has_no_node_id_and_creates_no_evidence_in_p(self):
        goal = run_scenario("two_failures", p_evidence=True)["goal"]
        event = ledger(goal)[0]
        self.assertNotIn("node_id", event)
        self.assertIs(event["creates_evidence"], False)
        self.assertEqual(event["action"], "unskip")
        p_events = [e for e in goal["events"] if e.get("node_id") == "p"]
        self.assertTrue(p_events and all(e["type"] in ("EVIDENCE", "PLACEMENT_SKIP") for e in p_events))
        self.assertEqual(len([e for e in p_events if e["type"] == "EVIDENCE"]), 1, "solo la evidencia previa de P; la propuesta no crea más")
        self.assertEqual(len(goal["coverage"][0]["dimensions"][0]["evidence"]), 1)

    def test_manual_correction_revokes(self):
        result = run_scenario("corrected_away")
        goal = result["goal"]
        proposals, revokes = ledger(goal), ledger(goal, "PREREQUISITE_REVIEW_REVOKED")
        self.assertEqual(len(proposals), 1)
        self.assertEqual(len(revokes), 1)
        self.assertNotIn("node_id", revokes[0])
        self.assertIs(revokes[0]["creates_evidence"], False)
        self.assertEqual(revokes[0]["proposal_id"], proposals[0]["proposal_id"])
        self.assertEqual(result["proposals"], 0)
        self.assertTrue(result["skipped"])

    def test_no_edge_no_proposal(self):
        result = run_scenario("two_failures", edge=False)
        self.assertEqual(ledger(result["goal"]), [])
        self.assertTrue(result["skipped"])
        self.assertEqual(result["goal"]["nodes"][1]["prerequisites"], [], "no se crean aristas")

    def test_zero_model_calls(self):
        with patch.object(APP, "gemini", side_effect=AssertionError("el disparador no debe llamar al modelo")) as provider:
            for name in ("two_failures", "corrected_away", "one_failure"):
                self.assertEqual(run_scenario(name)["model_calls"], 0, name)
            result = run_scenario("two_failures")
            self.memory.save(self.profile, self.store_of(result))
            self.memory.export(self.profile)
        self.assertEqual(provider.call_count, 0)

    def test_persistence_export_restore_and_legacy(self):
        result = run_scenario("two_failures")
        self.memory.save(self.profile, self.store_of(result))
        loaded = self.memory.load(self.profile)["store"]["goals"][0]
        self.assertEqual(len(ledger(loaded)), 1)
        self.assertNotIn("node_id", ledger(loaded)[0])
        backup = self.memory.export(self.profile)
        other = self.memory.create_profile("Otra")["profile_id"]
        other_goals = self.memory.load(other)["store"].get("goals", [])
        self.assertEqual([e for goal in other_goals for e in ledger(goal)], [], "otro perfil no ve la propuesta")
        self.memory.restore(self.profile, backup)
        restored = self.memory.load(self.profile)["store"]["goals"][0]
        self.assertEqual(ledger(restored), ledger(loaded))
        self.assertEqual([e["type"] for e in restored["events"]], [e["type"] for e in loaded["events"]])
        # Datos legacy: sin PREREQUISITE_REVIEW la validación sigue aceptando y no inventa eventos.
        legacy = run_scenario("one_failure")
        store = self.store_of(legacy)
        validate_store(store, self.profile)
        self.memory.save(self.profile, store)
        self.assertEqual(ledger(self.memory.load(self.profile)["store"]["goals"][0]), [])

    def test_existing_ledger_events_keep_their_meaning(self):
        result = run_scenario("one_failure")
        goal = result["goal"]
        self.assertEqual(len([e for e in goal["events"] if e["type"] == "PLACEMENT_SKIP"]), 1)
        self.assertTrue(result["skipped"], "un fallo ya no anula PLACEMENT_SKIP")


if __name__ == "__main__":
    unittest.main()
