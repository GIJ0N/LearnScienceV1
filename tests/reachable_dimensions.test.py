"""End-to-end regression for dimensions that used to be required but unreachable."""

import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("reachable_dimensions_app", ROOT / "app_legacy.py")
APP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APP)

FAMILIES = {
    "variables": "variable_identification",
    "units": "units",
    "equation_manipulation": "equation_manipulation",
    "method_selection": "method_selection",
}


def question(prompt, kind, dimensions):
    return {
        "prompt": prompt,
        "reference": "Criterio verificable",
        "kind": kind,
        "observable_dimensions": dimensions,
    }


def raw_map(dimension):
    nodes = []
    coverage = []
    for index in range(5):
        node_id = f"n{index + 1}"
        nodes.append({
            "id": node_id, "name": f"Paso {index + 1}", "outcome": "Resolver",
            "level": index, "prerequisites": [f"n{index}"] if index else [],
            "kind": "procedure",
            "probe": question(f"Diagnóstico {index + 1}", "explanation", ["conceptual"]),
        })
        coverage.append({
            "id": node_id, "name": f"Paso {index + 1}", "kind": "procedure",
            "priority": "important", "prerequisites": [f"n{index}"] if index else [],
            "contexts": [],
            "dimensions": [{"id": dimension if index == 0 else "conceptual", "name": "Dimensión", "required": True}],
        })
    return {"nodes": nodes, "coverage": coverage}


def raw_lesson(dimension, kind):
    return {
        "explanation": "Explicación",
        "example": "Ejemplo",
        "common_error": "Error común",
        "check": question("Comprueba la idea", "explanation", ["conceptual"]),
        "guided": question(f"Práctica guiada de {dimension}", kind, [dimension]),
        "independent": question(f"Práctica independiente de {dimension}", kind, [dimension]),
        "integration": question("Integra con la meta", "context_case", ["contextual_application", "interpretation"]),
    }


class ReachableDimensionsTests(unittest.TestCase):
    def test_generator_backend_contract_event_and_coverage(self):
        lessons = {}
        for dimension, kind in FAMILIES.items():
            with patch.object(APP, "gemini", return_value=raw_map(dimension)):
                generated_map = APP.make_map({"goal": "Resolver problemas físicos", "context": ""})
            self.assertEqual(generated_map["coverage"][0]["dimensions"][0]["id"], dimension)
            self.assertTrue(generated_map["coverage"][0]["dimensions"][0]["required"])

            with patch.object(APP, "gemini", return_value=raw_lesson(dimension, kind)):
                lesson = APP.make_lesson({
                    "goal": "Resolver problemas físicos", "name": "Paso 1",
                    "parent": "Meta", "target_dimension": dimension,
                })
            self.assertEqual(lesson["target_dimension"], dimension)
            self.assertEqual(lesson["independent"]["kind"], kind)
            self.assertEqual(lesson["independent"]["observable_dimensions"], [dimension])
            lessons[dimension] = lesson

        payload = {
            "families": [{"dimension": dimension, "kind": kind} for dimension, kind in FAMILIES.items()],
            "lessons": lessons,
        }
        completed = subprocess.run(
            ["node", str(ROOT / "tests" / "reachable_dimensions_runner.js")],
            input=json.dumps(payload), text=True, capture_output=True, cwd=ROOT, check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)
        results = json.loads(completed.stdout)
        for dimension, result in results.items():
            self.assertEqual(result["observed"], [dimension])
            self.assertEqual(result["evidence"], 1)
            self.assertEqual(result["status"], "MASTERED")

    def test_backend_rejects_mismatched_target_metadata(self):
        for dimension, kind in FAMILIES.items():
            wrong = raw_lesson(dimension, kind)
            wrong["independent"] = question("Actividad incorrecta", "explanation", [dimension])
            with patch.object(APP, "gemini", return_value=wrong):
                with self.assertRaisesRegex(ValueError, "debe usar kind"):
                    APP.make_lesson({
                        "goal": "Resolver problemas físicos", "name": "Paso 1",
                        "parent": "Meta", "target_dimension": dimension,
                    })

    def test_backend_rejects_every_incompatible_units_contract(self):
        cases = {
            "incompatible_kind": question("Actividad", "explanation", ["units"]),
            "missing_dimensions": {
                "prompt": "Actividad", "reference": "Criterio", "kind": "units",
            },
            "incorrect_dimensions": question("Actividad", "units", ["variables"]),
            "additional_dimensions": question("Actividad", "units", ["units", "variables"]),
            "unknown_kind": question("Actividad", "unknown_family", ["units"]),
        }
        for label, incompatible in cases.items():
            with self.subTest(label=label):
                wrong = raw_lesson("units", "units")
                wrong["guided"] = incompatible
                with patch.object(APP, "gemini", return_value=wrong):
                    with self.assertRaisesRegex(ValueError, "debe usar kind"):
                        APP.make_lesson({
                            "goal": "Verificar análisis dimensional", "name": "Unidades",
                            "parent": "Meta", "target_dimension": "units",
                        })

    def test_legacy_question_does_not_gain_metadata(self):
        legacy = APP.clean_question({
            "prompt": "Pregunta anterior", "reference": "Criterio", "kind": "unknown",
        })
        self.assertNotIn("observable_dimensions", legacy)


if __name__ == "__main__":
    unittest.main()
