"""integration_novelty_v1: la integración solo declara novedad si el modelo dice qué cambia y el enunciado es distinto."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app


def q(prompt, kind='application', **extra):
    return {'prompt': prompt, 'reference': 'criterio de ' + prompt, 'kind': kind, 'observable_dimensions': ['direct_application'], **extra}


def raw(integration=None, **over):
    base = {'explanation': 'Explicación', 'example': 'Ejemplo', 'common_error': 'Error',
            'check': q('Pregunta de comprensión', 'explanation'), 'guided': q('Ejercicio guiado'),
            'independent': q('Caso independiente'),
            'integration': integration if integration is not None else q('Decide en una planta nueva qué hacer', 'context_case', novelty_basis='Cambia el contexto: ahora es una decisión en planta')}
    base.update(over)
    return base


class Novelty(unittest.TestCase):
    def lesson(self, **kw):
        return app._lesson_from_raw(raw(**kw), None)

    def test_with_basis_and_distinct_prompt_declares_novelty(self):
        out = self.lesson()['integration']
        self.assertTrue(out['is_novel_variant'] and out['supports_transfer'])
        self.assertIn('Cambia el contexto', out['novelty_basis'])

    def test_missing_basis_no_novelty(self):
        out = self.lesson(integration=q('Decide en una planta nueva qué hacer', 'context_case'))['integration']
        for k in ('is_novel_variant', 'supports_transfer', 'novelty_basis'):
            self.assertNotIn(k, out)

    def test_short_basis_no_novelty(self):
        out = self.lesson(integration=q('Decide en una planta nueva qué hacer', 'context_case', novelty_basis='nuevo'))['integration']
        for k in ('is_novel_variant', 'supports_transfer', 'novelty_basis'):
            self.assertNotIn(k, out)

    def test_same_prompt_as_independent_no_novelty(self):
        same = q('Caso independiente!', 'context_case', novelty_basis='Cambia el contexto: ahora es una decisión en planta')
        out = self.lesson(integration=same)['integration']
        for k in ('is_novel_variant', 'supports_transfer', 'novelty_basis'):
            self.assertNotIn(k, out)

    def test_same_prompt_as_check_or_guided_no_novelty(self):
        for key, prompt in (('check', 'Pregunta de comprensión'), ('guided', 'Ejercicio guiado')):
            same = q(prompt.upper(), 'context_case', novelty_basis='Cambia la representación: ahora es una tabla')
            self.assertNotIn('is_novel_variant', self.lesson(integration=same)['integration'], key)

    def test_basis_is_bounded(self):
        out = self.lesson(integration=q('Decide algo distinto', 'context_case', novelty_basis='x' * 900))['integration']
        self.assertLessEqual(len(out['novelty_basis']), 300)

    def test_schema_and_prompt(self):
        props = app.STAGE_SCHEMA['properties']['integration']['properties']
        self.assertIn('novelty_basis', props)
        self.assertNotIn('novelty_basis', app.STAGE_SCHEMA['properties']['independent']['properties'])
        self.assertNotIn('novelty_basis', app.INTEGRATION_Q['required'])
        seen = {}

        def fake(prompt, *a, **k):
            seen['p'] = prompt
            return raw()
        with patch.object(app, 'gemini', side_effect=fake), patch.object(app, 'audit_content', return_value={'issues': [], 'checked': True}):
            out = app.make_lesson({'goal': 'Pintura en polvo', 'name': 'Curado'})
        self.assertIn('novelty_basis', seen['p'])
        self.assertTrue(out['integration']['is_novel_variant'])


if __name__ == '__main__':
    unittest.main()
