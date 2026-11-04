"""Acceptance guard regressions; all provider traffic is simulated."""
import io
import json
import sys
import tempfile
import unittest
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import accept_joint_candidate as harness


class AcceptanceGuard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.path = self.root / 'ledger.sqlite3'
        self.ledger = harness.Ledger(self.path)

    def tearDown(self):
        self.tmp.cleanup()

    def test_durable_budget_includes_failed_and_restarted_requests(self):
        for index in range(10):
            ledger = harness.Ledger(self.path)
            number = ledger.reserve('test')
            self.assertEqual(number, index + 1)
            ledger.finish(number, 'response_received' if index % 2 else 'invalid_json')
            ledger.review(number, 'accepted', 'Synthetic review of counter only')
        with self.assertRaisesRegex(harness.StopAcceptance, 'budget exhausted'):
            harness.Ledger(self.path).reserve('eleventh')
        self.assertEqual(self.ledger.status()['requests'], 10)

    def test_crash_reservation_blocks_restart_and_concurrent_requests(self):
        def reserve(_):
            try:
                return harness.Ledger(self.path).reserve('concurrent')
            except harness.StopAcceptance:
                return None
        with ThreadPoolExecutor(max_workers=5) as pool:
            self.assertEqual(sum(x is not None for x in pool.map(reserve, range(5))), 1)
        with self.assertRaisesRegex(harness.StopAcceptance, 'review required'):
            harness.Ledger(self.path).reserve('restart')
        with self.assertRaises(ValueError):
            self.ledger.review(1, 'accepted', 'Cannot approve an interrupted request')

    def test_two_contract_rejections_and_critical_findings_latch_stop(self):
        for index in range(2):
            number = self.ledger.reserve('contract')
            self.ledger.finish(number, 'response_received')
            self.ledger.review(number, 'contract_rejected', 'Invalid role / dimension')
        with self.assertRaises(harness.StopAcceptance):
            harness.Ledger(self.path).reserve('restart')
        for verdict in ('leak', 'false_evidence', 'fatal'):
            ledger = harness.Ledger(self.root / (verdict + '.sqlite3'))
            number = ledger.reserve('test')
            ledger.finish(number, 'response_received')
            ledger.review(number, verdict, 'Synthetic critical finding')
            self.assertTrue(ledger.status()['stopped'])

    def test_transport_auth_failure_counts_and_stops_without_error_text(self):
        def fail(*args, **kwargs):
            raise urllib.error.HTTPError('https://generativelanguage.googleapis.com', 401,
                                         'DO_NOT_LOG_THIS', {}, io.BytesIO(b'{}'))
        payload = dict(question=dict(prompt='Synthetic question', reference='Synthetic reference'),
                       answer='Synthetic answer', phase='CHECK')
        with patch.dict(harness.app.os.environ, {'GEMINI_API_KEY': 'SYNTHETIC_ONLY'}):
            with self.assertRaises(harness.StopAcceptance):
                harness.invoke('evaluate', payload, self.ledger, self.root, transport=fail)
        status = harness.Ledger(self.path).status()
        self.assertEqual(status['requests'], 1)
        self.assertTrue(status['stopped'])
        record = (self.root / 'request-01.json').read_text()
        self.assertNotIn('DO_NOT_LOG_THIS', record)
        self.assertNotIn('SYNTHETIC_ONLY', record)

    def test_invalid_provider_json_consumes_request_and_requires_review(self):
        def invalid(*args, **kwargs):
            return io.BytesIO(json.dumps(dict(candidates=[dict(content=dict(parts=[dict(text='not JSON')]))])).encode())
        payload = dict(question=dict(prompt='Synthetic question', reference='Synthetic reference'),
                       answer='Synthetic answer', phase='CHECK')
        with patch.dict(harness.app.os.environ, {'GEMINI_API_KEY': 'SYNTHETIC_ONLY'}):
            with self.assertRaises(harness.StopAcceptance):
                harness.invoke('evaluate', payload, self.ledger, self.root, transport=invalid)
        self.assertEqual(harness.Ledger(self.path).status()['requests'], 1)
        with self.assertRaisesRegex(harness.StopAcceptance, 'review required'):
            harness.Ledger(self.path).reserve('retry')
        self.ledger.review(1, 'contract_rejected', 'Invalid provider JSON')
        self.assertEqual(self.ledger.reserve('explicit-retry'), 2)

    def test_local_unknown_consumes_no_request(self):
        result = harness.invoke('evaluate', dict(question=dict(prompt='Synthetic'), answer='No sé'),
                                self.ledger, self.root, transport=lambda *_: self.fail('No network expected'))
        self.assertEqual(result['status'], 'UNKNOWN')
        self.assertEqual(self.ledger.status()['requests'], 0)

    def test_policy_bridge_persists_events_and_map_read_is_read_only(self):
        memory = harness.DurableMemory(self.root / 'synthetic.sqlite3')
        profile = memory.create_profile('SYNTHETIC GUARD TEST')
        (self.root / 'profile.json').write_text(json.dumps(profile))
        pid = profile['profile_id']
        loaded = memory.load(pid)
        q = dict(activity_id='p', prompt='Resuelve 2x + 3 = 7', reference='x=2',
                 kind='application', observable_dimensions=['direct_application'])
        loaded['store'].update(active='g', goals=[dict(id='g', nodes=[dict(id='n1', prerequisites=[])],
            coverage=[dict(id='n1', dimensions=[dict(id='direct_application', required=True, evidence=[])])],
            learner={}, lessons=dict(n1=dict(independent=q)), reviews=[], events=[], repairEpisodes=[],
            contextStack=[], session=dict(mode='INDEPENDENT',node='n1',stack=[],stage='teach'))])
        memory.save(pid, loaded['store'], loaded['revision'])
        with patch.object(harness, 'STATE', self.root):
            harness.app.set_memory_for_tests(memory)
            result = harness.policy_step(dict(action='parent', answer='x=5',
                evaluation=dict(status='MISCONCEPTION', error_type='algebra', feedback='Error')))
            self.assertEqual(result['result']['attempt_id'], 'joint-parent')
            before = memory.load(pid)
            harness.policy_step(dict(action='snapshot'))
            self.assertEqual(memory.load(pid), before)
            self.assertEqual(len(before['store']['goals'][0]['events']), 1)

    def test_criterion_generation_specifies_unique_literal_answer(self):
        # Regression for observed Gemini ambiguity: adding and subtracting five
        # both preserve equality, but only subtraction removes +5 in this step.
        # This checks the provider instruction, not a guarantee about semantics.
        with patch.object(harness.app, 'gemini', return_value={}) as provider:
            with self.assertRaises(ValueError):
                harness.app.make_criterion_activity(dict(profile_id='synthetic', goal_id='g',
                    goal='Ecuaciones', concept='Operaciones equivalentes'))
        prompt = provider.call_args.args[0]
        self.assertIn('exactamente una opción correcta', prompt)
        self.assertIn('eliminar el término indicado en ese paso', prompt)


if __name__ == '__main__':
    unittest.main()
