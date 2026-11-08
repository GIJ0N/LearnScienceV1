"""Quality gate for model-written multiple-choice items: cues that let a test-wise learner pass without the idea."""
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app


def item(options, prompt='Un barco pasa del río al mar: ¿qué ocurre?', key='a'):
    opts = [{'id': chr(97 + i), 'text': t, 'misconception': '' if chr(97 + i) == key else f'Idea errónea {i}.'} for i, t in enumerate(options)]
    return {'node_id': 'n1', 'prompt': prompt, 'correct_option_id': key, 'explanation': 'Porque sí.', 'options': opts}


def build(raw):
    return app._build_choice_item(raw, {'n1'}, app.PLACEMENT_VERSION)


class Gate(unittest.TestCase):
    def rejects(self, raw, fragment):
        with self.assertRaises(ValueError) as ctx:
            build(raw)
        self.assertIn('calidad', str(ctx.exception))
        self.assertIn(fragment, str(ctx.exception))

    def test_good_item_passes(self):
        public, private = build(item(['Flota más alto', 'Flota igual', 'Se hunde']))
        self.assertEqual(len(public['options']), 3)

    def test_duplicate_options_rejected_even_with_different_punctuation(self):
        self.rejects(item(['Flota más alto.', 'flota mas alto', 'Se hunde']), 'repetidas')

    def test_all_or_none_of_the_above_rejected(self):
        self.rejects(item(['Flota más alto', 'Se hunde', 'Ninguna de las anteriores']), 'todas/ninguna')
        self.rejects(item(['Flota más alto', 'Se hunde', 'Todas las opciones son correctas']), 'todas/ninguna')
        self.rejects(item(['Flota más alto', 'Se hunde', 'a y b']), 'todas/ninguna')

    def test_variable_names_in_options_are_not_confused_with_combinations(self):
        build(item(['Si a y b son positivos, el producto es positivo', 'Si a y b son positivos, el producto es negativo', 'No se puede saber sin conocer a ni b']))

    def test_much_longer_correct_option_rejected_but_moderately_longer_allowed(self):
        long_right = 'Flota más alto porque el agua de mar es más densa y el empuje aumenta con la densidad'
        self.rejects(item([long_right, 'Flota igual', 'Se hunde un poco']), 'más larga')
        build(item(['Flota más alto porque la densidad sube', 'Flota igual porque su peso no cambia', 'Se hunde más porque el agua salada pesa']))

    def test_correct_option_clearly_longest_rejected(self):
        self.rejects(item(['Flota más alto porque la densidad sube', 'Flota igual que en el río', 'Se hunde un poco más abajo']), 'más larga')
        build(item(['Flota más alto porque sube la densidad', 'Flota igual porque su peso no cambia', 'Se hunde']), )

    def test_short_options_are_never_flagged_by_length(self):
        build(item(['75', '3', '150']))

    def test_prompt_that_contains_the_answer_rejected(self):
        self.rejects(item(['Flota más alto', 'Se hunde', 'Igual'], prompt='Si el barco flota más alto en el mar, ¿qué ocurre?'), 'enunciado')

    def test_gate_applies_to_every_choice_version(self):
        for version in (app.PLACEMENT_VERSION, app.STEP_VERSION, app.DISC_VERSION, app.COMP_VERSION):
            with self.subTest(version=version):
                with self.assertRaises(ValueError):
                    app._build_choice_item(item(['Sí', 'No', 'Todas las anteriores']), {'n1'}, version)

    def test_generating_prompts_carry_the_shared_rules(self):
        from unittest.mock import patch
        seen = []
        def spy(prompt, schema, max_tokens):
            seen.append(prompt)
            raise ValueError('stop')
        nodes = [{'id': 'a', 'name': 'A', 'outcome': 'o', 'prerequisites': []}, {'id': 'b', 'name': 'B', 'outcome': 'o', 'prerequisites': []}]
        with patch.object(app, 'gemini', side_effect=spy):
            for fn, data in ((app.make_placement_items, {'profile_id': 'p', 'goal_id': 'g', 'goal': 'x', 'nodes': nodes, 'node_ids': ['a']}),
                             (app.make_discrimination_items, {'profile_id': 'p', 'goal_id': 'g', 'goal': 'x', 'nodes': nodes}),
                             (app.make_lesson_steps, {'profile_id': 'p', 'goal_id': 'g', 'node_id': 'a', 'goal': 'x', 'name': 'A'})):
                with self.assertRaises(ValueError):
                    fn(data)
        self.assertEqual(len(seen), 3)
        for prompt in seen:
            self.assertIn(app.CHOICE_QUALITY_RULES, prompt)


if __name__ == '__main__':
    unittest.main()
