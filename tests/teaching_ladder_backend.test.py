"""teaching_ladder_v1 (servidor): peldaño 2 con `avoid`, peldaño 3 con respuesta comentada y reconocimiento local de «no sé»."""
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
QUESTION = {'prompt': '¿Por qué conviene medir el espesor de película en micras?', 'reference': 'Porque el espesor controla la cobertura, el curado y la adherencia del recubrimiento', 'kind': 'conceptual'}
FIRST = 'El espesor es la altura de la capa de polvo ya curado sobre la pieza, medida en micras.'
OTHER = 'Piensa en una capa de pintura como una cobija: más gruesa abriga más y tarda más en calentarse por dentro.'


def check(prompt='¿Qué controla principalmente el espesor de la película aplicada?'):
    return {'prompt': prompt, 'options': [
        {'id': 'a', 'text': 'La cobertura y el curado del recubrimiento'},
        {'id': 'b', 'text': 'El color final de la pieza', 'misconception': 'Confunde espesor con tono'},
        {'id': 'c', 'text': 'La carga eléctrica de la pistola', 'misconception': 'Confunde espesor con voltaje'}],
        'correct_option_id': 'a', 'explanation': 'El espesor define cuánto polvo cura y cubre la pieza.'}


def package(first=OTHER, **over):
    base = {'needs': ['Qué es el espesor de película', 'Por qué cambia el curado'],
            'steps': [{'body': first}, {'body': 'Una capa más gruesa tarda más en curar, porque el calor debe atravesar más material.'}],
            'worked': {'prompt': 'Dos cobijas, una doble. ¿Cuál tarda más en calentarse por dentro?',
                       'steps': ['Comparar grosores: la doble es el doble.', 'El calor atraviesa el doble de material.', 'Entonces la doble tarda más.']},
            'check': check()}
    base.update(over)
    return base


def commented(**over):
    base = {'model_answer': 'Porque el espesor en micras controla la cobertura, el curado y la adherencia de la capa.',
            'why': ['La cobertura depende de cuánto polvo queda sobre la pieza, y eso se mide en micras.',
                    'Una capa más gruesa tarda más en curar, así que el espesor define el tiempo de horno.',
                    'Una capa fuera de rango pierde adherencia, por eso se controla con un medidor.']}
    base.update(over)
    return base


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'l.sqlite'
        self.mem = DurableMemory(self.path)
        self.old = (app._MEMORY, app._TEST_MEMORY)
        app.set_memory_for_tests(self.mem)
        self.pid = self.mem.create_profile('Prueba')['profile_id']
        self.prompts = []

    def tearDown(self):
        app._MEMORY, app._TEST_MEMORY = self.old
        self.tmp.cleanup()

    def data(self, **extra):
        return {'profile_id': self.pid, 'goal_id': 'g1', 'node_id': 'n1', 'goal': 'Pintura en polvo', 'name': 'Espesor', 'question': QUESTION, **extra}

    def run_with(self, raws, audits=None, **extra):
        raws = iter(raws if isinstance(raws, list) else [raws])
        audits = iter(audits) if audits else None

        def fake(prompt, *a, **k):
            self.prompts.append(prompt)
            return next(raws)
        with patch.object(app, 'gemini', side_effect=fake), patch.object(app, 'audit_content', side_effect=(lambda *a, **k: next(audits)) if audits else (lambda *a, **k: CLEAN)):
            return app.make_direct_teaching(self.data(**extra))

    def count(self):
        db = sqlite3.connect(str(self.path))
        try:
            return db.execute('SELECT COUNT(*) FROM placement_items').fetchone()[0]
        finally:
            db.close()


class Rung2(Base):
    def test_valid_rung2_with_avoid(self):
        out = self.run_with(package(), rung=2, avoid=[FIRST], misconception='Cree que el espesor es el color')
        self.assertEqual(out['rung'], 2)
        self.assertEqual(out['schema_version'], 'direct_teaching_v1')
        self.assertTrue(out['check']['item_id'].startswith('direct-'))
        self.assertEqual(self.count(), 1)
        self.assertNotIn('correct_option_id', json.dumps(out))
        self.assertEqual(len(self.prompts), 1)
        p = self.prompts[0]
        self.assertIn('OTRA forma', p)
        self.assertIn('<<<' + FIRST + '>>>', p)
        self.assertIn('<<<Cree que el espesor es el color>>>', p)

    def test_repeated_step_rejected_and_retried_once(self):
        shouting = FIRST.upper().replace('.', '!')  # mismo cuerpo normalizado
        out = self.run_with([package(first=shouting), package()], rung=2, avoid=[FIRST])
        self.assertEqual(len(self.prompts), 2)
        self.assertIn('repite una explicación', self.prompts[1])
        self.assertEqual(out['rung'], 2)
        self.assertEqual(self.count(), 1)

    def test_repeated_step_twice_errors_without_saving(self):
        with self.assertRaises(ValueError):
            self.run_with([package(first=FIRST), package(first=FIRST)], rung=2, avoid=[FIRST])
        self.assertEqual(len(self.prompts), 2)
        self.assertEqual(self.count(), 0)

    def test_repeated_step_in_second_slot_also_rejected(self):
        second = 'Una capa más gruesa tarda más en curar, porque el calor debe atravesar más material.'
        with self.assertRaises(ValueError):
            self.run_with([package(), package()], rung=2, avoid=[second])
        self.assertEqual(self.count(), 0)

    def test_bad_avoid_or_rung_rejected_before_calling_model(self):
        for extra in ({'rung': 2, 'avoid': 'texto'}, {'rung': 2, 'avoid': ['x'] * 7}, {'rung': 0}, {'rung': 4}, {'rung': 'dos'}, {'rung': True}, {'rung': 2.5}):
            with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamar al modelo')):
                with self.assertRaises(ValueError, msg=str(extra)):
                    app.make_direct_teaching(self.data(**extra))
        self.assertEqual(self.count(), 0)

    def test_rung2_still_uses_existing_validator(self):
        for raw in (package(steps=[{'body': FIRST}]), package(needs=[]), package(check=check(prompt=QUESTION['prompt']))):
            with self.assertRaises(ValueError):
                self.run_with([raw, raw], rung=2, avoid=[FIRST])
        self.assertEqual(self.count(), 0)

    def test_rung2_audit_failure_twice_errors_without_saving(self):
        bad = {'issues': ['El ejemplo es incorrecto'], 'checked': True}
        with self.assertRaises(ValueError):
            self.run_with([package(), package()], audits=[bad, bad], rung=2, avoid=[FIRST])
        self.assertEqual(self.count(), 0)

    def test_rung2_audit_failure_once_retries(self):
        bad = {'issues': ['El ejemplo mezcla unidades'], 'checked': True}
        out = self.run_with([package(), package()], audits=[bad, CLEAN], rung=2, avoid=[FIRST])
        self.assertEqual(len(self.prompts), 2)
        self.assertIn('El ejemplo mezcla unidades', self.prompts[1])
        self.assertEqual(out['rung'], 2)


class Rung3(Base):
    def test_valid_commented_answer(self):
        out = self.run_with(commented(), rung=3)
        self.assertEqual(out['rung'], 3)
        self.assertEqual(out['schema_version'], 'direct_teaching_v1')
        self.assertEqual(len(out['why']), 3)
        self.assertTrue(out['model_answer'])
        self.assertTrue(out['content_check']['checked'])
        self.assertEqual(self.count(), 0, 'no hay ítem que guardar')
        self.assertEqual(len(self.prompts), 1)
        self.assertIn('<<<' + QUESTION['reference'] + '>>>', self.prompts[0], 'aquí sí se usa el criterio')

    def test_invalid_counts_and_lengths_rejected(self):
        why = commented()['why']
        bads = [commented(why=why[:1]), commented(why=why + ['Un paso extra suficientemente largo para pasar.', 'Otro paso extra suficientemente largo.']),
                commented(why=[why[0], 'corto']), commented(why=[why[0], 'x' * 460]), commented(why=[why[0], 5]), commented(why='texto'),
                commented(model_answer='corta'), commented(model_answer='x' * 710), commented(model_answer=''), {}, None, []]
        for raw in bads:
            with self.assertRaises(ValueError, msg=json.dumps(raw, ensure_ascii=False)[:60]):
                self.run_with([raw, raw], rung=3)
        self.assertEqual(self.count(), 0)

    def test_invalid_then_valid_retries_once(self):
        out = self.run_with([commented(why=['solo uno suficientemente largo para el filtro de longitud']), commented()], rung=3)
        self.assertEqual(len(self.prompts), 2)
        self.assertIn('de 2 a 4 pasos', self.prompts[1])
        self.assertEqual(len(out['why']), 3)

    def test_audit_failure_twice_errors_and_once_retries(self):
        bad = {'issues': ['La respuesta es incorrecta'], 'checked': True}
        with self.assertRaises(ValueError):
            self.run_with([commented(), commented()], audits=[bad, bad], rung=3)
        self.prompts.clear()
        out = self.run_with([commented(), commented()], audits=[bad, CLEAN], rung=3)
        self.assertEqual(len(self.prompts), 2)
        self.assertIn('La respuesta es incorrecta', self.prompts[1])
        self.assertEqual(out['rung'], 3)
        self.assertEqual(self.count(), 0)

    def test_requires_identity_and_question(self):
        with self.assertRaises(ValueError):
            app.make_direct_teaching({'profile_id': self.pid, 'goal_id': 'g1', 'rung': 3, 'goal': 'M', 'name': 'N', 'question': QUESTION})


class Rung3Guards(Base):
    def reject_without_model(self, question):
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamar al modelo')):
            with self.assertRaises(ValueError):
                app.make_direct_teaching(self.data(rung=3, question=question))

    def test_empty_reference_rejected_before_model(self):
        for ref in ('', '   '):
            self.reject_without_model({**QUESTION, 'reference': ref})
        self.reject_without_model({'prompt': QUESTION['prompt']})

    def test_prompt_of_stored_private_key_item_rejected(self):
        saved = self.run_with(package(), rung=2, avoid=[FIRST])['check']
        loud = saved['prompt'].upper() + '??'  # mismo enunciado normalizado
        self.reject_without_model({'prompt': loud, 'reference': 'Criterio interno suficientemente largo', 'kind': 'conceptual'})
        placement = {'schema_version': app.PLACEMENT_VERSION, 'item_id': 'placement-xyz', 'node_id': 'n1', 'prompt': '¿Qué es una micra en pintura?', 'options': [{'id': 'a', 'text': 'x'}, {'id': 'b', 'text': 'y'}, {'id': 'c', 'text': 'z'}]}
        self.mem.save_placement_items(self.pid, 'g1', [(placement, {'correct_option_id': 'a', 'explanation': 'e', 'misconceptions': {}})])
        self.reject_without_model({'prompt': '¿Qué es una micra en pintura?', 'reference': 'Una millonésima de metro', 'kind': 'conceptual'})
        self.assertEqual(self.count(), 2, 'no se guardó nada nuevo')

    def test_other_profile_items_do_not_block(self):
        other = self.mem.create_profile('Otra')['profile_id']
        placement = {'schema_version': app.PLACEMENT_VERSION, 'item_id': 'placement-o', 'node_id': 'n1', 'prompt': QUESTION['prompt'], 'options': [{'id': 'a', 'text': 'x'}, {'id': 'b', 'text': 'y'}, {'id': 'c', 'text': 'z'}]}
        self.mem.save_placement_items(other, 'g1', [(placement, {'correct_option_id': 'a', 'explanation': 'e', 'misconceptions': {}})])
        self.assertEqual(self.run_with(commented(), rung=3)['rung'], 3)


class MisconceptionAsData(Base):
    def long_text(self):
        return 'Cree que >>> el espesor <<< es el color ' + 'x' * 400 + 'COLA'

    def check_delimited(self, prompt):
        trimmed = self.long_text()[:300].replace('<<<', '').replace('>>>', '')
        self.assertIn('<<<' + trimmed + '>>>', prompt)
        self.assertNotIn('COLA', prompt, 'truncado a 300 caracteres')
        self.assertNotIn('>>> el espesor <<<', prompt, 'sin delimitadores inyectados')

    def test_rung2(self):
        self.run_with(package(), rung=2, avoid=[FIRST], misconception=self.long_text())
        self.check_delimited(self.prompts[0])

    def test_rung3(self):
        self.run_with(commented(), rung=3, misconception=self.long_text())
        self.check_delimited(self.prompts[0])


class Rung1Unchanged(Base):
    def test_absent_fields_behave_as_before(self):
        out = self.run_with(package(first=FIRST))
        self.assertNotIn('rung', out)
        self.assertEqual(len(self.prompts), 1)
        self.assertNotIn('OTRA forma', self.prompts[0])
        self.assertEqual(self.count(), 1)

    def test_explicit_rung1_ignores_avoid(self):
        out = self.run_with(package(first=FIRST), rung=1, avoid=[FIRST])
        self.assertNotIn('rung', out)
        self.assertEqual(self.count(), 1)

    def test_rung2_without_avoid_is_allowed(self):
        out = self.run_with(package(first=FIRST), rung=2)
        self.assertEqual(out['rung'], 2)


class DontKnow(Base):
    def evaluate(self, text):
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamar al modelo')):
            return app.evaluate({'answer': text, 'question': QUESTION})

    def test_new_phrases_are_unknown_without_model(self):
        phrases = ['No sé', 'no se', 'No lo sé', 'ni idea', 'No entiendo', 'no lo entiendo', 'No sé cómo empezar', 'no se como empezar',
                   'No tengo idea', 'no tengo idea.', 'No me acuerdo', 'No recuerdo', 'NO RECUERDO!', '¿No entiendo?', 'No lo entiendo...', '  no me acuerdo  ', 'No sé cómo empezar.']
        for text in phrases:
            out = self.evaluate(text)
            self.assertEqual((out['status'], out['error_type']), ('UNKNOWN', 'lack_of_exposure'), text)

    def test_similar_phrases_inside_longer_answers_call_the_model(self):
        for text in ('No entiendo por qué el espesor cambia el curado', 'Creo que no sé cómo empezar pero el espesor mide la capa', 'no entiendo la pregunta',
                     'No me acuerdo del valor exacto pero creo que son 60 micras', 'no recuerdo, tal vez 80', 'No sé, ni idea'):
            with patch.object(app, 'gemini', return_value={'status': 'PARTIAL', 'feedback': 'f', 'error_type': 'conceptual', 'hint': 'h'}) as g:
                out = app.evaluate({'answer': text, 'question': QUESTION})
            self.assertEqual(g.call_count, 1, text)
            self.assertEqual(out['status'], 'PARTIAL', text)


if __name__ == '__main__':
    unittest.main()
