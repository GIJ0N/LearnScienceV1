"""evidence_hardening_v1 (backend): la pregunta independiente no puede parecerse al ejemplo resuelto,
y la práctica de ancla exige un contrato propio (purpose), al menos 4 pasos y dificultad standard."""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app
from memory_store import DurableMemory

EXAMPLE = ('Una pieza de 2 m² recibe 120 g de polvo de forma uniforme. Calcula la masa por unidad de área. '
           'Paso 1: identifica la masa total. Paso 2: divide entre el área. Resultado: 60 g/m².')


def q(prompt, kind='application', **extra):
    return {'prompt': prompt, 'reference': 'criterio de ' + prompt, 'kind': kind,
            'observable_dimensions': ['direct_application'], **extra}


def lesson_raw(example=EXAMPLE, guided=None, independent=None, check=None, integration=None):
    return {'explanation': 'Explicación breve', 'example': example, 'common_error': 'Error frecuente',
            'check': check or q('Explica con tus palabras qué es la masa por área', 'explanation'),
            'guided': guided or q('Convierte con apoyo 3 kg a gramos'),
            'independent': independent or q('Una pieza de 5 m² recibe 300 g de polvo. Calcula la masa por unidad de área.'),
            'integration': integration or q('Decide en una planta nueva qué hacer', 'context_case',
                                            novelty_basis='Cambia el contexto: ahora es una decisión en planta')}


class Overlap(unittest.TestCase):
    def test_equal_and_contained_texts_are_too_close(self):
        self.assertTrue(app._too_close('Calcula la masa por unidad de área', 'Calcula la masa por unidad de área'))
        self.assertTrue(app._too_close('Calcula la masa por unidad de área con estos datos',
                                       'Por favor calcula la masa por unidad de área con estos datos hoy'))

    def test_short_containment_is_not_enough(self):
        self.assertFalse(app._too_close('área', 'Calcula la masa por unidad de área'))

    def test_jaccard_applies_only_against_the_example_statement(self):
        # Mismo enunciado con otras cifras: el solapamiento léxico alto con el ENUNCIADO del ejemplo sí se marca.
        self.assertTrue(app._example_overlap('Una pieza de 2 m² recibe 120 g de polvo de forma uniforme. Calcula la masa por unidad de área.', EXAMPLE))
        # Un procedimiento distinto (otra situación) no se marca aunque comparta vocabulario general.
        self.assertFalse(app._example_overlap('Un operario revisa el horno y anota la temperatura de curado de cada lote.', EXAMPLE))

    def test_example_statement_stops_before_steps(self):
        statement = app._example_statement(EXAMPLE)
        self.assertIn('Calcula la masa por unidad de área', statement)
        self.assertNotIn('Paso 1', statement)
        self.assertLessEqual(len(app._example_statement('x' * 900)), 300)


class IndependentNotCopiedFromExample(unittest.TestCase):
    def lesson(self, **kw):
        return app._lesson_from_raw(lesson_raw(**kw), None)

    def test_distinct_independent_keeps_independence(self):
        out = self.lesson()
        self.assertNotIn('example_overlap', out['independent'])
        self.assertNotIn('supports_independence', out['independent'].get('activity_contract', {}))

    def test_independent_copy_of_example_statement_is_marked_as_practice(self):
        copy = 'Una pieza de 2 m² recibe 120 g de polvo de forma uniforme. Calcula la masa por unidad de área.'
        out = self.lesson(independent=q(copy))
        self.assertTrue(out['independent']['example_overlap'])
        self.assertEqual(out['independent']['activity_contract'], {'supports_independence': False})

    def test_same_template_other_numbers_against_guided_stays_independent(self):
        # C4: la comparación con guided/check es solo de igualdad o contención; cifras distintas no bastan para marcar.
        guided = q('Una pieza de 2 m² recibe 120 g de polvo de forma uniforme. Calcula la masa por unidad de área.')
        out = self.lesson(guided=guided, independent=q('Una pieza de 4 m² recibe 90 g de polvo de forma uniforme. Calcula la masa por unidad de área.'))
        self.assertNotIn('example_overlap', out['independent'])
        self.assertNotIn('activity_contract', out['independent'])

    def test_integration_copy_of_example_gets_no_novelty(self):
        copy = 'Una pieza de 2 m² recibe 120 g de polvo de forma uniforme. Calcula la masa por unidad de área.'
        out = self.lesson(integration=q(copy, 'context_case', novelty_basis='Cambia el contexto por completo ahora'))
        self.assertNotIn('is_novel_variant', out['integration'])
        self.assertNotIn('supports_transfer', out['integration'])


class ProductionAnchor(unittest.TestCase):
    NODE = {'id': 'n1', 'name': 'Espesor de película', 'outcome': 'Ordenar la preparación'}
    STEPS = ['Limpiar y desengrasar la pieza antes de pintar', 'Colgar la pieza y asegurar el contacto de tierra',
             'Aplicar el polvo con la pistola electrostática', 'Curar la pieza en el horno a la temperatura indicada']
    NUMERIC = {'applicable': True, 'prompt': 'Se aplican 120 g de polvo sobre 2 m². ¿Cuál es la masa por unidad de área?',
               'solution': 'Masa entre área.', 'value': 60, 'unit': 'g/m²'}
    CLEAN = {'issues': [], 'checked': True}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.mem = DurableMemory(Path(self.tmp.name) / 'p.sqlite')
        self.old = (app._MEMORY, app._TEST_MEMORY)
        app.set_memory_for_tests(self.mem)
        self.pid = self.mem.create_profile('Prueba')['profile_id']

    def tearDown(self):
        app._MEMORY, app._TEST_MEMORY = self.old
        self.tmp.cleanup()

    def produce(self, responses, **data):
        base = {'profile_id': self.pid, 'goal_id': 'g1', 'goal': 'Pintura en polvo', 'node': self.NODE}
        base.update(data)
        with patch.object(app, 'gemini', side_effect=responses) as g, patch.object(app, 'audit_content', return_value=self.CLEAN):
            try:
                return app.make_production_item(base), g.call_count
            except ValueError as exc:
                return exc, g.call_count

    def test_anchor_ordering_rejects_three_steps_and_retries_to_four(self):
        three = {'applicable': True, 'prompt': 'Preparas una pieza nueva para recubrirla.', 'solution': 'Orden.', 'steps': self.STEPS[:3]}
        four = {'applicable': True, 'prompt': 'Preparas una pieza nueva para recubrirla.', 'solution': 'Orden.', 'steps': self.STEPS}
        item, calls = self.produce([three, four], kind='ordering', purpose='anchor')
        self.assertEqual(calls, 2)
        self.assertEqual(len(item['steps']), 4)
        self.assertEqual(item['purpose'], 'anchor')

    def test_practice_ordering_keeps_three_steps(self):
        three = {'applicable': True, 'prompt': 'Preparas una pieza nueva para recubrirla.', 'solution': 'Orden.', 'steps': self.STEPS[:3]}
        item, calls = self.produce([three], kind='ordering')
        self.assertEqual(calls, 1)
        self.assertEqual(len(item['steps']), 3)
        self.assertNotIn('purpose', item)

    def test_invalid_purpose_fails_before_calling_the_model(self):
        result, calls = self.produce([self.NUMERIC], kind='numeric', purpose='essay')
        self.assertIsInstance(result, ValueError)
        self.assertIn('Propósito', str(result))
        self.assertEqual(calls, 0)

    def test_anchor_forces_standard_band_server_side(self):
        item, _ = self.produce([self.NUMERIC], kind='numeric', purpose='anchor', difficulty_band='challenge')
        self.assertEqual(item['difficulty_band'], 'standard')

    def test_anchor_numeric_publishes_expected_unit_without_value(self):
        item, _ = self.produce([self.NUMERIC], kind='numeric', purpose='anchor')
        self.assertEqual(item['expected_unit'], 'g/m²')
        self.assertNotIn('value', item)
        self.assertNotIn('60', item['prompt'])


class LegacyCheck(unittest.TestCase):
    def test_teaching_lesson_still_builds_without_contract_fields(self):
        out = app._lesson_from_raw(lesson_raw(), None)
        self.assertEqual(out['check']['prompt'], 'Explica con tus palabras qué es la masa por área')


if __name__ == '__main__':
    unittest.main()
