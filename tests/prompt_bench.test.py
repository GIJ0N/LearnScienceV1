"""El banco de prompts en modo reproducción: cada caso grabado cumple sus expectativas y los defectos se detectan."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import json
import prompt_bench as bench


class Replay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = json.loads(bench.CASES.read_text(encoding='utf-8'))

    def test_every_recorded_case_meets_its_expectations(self):
        self.assertGreaterEqual(len(self.cases), 8)
        for case in self.cases:
            with self.subTest(case=case['id']):
                result = bench.run_case(case)
                self.assertEqual(bench.evaluate(case, result), [])

    def test_all_generating_flows_are_covered(self):
        self.assertEqual({c['flow'] for c in self.cases}, {'placement', 'steps', 'discrimination', 'composition', 'graph', 'area_map'})

    def test_model_biases_are_reported_before_shuffle(self):
        case = next(c for c in self.cases if c['id'] == 'placement-con-sesgos-del-modelo')
        result = bench.run_case(case)
        self.assertGreater(result['bias_before_shuffle']['key_first_rate'], 0.5)
        self.assertGreater(result['bias_before_shuffle']['correct_longest_rate'], 0.5)
        self.assertEqual(result['proposed_items'], 4)
        self.assertEqual(result['accepted'], 2)
        self.assertTrue(any('más larga' in r for r in result['rejected']))

    def test_evaluate_flags_violated_expectations(self):
        case = {'id': 'x', 'flow': 'placement', 'expect': {'min_accepted': 3, 'max_model_calls': 0, 'min_rejected': {'repetidas': 1}}}
        result = {'accepted': 1, 'error': '', 'model_calls': 1, 'rejected': {}}
        problems = bench.evaluate(case, result)
        self.assertEqual(len(problems), 3)

    def test_cost_numbers_are_reported(self):
        result = bench.run_case(next(c for c in self.cases if c['id'] == 'mapa-por-areas'))
        self.assertEqual(result['model_calls'], 2)
        self.assertGreater(result['prompt_tokens_approx'], 0)
        self.assertEqual(result['max_output_tokens'], 1800 + 4200)

    def test_runs_without_network_or_keys(self):
        import os
        for name in ('ANTHROPIC_API_KEY', 'GEMINI_API_KEY'):
            os.environ.pop(name, None)
        self.assertEqual(bench.main(['--case', 'grafo-bien-formado']), 0)


if __name__ == '__main__':
    unittest.main()
