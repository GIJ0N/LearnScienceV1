"""local_production_v1: ítems de cálculo y de orden corregidos localmente, sin juez de modelo."""
import json
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

NODE = {'id': 'n1', 'name': 'Espesor de película', 'outcome': 'Calcular espesor'}
NUMERIC = {'applicable': True, 'prompt': 'Se aplican 120 g de polvo de manera uniforme sobre 2 m² de superficie. ¿Cuál es la masa aplicada por unidad de área, en g/m²?', 'solution': 'Masa entre área: 120/2.', 'value': 60, 'unit': 'g/m²'}
STEPS = ['Limpiar y desengrasar la pieza antes de pintar', 'Colgar la pieza y asegurar el contacto de tierra', 'Aplicar el polvo con la pistola electrostática', 'Curar la pieza en el horno a la temperatura indicada']
ORDERING = {'applicable': True, 'prompt': 'Preparas una pieza nueva para recubrirla.', 'solution': 'Cada paso depende del anterior.', 'steps': STEPS}
CLEAN = {'issues': [], 'checked': True}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'p.sqlite'
        self.mem = DurableMemory(self.path)
        self.old = (app._MEMORY, app._TEST_MEMORY)
        app.set_memory_for_tests(self.mem)
        self.pid = self.mem.create_profile('Prueba')['profile_id']
        self.other = self.mem.create_profile('Otra')['profile_id']
        self.n = 0

    def tearDown(self):
        app._MEMORY, app._TEST_MEMORY = self.old
        self.tmp.cleanup()

    def make(self, raw, kind='numeric', goal='g1', audit=CLEAN):
        with patch.object(app, 'gemini', return_value=raw) as g, patch.object(app, 'audit_content', return_value=audit):
            try:
                return app.make_production_item({'profile_id': self.pid, 'goal_id': goal, 'goal': 'Pintura en polvo', 'node': NODE, 'kind': kind})
            finally:
                self.calls = g.call_count

    def answer(self, item, attempt=None, goal='g1', profile=None, **kw):
        self.n += 1
        return app.answer_production_item({'profile_id': profile or self.pid, 'goal_id': goal, 'item_id': item['item_id'], 'attempt_id': attempt or f'att-{self.n}', **kw})

    def count_items(self):
        db = sqlite3.connect(str(self.path))
        try:
            return db.execute('SELECT COUNT(*) FROM placement_items').fetchone()[0]
        finally:
            db.close()


class Numeric(Base):
    def test_correct_within_tolerance_and_unit(self):
        item = self.make(NUMERIC)
        self.assertEqual(self.answer(item, value=60, unit='g/m²')['status'], 'CORRECT')
        self.assertEqual(self.answer(item, value=60.9, unit='G/M2')['status'], 'CORRECT', 'tolerancia 2 % y unidad normalizada')

    def test_outside_tolerance_is_arithmetic_failure(self):
        item = self.make(NUMERIC)
        out = self.answer(item, value=62, unit='g/m²')
        self.assertEqual((out['status'], out['error_type']), ('MISCONCEPTION', 'arithmetic'))

    def test_right_number_wrong_unit_is_units_failure(self):
        item = self.make(NUMERIC)
        out = self.answer(item, value=60, unit='kg/m²')
        self.assertEqual((out['status'], out['error_type']), ('MISCONCEPTION', 'units'))
        self.assertEqual(self.answer(item, value=60, unit='')['error_type'], 'units')

    def test_decimal_comma_equals_point(self):
        raw = dict(NUMERIC, value=1.5, unit='mm', prompt='Una capa de 1500 micras, expresada en milímetros, ¿cuántos mm mide?')
        item = self.make(raw)
        self.assertEqual(self.answer(item, value='1,5', unit='mm')['status'], 'CORRECT')

    def test_missing_value_is_unknown_and_invalid_is_rejected(self):
        item = self.make(NUMERIC)
        out = self.answer(item, value='', unit='g/m²')
        self.assertEqual((out['status'], out['error_type']), ('UNKNOWN', 'lack_of_exposure'))
        with self.assertRaises(ValueError):
            self.answer(item, value='abc', unit='g/m²')
        with self.assertRaises(ValueError):
            self.answer(item, value='nan', unit='g/m²')

    def test_adimensional_unit(self):
        item = self.make(dict(NUMERIC, unit='adimensional', value=0.5, prompt='Si 1 de cada 2 piezas pasa, ¿qué fracción pasa?'))
        self.assertEqual(self.answer(item, value='0,5', unit='')['status'], 'CORRECT')

    def test_result_reveals_solution_after_answering(self):
        out = self.answer(self.make(NUMERIC), value=1, unit='x')
        self.assertEqual((out['correct_value'], out['correct_unit'], out['evaluator_version']), (60.0, 'g/m²', 'local-production-v1'))
        self.assertIn('120/2', out['solution'])


class Ordering(Base):
    def correct_ids(self, item):
        text = {x['id']: x['text'] for x in item['steps']}
        return [next(i for i, t in text.items() if t == s) for s in STEPS]

    def test_correct_order(self):
        item = self.make(ORDERING, 'ordering')
        out = self.answer(item, order=self.correct_ids(item))
        self.assertEqual(out['status'], 'CORRECT')
        self.assertEqual([x['text'] for x in out['correct_order']], STEPS)

    def test_two_steps_swapped_fails(self):
        item = self.make(ORDERING, 'ordering')
        ids = self.correct_ids(item)
        ids[0], ids[1] = ids[1], ids[0]
        out = self.answer(item, order=ids)
        self.assertEqual((out['status'], out['error_type']), ('MISCONCEPTION', 'procedure'))

    def test_public_steps_are_shuffled_and_relabelled(self):
        item = self.make(ORDERING, 'ordering')
        self.assertNotEqual([x['text'] for x in item['steps']], STEPS)
        self.assertEqual(sorted(x['id'] for x in item['steps']), ['s1', 's2', 's3', 's4'])

    def test_incomplete_or_repeated_order_is_rejected(self):
        item = self.make(ORDERING, 'ordering')
        ids = self.correct_ids(item)
        for bad in (ids[:-1], ids + ['s1'], ['s1', 's1', 's2', 's3'], 'abc'):
            with self.assertRaises(ValueError):
                self.answer(item, order=bad)
        self.assertEqual(self.answer(item)['status'], 'UNKNOWN')


class Privacy(Base):
    def test_key_is_not_in_public_response(self):
        for raw, kind in ((NUMERIC, 'numeric'), (ORDERING, 'ordering')):
            item = self.make(raw, kind)
            for secret in ('value', 'order', 'solution', 'tolerance_pct', 'correct_value', 'correct_order'):
                self.assertNotIn(secret, item)
            self.assertNotIn('unit', item)
            self.assertNotIn('Masa entre área', json.dumps(item, ensure_ascii=False))
        stored = self.mem.load_placement_item(self.pid, item['item_id'])
        self.assertIn('order', stored['private'])

    def test_idempotency_by_attempt(self):
        item = self.make(NUMERIC)
        first = self.answer(item, 'same', value=60, unit='g/m²')
        self.assertEqual(self.answer(item, 'same', value=60, unit='g/m²'), first)
        with self.assertRaises(ValueError) as ctx:
            self.answer(item, 'same', value=1, unit='g/m²')
        self.assertIn('PLACEMENT_ATTEMPT_CONFLICT', str(ctx.exception))

    def test_other_goal_or_profile_rejected(self):
        item = self.make(NUMERIC)
        with self.assertRaises(ValueError):
            self.answer(item, goal='otra-meta', value=60, unit='g/m²')
        with self.assertRaises(ValueError):
            self.answer(item, profile=self.other, value=60, unit='g/m²')

    def test_other_versions_are_not_interchangeable(self):
        item = self.make(NUMERIC)
        with self.assertRaises(ValueError):
            app._answer_choice_item({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': 'x', 'selected_option_id': 'a'}, app.PLACEMENT_VERSION)
        placement = {'schema_version': app.PLACEMENT_VERSION, 'item_id': 'placement-xyz', 'node_id': 'n1', 'prompt': 'p', 'options': [{'id': 'a', 'text': 'x'}]}
        self.mem.save_placement_items(self.pid, 'g1', [(placement, {'correct_option_id': 'a', 'explanation': 'e', 'misconceptions': {}})])
        with self.assertRaises(ValueError):
            app.answer_production_item({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': 'placement-xyz', 'attempt_id': 'y', 'value': 1, 'unit': 'u'})


class Generation(Base):
    def test_not_applicable_errors_without_saving_or_retry(self):
        with self.assertRaises(ValueError) as ctx:
            self.make({'applicable': False, 'prompt': '', 'solution': ''})
        self.assertIn('PRODUCTION_NOT_APPLICABLE', str(ctx.exception))
        self.assertEqual(self.calls, 1)
        self.assertEqual(self.count_items(), 0)

    def test_audit_issue_twice_errors_without_saving(self):
        with self.assertRaises(ValueError):
            self.make(NUMERIC, audit={'issues': ['La clave es incorrecta'], 'checked': True})
        self.assertEqual(self.calls, 2)
        self.assertEqual(self.count_items(), 0)

    def test_audit_issue_once_then_ok_retries_with_reason(self):
        audits = [{'issues': ['dato inconsistente'], 'checked': True}, CLEAN]
        prompts = []

        def fake(prompt, *a, **k):
            prompts.append(prompt)
            return NUMERIC
        with patch.object(app, 'gemini', side_effect=fake), patch.object(app, 'audit_content', side_effect=audits):
            item = app.make_production_item({'profile_id': self.pid, 'goal_id': 'g1', 'goal': 'Meta', 'node': NODE, 'kind': 'numeric'})
        self.assertIn('dato inconsistente', prompts[1])
        self.assertTrue(item['item_id'].startswith('prod-'))
        self.assertEqual(self.count_items(), 1)

    def test_numeric_contract_violations_are_rejected(self):
        bad = [dict(NUMERIC, prompt='Calcula la masa por área; el resultado es 60 g/m²'), dict(NUMERIC, prompt='Calcula la masa por área sin datos'),
               dict(NUMERIC, unit='una unidad demasiado larga'), dict(NUMERIC, unit=''), dict(NUMERIC, value=float('inf')), dict(NUMERIC, value=True), dict(NUMERIC, value='60')]
        for raw in bad:
            with self.assertRaises(ValueError, msg=str(raw)):
                self.make(raw)
        self.assertEqual(self.count_items(), 0)

    def test_ordering_contract_violations_are_rejected(self):
        bad = [dict(ORDERING, steps=STEPS[:2]), dict(ORDERING, steps=STEPS + STEPS[:3]), dict(ORDERING, steps=['1. ' + STEPS[0]] + STEPS[1:]),
               dict(ORDERING, steps=['Paso uno: ' + STEPS[0]] + STEPS[1:]), dict(ORDERING, steps=[STEPS[0], STEPS[0].upper(), STEPS[2]]),
               dict(ORDERING, steps=['corto'] + STEPS[1:])]
        for raw in bad:
            with self.assertRaises(ValueError, msg=str(raw)):
                self.make(raw, 'ordering')
        self.assertEqual(self.count_items(), 0)

    def test_invalid_kind_or_missing_fields(self):
        with self.assertRaises(ValueError):
            app.make_production_item({'profile_id': self.pid, 'goal_id': 'g1', 'goal': 'M', 'node': NODE, 'kind': 'essay'})
        with self.assertRaises(ValueError):
            app.make_production_item({'profile_id': self.pid, 'goal': 'M', 'node': NODE, 'kind': 'numeric'})

    def test_routes_registered(self):
        self.assertIs(app.ROUTES['/api/practice/produce'], app.make_production_item)
        self.assertIs(app.ROUTES['/api/practice/produce/answer'], app.answer_production_item)


if __name__ == '__main__':
    unittest.main()
