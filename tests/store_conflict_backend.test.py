import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy
app_legacy.CONTENT_VERIFY = False
from memory_store import DurableMemory


def sample_store(answer="respuesta completa"):
    question = {"prompt": "Convierte 2 m a cm", "reference": "200 cm", "kind": "units", "observable_dimensions": ["units"]}
    event = {
        "type": "EVIDENCE", "evidence_id": "evidence-1", "attempt_id": "attempt-1",
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


class StoreConflictBackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.temp.name) / "memory.sqlite3")
        self.profile_id = self.memory.create_profile("Ada")["profile_id"]
        self.first = self.memory.save(self.profile_id, sample_store("respuesta original"), self.memory.load(self.profile_id)["revision"])
        app_legacy.set_memory_for_tests(self.memory)
        self.server = app_legacy.ThreadingHTTPServer(("127.0.0.1", 0), app_legacy.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:%d" % self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)
        app_legacy.set_memory_for_tests(None)
        self.temp.cleanup()

    def post(self, path, payload):
        request = urllib.request.Request(self.base + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def test_memory_conflict_message_carries_store_conflict_prefix(self):
        with self.assertRaisesRegex(ValueError, r"^STORE_CONFLICT: "):
            self.memory.save(self.profile_id, sample_store("no debe guardarse"), 0)

    def test_http_conflict_returns_code_and_keeps_history_intact(self):
        status, body = self.post("/api/profile/save", {"profile_id": self.profile_id, "store": sample_store("intento de la otra pestaña"), "expected_revision": 0})
        self.assertEqual(status, 400)
        self.assertEqual(body.get("code"), "STORE_CONFLICT")
        self.assertIn("recarga", body["error"])
        self.assertNotIn("STORE_CONFLICT", body["error"])
        history = self.memory.history(self.profile_id)
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["response_text"], "respuesta original")
        self.assertEqual(self.memory.load(self.profile_id)["revision"], self.first["revision"])

    def test_other_validation_errors_carry_no_conflict_code(self):
        status, body = self.post("/api/profile/save", {"profile_id": self.profile_id, "store": {"goals": "no es una lista"}, "expected_revision": self.first["revision"]})
        self.assertEqual(status, 400)
        self.assertNotIn("code", body)
        self.assertEqual(self.memory.history(self.profile_id)[0]["response_text"], "respuesta original")


if __name__ == "__main__":
    unittest.main()
