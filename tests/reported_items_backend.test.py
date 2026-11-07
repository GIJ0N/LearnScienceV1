"""reported_items_v1: una pregunta de diagnóstico reportada se excluye en el servidor sin tocar la evidencia previa."""
import contextlib
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory

NODES = [{'id': 'a', 'name': 'Fracciones', 'outcome': 'Operar', 'prerequisites': []},
         {'id': 'b', 'name': 'Proporciones', 'outcome': 'Resolver', 'prerequisites': ['a']}]
PROMPT = 'Si 2 kg cuestan 30, ¿cuánto cuestan 5 kg?'


def item(node_id='b', prompt=PROMPT):
    return {'node_id': node_id, 'prompt': prompt, 'correct_option_id': 'a', 'explanation': 'Precio por kg 15; 5 × 15 = 75.',
            'options': [{'id': 'a', 'text': '75', 'misconception': ''},
                        {'id': 'b', 'text': '33', 'misconception': 'Suma la diferencia en lugar de escalar.'},
                        {'id': 'c', 'text': '150', 'misconception': 'Multiplica sin dividir por el tamaño de la base.'}]}


class ReportedItems(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'r.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.other = self.memory.create_profile('Otro')['profile_id']
        self.patches = [patch.object(app, 'memory', return_value=self.memory), patch.object(app, 'CONTENT_VERIFY', False)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def generate(self, items, goal_id='g1', profile=None):
        calls = []
        def fake(prompt, schema, max_tokens):
            calls.append(prompt)
            return {'items': items}
        with patch.object(app, 'gemini', side_effect=fake):
            out = app.make_placement_items({'profile_id': profile or self.profile, 'goal_id': goal_id, 'goal': 'Aritmética', 'nodes': NODES, 'node_ids': ['a', 'b']})
        return out, calls

    def answer(self, item_id, attempt, selected=None, goal_id='g1'):
        if selected is None:  # los ids de opción se reordenan al azar: elegimos la clave guardada
            selected = self.memory.load_placement_item(self.profile, item_id)['private']['correct_option_id']
        return app.answer_placement_item({'profile_id': self.profile, 'goal_id': goal_id, 'item_id': item_id, 'attempt_id': attempt, 'selected_option_id': selected})

    def report(self, item_id, kind='placement', goal_id='g1', note='Está mal'):
        return app.report_content({'profile_id': self.profile, 'goal_id': goal_id, 'node_id': 'b', 'kind': kind, 'item_id': item_id, 'excerpt': PROMPT, 'note': note})

    def one_item(self):
        out, _ = self.generate([item()])
        return out['items'][0]['item_id']

    def test_reported_placement_item_cannot_be_answered_any_more(self):
        item_id = self.one_item()
        self.assertEqual(self.report(item_id), {'saved': True, 'excluded': True})
        self.assertTrue(self.memory.is_item_excluded(self.profile, item_id))
        with self.assertRaisesRegex(ValueError, 'ITEM_EXCLUDED'):
            self.answer(item_id, 'nuevo')

    def test_an_attempt_registered_before_the_report_can_still_be_repeated(self):
        item_id = self.one_item()
        first = self.answer(item_id, 'antes')
        self.report(item_id)
        self.assertEqual(self.answer(item_id, 'antes'), first, 'idempotencia: la evidencia previa no se retira')
        with self.assertRaisesRegex(ValueError, 'ITEM_EXCLUDED'):
            self.answer(item_id, 'otro-intento')

    def test_reporting_from_another_goal_or_with_another_kind_excludes_nothing(self):
        item_id = self.one_item()
        self.assertEqual(self.report(item_id, goal_id='otra-meta')['excluded'], False)
        self.assertEqual(self.report(item_id, kind='lesson')['excluded'], False)
        self.assertEqual(self.report(item_id, kind='question')['excluded'], False)
        self.assertFalse(self.memory.is_item_excluded(self.profile, item_id))
        self.assertEqual(self.answer(item_id, 'sigue')['status'], 'CORRECT')

    def test_unknown_or_foreign_item_ids_are_ignored(self):
        self.assertEqual(self.report('placement-inexistente')['excluded'], False)
        self.assertEqual(self.report('disc-abc')['excluded'], False)
        self.assertEqual(self.report('')['excluded'], False)

    def test_another_profile_is_not_affected(self):
        item_id = self.one_item()
        self.report(item_id)
        self.assertFalse(self.memory.is_item_excluded(self.other, item_id))

    def test_report_is_still_saved_as_content_report(self):
        item_id = self.one_item()
        self.report(item_id)
        saved = self.memory.load_content_reports(self.profile, 'g1')
        self.assertEqual([(r['kind'], r['excerpt']) for r in saved], [('placement', PROMPT)])

    def test_reported_prompt_is_added_to_the_ones_the_generator_must_avoid(self):
        item_id = self.one_item()
        self.report(item_id)
        _, calls = self.generate([item(prompt='Otra pregunta distinta sobre proporciones y precios.')])
        self.assertIn(PROMPT, calls[0])
        self.assertIn('No repitas estos enunciados', calls[0])

    def test_reports_of_other_kinds_do_not_feed_the_placement_avoid_list(self):
        self.report('x', kind='lesson')
        _, calls = self.generate([item()])
        self.assertNotIn('No repitas estos enunciados', calls[0])

    def test_deleting_the_profile_removes_the_exclusions(self):
        item_id = self.one_item()
        self.report(item_id)
        self.memory.delete_profile(self.profile)
        with contextlib.closing(sqlite3.connect(str(Path(self.tmp.name) / 'r.sqlite'))) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM excluded_items').fetchone()[0], 0)

    def test_exclude_item_is_idempotent_and_requires_an_existing_profile(self):
        self.assertTrue(self.memory.exclude_item(self.profile, 'placement-x'))
        self.assertTrue(self.memory.exclude_item(self.profile, 'placement-x'))
        with self.assertRaisesRegex(ValueError, 'perfil'):
            self.memory.exclude_item('perfil-que-no-existe', 'placement-x')
        with self.assertRaisesRegex(ValueError, 'excluir'):
            self.memory.exclude_item(self.profile, '')


if __name__ == '__main__':
    unittest.main()
