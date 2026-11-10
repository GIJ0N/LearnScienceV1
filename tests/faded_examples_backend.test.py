"""faded_examples_v1: ejemplo resuelto + ejemplo con huecos; los huecos son preguntas de clave privada y son formativos."""
import copy
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

CLEAN = {'issues': [], 'checked': True}


def check(prompt, right, wrongs):
    opts = [{'id': 'a', 'text': right}] + [{'id': 'bcd'[i], 'text': w, 'misconception': f'Confunde el paso {i}'} for i, w in enumerate(wrongs)]
    return {'prompt': prompt, 'options': opts, 'correct_option_id': 'a', 'explanation': 'Porque ese paso conserva el balance de masa.'}


def blank(text, n=1):
    return {'text': text, 'blank': True, 'check': check(f'¿Qué paso falta en este punto del procedimiento {n}?', f'Calcular la masa total aplicada {n}', [f'Dividir el área entre el tiempo {n}', f'Restar la densidad del volumen {n}', f'Multiplicar la altura por el color {n}'])}


def step(text):
    return {'text': text, 'blank': False}


def package(**over):
    base = {'worked': {'prompt': 'Se aplican 120 g sobre 2 m². ¿Qué masa por área resulta?', 'steps': ['Identificar la masa: 120 g, porque es el dato aplicado.', 'Identificar el área: 2 m², porque normaliza la masa.', 'Dividir masa entre área, porque la masa por área es esa razón.']},
            'faded': {'prompt': 'Se aplican 300 g sobre 5 m². ¿Qué masa por área resulta?', 'steps': [step('Identificar la masa: 300 g.'), blank('Identificar el área: 5 m²', 1), step('Dividir masa entre área.')]}}
    for k, v in over.items():
        base[k] = v
    return base


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'f.sqlite'
        self.mem = DurableMemory(self.path)
        self.old = (app._MEMORY, app._TEST_MEMORY)
        app.set_memory_for_tests(self.mem)
        self.pid = self.mem.create_profile('Prueba')['profile_id']
        self.other = self.mem.create_profile('Otra')['profile_id']

    def tearDown(self):
        app._MEMORY, app._TEST_MEMORY = self.old
        self.tmp.cleanup()

    def make(self, raw, audit=CLEAN, node='n1'):
        data = {'profile_id': self.pid, 'goal_id': 'g1', 'node_id': node, 'goal': 'Pintura', 'name': 'Masa por área', 'explanation': 'e', 'example': 'x'}
        with patch.object(app, 'gemini', return_value=raw) as g, patch.object(app, 'audit_content', return_value=audit):
            try:
                return app.make_faded_example(data)
            finally:
                self.calls = g.call_count

    def count(self):
        db = sqlite3.connect(str(self.path))
        try:
            return db.execute('SELECT COUNT(*) FROM placement_items').fetchone()[0]
        finally:
            db.close()


class Valid(Base):
    def test_valid_package_shape_and_prefix(self):
        out = self.make(package())
        self.assertEqual(out['schema_version'], 'faded_examples_v1')
        self.assertEqual(len(out['worked']['steps']), 3)
        steps = out['faded']['steps']
        self.assertEqual([bool(x.get('blank')) for x in steps], [False, True, False])
        item = steps[1]['check']
        self.assertTrue(item['item_id'].startswith('fade-'))
        self.assertNotIn('correct_option_id', json.dumps(out))
        self.assertNotIn('Porque ese paso', json.dumps(out))
        self.assertEqual(self.count(), 1)

    def test_two_blanks_are_allowed(self):
        raw = package()
        raw['faded']['steps'] = [blank('x', 1), step('Identificar el área.'), blank('y', 2)]
        out = self.make(raw)
        self.assertEqual(sum(1 for x in out['faded']['steps'] if x.get('blank')), 2)
        self.assertEqual(self.count(), 2)

    def test_blank_can_be_answered_with_private_key(self):
        out = self.make(package())
        item = out['faded']['steps'][1]['check']
        stored = self.mem.load_placement_item(self.pid, item['item_id'])
        key = stored['private']['correct_option_id']
        wrong = next(o['id'] for o in item['options'] if o['id'] != key)
        ok = app.answer_faded_item({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': 'a1', 'selected_option_id': key, 'learner_confidence': 80})
        bad = app.answer_faded_item({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': 'a2', 'selected_option_id': wrong})
        none = app.answer_faded_item({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': 'a3'})
        self.assertEqual((ok['status'], bad['status'], none['status']), ('CORRECT', 'MISCONCEPTION', 'UNKNOWN'))
        self.assertEqual(ok['schema_version'], 'faded_examples_v1')

    def test_routes(self):
        self.assertIs(app.ROUTES['/api/lesson/faded'], app.make_faded_example)
        self.assertIs(app.ROUTES['/api/lesson/faded/answer'], app.answer_faded_item)


class Rejections(Base):
    def reject(self, raw, **kw):
        with self.assertRaises(ValueError, msg=json.dumps(raw)[:80]):
            self.make(raw, **kw)
        self.assertEqual(self.count(), 0, 'no se guarda nada')

    def test_step_counts(self):
        w2 = package(); w2['worked']['steps'] = w2['worked']['steps'][:2]
        w6 = package(); w6['worked']['steps'] = w6['worked']['steps'] * 2
        f2 = package(); f2['faded']['steps'] = [step('uno'), blank('dos')]
        f6 = package(); f6['faded']['steps'] = [step('s')] * 5 + [blank('b')]
        for raw in (w2, w6, f2, f6):
            self.reject(raw)

    def test_blank_counts(self):
        none = package(); none['faded']['steps'] = [step('a'), step('b'), step('c')]
        three = package(); three['faded']['steps'] = [blank('a', 1), blank('b', 2), blank('c', 3)]
        for raw in (none, three):
            self.reject(raw)

    def test_blank_failing_quality_rejects_whole_package(self):
        raw = package()
        raw['faded']['steps'][1]['check']['options'][1]['text'] = raw['faded']['steps'][1]['check']['options'][0]['text']
        self.reject(raw)
        raw = package()
        raw['faded']['steps'][1]['check']['options'][2]['text'] = 'Todas las anteriores'
        self.reject(raw)
        raw = package()
        raw['faded']['steps'][1]['check']['options'][0]['text'] = 'Calcular la masa total aplicada, sumando cada una de las capas depositadas en la pieza y sus retoques'
        self.reject(raw)

    def test_blank_without_misconception_or_key_rejects(self):
        raw = package(); del raw['faded']['steps'][1]['check']['options'][1]['misconception']
        self.reject(raw)
        raw = package(); raw['faded']['steps'][1]['check']['correct_option_id'] = 'z'
        self.reject(raw)
        raw = package(); raw['faded']['steps'][1].pop('check')
        self.reject(raw)

    def test_same_prompts_rejected(self):
        raw = package(); raw['faded']['prompt'] = raw['worked']['prompt'].upper() + '!'
        self.reject(raw)

    def test_empty_step_rejected(self):
        raw = package(); raw['worked']['steps'][0] = '  '
        self.reject(raw)
        raw = package(); raw['faded']['steps'][0] = step('')
        self.reject(raw)

    def test_malformed_output(self):
        for raw in (None, [], {'worked': {}}, {'worked': {'prompt': 'a', 'steps': []}, 'faded': 5}):
            self.reject(raw)

    def test_audit_issue_twice_errors_without_saving(self):
        self.reject(package(), audit={'issues': ['El paso 2 es incorrecto'], 'checked': True})
        self.assertEqual(self.calls, 2)

    def test_validation_failure_retries_once_with_reason(self):
        bad = package(); bad['worked']['steps'] = bad['worked']['steps'][:2]
        prompts = []

        def fake(prompt, *a, **k):
            prompts.append(prompt)
            return bad if len(prompts) == 1 else package()
        with patch.object(app, 'gemini', side_effect=fake), patch.object(app, 'audit_content', return_value=CLEAN):
            out = app.make_faded_example({'profile_id': self.pid, 'goal_id': 'g1', 'node_id': 'n1', 'goal': 'M', 'name': 'N'})
        self.assertIn('de 3 a 5 pasos', prompts[1])
        self.assertEqual(out['schema_version'], 'faded_examples_v1')

    def test_missing_identity(self):
        with self.assertRaises(ValueError):
            app.make_faded_example({'profile_id': self.pid, 'goal_id': 'g1', 'goal': 'M', 'name': 'N'})


class Isolation(Base):
    def test_fade_item_not_answerable_as_placement_and_vice_versa(self):
        item = self.make(package())['faded']['steps'][1]['check']
        base = {'profile_id': self.pid, 'goal_id': 'g1', 'attempt_id': 'x', 'selected_option_id': 'a'}
        with self.assertRaises(ValueError):
            app.answer_placement_item({**base, 'item_id': item['item_id']})
        with self.assertRaises(ValueError):
            app._answer_choice_item({**base, 'item_id': item['item_id']}, app.DISC_VERSION)
        placement = {'schema_version': app.PLACEMENT_VERSION, 'item_id': 'placement-abc', 'node_id': 'n1', 'prompt': 'p', 'options': [{'id': 'a', 'text': 'x'}, {'id': 'b', 'text': 'y'}, {'id': 'c', 'text': 'z'}]}
        self.mem.save_placement_items(self.pid, 'g1', [(placement, {'correct_option_id': 'a', 'explanation': 'e', 'misconceptions': {}})])
        with self.assertRaises(ValueError):
            app.answer_faded_item({**base, 'item_id': 'placement-abc'})

    def test_other_goal_or_profile_rejected(self):
        item = self.make(package())['faded']['steps'][1]['check']
        base = {'item_id': item['item_id'], 'attempt_id': 'y', 'selected_option_id': 'a'}
        with self.assertRaises(ValueError):
            app.answer_faded_item({**base, 'profile_id': self.pid, 'goal_id': 'otra'})
        with self.assertRaises(ValueError):
            app.answer_faded_item({**base, 'profile_id': self.other, 'goal_id': 'g1'})


if __name__ == '__main__':
    unittest.main()
