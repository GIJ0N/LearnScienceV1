"""Controlled backend and durable validation for repair_teaching_v2."""
import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy
from memory_store import validate_store


def q(prompt, reference, kind, dimensions):
    return {"prompt": prompt, "reference": reference, "kind": kind, "observable_dimensions": dimensions}


diagnosis_response = {
    "plan_version": "repair_teaching_v2",
    "suspected_gaps": [{"gap_id": "gap-1", "node_id": "n0", "concept": "Operaciones inversas", "reason": "No aisló la variable", "motivating_evidence": "Sumó tres", "confidence": 0.9, "status": "SUSPECTED"}],
    "diagnostic_checks": [{"gap_id": "gap-1", "question": q("¿Qué deshace sumar cinco?", "Restar cinco", "explanation", ["conceptual"])}],
}
teaching_response = {
    "plan_version": "repair_teaching_v2", "gap_id": "gap-1",
    "explanation": "La operación inversa aplicada a ambos lados conserva la igualdad.",
    "worked_example": {"prompt": "Resuelve y + 4 = 10", "steps": ["Resta cuatro en ambos lados", "Simplifica"], "conclusion": "y = 6"},
    "expansion": "Piensa en una balanza equilibrada.",
    "guided_hints": ["Identifica la operación que acompaña a la variable."],
    "repair_activities": {
        "CHECK": q("¿Qué harías primero en z + 8 = 11?", "Restar ocho", "explanation", ["conceptual"]),
        "GUIDED": q("Con apoyo resuelve a + 6 = 15", "a = 9", "application", ["direct_application"]),
        "INDEPENDENT": q("Sin ayuda resuelve 3b - 1 = 11", "b = 4", "application", ["direct_application"]),
    },
    "independent_retries": [q("Sin ayuda resuelve 4c + 2 = 18", "c = 4", "calculation", ["direct_application"])],
    "parent_retest": q("Resuelve 2m + 5 = 13", "m = 4", "application", ["direct_application"]),
    "transfer_check": q("Una tarifa cobra 5 de base y 2 por hora; ¿cuántas horas producen 13?", "4 horas", "transfer", ["transfer"]),
    "transfer_novelty_status": "CONFIRMED", "transfer_novelty_basis": "Cambia de ecuación simbólica a modelado verbal.",
}
diagnosis_request = {
    "operation": "diagnose", "plan_version": "repair_teaching_v2",
    "question": q("Resuelve 2x + 3 = 7", "x = 2", "application", ["direct_application"]),
    "answer": "Sumé tres", "feedback": "Revisa la operación inversa", "error_type": "prerequisite",
    "nearby_prerequisites": [{"id": "n0", "name": "Operaciones inversas"}],
}
teaching_request = {
    "operation": "teach", "plan_version": "repair_teaching_v2", "episode_id": "episode-1",
    "selected_gap": {"gap_id": "gap-1", "node_id": "n0", "concept": "Operaciones inversas", "status": "CONFIRMED"},
    "parent_question": diagnosis_request["question"], "parent_response": "Sumé tres",
    "parent_evaluation": {"status": "PARTIAL", "error_type": "prerequisite"},
    "diagnostic_checks": [{"gap_id": "gap-1", "question": diagnosis_response["diagnostic_checks"][0]["question"], "evidence": [{"result": "PARTIAL"}]}],
}

original = app_legacy.gemini
try:
    assert "observable_dimensions" in app_legacy.REPAIR_Q["required"]
    assert "observable_dimensions" in app_legacy.REPAIR_TEACHING_SCHEMA["properties"]["repair_activities"]["properties"]["GUIDED"]["required"]
    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: copy.deepcopy(diagnosis_response)
    diagnosis = app_legacy.make_micro_context(diagnosis_request)
    assert diagnosis["plan_version"] == "repair_teaching_v2"
    assert diagnosis["suspected_gaps"][0]["status"] == "SUSPECTED"
    assert "repair_activities" not in diagnosis

    # The provider-facing repair schema and prompt must constrain the exact
    # family/dimension pairs; local validation remains authoritative.
    assert app_legacy.REPAIR_Q["properties"]["kind"]["enum"]
    assert "explanation → [\"conceptual\"]" in app_legacy.REPAIR_DIAGNOSTIC_PAIR_INSTRUCTION
    assert app_legacy.REPAIR_TEACHING_SCHEMA["properties"]["repair_activities"]["properties"]["CHECK"]["properties"]["kind"]["enum"] == ["explanation", "recognition"]
    assert app_legacy.REPAIR_TEACHING_SCHEMA["properties"]["repair_activities"]["properties"]["GUIDED"]["properties"]["kind"]["enum"] == ["application", "calculation", "problem", "procedure"]
    assert app_legacy.REPAIR_TEACHING_SCHEMA["properties"]["transfer_check"]["properties"]["kind"]["enum"] == ["transfer"]
    assert 'transfer_check: kind "transfer"' in app_legacy.REPAIR_TEACHING_PAIR_INSTRUCTION
    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: copy.deepcopy(teaching_response)
    assert any('distintas de TODAS las comprobaciones diagnósticas recibidas' in item for item in app_legacy.repair_teaching.__code__.co_consts if isinstance(item, str))
    incompatible_diagnostic = copy.deepcopy(diagnosis_response)
    incompatible_diagnostic["diagnostic_checks"][0]["question"] = q(
        "¿Qué operación deshace sumar cinco?", "Restar cinco", "explanation", ["direct_application"])
    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: incompatible_diagnostic
    try:
        app_legacy.make_micro_context(diagnosis_request)
    except ValueError as error:
        assert "incompatibles" in str(error)
    else:
        raise AssertionError("El backend aceptó una dimensión incompatible con explanation en DIAGNOSTIC")

    missing_dimension = copy.deepcopy(diagnosis_response)
    missing_dimension["diagnostic_checks"][0]["question"].pop("observable_dimensions")
    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: missing_dimension
    try:
        app_legacy.make_micro_context(diagnosis_request)
    except ValueError as error:
        assert "observable_dimensions" in str(error)
    else:
        raise AssertionError("El backend aceptó un diagnóstico sin dimensiones observables")

    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: copy.deepcopy(teaching_response)
    package = app_legacy.make_micro_context(teaching_request)
    assert package["gap_id"] == "gap-1"
    assert package["repair_activities"]["GUIDED"]["observable_dimensions"] == ["direct_application"]
    assert len(package["independent_retries"]) == 1

    incompatible = copy.deepcopy(teaching_response)
    incompatible["repair_activities"]["GUIDED"] = q("Pregunta incompatible", "Criterio", "explanation", ["conceptual"])
    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: incompatible
    try:
        app_legacy.make_micro_context(teaching_request)
    except ValueError as error:
        assert "repair_activities.GUIDED" in str(error)
        assert "incompatibles" in str(error)
    else:
        raise AssertionError("El backend aceptó una familia incompatible con GUIDED")

    incompatible_transfer = copy.deepcopy(teaching_response)
    incompatible_transfer["transfer_check"] = q(
        "Aplica la igualdad en un contexto distinto", "Una aplicación válida", "context_case", ["contextual_application"])
    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: incompatible_transfer
    try:
        app_legacy.make_micro_context(teaching_request)
    except ValueError as error:
        assert "transfer_check" in str(error)
        assert "incompatibles" in str(error)
    else:
        raise AssertionError("El backend aceptó un kind de transferencia que el contrato local no reconoce")

    copied = copy.deepcopy(teaching_response)
    copied["worked_example"]["prompt"] = diagnosis_request["question"]["prompt"]
    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: copied
    try:
        app_legacy.make_micro_context(teaching_request)
    except ValueError as error:
        assert "copia" in str(error)
    else:
        raise AssertionError("El backend aceptó un ejemplo que copia el padre")

    uncertain = copy.deepcopy(teaching_request)
    uncertain["selected_gap"]["status"] = "SUSPECTED"
    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: copy.deepcopy(teaching_response)
    try:
        app_legacy.make_micro_context(uncertain)
    except ValueError as error:
        assert "confirmada" in str(error)
    else:
        raise AssertionError("El backend generó enseñanza para una laguna sospechada")
finally:
    app_legacy.gemini = original


event = {"type": "EVIDENCE", "attempt_id": "parent-attempt", "evidence_id": "parent-evidence", "activity_id": "parent-activity", "node_id": "n1", "result": "PARTIAL"}
store = {"active": "goal-1", "goals": [{
    "id": "goal-1", "nodes": [{"id": "n0", "prerequisites": []}, {"id": "n1", "prerequisites": ["n0"]}],
    "coverage": [], "learner": {}, "lessons": {}, "reviews": [], "events": [event, {"type": "CONTENT_EXPOSURE", "episode_id": "episode-1", "node_id": "n0", "content_id": "package:example"}],
    "session": {"mode": "CONTEXT", "node": "n1"}, "contextStack": [{"context_id": "ctx", "episode_id": "episode-1"}],
    "repairEpisodes": [{"episode_id": "episode-1", "parent_node_id": "n1", "parent_attempt_id": "parent-attempt", "plan_version": "repair_teaching_v2", "suspected_gaps": [{"gap_id": "gap-1"}], "selected_gap": {"gap_id": "gap-1", "status": "CONFIRMED"}, "plan_gap_id": "gap-1", "teaching_package": package, "attempt_checkpoint": {"attempt_id": "pending", "activity_id": "activity", "stage": "CHECK", "response_text": "respuesta", "help_used": 0, "status": "EVALUATED", "evaluation": {"status": "CORRECT"}}}],
}]}
validated, counts = validate_store(copy.deepcopy(store), "profile-test")
assert counts["repair_episodes"] == 1
assert validated["goals"][0]["repairEpisodes"][0]["teaching_package"]["gap_id"] == "gap-1"

broken = copy.deepcopy(store); broken["goals"][0]["repairEpisodes"][0]["teaching_package"]["gap_id"] = "other"
try:
    validate_store(broken, "profile-test")
except ValueError as error:
    assert "laguna seleccionada" in str(error)
else:
    raise AssertionError("La persistencia aceptó un paquete ligado a otra laguna")

unknown = copy.deepcopy(store); unknown_episode = unknown["goals"][0]["repairEpisodes"][0]; unknown_episode["plan_version"] = "repair_teaching_v99"; unknown_episode.pop("teaching_package"); unknown_episode.pop("plan_gap_id")
validate_store(unknown, "profile-test")

print("repair_teaching_backend.test.py PASS")
