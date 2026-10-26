"""Durability, restart, isolation and backend idempotency for criterion v1."""
import copy
import json
import sqlite3
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy
from memory_store import DurableMemory, validate_store, SCHEMA_VERSION


tmp = Path(tempfile.mkdtemp(prefix="criterion-durable-")) / "criteria.sqlite3"
store = DurableMemory(tmp)
profile_a = store.create_profile("criterio-a")
profile_b = store.create_profile("criterio-b")
app_legacy.set_memory_for_tests(store)
activity = {
    "schema_version": "criterion_assessment_v1", "activity_id": "durable-activity",
    "type": "multiple_choice_explanation", "phase": "INDEPENDENT",
    "prompt": "¿Qué conserva una operación inversa?",
    "options": [{"id": "a", "text": "La igualdad"}, {"id": "b", "text": "Solo un lado"}],
    "correct_option_id": "a",
    "criteria": [
        {"criterion_id": "option_choice", "observable_dimension": "recognition", "required": True, "description": "Elegir"},
        {"criterion_id": "explanation", "observable_dimension": "conceptual", "required": True, "description": "Explicar"},
    ],
    "help": {"enabled": True, "critical": True}, "variant": "durable-v1", "context": "sintético",
}

with patch.object(app_legacy, "gemini", return_value=copy.deepcopy(activity)):
    public = app_legacy.make_criterion_activity({"profile_id": profile_a["profile_id"], "goal_id": "goal-a", "goal": "Álgebra", "concept": "Inversas"})
assert "correct_option_id" not in public

draft = {
    "schema_version": "criterion_assessment_v1", "profile_id": profile_a["profile_id"], "goal_id": "goal-a",
    "node_id": "n1", "activity_id": public["activity_id"], "activity": public,
    "selected_option_id": "a", "explanation": "La igualdad se conserva.", "help_used": 0,
    "status": "DRAFT", "attempt_id": None, "assessment": None,
}
raw_store = {"schema_version": 5, "profile_id": profile_a["profile_id"], "active": "goal-a", "goals": [{
    "id": "goal-a", "profile_id": profile_a["profile_id"], "goal": "Álgebra", "nodes": [{"id": "n1"}],
    "coverage": [{"id": "n1", "dimensions": []}], "learner": {}, "lessons": {"n1": {}}, "reviews": [],
    "events": [], "criterion_draft": draft,
}]}
store.save(profile_a["profile_id"], raw_store, expected_revision=1)

# Restart: the public contract and private references are recovered from SQLite.
restarted = DurableMemory(tmp)
app_legacy.set_memory_for_tests(restarted)
loaded = restarted.load_criterion_activity(profile_a["profile_id"], public["activity_id"])
assert loaded and loaded["public_contract"]["activity_id"] == public["activity_id"]
assert loaded["private_contract"]["correct_option_id"] == "a"
assert "correct_option_id" not in json.dumps(restarted.export(profile_a["profile_id"]))

semantic = {"status": "SATISFIED", "observation": "Explicación pertinente."}
with patch.object(app_legacy, "gemini", return_value=semantic):
    first = app_legacy.evaluate_criterion_activity({
        "profile_id": profile_a["profile_id"], "goal_id": "goal-a", "activity_id": public["activity_id"],
        "selected_option_id": "a", "explanation": "La igualdad se conserva.", "attempt_id": "attempt-durable",
        "criterion_description": "Explicar", "help_used": 0,
    })
assert first["overall"] == "CORRECT"

# Simulated process crash: the reservation survives, but a fresh process
# (new owner token) may reclaim the same attempt without creating another one.
crash_fingerprint = app_legacy._criterion_fingerprint(
    profile_a["profile_id"], "goal-a", public["activity_id"], "attempt-crashed",
    "a", "Se conserva.", 0, "criterion_assessment_v1",
    loaded["private_contract"]["contract_digest"],
)
restarted.begin_criterion_evaluation(
    profile_a["profile_id"], "goal-a", public["activity_id"],
    "attempt-crashed", crash_fingerprint, "old-process",
)
app_legacy.set_memory_for_tests(DurableMemory(tmp))
with patch.object(app_legacy, "gemini", return_value=semantic):
    recovered = app_legacy.evaluate_criterion_activity({
        "profile_id": profile_a["profile_id"], "goal_id": "goal-a", "activity_id": public["activity_id"],
        "selected_option_id": "a", "explanation": "Se conserva.", "attempt_id": "attempt-crashed",
        "criterion_description": "Explicar", "help_used": 0,
    })
assert recovered["attempt_id"] == "attempt-crashed"
try:
    restarted.finish_criterion_evaluation(
        profile_a["profile_id"], "attempt-crashed", crash_fingerprint,
        {"attempt_id": "attempt-crashed"}, "old-process",
    )
except ValueError as exc:
    assert "otra solicitud" in str(exc)
else:
    raise AssertionError("Una respuesta tardía sobrescribió la evaluación recuperada")

# Reopening the process must recover the result without calling the provider.
app_legacy.set_memory_for_tests(DurableMemory(tmp))
with patch.object(app_legacy, "gemini", side_effect=AssertionError("no second provider call")):
    assert app_legacy.evaluate_criterion_activity({
        "profile_id": profile_a["profile_id"], "goal_id": "goal-a", "activity_id": public["activity_id"],
        "selected_option_id": "a", "explanation": "La igualdad se conserva.", "attempt_id": "attempt-durable",
        "criterion_description": "Explicar", "help_used": 0,
    })["attempt_id"] == "attempt-durable"
try:
    app_legacy.evaluate_criterion_activity({
        "profile_id": profile_a["profile_id"], "goal_id": "goal-a", "activity_id": public["activity_id"],
        "selected_option_id": "b", "explanation": "Otra respuesta.", "attempt_id": "attempt-durable",
        "criterion_description": "Explicar", "help_used": 0,
    })
except ValueError as exc:
    assert "attempt_id" in str(exc)
else:
    raise AssertionError("La respuesta distinta reutilizó attempt_id")
try:
    app_legacy.evaluate_criterion_activity({
        "profile_id": profile_a["profile_id"], "goal_id": "another-goal", "activity_id": public["activity_id"],
        "selected_option_id": "a", "explanation": "Texto.", "attempt_id": "attempt-other-goal",
        "criterion_description": "Explicar", "help_used": 0,
    })
except ValueError as exc:
    assert "otra meta" in str(exc)
else:
    raise AssertionError("Una meta distinta accedió al contrato privado")

# Concurrent identical submissions reserve one evaluation; the second call
# cannot launch a second provider evaluation while the first is pending.
concurrent_results, concurrent_errors = [], []
def evaluate_concurrent():
    try:
        concurrent_results.append(app_legacy.evaluate_criterion_activity({
            "profile_id": profile_a["profile_id"], "goal_id": "goal-a", "activity_id": public["activity_id"],
            "selected_option_id": "a", "explanation": "Concurrente.", "attempt_id": "attempt-concurrent",
            "criterion_description": "Explicar", "help_used": 0,
        }))
    except Exception as exc:
        concurrent_errors.append(exc)
def slow_gemini(*args, **kwargs):
    time.sleep(0.15)
    return semantic
with patch.object(app_legacy, "gemini", side_effect=slow_gemini):
    threads = [threading.Thread(target=evaluate_concurrent) for _ in range(2)]
    for thread in threads: thread.start()
    for thread in threads: thread.join(timeout=2)
assert len(concurrent_results) == 1
assert len(concurrent_errors) == 1 and "PENDING" in str(concurrent_errors[0])

# Restoring a public backup into another profile never reuses A's private key.
backup = restarted.export(profile_a["profile_id"])
restarted.restore(profile_b["profile_id"], backup)
assert restarted.load_criterion_activity(profile_b["profile_id"], public["activity_id"]) is None
assert restarted.load(profile_b["profile_id"])["store"]["goals"][0]["criterion_draft"]["status"] == "DRAFT"
assert SCHEMA_VERSION == 2
legacy = {"active": None, "goals": []}
validate_store(legacy, profile_b["profile_id"])
restarted.delete_profile(profile_b["profile_id"])
assert restarted.load_criterion_activity(profile_b["profile_id"], public["activity_id"]) is None

# Legacy migration is repeatable and adds the reservation owner column without
# requiring a private backup or changing existing profile data.
legacy_path = Path(tempfile.mkdtemp(prefix="criterion-legacy-")) / "legacy.sqlite3"
with sqlite3.connect(legacy_path) as legacy_db:
    legacy_db.executescript("""
      CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE profiles(profile_id TEXT PRIMARY KEY, name TEXT NOT NULL,
        preferences_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE stores(profile_id TEXT PRIMARY KEY REFERENCES profiles(profile_id) ON DELETE CASCADE,
        store_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE criterion_evaluations(
        profile_id TEXT NOT NULL, goal_id TEXT NOT NULL, activity_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
        assessment_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY(profile_id, attempt_id));
    """)
DurableMemory(legacy_path)
with sqlite3.connect(legacy_path) as legacy_db:
    columns = {row[1] for row in legacy_db.execute("PRAGMA table_info(criterion_evaluations)")}
assert "owner_token" in columns
DurableMemory(legacy_path)
print("criterion_durability.test.py PASS")
