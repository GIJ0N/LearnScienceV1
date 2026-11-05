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


def hunt(node_id='a', prompt=SOLUTION, options=None, key='a'):
    options = options or [
        {'id': 'a', 'text': 'El error está en el paso 2: 15 × 5 es 75, no 70.', 'misconception': ''},
        {'id': 'b', 'text': 'El error está en el paso 1: debió multiplicar 30 × 2.', 'misconception': 'Confunde dividir con multiplicar al buscar el precio unitario.'},
        {'id': 'c', 'text': 'El error está en el paso 3: la respuesta debe llevar unidades de masa.', 'misconception': 'Cree que el error es de formato y no de cálculo.'}]
    return {'node_id': node_id, 'prompt': prompt, 'options': options, 'correct_option_id': key, 'explanation': '15 × 5 = 75; el paso 2 resta 5 al resultado.'}


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

    def generate(self, items, nodes=None):
        with patch.object(app, 'gemini', return_value={'items': items}) as g:
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

    def test_contract_drops_malformed_solutions(self):
        two_steps = SOLUTION.replace('Paso 3: Respuesta: 70.\n', '')
        seven = 'Problema\n' + '\n'.join(f'Paso {i}: x' for i in range(1, 8)) + '\n¿Dónde está el error?'
        skipped = SOLUTION.replace('Paso 2:', 'Paso 4:')
        no_cite = [{'id': 'a', 'text': 'Hay un error de cálculo al multiplicar.', 'misconception': ''},
                   {'id': 'b', 'text': 'Hay un error al dividir por dos.', 'misconception': 'Confunde la operación.'},
                   {'id': 'c', 'text': 'No hay ningún error de fondo.', 'misconception': 'Cree que el resultado es válido.'}]
        out_of_range = [{'id': 'a', 'text': 'El error está en el paso 2.', 'misconception': ''},
                        {'id': 'b', 'text': 'El error está en el paso 9.', 'misconception': 'Inventa un paso.'},
                        {'id': 'c', 'text': 'El error está en el paso 1.', 'misconception': 'Revisa solo el inicio.'}]
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
        with patch.object(app, 'CONTENT_VERIFY', True), patch.object(app, 'gemini', side_effect=replies):
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

    def test_routes_registered(self):
        self.assertIs(app.ROUTES['/api/practice/error'], app.make_error_hunt_items)
        self.assertIs(app.ROUTES['/api/practice/error/answer'], app.answer_error_hunt_item)


if __name__ == '__main__':
    unittest.main()
