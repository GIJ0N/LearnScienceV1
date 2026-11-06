"""Ronda QA 2: Encuentra el error tolera formato real de Gemini, pista 3 sin datos de la pregunta, reto con reintento y campos numéricos, Beto exige más que un ejemplo."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory

NODE = {'id': 'n1', 'name': 'Proporciones', 'outcome': 'Resolver reglas de tres'}
MD_PROMPT = 'Si 2 kg cuestan 30, ¿cuánto cuestan 5 kg? **Paso 1:** 30 ÷ 2 = 15. **Paso 2:** 15 × 5 = 70. **Paso 3:** Respuesta: 70. ¿Hay un error? Si lo hay, ¿dónde está?'
LONG_RIGHT = 'El error está en el paso 2: 15 × 5 es 75, no 70, porque al multiplicar el precio unitario por los kilogramos se calculó mal el producto.'


def err_item(prompt=MD_PROMPT, right=LONG_RIGHT):
    return {'node_id': 'n1', 'prompt': prompt, 'correct_option_id': 'a', 'explanation': '15 × 5 = 75.', 'fix_reference': 'Paso 2: 15 × 5 = 75.',
            'options': [{'id': 'a', 'text': right, 'misconception': ''},
                        {'id': 'b', 'text': 'El error está en el paso 1: debió multiplicar 30 × 2, porque la relación es proporcional.', 'misconception': 'Confunde operaciones.'},
                        {'id': 'c', 'text': app.ERR_CLEAN_EXAMPLE, 'misconception': 'Cree que el resultado es válido.'}]}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'q.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.patches = [patch.object(app, 'memory', return_value=self.memory), patch.object(app, 'CONTENT_VERIFY', False),
                        patch.object(app, '_choose_clean_nodes', return_value=set())]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()


class ErrorHuntFormat(Base):
    def hunt(self, *replies):
        data = {'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Proporciones', 'nodes': [NODE]}
        with patch.object(app, 'gemini', side_effect=list(replies)) as g:
            return app.make_error_hunt_items(data), g

    def test_markdown_and_inline_steps_are_normalized(self):
        out, g = self.hunt({'items': [err_item()]})
        self.assertEqual(g.call_count, 1)
        prompt = out['items'][0]['prompt']
        self.assertNotIn('*', prompt)
        self.assertEqual(sum(1 for line in prompt.split('\n') if line.startswith('Paso ')), 3)

    def test_long_correct_diagnosis_is_not_flagged_by_the_short_clean_option(self):
        right = 'El error está en el paso 2: 15 × 5 es 75 y no 70, porque al multiplicar el precio unitario por los kilogramos se calculó mal el producto final.'
        wrong_len = len('El error está en el paso 1: debió multiplicar 30 × 2, porque la relación es proporcional.')
        self.assertGreater(len(right), 1.4 * wrong_len)
        self.assertLess(len(right), 2.0 * wrong_len)
        self.assertGreaterEqual(len(right), 2.0 * (wrong_len + len(app.ERR_CLEAN_EXAMPLE)) / 2)
        out, _ = self.hunt({'items': [err_item(right=right)]})
        self.assertEqual(len(out['items']), 1)

    def test_retry_with_reasons_then_success(self):
        bad = err_item(prompt='Sin pasos numerados.')
        out, g = self.hunt({'items': [bad]}, {'items': [err_item()]})
        self.assertEqual(g.call_count, 2)
        self.assertIn('Corrección', g.call_args_list[1][0][0])
        self.assertEqual(len(out['items']), 1)

    def test_failure_reports_reasons_and_saves_nothing(self):
        bad = err_item(prompt='Sin pasos numerados.')
        with self.assertRaisesRegex(ValueError, 'Motivos: .*pasos'):
            self.hunt({'items': [bad]}, {'items': [bad]})


class HintLevel3(Base):
    Q = {'prompt': 'Si 3 cajas pesan 15 kg, ¿cuánto pesan 6 cajas?', 'reference': 'El peso es proporcional: 6 cajas pesan 30 kg.'}

    def hint(self, *texts, level=3):
        data = {'goal': 'Proporciones', 'name': 'Reglas de tres', 'question': self.Q, 'level': level}
        with patch.object(app, 'gemini', side_effect=[{'hint': t} for t in texts]) as g:
            return app.make_hint(data), g

    def test_level3_reusing_question_data_is_retried_then_accepted(self):
        out, g = self.hint('Duplicas las 3 cajas y duplicas los 15 kg.', 'Si 4 botellas llenan 8 litros, 8 botellas llenan el doble: así se traslada el método.')
        self.assertEqual(g.call_count, 2)
        self.assertIn('Usa otros números', g.call_args_list[1][0][0])
        self.assertNotIn('15', out['hint'])

    def test_level3_still_reusing_data_is_discarded(self):
        with self.assertRaisesRegex(ValueError, 'reutilizaba'):
            self.hint('Con 3 cajas y 15 kg, duplica.', 'De 3 cajas a 6 cajas duplicas los 15 kg.')

    def test_levels_1_and_2_are_not_affected(self):
        out, g = self.hint('Fíjate en cuánto pesa cada caja: 15 kg entre 3.', level=1)
        self.assertEqual(g.call_count, 1)


class ChallengeRound2(Base):
    CH = {'title': 'Proporciones en casa', 'scenario': 'Tienes una regla y 10 clips.', 'prediction_prompt': '¿Cuánto medirán 10 clips en fila?', 'minutes': 15,
          'materials': ['10 clips', 'regla'], 'steps': ['Mide un clip.', 'Mide 10 clips en fila.'],
          'evidence_fields': [{'id': 'uno', 'label': 'Longitud de 1 clip en cm'}, {'id': 'diez', 'label': 'Longitud de 10 clips en cm'}],
          'safety_note': 'Cuida no pincharte.', 'success_criteria': 'La longitud de 10 clips es 10 veces la de uno.'}

    def start(self, *replies):
        with patch.object(app, 'gemini', side_effect=list(replies)) as g:
            return app.challenge_start({'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Proporciones', 'node': NODE}), g

    def test_first_attempt_rejected_second_is_generated(self):
        unsafe = {**self.CH, 'steps': ['Enciende una vela.', 'Mide.']}
        out, g = self.start(unsafe, self.CH)
        self.assertEqual(g.call_count, 2)
        self.assertIn('filtro de seguridad', g.call_args_list[1][0][0])
        self.assertTrue(out['item_id'].startswith('chal-'))

    def test_two_rejections_raise_and_save_nothing(self):
        unsafe = {**self.CH, 'steps': ['Enciende una vela.', 'Mide.']}
        with self.assertRaisesRegex(ValueError, 'no se guardó nada'):
            self.start(unsafe, unsafe)

    def test_numeric_measurements_are_accepted_but_empty_words_are_not(self):
        out, _ = self.start(self.CH)
        item = {'item_id': out['item_id']}
        app.challenge_commit({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': 'c1', 'prediction': 'Creo que medirán diez veces más', 'confidence': 60})
        base = {'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item['item_id'], 'prediction_attempt_id': 'c1', 'reflection': 'Coincidió con mi predicción porque es proporcional.'}
        with patch.object(app, 'gemini', return_value={'status': 'SUPPORTED', 'prediction_match': 'YES', 'feedback': 'Bien, citaste 20 cm.', 'next_step': 'Repite.'}):
            ok = app.challenge_report({**base, 'attempt_id': 'r1', 'evidence': {'uno': '2 cm', 'diez': '20'}})
        self.assertEqual(ok['status'], 'SUPPORTED')
        with self.assertRaisesRegex(ValueError, 'Completa'):
            app.challenge_report({**base, 'attempt_id': 'r2', 'evidence': {'uno': 'sí', 'diez': '20 cm'}})
        with self.assertRaisesRegex(ValueError, 'Completa'):
            app.challenge_report({**base, 'attempt_id': 'r3', 'evidence': {'uno': '2 cm', 'diez': 'bastante'}})


class BetoRound2(Base):
    def test_corrected_with_a_one_line_reply_is_downgraded(self):
        start = {'belief': 'Si ambas suben son proporcionales.', 'correct_idea': 'Proporcional exige razón constante.', 'opening': 'Creo que estatura y edad son proporcionales.'}
        with patch.object(app, 'gemini', return_value=start):
            s = app.beto_start({'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Proporciones', 'node': NODE})
        reply = {'beto_reply': 'Vaya, eso cambia todo.', 'status': 'CORRECTED', 'learner_issues': [], 'debrief': 'Bien.'}
        with patch.object(app, 'gemini', return_value=reply):
            out = app.beto_turn({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': s['item_id'], 'attempt_id': 't1', 'message': 'Piensa en estatura', 'history': [{'role': 'beto', 'text': s['opening']}]})
        self.assertEqual(out['status'], 'PARTIAL')
        self.assertFalse(out['final'])


if __name__ == '__main__':
    unittest.main()
