"""error_hunt_v1: solución con un error escondido, contrato local, corrección sin proveedor y auditoría."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory

NODES = [{'id': 'a', 'name': 'Proporciones', 'outcome': 'Escalar'}, {'id': 'b', 'name': 'Porcentajes', 'outcome': 'Calcular'}]
SOLUTION = ('Si 2 kg cuestan 30, ¿cuánto cuestan 5 kg?\nPaso 1: Precio por kg = 30 ÷ 2 = 15.\nPaso 2: Para 5 kg multiplico 15 × 5 = 70.\n'
            'Paso 3: Respuesta: 70.\n¿Dónde está el error?')


CLEAN_OPTION = 'Ningún paso tiene error: la solución es correcta.'
CLEAN_SOLUTION = SOLUTION.replace('15 × 5 = 70', '15 × 5 = 75').replace('Respuesta: 70', 'Respuesta: 75')


def hunt(node_id='a', prompt=SOLUTION, options=None, key='a', fix='Paso 2: Para 5 kg multiplico 15 × 5 = 75.'):
    options = options or [
        {'id': 'a', 'text': 'El error está en el paso 2: 15 × 5 es 75, no 70.', 'misconception': ''},
        {'id': 'b', 'text': 'El error está en el paso 1: debió multiplicar 30 × 2.', 'misconception': 'Confunde dividir con multiplicar al buscar el precio unitario.'},
        {'id': 'c', 'text': 'El error está en el paso 3: la respuesta debe llevar unidades de masa.', 'misconception': 'Cree que el error es de formato y no de cálculo.'},
        {'id': 'd', 'text': CLEAN_OPTION, 'misconception': 'Cree que la solución es válida porque el resultado parece razonable.'}]
    return {'node_id': node_id, 'prompt': prompt, 'options': options, 'correct_option_id': key,
            'explanation': '15 × 5 = 75; el paso 2 resta 5 al resultado.', 'fix_reference': fix}


def clean_hunt(node_id='a'):
    options = [
        {'id': 'a', 'text': CLEAN_OPTION, 'misconception': ''},
        {'id': 'b', 'text': 'El error está en el paso 2: 15 × 5 es 70.', 'misconception': 'Recuerda mal la tabla del 15.'},
        {'id': 'c', 'text': 'El error está en el paso 1: debió multiplicar 30 × 2.', 'misconception': 'Confunde dividir con multiplicar.'}]
    return hunt(node_id, CLEAN_SOLUTION, options, 'a', fix='')


class ErrorHunt(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'e.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.patches = [patch.object(app, 'memory', return_value=self.memory), patch.object(app, 'CONTENT_VERIFY', False)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def generate(self, items, nodes=None, clean=()):
        with patch.object(app, 'gemini', return_value={'items': items}) as g, patch.object(app, '_choose_clean_nodes', return_value=set(clean)):
            out = app.make_error_hunt_items({'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Aritmética', 'nodes': NODES if nodes is None else nodes})
        return out, g

    def test_valid_item_keeps_the_key_private(self):
        out, g = self.generate([hunt('a')])
        self.assertEqual(out['schema_version'], 'error_hunt_v1')
        item = out['items'][0]
        self.assertTrue(item['item_id'].startswith('err-'))
        self.assertNotIn('correct_option_id', item)
        self.assertNotIn('explanation', item)
        self.assertEqual(g.call_count, 1)
        self.assertIn('EXACTAMENTE un paso', g.call_args[0][0])
        self.assertIn('SIEMPRE, una opción exacta', g.call_args[0][0])

    def test_contract_drops_malformed_solutions(self):
        two_steps = SOLUTION.replace('Paso 3: Respuesta: 70.\n', '')
        seven = 'Problema\n' + '\n'.join(f'Paso {i}: x' for i in range(1, 8)) + '\n¿Dónde está el error?'
        skipped = SOLUTION.replace('Paso 2:', 'Paso 4:')
        no_cite = [{'id': 'a', 'text': 'Hay un error de cálculo al multiplicar.', 'misconception': ''},
                   {'id': 'b', 'text': 'Hay un error al dividir por dos.', 'misconception': 'Confunde la operación.'},
                   {'id': 'c', 'text': 'No hay ningún error de fondo.', 'misconception': 'Cree que el resultado es válido.'},
                   {'id': 'd', 'text': 'Hay un error de unidades.', 'misconception': 'Mezcla masa con precio.'}]
        out_of_range = [{'id': 'a', 'text': 'El error está en el paso 2.', 'misconception': ''},
                        {'id': 'b', 'text': 'El error está en el paso 9.', 'misconception': 'Inventa un paso.'},
                        {'id': 'c', 'text': 'El error está en el paso 1.', 'misconception': 'Revisa solo el inicio.'},
                        {'id': 'd', 'text': CLEAN_OPTION, 'misconception': 'Cree que todo está bien.'}]
        for bad in (hunt('a', two_steps), hunt('a', seven), hunt('a', skipped), hunt('a', options=no_cite), hunt('a', options=out_of_range)):
            with self.assertRaisesRegex(ValueError, 'no se guardó nada'):
                self.generate([bad])

    def test_good_items_survive_next_to_bad_ones_and_duplicates_collapse(self):
        out, _ = self.generate([hunt('a', 'sin pasos'), hunt('b'), hunt('b')])
        self.assertEqual([i['node_id'] for i in out['items']], ['b'])

    def test_requires_at_least_one_topic(self):
        with self.assertRaisesRegex(ValueError, 'al menos un tema'):
            self.generate([hunt('a')], nodes=[])

    def test_audit_drops_flagged_items(self):
        replies = [{'items': [hunt('a'), hunt('b')]}, {'issues': [{'item': 1, 'problem': 'El paso 2 en realidad es correcto.'}]}]
        with patch.object(app, 'CONTENT_VERIFY', True), patch.object(app, '_choose_clean_nodes', return_value=set()), patch.object(app, 'gemini', side_effect=replies):
            out = app.make_error_hunt_items({'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Aritmética', 'nodes': NODES})
        self.assertEqual([i['node_id'] for i in out['items']], ['b'])

    def test_grading_is_local_idempotent_and_version_isolated(self):
        out, _ = self.generate([hunt('a')])
        item = out['items'][0]
        private = self.memory.load_placement_item(self.profile, item['item_id'])['private']
        correct = private['correct_option_id']
        wrong = next(o['id'] for o in item['options'] if o['id'] != correct)
        base = {'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item['item_id']}
        with patch.object(app, 'gemini', side_effect=AssertionError('la corrección no debe llamar al proveedor')):
            ok = app.answer_error_hunt_item({**base, 'attempt_id': 'a1', 'selected_option_id': correct, 'learner_confidence': 80})
            bad = app.answer_error_hunt_item({**base, 'attempt_id': 'a2', 'selected_option_id': wrong, 'learner_confidence': 90})
            again = app.answer_error_hunt_item({**base, 'attempt_id': 'a1', 'selected_option_id': correct, 'learner_confidence': 80})
            with self.assertRaisesRegex(ValueError, 'otra respuesta'):
                app.answer_error_hunt_item({**base, 'attempt_id': 'a1', 'selected_option_id': wrong})
        self.assertEqual(ok['status'], 'CORRECT')
        self.assertEqual(bad['status'], 'MISCONCEPTION')
        self.assertTrue(bad['selected_misconception'])
        self.assertEqual(again['status'], 'CORRECT', 'repetir el mismo attempt_id devuelve el resultado original')
        with self.assertRaisesRegex(ValueError, 'otra actividad'):
            app.answer_discrimination_item({**base, 'attempt_id': 'a3', 'selected_option_id': correct})

    def test_clean_solution_has_its_no_error_key_and_is_indistinguishable_in_the_public_item(self):
        out, _ = self.generate([clean_hunt('a'), hunt('b')], clean={'a'})
        self.assertEqual({i['node_id'] for i in out['items']}, {'a', 'b'})
        for item in out['items']:
            texts = [o['text'] for o in item['options']]
            self.assertEqual(sum(1 for t in texts if 'Ningún paso tiene error' in t), 1, 'la opción «ningún paso» siempre está')
            self.assertNotIn('has_error', item)
            self.assertNotIn('fix_reference', item)
        private = {i['node_id']: self.memory.load_placement_item(self.profile, i['item_id'])['private'] for i in out['items']}
        self.assertFalse(private['a']['has_error'])
        self.assertEqual(private['a']['fix_reference'], '')
        self.assertTrue(private['b']['has_error'])
        self.assertIn('75', private['b']['fix_reference'])

    def test_key_must_match_the_requested_kind(self):
        # Se pidió limpia pero la clave señala un paso; o se pidió con error y la clave dice «sin error».
        with self.assertRaisesRegex(ValueError, 'no se guardó nada'):
            self.generate([hunt('a')], clean={'a'})
        wrong_clean = clean_hunt('a')
        with self.assertRaisesRegex(ValueError, 'no se guardó nada'):
            self.generate([wrong_clean], clean=set())

    def test_every_item_needs_exactly_one_no_error_option_and_an_error_item_needs_its_fix(self):
        no_clean = hunt('a', options=[
            {'id': 'a', 'text': 'El error está en el paso 2: 15 × 5 es 75.', 'misconception': ''},
            {'id': 'b', 'text': 'El error está en el paso 1: debió multiplicar.', 'misconception': 'Confunde operaciones.'},
            {'id': 'c', 'text': 'El error está en el paso 3: faltan unidades.', 'misconception': 'Cree que es formato.'}])
        with self.assertRaisesRegex(ValueError, 'no se guardó nada'):
            self.generate([no_clean])
        with self.assertRaisesRegex(ValueError, 'no se guardó nada'):
            self.generate([hunt('a', fix='')])

    def test_no_error_prompt_is_requested_per_node(self):
        _, g = self.generate([clean_hunt('a'), hunt('b')], clean={'a'})
        prompt = g.call_args[0][0]
        self.assertIn('a: Proporciones', prompt)
        self.assertRegex(prompt, r'a: Proporciones \(resultado: Escalar; solución SIN errores')
        self.assertRegex(prompt, r'b: Porcentajes \(resultado: Calcular; solución CON exactamente un paso erróneo')

    def test_answer_flags_when_a_fix_is_needed(self):
        out, _ = self.generate([clean_hunt('a'), hunt('b')], clean={'a'})
        by_node = {i['node_id']: i for i in out['items']}
        results = {}
        for node, item in by_node.items():
            key = self.memory.load_placement_item(self.profile, item['item_id'])['private']['correct_option_id']
            results[node] = app.answer_error_hunt_item({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': 'k-' + node, 'selected_option_id': key, 'learner_confidence': 80})
        self.assertTrue(results['a']['clean_solution'])
        self.assertFalse(results['a']['needs_fix'])
        self.assertFalse(results['b']['clean_solution'])
        self.assertTrue(results['b']['needs_fix'])

    # --- corrección escrita ---
    def solved(self):
        out, _ = self.generate([hunt('b')])
        item = out['items'][0]
        key = self.memory.load_placement_item(self.profile, item['item_id'])['private']['correct_option_id']
        wrong = next(o['id'] for o in item['options'] if o['id'] != key)
        base = {'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item['item_id']}
        app.answer_error_hunt_item({**base, 'attempt_id': 'diag-ok', 'selected_option_id': key, 'learner_confidence': 70})
        app.answer_error_hunt_item({**base, 'attempt_id': 'diag-bad', 'selected_option_id': wrong, 'learner_confidence': 70})
        return base

    def fix(self, base, reply, **extra):
        data = {**base, 'attempt_id': 'fix-1', 'diagnosis_attempt_id': 'diag-ok', 'answer': 'Paso 2: 15 × 5 = 75.'}
        data.update(extra)
        with patch.object(app, 'gemini', return_value=reply) as g:
            return app.grade_error_fix(data), g

    def test_fix_is_graded_by_rubric_and_marked_provisional(self):
        base = self.solved()
        result, g = self.fix(base, {'status': 'CORRECT', 'feedback': 'Arreglas la multiplicación.'})
        self.assertEqual(result['status'], 'CORRECT')
        self.assertTrue(result['provisional'])
        self.assertIn('75', result['correct_step'])
        prompt = g.call_args[0][0]
        self.assertIn('No premies elocuencia', prompt)
        self.assertIn('<<<Paso 2: 15 × 5 = 75.>>>', prompt)

    def test_fix_is_idempotent_and_rejects_a_different_text_for_the_same_attempt(self):
        base = self.solved()
        first, _ = self.fix(base, {'status': 'PARTIAL', 'feedback': 'Falta algo.'})
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe volver a llamar al modelo')):
            again = app.grade_error_fix({**base, 'attempt_id': 'fix-1', 'diagnosis_attempt_id': 'diag-ok', 'answer': 'Paso 2: 15 × 5 = 75.'})
            self.assertEqual(again['status'], first['status'])
            with self.assertRaisesRegex(ValueError, 'otra corrección'):
                app.grade_error_fix({**base, 'attempt_id': 'fix-1', 'diagnosis_attempt_id': 'diag-ok', 'answer': 'Otra cosa distinta'})

    def test_fix_requires_a_correct_diagnosis_first(self):
        base = self.solved()
        with self.assertRaisesRegex(ValueError, 'Primero hay que encontrar'):
            self.fix(base, {'status': 'CORRECT', 'feedback': 'x'}, diagnosis_attempt_id='diag-bad')
        with self.assertRaisesRegex(ValueError, 'Primero hay que encontrar'):
            self.fix(base, {'status': 'CORRECT', 'feedback': 'x'}, diagnosis_attempt_id='no-existe')

    def test_fix_rejects_clean_solutions_other_goals_other_versions_and_bad_grades(self):
        out, _ = self.generate([clean_hunt('a')], clean={'a'})
        item = out['items'][0]
        key = self.memory.load_placement_item(self.profile, item['item_id'])['private']['correct_option_id']
        base = {'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item['item_id']}
        app.answer_error_hunt_item({**base, 'attempt_id': 'diag-clean', 'selected_option_id': key})
        with self.assertRaisesRegex(ValueError, 'no tiene una corrección'):
            self.fix(base, {'status': 'CORRECT', 'feedback': 'x'}, diagnosis_attempt_id='diag-clean', attempt_id='fix-clean')
        solved = self.solved()
        with self.assertRaisesRegex(ValueError, 'no existe para esta meta'):
            self.fix({**solved, 'goal_id': 'otra'}, {'status': 'CORRECT', 'feedback': 'x'})
        with self.assertRaisesRegex(ValueError, 'incompleta'):
            self.fix(solved, {'status': 'GENIAL', 'feedback': 'x'}, attempt_id='fix-2')
        with self.assertRaisesRegex(ValueError, 'Escribe cómo'):
            self.fix(solved, {'status': 'CORRECT', 'feedback': 'x'}, answer='ok', attempt_id='fix-3')

    def test_route_registered_for_fix(self):
        self.assertIs(app.ROUTES['/api/practice/error/fix'], app.grade_error_fix)

    def test_routes_registered(self):
        self.assertIs(app.ROUTES['/api/practice/error'], app.make_error_hunt_items)
        self.assertIs(app.ROUTES['/api/practice/error/answer'], app.answer_error_hunt_item)


if __name__ == '__main__':
    unittest.main()
