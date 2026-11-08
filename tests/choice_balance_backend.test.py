"""Opciones sin pistas de longitud: la correcta no puede destacar por larga y, si el modelo falla el contrato, se reintenta una vez con el motivo."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory

NODES = [{'id': 'a', 'name': 'Razones', 'outcome': 'Comparar razones'}, {'id': 'b', 'name': 'Porcentajes', 'outcome': 'Calcular porcentajes'}]


def item(node_id, right, wrongs):
    opts = [{'id': 'a', 'text': right, 'misconception': ''}] + [{'id': chr(98 + i), 'text': w, 'misconception': 'Confusión concreta ' + str(i)} for i, w in enumerate(wrongs)]
    return {'node_id': node_id, 'prompt': 'Una mezcla tiene 2 partes de pintura y 3 de solvente. ¿Qué ocurre si duplicas ambas partes?', 'correct_option_id': 'a',
            'explanation': 'Duplicar ambas partes conserva la razón.', 'options': opts}


LONG = item('a', 'La concentración se mantiene igual porque ambas cantidades crecen en la misma proporción y la razón no cambia', ['Se diluye', 'Se concentra más'])
FAIR = item('a', 'La concentración se mantiene porque la razón no cambia', ['La concentración baja porque hay más solvente total', 'La concentración sube porque hay más pintura total'])
FAIR_B = item('b', 'El 20 % de 50 son 10 unidades del total', ['El 20 % de 50 son 25 unidades del total', 'El 20 % de 50 son 2,5 unidades del total'])


class Gate(unittest.TestCase):
    def test_key_clearly_longest_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'más larga'):
            app._build_choice_item(LONG, {'a'}, app.DISC_VERSION)
        # Moderately longer than the average but clearly the longest: only the new rule catches it.
        moderate = item('a', 'Se mantiene porque la razón entre pintura y solvente no cambia', ['Se diluye porque hay más solvente', 'Se concentra porque hay más pintura'])
        right, wrong = len(moderate['options'][0]['text']), [len(o['text']) for o in moderate['options'][1:]]
        self.assertLess(right, app.CHOICE_LENGTH_RATIO * sum(wrong) / len(wrong), 'la regla anterior no lo detectaba')
        with self.assertRaisesRegex(ValueError, 'claramente la más larga'):
            app._build_choice_item(moderate, {'a'}, app.DISC_VERSION)

    def test_balanced_options_pass_even_if_key_is_a_bit_longer(self):
        app._build_choice_item(FAIR, {'a'}, app.DISC_VERSION)
        app._build_choice_item(item('a', 'La razón se mantiene igual', ['Se diluye un poco', 'Se concentra más']), {'a'}, app.DISC_VERSION)

    def test_distractor_longer_than_key_passes(self):
        app._build_choice_item(item('a', 'Se mantiene igual', ['Se diluye porque hay más solvente en total', 'Se concentra']), {'a'}, app.DISC_VERSION)

    def test_short_numeric_options_never_flagged(self):
        app._build_choice_item(item('a', '1250 mL', ['5 mL', '75 mL']), {'a'}, app.DISC_VERSION)

    def test_prompt_rules_ask_for_balanced_distractors(self):
        self.assertIn('al menos una opción incorrecta debe ser tan larga y tan específica como la correcta', app.CHOICE_QUALITY_RULES)
        self.assertIn('la correcta no debe ser la única con unidades, cifras, condiciones o matices', app.CHOICE_QUALITY_RULES)


class Retry(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'b.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.prompts = []
        self.patches = [patch.object(app, 'memory', return_value=self.memory), patch.object(app, 'CONTENT_VERIFY', False)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def run_with(self, fn, data, replies):
        def fake(prompt, schema, max_tokens):
            self.prompts.append(prompt)
            return replies.pop(0)
        with patch.object(app, 'gemini', side_effect=fake):
            return fn(data)

    def placement(self, replies):
        return self.run_with(app.make_placement_items, {'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Proporciones', 'nodes': NODES, 'node_ids': ['a']}, replies)

    def disc(self, replies):
        return self.run_with(app.make_discrimination_items, {'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Proporciones', 'nodes': NODES}, replies)

    def test_placement_contract_failure_retries_with_reason(self):
        out = self.placement([{'items': [LONG]}, {'items': [FAIR]}])
        self.assertEqual(len(out['items']), 1)
        self.assertEqual(len(self.prompts), 2)
        self.assertNotIn('Corrección', self.prompts[0])
        self.assertIn('Corrección', self.prompts[1])
        self.assertIn('más larga', self.prompts[1])

    def test_placement_contract_failure_twice_raises(self):
        with self.assertRaisesRegex(ValueError, 'cumplió el contrato'):
            self.placement([{'items': [LONG]}, {'items': [LONG]}])
        self.assertEqual(len(self.prompts), 2, 'una sola regeneración')

    def test_discrimination_retries_once_then_succeeds(self):
        out = self.disc([{'items': [LONG, FAIR_B]}, {'items': [FAIR, FAIR_B]}])
        self.assertEqual(len(out['items']), 2)
        self.assertIn('más larga', self.prompts[1])

    def test_discrimination_fails_twice(self):
        with self.assertRaisesRegex(ValueError, 'no cumplió el contrato'):
            self.disc([{'items': [LONG, FAIR_B]}, {'items': [LONG, FAIR_B]}])
        self.assertEqual(len(self.prompts), 2)

    def test_good_first_answer_makes_one_call(self):
        self.disc([{'items': [FAIR, FAIR_B]}])
        self.assertEqual(len(self.prompts), 1)


if __name__ == '__main__':
    unittest.main()
