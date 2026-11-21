"""worked_examples_v1 (L4b, backend): ejemplo resuelto con gemelos, porqués y huecos calificados sin modelo.

Proveedor controlado: gemini y audit_content se parchean; no hay llamadas reales.
"""
import hashlib
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
WEX = 'worked_examples_v1'
PROCESS = ['Identificar la masa aplicada en el enunciado', 'Identificar el área que recibe la masa', 'Dividir la masa aplicada entre el área', 'Expresar el resultado en gramos por metro cuadrado']


def opts(right, wrong_a, wrong_b):
    return [{'id': 'a', 'text': right}, {'id': 'b', 'text': wrong_a, 'misconception': 'Divide la masa entre el tiempo'}, {'id': 'c', 'text': wrong_b, 'misconception': 'Resta la densidad del material'}]


def why(i):
    return {'options': opts('Conserva la masa total del material aplicado', 'Divide la masa entre el tiempo empleado', 'Resta la densidad del material'), 'correct_option_id': 'a', 'explanation': f'Porque el paso {i} conserva la masa que se reparte.'}


def check(step_text):
    return {'prompt': '¿Qué operación completa el procedimiento en este punto?', 'options': opts(step_text, 'Multiplicar la altura por el ancho del marco', 'Sumar el peso del soporte metálico'), 'correct_option_id': 'a', 'explanation': 'Porque ese paso completa el cálculo.'}


def procedure_raw(twin_prompts=None, twin_extra=None):
    worked_steps = [{'text': PROCESS[0], 'why': why(1)}, {'text': PROCESS[1]}, {'text': PROCESS[2], 'why': why(3)}, {'text': PROCESS[3]}]
    prompts = twin_prompts or ['Se aplican 300 g sobre 5 m². ¿Qué masa por área resulta?', 'Se aplican 90 g sobre 3 m². ¿Qué masa por área resulta?', 'Se aplican 84 g sobre 4 m². ¿Qué masa por área resulta?']
    twins = []
    for k, prompt in enumerate(prompts):
        steps = [{'text': PROCESS[0], 'blank': False}, {'text': PROCESS[1], 'blank': False}, {'text': PROCESS[2], 'blank': True, 'check': check(PROCESS[2])}, {'text': PROCESS[3], 'blank': True, 'check': check(PROCESS[3])}]
        twins.append({'prompt': prompt, 'steps': steps})
    raw = {'kind': 'procedure', 'worked': {'prompt': 'Se aplican 120 g sobre 2 m². ¿Qué masa por área resulta?', 'steps': worked_steps}, 'twins': twins}
    if twin_extra:
        twin_extra(raw)
    return raw


def numeric_raw():
    texts = [['Identificar la masa: 300 g.', 'Identificar el área: 5 m².', 'Dividir la masa entre el área.', 'Interpretar el resultado.'],
             ['Identificar la masa: 90 g.', 'Identificar el área: 3 m².', 'Dividir la masa entre el área.', 'Interpretar el resultado.'],
             ['Identificar la masa: 84 g.', 'Identificar el área: 4 m².', 'Dividir la masa entre el área.', 'Interpretar el resultado.']]
    values = [60, 30, 21]
    prompts = ['Se aplican 300 g sobre 5 m². ¿Qué masa por área resulta?', 'Se aplican 90 g sobre 3 m². ¿Qué masa por área resulta?', 'Se aplican 84 g sobre 4 m². ¿Qué masa por área resulta?']
    twins = []
    for k in range(3):
        steps = []
        for j, t in enumerate(texts[k]):
            if j >= 2:
                steps.append({'text': t, 'blank': True, 'value': values[k], 'unit': 'g/m²', 'ask': '¿Cuál es la masa por área?'})
            else:
                steps.append({'text': t, 'blank': False})
        twins.append({'prompt': prompts[k], 'steps': steps})
    worked = {'prompt': 'Se aplican 120 g sobre 2 m². ¿Qué masa por área resulta?', 'steps': [{'text': 'Identificar la masa: 120 g.', 'why': why(1)}, {'text': 'Identificar el área: 2 m².'}, {'text': 'Dividir la masa entre el área: 60 g/m².', 'why': why(3)}, {'text': 'Interpretar el resultado con su unidad.'}]}
    return {'kind': 'numeric', 'worked': worked, 'twins': twins}


def goal_store():
    nodes = [{'id': 'n1', 'name': 'Masa por área', 'outcome': 'o', 'level': 0, 'kind': 'concept', 'prerequisites': [], 'probe': None}]
    return {'id': 'g1', 'goal': 'Pintura en polvo', 'nodes': nodes, 'coverage': [], 'learner': {}, 'lessons': {}, 'reviews': [], 'events': [],
            'session': {'mode': 'DIAGNOSTIC', 'node': None, 'stack': [], 'stage': 'teach', 'tries': 0}, 'repairEpisodes': [], 'contextStack': [], 'map_updates': []}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'w.sqlite'
        self.mem = DurableMemory(self.path)
        self.old = (app._MEMORY, app._TEST_MEMORY)
        app.set_memory_for_tests(self.mem)
        self.pid = self.mem.create_profile('Prueba')['profile_id']
        self.other = self.mem.create_profile('Otra')['profile_id']
        self.mem.save(self.pid, {'goals': [goal_store()], 'active': 'g1'})

    def tearDown(self):
        app._MEMORY, app._TEST_MEMORY = self.old
        self.tmp.cleanup()

    def data(self, **over):
        base = {'profile_id': self.pid, 'goal_id': 'g1', 'node_id': 'n1', 'goal': 'Pintura en polvo', 'name': 'Masa por área', 'explanation': 'e', 'example': 'x', 'avoid': []}
        base.update(over)
        return base

    def make(self, raw, audit=CLEAN, **over):
        with patch.object(app, 'gemini', return_value=raw) as g, patch.object(app, 'audit_content', return_value=audit):
            try:
                return app.make_worked_set(self.data(**over))
            finally:
                self.calls = g.call_count

    def rows(self):
        db = sqlite3.connect(str(self.path))
        try:
            return db.execute('SELECT COUNT(*) FROM placement_items').fetchone()[0]
        finally:
            db.close()

    def stored(self, item_id, profile=None):
        return self.mem.load_placement_item(profile or self.pid, item_id)

    def open(self, set_id, index, rung, profile=None, goal='g1'):
        return app.open_worked_blank_set({'profile_id': profile or self.pid, 'goal_id': goal, 'set_id': set_id, 'index': index, 'rung': rung})


class Public(Base):
    def test_public_set_hides_values_twin_steps_and_keys(self):
        out = self.make(numeric_raw())
        self.assertEqual(out['schema_version'], WEX)
        self.assertEqual([t['index'] for t in out['twins']], [0, 1, 2])
        self.assertEqual(set(out['twins'][0]), {'index', 'prompt'})
        text = json.dumps(out, ensure_ascii=False)
        self.assertNotIn('correct_option_id', text)
        self.assertNotIn('"value"', text)
        self.assertNotIn('Porque el paso', text, 'la explicación del porqué es privada hasta que se responde')
        self.assertTrue(all(w['item_id'].startswith('wex-') for w in [x['why'] for x in out['worked']['steps'] if x.get('why')]))
        self.assertEqual(sum(1 for x in out['worked']['steps'] if x.get('why')), 2)

    def test_procedure_set_saves_twin_checks_only_privately(self):
        out = self.make(procedure_raw())
        self.assertEqual(self.rows(), 2 + 1, 'dos porqués y el conjunto; los gemelos no se guardan como filas públicas')
        stored = self.stored(out['set_id'])
        self.assertEqual(stored['public']['wex_role'], 'set')
        self.assertNotIn('steps', out['twins'][0])


class Rejections(Base):
    def test_bad_contracts_retry_once_and_save_nothing(self):
        def bad_twin_count(raw): raw['twins'] = raw['twins'][:2]
        def bad_why_count(raw):
            for s in raw['worked']['steps']: s.pop('why', None)
        def value_in_prompt(raw):
            raw['twins'][0]['prompt'] = 'Se aplican 60 g sobre 5 m². ¿Qué masa por área resulta?'
        def distractor_no_misconception(raw): del raw['worked']['steps'][0]['why']['options'][1]['misconception']
        def repeated_prompt(raw): raw['twins'][1]['prompt'] = raw['twins'][0]['prompt']
        cases = [bad_twin_count, bad_why_count, distractor_no_misconception, repeated_prompt]
        for case in cases:
            raw = procedure_raw()
            case(raw)
            with self.subTest(case=case.__name__):
                before = self.rows()
                with self.assertRaises(ValueError):
                    self.make(raw)
                self.assertEqual(self.calls, 2, 'un reintento con motivo, y después error')
                self.assertEqual(self.rows(), before, 'nada parcial')
        raw = numeric_raw()
        value_in_prompt(raw)
        with self.subTest(case='value_in_prompt'):
            before = self.rows()
            with self.assertRaises(ValueError):
                self.make(raw)
            self.assertEqual(self.rows(), before)
            with self.subTest(case=case.__name__):
                before = self.rows()
                with self.assertRaises(ValueError):
                    self.make(raw)
                self.assertEqual(self.calls, 2, 'un reintento con motivo, y después error')
                self.assertEqual(self.rows(), before, 'nada parcial')

    def test_twin_too_close_to_lesson_prompt_is_rejected(self):
        raw = procedure_raw()
        with self.assertRaises(ValueError):
            self.make(raw, avoid=['Se aplican 300 g sobre 5 m². ¿Qué masa por área resulta?'])
        self.assertEqual(self.rows(), 0)

    def test_audit_issue_retries_and_saves_nothing(self):
        with patch.object(app, 'gemini', return_value=procedure_raw()) as g, patch.object(app, 'audit_content', return_value={'issues': ['demasiado vago'], 'checked': True}):
            with self.assertRaises(ValueError):
                app.make_worked_set(self.data())
        self.assertEqual(g.call_count, 2)
        self.assertEqual(self.rows(), 0)


class Consolidate(Base):
    def test_consolidate_is_not_needed_without_model_unless_requested(self):
        adaptation = ('consolidate', 'razón', 1)
        with patch.object(app, 'lesson_adaptation', return_value=adaptation), patch.object(app, 'gemini', side_effect=AssertionError('no debe llamar al modelo')) as g:
            out = app.make_worked_set(self.data())
        self.assertEqual(out['code'], 'WORKED_NOT_NEEDED')
        self.assertEqual(g.call_count, 0)
        with patch.object(app, 'lesson_adaptation', return_value=adaptation), patch.object(app, 'gemini', return_value=procedure_raw()) as g, patch.object(app, 'audit_content', return_value=CLEAN):
            out = app.make_worked_set(self.data(learner_requested=True))
        self.assertEqual(g.call_count, 1)
        self.assertEqual(out['schema_version'], WEX)


class Openings(Base):
    def setUp(self):
        super().setUp()
        self.set_id = self.make(procedure_raw())['set_id']

    def test_opening_is_unique_per_twin(self):
        first = self.open(self.set_id, 0, 1)
        second = self.open(self.set_id, 0, 2)
        self.assertEqual(second['rung'], 1, 'otro peldaño devuelve la apertura original')
        self.assertEqual(first['blanks'][0]['item_id'], second['blanks'][0]['item_id'])
        self.assertEqual(first['steps'][-1]['blank'], True)

    def test_other_profile_goal_and_index_are_rejected(self):
        with self.assertRaises(ValueError):
            self.open(self.set_id, 0, 1, profile=self.other)
        with self.assertRaises(ValueError):
            self.open(self.set_id, 0, 1, goal='otra')
        with self.assertRaises(ValueError):
            self.open(self.set_id, 9, 1)
        with self.assertRaises(ValueError):
            self.open(self.set_id, 0, 4)

    def test_integrity_error_rereads_saved_opening(self):
        saved = self.open(self.set_id, 1, 1)
        real = self.mem.load_placement_item
        calls = {'n': 0}
        def late_load(profile_id, item_id):
            if not str(item_id).startswith('wexo-'):
                return real(profile_id, item_id)
            calls['n'] += 1
            return None if calls['n'] == 1 else real(profile_id, item_id)
        with patch.object(app, 'memory', return_value=self.mem), patch.object(self.mem, 'load_placement_item', side_effect=late_load), patch.object(self.mem, 'save_placement_items', side_effect=sqlite3.IntegrityError('dup')):
            again = self.open(self.set_id, 1, 2)
        self.assertEqual(again['rung'], saved['rung'])


class Answers(Base):
    def setUp(self):
        super().setUp()
        self.set_id = self.make(numeric_raw())['set_id']

    def blank(self, index, rung):
        return self.open(self.set_id, index, rung)['blanks']

    def test_numeric_tolerance_units_and_unknown(self):
        # Cada caso es un hueco distinto: la primera respuesta de un ítem es la que cuenta.
        ok_blank, units_blank, arith_blank = self.blank(0, 1)[0], self.blank(1, 1)[0], self.blank(2, 1)[0]
        self.assertNotIn('value', ok_blank)
        ok = app.answer_worked_item({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': ok_blank['item_id'], 'attempt_id': 'a1', 'value': 60.5, 'unit': 'g/m²', 'learner_confidence': 80})
        units = app.answer_worked_item({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': units_blank['item_id'], 'attempt_id': 'a2', 'value': 30, 'unit': 'kg'})
        arith = app.answer_worked_item({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': arith_blank['item_id'], 'attempt_id': 'a3', 'value': 99, 'unit': 'g/m²'})
        other_set = self.make(numeric_raw(), node='n1')['set_id']
        none_blank = self.open(other_set, 0, 1)['blanks'][0]
        none = app.answer_worked_item({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': none_blank['item_id'], 'attempt_id': 'a4'})
        self.assertEqual((ok['status'], units['status'], arith['status'], none['status']), ('CORRECT', 'MISCONCEPTION', 'MISCONCEPTION', 'UNKNOWN'))
        self.assertEqual((units['error_type'], arith['error_type']), ('units', 'arithmetic'))
        self.assertEqual(ok['evaluator_version'], 'worked-local-v1')
        self.assertNotIn('local-production', ok['evaluator_version'])

    def test_first_answer_per_item_and_idempotence(self):
        blank = self.blank(0, 1)[0]
        base = {'profile_id': self.pid, 'goal_id': 'g1', 'item_id': blank['item_id']}
        first = app.answer_worked_item({**base, 'attempt_id': 'x1', 'value': 60, 'unit': 'g/m²'})
        same = app.answer_worked_item({**base, 'attempt_id': 'x1', 'value': 60, 'unit': 'g/m²'})
        second = app.answer_worked_item({**base, 'attempt_id': 'x2', 'value': 1, 'unit': 'g/m²'})
        self.assertEqual(first, same)
        self.assertTrue(second.get('already_answered'))
        self.assertEqual(second['status'], first['status'])
        with self.assertRaises(ValueError):
            app.answer_worked_item({**base, 'attempt_id': 'x1', 'value': 1, 'unit': 'g/m²'})

    def test_rejects_other_routes_and_profiles(self):
        blank = self.blank(0, 1)[0]
        with self.assertRaises(ValueError):
            app.answer_production_item({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': blank['item_id'], 'attempt_id': 'p1', 'value': 60, 'unit': 'g/m²'})
        with self.assertRaises(ValueError):
            app.answer_faded_item({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': blank['item_id'], 'attempt_id': 'f1', 'selected_option_id': 'a'})
        with self.assertRaises(ValueError):
            app.answer_worked_item({'profile_id': self.other, 'goal_id': 'g1', 'item_id': blank['item_id'], 'attempt_id': 'o1', 'value': 60, 'unit': 'g/m²'})

    def test_shown_rule_uses_numeric_boundaries(self):
        self.assertFalse(app._number_shown(60, ['Se aplican 1600 g sobre 5 m².']), '1600 no es el valor 60')
        self.assertTrue(app._number_shown(60, ['Se aplican 60 g sobre 5 m².']))


class Ordering(Base):
    def test_procedure_problem_solo_orders_steps(self):
        out = self.make(procedure_raw())
        view = self.open(out['set_id'], 0, 3)
        self.assertEqual(view['steps'], [], 'el problema solo no muestra pasos')
        blank = view['blanks'][0]
        self.assertEqual(blank['blank_kind'], 'ordering')
        ids = [s['id'] for s in blank['steps']]
        self.assertEqual(len(ids), 4)
        private_order = self.stored(blank['item_id'])['private']['order']
        ok = app.answer_worked_item({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': blank['item_id'], 'attempt_id': 'o1', 'order': private_order})
        self.assertEqual(ok['status'], 'CORRECT')
        self.assertEqual(ok['evaluator_version'], 'worked-local-v1')


class Why(Base):
    def setUp(self):
        super().setUp()
        self.out = self.make(procedure_raw())
        self.why_id = next(x['why']['item_id'] for x in self.out['worked']['steps'] if x.get('why'))

    def test_open_why_saves_before_revealing_and_never_calls_model(self):
        with patch.object(app, 'gemini', side_effect=AssertionError('no modelo')) as g:
            with self.assertRaises(ValueError):
                app.answer_worked_why_open({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': self.why_id, 'attempt_id': 'w0', 'text': '   '})
            ref = app.answer_worked_why_open({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': self.why_id, 'attempt_id': 'w1', 'text': 'Porque se reparte la masa.'})
        self.assertEqual(g.call_count, 0)
        self.assertIn('explanation', ref)
        self.assertEqual(ref['evaluator_version'], 'worked-local-v1')

    def test_menu_why_uses_key_and_rejects_non_why_items(self):
        key = self.stored(self.why_id)['private']['correct_option_id']
        ok = app.answer_worked_why({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': self.why_id, 'attempt_id': 'm1', 'selected_option_id': key})
        self.assertEqual(ok['status'], 'CORRECT')
        with self.assertRaises(ValueError):
            app.answer_worked_why({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': self.out['set_id'], 'attempt_id': 'm2', 'selected_option_id': 'a'})


class TransferCorpus(Base):
    def test_worked_prompts_join_the_near_distance_corpus(self):
        goal = {'lessons': {'n1': {'worked': {'schema_version': WEX, 'worked': {'prompt': 'Enunciado resuelto único'}, 'twins': [{'index': 0, 'prompt': 'Gemelo único'}]},
                                   'faded': {'schema_version': 'faded_examples_v1', 'worked': {'prompt': 'Antiguo resuelto único'}, 'faded': {'prompt': 'Antiguo con huecos único'}}}},
                'events': []}
        texts, _examples = app._transfer_near_texts(goal, {'id': 'n1', 'name': 'Masa'}, [])
        for needle in ('Enunciado resuelto único', 'Gemelo único', 'Antiguo resuelto único', 'Antiguo con huecos único'):
            self.assertIn(needle, texts)


class Store(Base):
    def test_validate_store_forces_no_evidence_and_trims_text(self):
        goal = goal_store()
        goal['events'] = [{'type': 'WORKED_WHY', 'node_id': 'n1', 'set_id': 'wexs-x', 'item_id': 'wex-1', 'mode': 'open', 'status': None, 'self_match': 'si', 'text': 'x' * 900, 'creates_evidence': True, 'at': 1},
                          {'type': 'WORKED_LADDER_END', 'node_id': 'n1', 'set_id': 'wexs-x', 'reason': 'exhausted', 'final_rung': 1, 'creates_evidence': True, 'at': 2}]
        self.mem.save(self.pid, {'goals': [goal], 'active': 'g1'})
        events = self.mem.load(self.pid)['store']['goals'][0]['events']
        why = next(e for e in events if e['type'] == 'WORKED_WHY')
        end = next(e for e in events if e['type'] == 'WORKED_LADDER_END')
        self.assertEqual((why['creates_evidence'], end['creates_evidence']), (False, False))
        self.assertLessEqual(len(why['text']), 600)


if __name__ == '__main__':
    unittest.main()
