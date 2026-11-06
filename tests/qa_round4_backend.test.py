"""Ronda QA 4: historial sin la pregunta equivocada, retos con lápiz y comparación numérica, observación en segunda persona."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory, _question_for


class Round4(unittest.TestCase):
    def test_criterion_attempt_never_borrows_the_current_lesson_question(self):
        goal = {'lessons': {'n1': {'independent': {'prompt': 'Un grifo llena 5 litros…'}}}}
        bare = {'type': 'EVIDENCE', 'node_id': 'n1', 'phase': 'INDEPENDENT', 'criterion_assessment': {'overall': 'CORRECT'}}
        self.assertIsNone(_question_for(goal, bare))
        own = dict(bare, question={'prompt': 'Manzanas'})
        self.assertEqual(_question_for(goal, own)['prompt'], 'Manzanas')
        lesson_event = {'type': 'EVIDENCE', 'node_id': 'n1', 'phase': 'INDEPENDENT', 'activity_id': 'a1'}
        self.assertEqual(_question_for(goal, lesson_event)['prompt'], 'Un grifo llena 5 litros…', 'las preguntas normales siguen igual')

    def test_error_hunt_question_goes_on_its_own_line(self):
        out = app._err_normalize_item({'prompt': 'P. Paso 1: a. Paso 2: b. ¿Hay un error? Si lo hay, ¿dónde?'})
        self.assertEqual(out['prompt'].split('\n')[-1], '¿Hay un error? Si lo hay, ¿dónde?')

    def test_challenge_prompts_and_single_digit_measurements(self):
        with patch.object(app, 'gemini', side_effect=ValueError('stop')) as g:
            with self.assertRaises(ValueError):
                app._challenge_attempt('Meta', 'Tema', '')
        self.assertIn('papel y lápiz', g.call_args[0][0])
        src = Path(app.__file__).read_text(encoding='utf-8')
        self.assertIn('compara los números explícitamente', src)
        self.assertIn('segunda persona (tú)', src)
        self.assertEqual(app.CHAL_MIN_NUMERIC, 1)

    def test_single_digit_report_is_accepted(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        mem = DurableMemory(Path(tmp.name) / 'r.sqlite')
        prof = mem.create_profile('S')['profile_id']
        ch = {'title': 'Vasos', 'scenario': 'Dos recipientes.', 'prediction_prompt': '¿Cuántos vasos caben?', 'minutes': 15, 'materials': ['vaso', 'papel y lápiz'],
              'steps': ['Llena el pequeño con vasos.', 'Llena el grande con vasos.'], 'evidence_fields': [{'id': 'p', 'label': 'Vasos del pequeño'}, {'id': 'g', 'label': 'Vasos del grande'}],
              'safety_note': 'Seca lo que se derrame.', 'success_criteria': 'El grande necesita más vasos.'}
        with patch.object(app, 'memory', return_value=mem), patch.object(app, 'CONTENT_VERIFY', False):
            with patch.object(app, 'gemini', return_value=ch):
                item = app.challenge_start({'profile_id': prof, 'goal_id': 'g', 'goal': 'M', 'node': {'id': 'n', 'name': 'T'}})
            app.challenge_commit({'profile_id': prof, 'goal_id': 'g', 'item_id': item['item_id'], 'attempt_id': 'c', 'prediction': 'El grande necesitará el doble', 'confidence': 50})
            with patch.object(app, 'gemini', return_value={'status': 'SUPPORTED', 'prediction_match': 'YES', 'feedback': 'Citas 2 y 4 vasos.', 'next_step': 'x'}):
                out = app.challenge_report({'profile_id': prof, 'goal_id': 'g', 'item_id': item['item_id'], 'attempt_id': 'r', 'prediction_attempt_id': 'c', 'evidence': {'p': '2', 'g': '4'}, 'reflection': 'Coincidió: el grande necesitó el doble de vasos.'})
        self.assertEqual(out['status'], 'SUPPORTED')


if __name__ == '__main__':
    unittest.main()
