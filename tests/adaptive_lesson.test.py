"""Evidence-informed lesson generation without changing mastery or persistence rules."""
import unittest
from unittest.mock import patch
import app_legacy as app


def lesson():
    def q(label, kind, observed):
        return {'prompt': label, 'reference': 'Criterio', 'kind': kind,
                'observable_dimensions': observed}
    return {'explanation': 'Explicación breve', 'example': 'Ejemplo guiado',
            'common_error': 'Error común',
            'check': q('Comprueba el principio', 'explanation', ['conceptual']),
            'guided': q('Práctica asistida', 'units', ['units']),
            'independent': q('Aplicación distinta', 'units', ['units']),
            'integration': q('Contexto distinto', 'context_case', ['contextual_application'])}


def attempt(result='CORRECT', independent=False, helped=0, dimensions=None, corrected=False):
    return {'result': result, 'help_used': helped, 'event': {
        'observed_dimensions': dimensions if dimensions is not None else ['units'],
        'is_independent': independent, 'corrected': corrected}}


class Memory:
    def __init__(self, attempts):
        self.attempts = attempts
    def load(self, profile_id):
        return {'preferences': {'concrete_examples': True}}
    def relevant_memory(self, profile_id, goal_id, node_id, target_dimension, limit):
        return {'reason': 'Intentos del nodo', 'sources': [], 'attempts': self.attempts}


class AdaptiveLessonTests(unittest.TestCase):
    def run_case(self, attempts, expected, needle):
        prompts = []
        def generate(prompt, schema, max_tokens):
            prompts.append(prompt)
            return lesson()
        with patch.object(app, 'memory', return_value=Memory(attempts)), patch.object(app, 'gemini', side_effect=generate):
            result = app.make_lesson({'goal': 'Aprender conversiones de unidades',
                                      'name': 'Cambiar unidades', 'parent': 'Meta',
                                      'target_dimension': 'units', 'profile_id': 'profile',
                                      'goal_id': 'goal', 'node_id': 'node',
                                      'student_level': 'expert'})
        self.assertEqual(result['adaptation_mode'], expected)
        self.assertIn(needle, prompts[0])
        self.assertEqual(result['guided']['kind'], 'units')
        self.assertEqual(result['independent']['observable_dimensions'], ['units'])
        self.assertTrue(result['adaptation_reason'])
        self.assertEqual(result['memory_sources'], [])
        return result

    def test_novice_does_not_trust_claimed_expertise(self):
        self.run_case([], 'initial', 'Microlección desde nivel cero')

    def test_independent_success_gets_consolidation_without_mastery_claim(self):
        result = self.run_case([attempt(independent=True)], 'consolidate',
                               'Microlección de consolidación')
        self.assertNotIn('MASTERED', str(result))

    def test_recent_misconception_takes_priority_over_older_success(self):
        self.run_case([attempt('MISCONCEPTION'), attempt(independent=True)],
                      'repair', 'Microlección correctiva')

    def test_help_and_guided_success_keep_support(self):
        self.run_case([attempt(independent=False, helped=1)],
                      'scaffold', 'Microlección de apoyo gradual')
        self.run_case([attempt(independent=False)],
                      'scaffold', 'Microlección de apoyo gradual')

    def test_irrelevant_or_manually_corrected_evidence_does_not_upgrade(self):
        self.run_case([attempt(independent=True, dimensions=['conceptual'])],
                      'initial', 'Microlección desde nivel cero')
        self.run_case([attempt(independent=True, corrected=True)],
                      'initial', 'Microlección desde nivel cero')

    def test_missing_legacy_metadata_is_conservative(self):
        self.run_case([{'result': 'CORRECT', 'help_used': 0, 'event': None}],
                      'initial', 'Microlección desde nivel cero')


if __name__ == '__main__':
    unittest.main()
