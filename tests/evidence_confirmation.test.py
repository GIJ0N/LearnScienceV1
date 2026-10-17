"""Active HTTP route, bounded generation and durable v2 session compatibility."""
import copy
import json
import subprocess
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app
from memory_store import DurableMemory


def question(dimension='units', prompt='Detecta un error dimensional'):
    return {'prompt': prompt, 'reference': 'Criterio', 'kind': app.CONFIRMATION_KINDS[dimension],
            'observable_dimensions': [dimension]}


class ConfirmationTests(unittest.TestCase):
    def test_each_supported_dimension_has_an_exact_contract(self):
        for dimension in app.CONFIRMATION_KINDS:
            with self.subTest(dimension=dimension), patch.object(app, 'gemini', return_value={'question': question(dimension)}) as generate:
                result = app.evidence_confirmation({'goal': 'Aprender', 'concept': 'Competencia', 'target_dimension': dimension, 'previous': ['Otro caso']})
                self.assertEqual(result['question'], question(dimension))
                self.assertEqual(generate.call_count, 1)
                self.assertIn('No declares transferencia', generate.call_args.args[0])

    def test_incompatible_or_repeated_output_never_becomes_an_activity(self):
        for raw in [None, {}, {'question': {}}, {'question': {**question(), 'kind': 'explanation'}},
                    {'question': {**question(), 'observable_dimensions': ['units', 'procedure']}},
                    {'question': question(prompt='  CASO REPETIDO!!! ')}]:
            with self.subTest(raw=raw), patch.object(app, 'gemini', return_value=raw) as generate:
                with self.assertRaises(ValueError):
                    app.evidence_confirmation({'goal': 'Aprender', 'concept': 'Competencia', 'target_dimension': 'units', 'previous': ['Caso repetido']})
                self.assertEqual(generate.call_count, 1, 'no automatic retry loop')

    def test_invalid_request_makes_no_provider_call(self):
        for changes in [{'target_dimension': 'transfer'}, {'target_dimension': 'unknown'}, {'previous': 'texto'},
                        {'previous': ['x'] * 21}, {'previous': ['x' * 701]}, {'previous': [None]}]:
            data = {'goal': 'Aprender', 'concept': 'Competencia', 'target_dimension': 'units', **changes}
            with self.subTest(changes=changes), patch.object(app, 'gemini') as generate:
                with self.assertRaises(ValueError): app.evidence_confirmation(data)
                generate.assert_not_called()

    def test_http_generation_pending_session_and_sqlite_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'memory.sqlite3'
            memory = DurableMemory(path)
            app.set_memory_for_tests(memory)
            server = app.ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            base = 'http://127.0.0.1:%d' % server.server_address[1]
            def post(route, payload):
                request = urllib.request.Request(base + route, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}, method='POST')
                with urllib.request.urlopen(request, timeout=5) as response: return json.load(response)
            try:
                profile = post('/api/profile/create', {'name': 'Evidencia'})
                with patch.object(app, 'gemini', return_value={'question': question()}):
                    generated = post('/api/confirmation', {'goal': 'Aprender', 'concept': 'Unidades', 'target_dimension': 'units', 'previous': []})
                q = {**generated['question'], 'activity_id': 'confirmation-activity'}
                first = {'type': 'EVIDENCE', 'attempt_id': 'attempt-1', 'evidence_id': 'evidence-1', 'node_id': 'n1',
                         'activity_id': 'first-activity', 'phase': 'INDEPENDENT', 'result': 'CORRECT', 'is_independent': True,
                         'observed_dimensions': ['units'], 'help_used': 0, 'answer': 'Respuesta original',
                         'question': question(prompt='Primera conversión'), 'timestamp': 1000, 'at': 1000}
                state = {'goals': [{'id': 'goal-1', 'goal': 'Unidades',
                    'nodes': [{'id': 'n1', 'name': 'Unidades', 'prerequisites': []}],
                    'coverage': [{'id': 'n1', 'dimensions': [{'id': 'units', 'required': True, 'evidence': [first]}]}],
                    'learner': {}, 'lessons': {}, 'reviews': [], 'events': [first],
                    'session': {'mode': 'CONFIRMATION', 'node': 'n1', 'stack': [], 'confirmation': {
                        'node_id': 'n1', 'attempts': 0, 'question': q, 'target_dimension': 'units'}},
                    'repairEpisodes': [], 'contextStack': []}], 'active': 'goal-1'}
                original = copy.deepcopy(state)
                saved = post('/api/profile/save', {'profile_id': profile['profile_id'], 'store': state, 'expected_revision': profile['revision']})
                self.assertEqual(state, original, 'caller data is not mutated')
                app.set_memory_for_tests(DurableMemory(path))
                loaded = post('/api/profile/load', {'profile_id': profile['profile_id']})
                self.assertEqual(loaded['revision'], saved['revision'])
                self.assertEqual(loaded['store']['goals'][0]['session']['confirmation']['question'], q)
                history = post('/api/profile/history', {'profile_id': profile['profile_id']})
                self.assertEqual(history['attempts'][0]['response_text'], 'Respuesta original')
                # Normalize with the actual frontend and ensure a single preserved success stays provisional.
                script = "global.document={getElementById:()=>({}),createElement:()=>({})};const p=require('./app.js');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const g=p.normalizeImportedStore(JSON.parse(s)).goals[0];if(p.verified(g,'n1')||g.session.confirmation.question.activity_id!=='confirmation-activity')process.exit(1);});"
                completed = subprocess.run(['node', '-e', script], input=json.dumps(loaded['store']), text=True, capture_output=True, cwd=ROOT)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                backup = post('/api/profile/export', {'profile_id': profile['profile_id']})
                target = post('/api/profile/create', {'name': 'Restaurado'})
                post('/api/profile/restore', {'profile_id': target['profile_id'], 'backup': backup})
                restored = post('/api/profile/load', {'profile_id': target['profile_id']})
                self.assertEqual(restored['store']['goals'][0]['session']['confirmation'], loaded['store']['goals'][0]['session']['confirmation'])
                self.assertEqual(len(post('/api/profile/history', {'profile_id': target['profile_id']})['attempts']), 1)
                # No fabricated evidence when continuing with a pending dimension.
                pending = copy.deepcopy(loaded['store'])
                pending['goals'][0]['events'].append({'type': 'CURRICULUM_CONTINUED', 'node_id': 'n1', 'pending_dimensions': ['units'], 'at': 2000, 'policy_version': 'evidence_policy_v2'})
                post('/api/profile/save', {'profile_id': profile['profile_id'], 'store': pending, 'expected_revision': loaded['revision']})
                self.assertEqual(len(post('/api/profile/history', {'profile_id': profile['profile_id']})['attempts']), 1)
            finally:
                server.shutdown(); server.server_close(); thread.join(5)
                app.set_memory_for_tests(None)


if __name__ == '__main__': unittest.main()
