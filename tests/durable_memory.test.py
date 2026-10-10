import copy
import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy
from memory_store import DurableMemory


def sample_store(answer="respuesta completa", attempt_id="attempt-1"):
    question = {"prompt": "Convierte 2 m a cm", "reference": "200 cm", "kind": "units", "observable_dimensions": ["units"]}
    event = {
        "type": "EVIDENCE", "evidence_id": "evidence-1", "attempt_id": attempt_id,
        "activity_id": "activity-1", "node_id": "n1", "phase": "INDEPENDENT",
        "activity_kind": "units", "result": "CORRECT", "status": "CORRECT",
        "answer": answer, "feedback": "Conversión correcta y justificada.", "hint": "",
        "error_type": "none", "help_used": 0, "is_independent": True,
        "observed_dimensions": ["units"], "at": 123456, "timestamp": 123456,
    }
    evidence = {key: value for key, value in event.items() if key != "type"}
    return {
        "goals": [{
            "id": "goal-1", "goal": "Análisis dimensional", "nodes": [{
                "id": "n1", "name": "Unidades", "outcome": "Convertir", "level": 0,
                "kind": "concept", "prerequisites": [], "probe": question,
            }],
            "coverage": [{
                "id": "n1", "name": "Unidades", "kind": "concept", "priority": "important",
                "prerequisites": [], "contexts": [], "status": "MASTERED", "confidence": 1,
                "last_evidence": 123456, "updates": [],
                "dimensions": [{"id": "units", "name": "Unidades", "required": True, "status": "MASTERED", "evidence": [evidence]}],
            }],
            "learner": {"n1": {"level": 5, "confidence": "verified", "evidence": [evidence], "errors": [], "last": 123456}},
            "lessons": {"n1": {"independent": question}}, "reviews": [], "events": [event],
            "session": {"mode": "INTEGRATE", "node": "n1", "stack": [], "stage": "teach", "tries": 0},
            "repairEpisodes": [], "contextStack": [], "map_updates": [],
        }],
        "active": "goal-1",
    }


class DurableMemoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "memory.sqlite3"
        self.memory = DurableMemory(self.path)

    def tearDown(self):
        app_legacy.set_memory_for_tests(None)
        self.temp.cleanup()

    def profile(self, name="Ada"):
        return self.memory.create_profile(name)["profile_id"]

    def test_restart_preserves_session_and_full_attempt(self):
        profile_id = self.profile()
        answer = "x" * 1700
        saved = self.memory.save(profile_id, sample_store(answer))
        reopened = DurableMemory(self.path)
        loaded = reopened.load(profile_id)
        self.assertEqual(loaded["revision"], saved["revision"])
        self.assertEqual(loaded["store"]["goals"][0]["session"]["mode"], "INTEGRATE")
        history = reopened.history(profile_id)
        self.assertEqual(history[0]["response_text"], answer)
        self.assertEqual(history[0]["evaluation"]["feedback"], "Conversión correcta y justificada.")
        self.assertEqual(history[0]["question"]["prompt"], "Convierte 2 m a cm")

    def test_profiles_are_strictly_isolated(self):
        first, second = self.profile("Ada"), self.profile("Grace")
        self.memory.save(first, sample_store())
        self.assertEqual(len(self.memory.history(first)), 1)
        self.assertEqual(self.memory.history(second), [])
        self.assertEqual(self.memory.load(second)["store"]["goals"], [])

    def test_revision_conflict_is_visible_and_does_not_overwrite(self):
        profile_id = self.profile()
        original = self.memory.load(profile_id)
        self.memory.save(profile_id, sample_store(), original["revision"])
        changed = sample_store("no debe guardarse")
        with self.assertRaisesRegex(ValueError, "recarga"):
            self.memory.save(profile_id, changed, original["revision"])
        self.assertNotEqual(self.memory.history(profile_id)[0]["response_text"], "no debe guardarse")

    def test_import_is_idempotent_and_does_not_invent_legacy_evidence(self):
        profile_id = self.profile()
        raw = sample_store()
        raw["goals"][0]["events"] = []
        raw["goals"][0]["coverage"][0]["dimensions"][0]["evidence"] = []
        raw["goals"][0]["coverage"][0]["dimensions"][0]["status"] = "UNKNOWN"
        first = self.memory.import_store(profile_id, raw)
        second = self.memory.import_store(profile_id, raw)
        self.assertTrue(first["imported"])
        self.assertTrue(second["duplicate"])
        self.assertEqual(self.memory.history(profile_id), [])
        dim = self.memory.load(profile_id)["store"]["goals"][0]["coverage"][0]["dimensions"][0]
        self.assertEqual(dim["status"], "UNKNOWN")
        self.assertEqual(dim["evidence"], [])

    def test_export_restore_and_memory_provenance(self):
        source, target = self.profile("Origen"), self.profile("Destino")
        self.memory.save(source, sample_store())
        self.memory.set_preferences(source, {"concrete_examples": True})
        backup = self.memory.export(source)
        self.memory.restore(target, backup)
        self.assertEqual(self.memory.history(target)[0]["attempt_id"], "attempt-1")
        self.assertTrue(self.memory.load(target)["preferences"]["concrete_examples"])
        relevant = self.memory.relevant_memory(target, "goal-1", "n1", "units")
        self.assertEqual(relevant["sources"][0]["attempt_id"], "attempt-1")
        self.assertIn("units", relevant["reason"])

    def test_lesson_uses_bounded_memory_and_returns_provenance(self):
        profile_id = self.profile()
        self.memory.save(profile_id, sample_store())
        app_legacy.set_memory_for_tests(self.memory)
        generated = {
            "explanation": "Explicación", "example": "Ejemplo", "common_error": "Error",
            "check": {"prompt": "c", "reference": "r", "kind": "explanation", "observable_dimensions": ["conceptual"]},
            "guided": {"prompt": "g", "reference": "r", "kind": "units", "observable_dimensions": ["units"]},
            "independent": {"prompt": "i", "reference": "r", "kind": "units", "observable_dimensions": ["units"]},
            "integration": {"prompt": "t", "reference": "r", "kind": "integration", "observable_dimensions": ["contextual_application"]},
        }
        with patch.object(app_legacy, "gemini", return_value=generated) as fake:
            lesson = app_legacy.make_lesson({"profile_id": profile_id, "goal_id": "goal-1", "node_id": "n1", "goal": "Análisis dimensional", "name": "Unidades", "target_dimension": "units"})
        self.assertEqual(lesson["memory_sources"][0]["attempt_id"], "attempt-1")
        self.assertIn("Memoria pertinente", fake.call_args.args[0])
        self.assertLessEqual(len(lesson["memory_sources"]), 5)

    def test_http_profile_roundtrip_uses_isolated_database(self):
        app_legacy.set_memory_for_tests(self.memory)
        server = app_legacy.ThreadingHTTPServer(("127.0.0.1", 0), app_legacy.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = "http://127.0.0.1:%d" % server.server_address[1]

        def post(path, payload):
            request = urllib.request.Request(base + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(request, timeout=5) as response:
                return json.load(response)

        try:
            created = post("/api/profile/create", {"name": "HTTP"})
            saved = post("/api/profile/save", {"profile_id": created["profile_id"], "store": sample_store(), "expected_revision": created["revision"]})
            loaded = post("/api/profile/load", {"profile_id": created["profile_id"]})
            history = post("/api/profile/history", {"profile_id": created["profile_id"]})
            self.assertEqual(saved["revision"], loaded["revision"])
            self.assertEqual(history["attempts"][0]["response_text"], "respuesta completa")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(5)


if __name__ == "__main__":
    unittest.main()
