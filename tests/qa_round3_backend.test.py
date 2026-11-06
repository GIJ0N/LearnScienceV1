"""Ronda QA 3: la auditoría recibe contexto (sin romperse), retos exigen materiales coherentes y valoran verosimilitud."""
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app


class Round3(unittest.TestCase):
    def test_audit_note_reaches_the_reviewer_and_the_audit_really_runs(self):
        with patch.object(app, 'CONTENT_VERIFY', True), patch.object(app, 'gemini', return_value={'issues': []}) as g:
            out = app.audit_content('Meta', 'Tema', 'material', note='Contexto de prueba.')
        self.assertTrue(out['checked'], 'una excepción interna no debe disfrazarse de «sin revisar»')
        self.assertIn('Contexto de prueba.', g.call_args[0][0])
        with patch.object(app, 'CONTENT_VERIFY', True), patch.object(app, 'gemini', return_value={'issues': []}) as g:
            self.assertTrue(app.audit_content('Meta', 'Tema', 'material')['checked'])

    def test_beto_audit_note_explains_the_belief_is_false_on_purpose(self):
        self.assertIn('PUESTA A PROPÓSITO', app.BETO_AUDIT_NOTE)

    def test_challenge_prompts_ask_for_coherent_materials_and_plausible_data(self):
        with patch.object(app, 'gemini', side_effect=ValueError('stop')) as g:
            with self.assertRaises(ValueError):
                app._challenge_attempt('Meta', 'Tema', '')
        prompt = g.call_args[0][0]
        self.assertIn('debe estar en materials', prompt)
        self.assertIn('superficie', prompt)
        src = Path(app.__file__).read_text(encoding='utf-8')
        self.assertIn('físicamente inverosímiles', src)


if __name__ == '__main__':
    unittest.main()
