"""Active backend and durable-store regressions for skill_foundation_v1."""
import copy
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy
from memory_store import DurableMemory, validate_store


def question(prompt, kind="explanation", dimensions=None):
    return {"prompt": prompt, "reference": "Criterio privado controlado", "kind": kind,
            "observable_dimensions": dimensions or ["conceptual"]}


def lesson():
    return {"explanation": "Explicación controlada", "example": "Ejemplo distinto",
            "common_error": "Confundir condición con conclusión",
            "check": question("Comprobación"), "guided": question("Guiada", "application", ["direct_application"]),
            "independent": question("Independiente", "application", ["direct_application"]),
            "integration": question("Integración", "transfer", ["transfer"])}


def store_for(profile_id):
    nodes = [
        {"id": "quant", "name": "Fracciones", "outcome": "Razonar sobre la unidad", "prerequisites": []},
        {"id": "science", "name": "Tensión superficial", "outcome": "Explicar cohesión", "prerequisites": []},
        {"id": "code", "name": "Leer una condición", "outcome": "Predecir una rama sin ejecutar código", "prerequisites": []},
    ]
    return {"profile_id": profile_id, "active": "goal-1", "goals": [{
        "id": "goal-1", "profile_id": profile_id, "goal": "Fundamentos sintéticos", "nodes": nodes,
        "coverage": [{"id": node["id"], "dimensions": []} for node in nodes], "learner": {},
        "lessons": {}, "foundations": [], "reviews": [], "events": [],
        "session": {"mode": "TEACH", "node": "quant", "stack": [], "stage": "teach", "tries": 0},
    }]}


tmp = tempfile.TemporaryDirectory(prefix="skill-foundations-")
path = Path(tmp.name) / "memory.sqlite3"
memory = DurableMemory(path)
profile = memory.create_profile("fundamentos-a")
other = memory.create_profile("fundamentos-b")
memory.save(profile["profile_id"], store_for(profile["profile_id"]), expected_revision=1)
memory.save(other["profile_id"], store_for(other["profile_id"]), expected_revision=1)
app_legacy.set_memory_for_tests(memory)

# Manual creation is server-scoped and works without a provider.
manual = app_legacy.foundation_create({"profile_id": profile["profile_id"], "goal_id": "goal-1", "node_id": "quant",
    "statement": "Una fracción expresa una cantidad respecto de una unidad elegida.",
    "conditions": ["Comparar exige la misma unidad"], "provenance": {"source": "manual"}})
assert manual["foundation_id"].startswith("foundation-") and manual["status"] == "accepted"
for altered in [
    {"profile_id": other["profile_id"], "goal_id": "goal-1", "node_id": "missing"},
    {"profile_id": profile["profile_id"], "goal_id": "missing", "node_id": "quant"},
    {"profile_id": profile["profile_id"], "goal_id": "goal-1", "node_id": "missing"},
]:
    try:
        app_legacy.foundation_create({**altered, "statement": "No debe guardarse", "conditions": [], "provenance": {"source": "manual"}})
        raise AssertionError("foreign or missing scope accepted")
    except ValueError:
        pass

# Controlled provider proposal: integration, not scientific accuracy.
with patch.object(app_legacy, "gemini", return_value={"statement": "Las moléculas cohesivas minimizan el área superficial.", "conditions": ["Depende del sistema y la temperatura"]}):
    proposed = app_legacy.foundation_propose({"profile_id": profile["profile_id"], "goal_id": "goal-1", "node_id": "science"})
assert proposed["status"] == "proposed" and proposed["revisions"][0]["provenance"]["source"] == "model"
with patch.object(app_legacy, "gemini", return_value={"statement": "", "conditions": []}):
    try:
        app_legacy.foundation_propose({"profile_id": profile["profile_id"], "goal_id": "goal-1", "node_id": "code"})
        raise AssertionError("invalid provider response accepted")
    except ValueError:
        pass

# Persist three domains, revise one, and retain the exact older revision.
loaded = memory.load(profile["profile_id"])
goal = loaded["store"]["goals"][0]
code = app_legacy.foundation_create({"profile_id": profile["profile_id"], "goal_id": "goal-1", "node_id": "code",
    "statement": "Una condición elige una rama según su valor booleano.", "conditions": ["Leer sin ejecutar no acredita programación"],
    "provenance": {"source": "provided_reference", "reference": "Nota aportada por el usuario", "verification_status": "unverified"}})
goal["foundations"] = [manual, proposed, code]
saved = memory.save(profile["profile_id"], loaded["store"], expected_revision=loaded["revision"])
revised = app_legacy.foundation_revise({"profile_id": profile["profile_id"], "goal_id": "goal-1", "node_id": "quant",
    "foundation_id": manual["foundation_id"], "expected_revision": 1, "status": "accepted",
    "statement": "Una fracción compara una cantidad con la unidad de referencia.", "conditions": ["La unidad debe declararse"]})
assert revised["current_revision"] == 2 and revised["revisions"][0]["statement"] == manual["revisions"][0]["statement"]
loaded = memory.load(profile["profile_id"]); loaded["store"]["goals"][0]["foundations"][0] = revised
memory.save(profile["profile_id"], loaded["store"], expected_revision=loaded["revision"])

# The active lesson fetches authorized content server-side, bounded and scoped.
captured = {}
def controlled(prompt, schema, limit):
    captured["prompt"] = prompt
    return lesson()
with patch.object(app_legacy, "gemini", side_effect=controlled):
    result = app_legacy.make_lesson({"profile_id": profile["profile_id"], "goal_id": "goal-1", "node_id": "quant",
        "goal": "Fundamentos sintéticos", "name": "Fracciones", "parent": "Meta",
        "foundations": [{"statement": "PAYLOAD ADULTERADO", "reference": "CLAVE PRIVADA"}]})
assert result["foundation_sources"] == [{"foundation_id": manual["foundation_id"], "revision": 2, "node_id": "quant"}]
assert "Una fracción compara" in captured["prompt"] and "PAYLOAD ADULTERADO" not in captured["prompt"]
assert "CLAVE PRIVADA" not in json.dumps(result)
assert proposed["revisions"][0]["statement"] not in captured["prompt"], "other node/proposed content leaked"

# Legacy stores normalize conservatively; restart/export/restore keep public provenance and isolation.
legacy, _ = validate_store({"profile_id": profile["profile_id"], "active": None, "goals": []}, profile["profile_id"])
assert legacy["goals"] == []
restarted = DurableMemory(path)
assert restarted.load(profile["profile_id"])["store"]["goals"][0]["foundations"][0]["current_revision"] == 2
exported = restarted.export(profile["profile_id"])
assert "correct_option_id" not in json.dumps(exported) and "explanation_reference" not in json.dumps(exported)
restored_profile = restarted.create_profile("restaurado")
restored = restarted.restore(restored_profile["profile_id"], exported)
restored_goal = restarted.load(restored_profile["profile_id"])["store"]["goals"][0]
assert all(item["profile_id"] == restored_profile["profile_id"] for item in restored_goal["foundations"])
assert restarted.load(other["profile_id"])["store"]["goals"][0].get("foundations", []) == []
# Removing a goal removes its embedded foundations; removing only its node while
# retaining a reference is rejected instead of being reassigned by name or ID.
broken = copy.deepcopy(restored_goal); broken["nodes"] = [node for node in broken["nodes"] if node["id"] != "quant"]
try:
    validate_store({"profile_id": restored_profile["profile_id"], "active": broken["id"], "goals": [broken]}, restored_profile["profile_id"])
    raise AssertionError("missing foundation endpoint was silently reassigned")
except ValueError:
    pass
empty, _ = validate_store({"profile_id": restored_profile["profile_id"], "active": None, "goals": []}, restored_profile["profile_id"])
assert empty["goals"] == []
restarted.delete_profile(restored_profile["profile_id"])
try:
    restarted.load(restored_profile["profile_id"])
    raise AssertionError("deleted profile remained")
except ValueError:
    pass

print("skill foundations backend: PASS")

