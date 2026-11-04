"""Learner confidence and think-aloud reasoning: validated, passed to the model as context, never graded."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory

QUESTION = {'prompt': '¿Por qué flota el hielo?', 'reference': 'Densidad menor que el agua líquida.'}


def controlled(status='CORRECT', prompts=None):
    def fake(prompt, schema, max_tokens):
        if prompts is not None:
            prompts.append(prompt)
        return {'status': status, 'feedback': 'f', 'error_type': 'none', 'hint': ''}
    return fake


class EvaluateSignals(unittest.TestCase):
    def test_reasoning_and_confidence_reach_the_prompt(self):
        prompts = []
        with patch.object(app, 'gemini', side_effect=controlled('MISCONCEPTION', prompts)):
            out = app.evaluate({'question': QUESTION, 'answer': 'Porque pesa menos', 'phase': 'INDEPENDENT',
                                'reasoning': 'Creo que el hielo tiene aire dentro', 'learner_confidence': 90})
        self.assertEqual(out['status'], 'MISCONCEPTION')
        self.assertIn('Creo que el hielo tiene aire dentro', prompts[0])
        self.assertIn('confianza declarada: 90%', prompts[0])
        self.assertIn('no cambia el status', prompts[0])

    def test_absent_signals_keep_the_original_prompt(self):
        prompts = []
        with patch.object(app, 'gemini', side_effect=controlled('CORRECT', prompts)):
            app.evaluate({'question': QUESTION, 'answer': 'Menor densidad', 'phase': 'INDEPENDENT'})
        self.assertNotIn('razonamiento en voz alta', prompts[0])
        self.assertNotIn('confianza declarada', prompts[0])

    def test_invalid_confidence_is_rejected_before_calling_the_model(self):
        for value in (150, -1, 'alta', True):
            with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamarse')):
                with self.assertRaises(ValueError):
                    app.evaluate({'question': QUESTION, 'answer': 'x', 'learner_confidence': value})

    def test_unknown_answer_ignores_confidence(self):
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamarse')):
            out = app.evaluate({'question': QUESTION, 'answer': 'no sé', 'learner_confidence': 80})
        self.assertEqual(out['status'], 'UNKNOWN')


def store_with(events):
    node = {'id': 'n1', 'name': 'Densidad', 'outcome': 'Explicar', 'level': 0, 'prerequisites': [], 'kind': 'concept'}
    return {'goals': [{'id': 'g1', 'goal': 'Física', 'nodes': [node], 'events': events, 'coverage': [], 'reviews': []}], 'active': 'g1'}


def evidence(attempt_id, at, **extra):
    base = {'type': 'EVIDENCE', 'attempt_id': attempt_id, 'activity_id': 'a1', 'node_id': 'n1', 'phase': 'INDEPENDENT',
            'result': 'MISCONCEPTION', 'help_used': 0, 'answer': 'r', 'observed_dimensions': ['conceptual'], 'at': at}
    base.update(extra)
    return base


class MemorySignals(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'mem.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']

    def tearDown(self):
        self.tmp.cleanup()

    def test_committed_misconception_is_surfaced_with_provenance(self):
        self.memory.save(self.profile, store_with([evidence('t1', 1000, learner_confidence=95, calibration_signal='committed_misconception',
                                                            reasoning_text='aire dentro', learner_signal_version='learner-signals-v1')]))
        result = self.memory.relevant_memory(self.profile, 'g1', 'n1')
        self.assertEqual(result['sources'][0]['learner_confidence'], 95)
        self.assertIn('confianza alta', result['reason'])

    def test_legacy_events_without_signals_load_unchanged(self):
        self.memory.save(self.profile, store_with([evidence('t2', 1000)]))
        result = self.memory.relevant_memory(self.profile, 'g1', 'n1')
        self.assertNotIn('learner_confidence', result['sources'][0])
        self.assertIn('dificultad', result['reason'])

    def test_lesson_context_includes_signals_only_when_recorded(self):
        prompts = []
        lesson = {'explanation': 'e', 'example': 'x', 'common_error': 'c',
                  **{k: {'prompt': k, 'reference': 'r', 'kind': 'explanation', 'observable_dimensions': ['conceptual']}
                     for k in ('check', 'guided', 'independent', 'integration')}}
        self.memory.save(self.profile, store_with([evidence('t3', 1000, learner_confidence=95, calibration_signal='committed_misconception',
                                                            reasoning_text='aire dentro', learner_signal_version='learner-signals-v1')]))
        def fake(prompt, schema, max_tokens):
            prompts.append(prompt)
            return lesson
        with patch.object(app, 'memory', return_value=self.memory), patch.object(app, 'gemini', side_effect=fake):
            app.make_lesson({'goal': 'Física', 'name': 'Densidad', 'profile_id': self.profile, 'goal_id': 'g1', 'node_id': 'n1'})
        self.assertIn('committed_misconception', prompts[0])
        self.assertIn('aire dentro', prompts[0])


if __name__ == '__main__':
    unittest.main()
