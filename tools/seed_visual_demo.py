"""Create an isolated, synthetic UI demo without calling a model provider."""

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from memory_store import DurableMemory


def _event(index, node_id, dimension, result="CORRECT"):
    timestamp = int(time.time() * 1000) - index * 1000
    return {
        "type": "EVIDENCE",
        "attempt_id": "visual-attempt-{0}".format(index),
        "evidence_id": "visual-evidence-{0}".format(index),
        "activity_id": "visual-activity-{0}".format(index),
        "node_id": node_id,
        "phase": "INDEPENDENT",
        "activity_kind": "explanation",
        "result": result,
        "status": result,
        "help_used": 0,
        "is_independent": result == "CORRECT",
        "observed_dimensions": [dimension],
        "evidence_scope": "node",
        "timestamp": timestamp,
        "at": timestamp,
        "question": {
            "prompt": "Pregunta independiente sintética {0}".format(index),
            "kind": "explanation",
            "observable_dimensions": [dimension],
        },
    }


def _criterion_contract():
    return {
        "schema_version": "criterion_assessment_v1",
        "activity_id": "criterion-visual-demo",
        "type": "multiple_choice_explanation",
        "phase": "INDEPENDENT",
        "prompt": "Si 4x + 8 = 24, ¿qué primer paso conserva la igualdad? Elige una opción y explica por qué.",
        "options": [
            {"id": "subtract-both", "text": "Restar 8 a ambos lados."},
            {"id": "subtract-left", "text": "Restar 8 solo al lado izquierdo."},
            {"id": "divide-term", "text": "Dividir únicamente 4x entre 4."},
        ],
        "criteria": [
            {
                "criterion_id": "option_choice",
                "observable_dimension": "recognition",
                "required": True,
                "description": "Selecciona una operación aplicada de forma equivalente.",
            },
            {
                "criterion_id": "explanation",
                "observable_dimension": "conceptual",
                "required": True,
                "description": "Explica por qué la operación conserva el conjunto de soluciones.",
            },
        ],
        "required_criteria": ["option_choice", "explanation"],
        "help": {"enabled": True, "critical": True},
        "variant": "visual-demo-v1",
        "context": "ecuaciones lineales",
    }


def seed(db_path):
    path = Path(db_path).expanduser().resolve()
    try:
        path.relative_to(ROOT)
    except ValueError:
        pass
    else:
        raise ValueError("La SQLite de demostración debe vivir fuera del repositorio.")
    if path.exists() or path.with_suffix(path.suffix + ".server.lock").exists():
        raise ValueError("La ruta de demostración ya existe; usa otra ruta para no sobrescribir datos.")
    path.parent.mkdir(parents=True, exist_ok=True)
    memory = DurableMemory(path)
    source = memory.create_profile("DEMO VISUAL SINTÉTICA")
    empty = memory.create_profile("DEMO VISUAL VACÍA")
    profile_id = source["profile_id"]
    events = [
        _event(1, "fundamentos", "conceptual"),
        _event(2, "fundamentos", "conceptual"),
        _event(3, "variables", "variables"),
        _event(4, "unidades", "units", "MISCONCEPTION"),
    ]
    nodes = [
        {"id": "fundamentos", "name": "Igualdad y equivalencia", "outcome": "Explicar qué conserva una igualdad.", "kind": "concept", "prerequisites": []},
        {"id": "variables", "name": "Identificar variables", "outcome": "Distinguir variable, constante y coeficiente.", "kind": "skill", "prerequisites": ["fundamentos"]},
        {"id": "unidades", "name": "Consistencia de unidades", "outcome": "Comprobar que una transformación respeta unidades.", "kind": "skill", "prerequisites": ["fundamentos"]},
        {"id": "ecuaciones", "name": "Manipular ecuaciones", "outcome": "Aplicar operaciones equivalentes paso a paso.", "kind": "skill", "prerequisites": ["variables", "unidades"]},
        {"id": "metodos", "name": "Seleccionar un método", "outcome": "Elegir una estrategia adecuada y justificarla.", "kind": "skill", "prerequisites": ["ecuaciones"]},
        {"id": "transferencia", "name": "Resolver un caso nuevo", "outcome": "Transferir el método a una situación no ensayada.", "kind": "skill", "prerequisites": ["metodos"]},
    ]
    names = {node["id"]: node["name"] for node in nodes}

    def coverage(node_id, dimension, name, evidence):
        return {
            "id": node_id,
            "name": names[node_id],
            "dimensions": [{"id": dimension, "name": name, "required": True, "evidence": evidence}],
        }

    coverage_items = [
        coverage("fundamentos", "conceptual", "Comprensión", events[:2]),
        coverage("variables", "variables", "Variables", events[2:3]),
        coverage("unidades", "units", "Unidades", events[3:4]),
        coverage("ecuaciones", "equation_manipulation", "Manipulación de ecuaciones", []),
        coverage("metodos", "method_selection", "Selección de método", []),
        coverage("transferencia", "transfer", "Transferencia", []),
    ]
    public = _criterion_contract()
    digest = hashlib.sha256(json.dumps(public, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    private = {
        "correct_option_id": "subtract-both",
        "criteria": public["criteria"],
        "rubric_version": "criterion_assessment_v1",
        "contract_digest": digest,
        "references": {"explanation": public["criteria"][1]["description"]},
    }
    goal = {
        "id": "visual-goal",
        "profile_id": profile_id,
        "goal": "Comprender y resolver ecuaciones lineales",
        "context": "Demostración sintética sin datos personales",
        "nodes": nodes,
        "coverage": coverage_items,
        "learner": {},
        "lessons": {},
        "reviews": [],
        "events": events,
        "session": {"profile_id": profile_id, "mode": "INDEPENDENT", "node": "ecuaciones", "stack": [], "stage": "practice", "tries": 0},
        "map_updates": [],
        "contextStack": [],
        "repairEpisodes": [],
        "pending_repair_diagnosis": None,
        "criterion_assessments": [],
        "criterion_draft": {
            "schema_version": "criterion_assessment_v1",
            "profile_id": profile_id,
            "goal_id": "visual-goal",
            "node_id": "ecuaciones",
            "activity_id": public["activity_id"],
            "activity": public,
            "selected_option_id": "",
            "explanation": "",
            "help_used": 0,
            "status": "DRAFT",
            "attempt_id": None,
            "assessment": None,
        },
    }
    store = {"schema_version": 4, "profile_id": profile_id, "goals": [goal], "active": goal["id"]}
    memory.save_criterion_activity(profile_id, goal["id"], public, private)
    memory.save(profile_id, store, source["revision"])
    return {"database": str(path), "profile_id": profile_id, "empty_profile_id": empty["profile_id"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="Nueva ruta SQLite fuera del repositorio")
    result = seed(parser.parse_args().db)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
