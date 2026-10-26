"""Controlled backend contracts for directed delayed review."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy


def response(kind, dimension):
    return {"question": {"prompt": "Pregunta nueva", "reference": "Criterio", "kind": kind, "observable_dimensions": [dimension]}}


original = app_legacy.gemini
try:
    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: response("recall", "memory")
    result = app_legacy.review_question({"goal": "Meta", "concept": "Habilidad", "target_dimension": "memory"})
    assert result["question"]["kind"] == "recall"
    assert result["question"]["observable_dimensions"] == ["memory"]
    assert result["target_dimension"] == "memory"
    assert result["temporal_policy_version"] == "delayed_review_v1"

    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: response("units", "units")
    result = app_legacy.review_question({"goal": "Meta", "concept": "Habilidad", "target_dimension": "units"})
    assert result["question"]["kind"] == "units"
    assert result["question"]["observable_dimensions"] == ["units"]

    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: response("application", "memory")
    try:
        app_legacy.review_question({"goal": "Meta", "concept": "Habilidad", "target_dimension": "memory"})
    except ValueError as error:
        assert "kind recall" in str(error)
    else:
        raise AssertionError("El backend aceptó un contrato de repaso incompatible")

    app_legacy.gemini = lambda prompt, schema, max_tokens=2000: {"question": {"prompt": "Pregunta nueva", "reference": "Criterio", "kind": "units", "observable_dimensions": ["units", "invented_dimension"]}}
    try:
        app_legacy.review_question({"goal": "Meta", "concept": "Habilidad", "target_dimension": "units"})
    except ValueError as error:
        assert "observar únicamente units" in str(error)
    else:
        raise AssertionError("El backend eliminó una dimensión adicional desconocida y aceptó el contrato")
finally:
    app_legacy.gemini = original

print("OK: backend delayed review target contract and rejection")
