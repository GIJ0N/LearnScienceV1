"""Persist a state produced by the real JS cycle through SQLite and restoration."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app
from memory_store import DurableMemory

class AdaptiveCycleTests(unittest.TestCase):
    def test_real_frontend_decisions_survive_sqlite_restart_and_restore_isolated(self):
        run = subprocess.run(['node', 'tests/adaptive_cycle.test.js', '--snapshot'], cwd=ROOT, text=True, capture_output=True, check=True)
        state = json.loads(run.stdout)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'memory.sqlite3'
            memory = DurableMemory(path)
            first = memory.create_profile('Primero'); second = memory.create_profile('Segundo')
            untouched = memory.load(second['profile_id'])
            memory.save(first['profile_id'], state, first['revision'])
            memory = DurableMemory(path)
            loaded = memory.load(first['profile_id'])
            self.assertEqual(memory.load(second['profile_id']), untouched)
            goal = loaded['store']['goals'][0]
            self.assertEqual(goal['session']['tutor_decision'], state['goals'][0]['session']['tutor_decision'])
            self.assertEqual(goal['session']['confirmation'], state['goals'][0]['session']['confirmation'])
            expected_attempts = len([e for e in state['goals'][0]['events'] if e['type'] == 'EVIDENCE'])
            self.assertEqual(len(memory.history(first['profile_id'])), expected_attempts)
            backup = memory.export(first['profile_id'])
            memory.restore(second['profile_id'], backup)
            restored = memory.load(second['profile_id'])
            self.assertEqual(restored['store']['goals'][0]['session']['tutor_decision'], goal['session']['tutor_decision'])
            self.assertEqual(len(memory.history(second['profile_id'])), expected_attempts)
            self.assertEqual(memory.load(first['profile_id']), loaded)
            # Re-run the frontend selector on the persisted inputs; same clock, same decision.
            script = "global.document={getElementById:()=>({})};const p=require('./app.js');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{let g=p.normalizeImportedStore(JSON.parse(s)).goals[0];process.stdout.write(JSON.stringify(p.selectTutorAction(g,123456,{reselect:true})))})"
            outputs = [subprocess.run(['node', '-e', script], input=json.dumps(source), cwd=ROOT, capture_output=True, text=True, check=True).stdout for source in [state,loaded['store'],restored['store']]]
            self.assertEqual(outputs[0], outputs[1]); self.assertEqual(outputs[1], outputs[2])

    def test_challenge_request_changes_generation_not_evidence_permissions(self):
        q = {'prompt': 'Justifica una conversión con una restricción', 'reference': 'Criterio', 'kind': 'units', 'observable_dimensions': ['units']}
        with patch.object(app, 'gemini', return_value={'question': q}) as generate:
            output = app.evidence_confirmation({'goal': 'Medidas', 'concept': 'Unidades', 'target_dimension': 'units', 'difficulty': 'challenge'})
            self.assertIn('Añade una restricción relevante', generate.call_args.args[0])
            self.assertEqual(output['question']['observable_dimensions'], ['units'])
            self.assertNotIn('supports_transfer', output['question'])
        with patch.object(app, 'gemini') as generate:
            with self.assertRaises(ValueError):
                app.evidence_confirmation({'goal': 'Medidas', 'concept': 'Unidades', 'target_dimension': 'units', 'difficulty': 'expert'})
            generate.assert_not_called()

    def test_pending_memory_review_requests_exact_observable_dimension(self):
        q = {'prompt': 'Recupera el principio', 'reference': 'Criterio', 'kind': 'recall', 'observable_dimensions': ['memory']}
        with patch.object(app, 'gemini', return_value={'question': q}):
            result = app.review_question({'goal': 'Medidas', 'concept': 'Unidades', 'target_dimension': 'memory', 'previous_questions': []})
            self.assertEqual(result['question']['observable_dimensions'], ['memory'])
        with patch.object(app, 'gemini', return_value={'question': {**q, 'kind': 'explanation'}}):
            with self.assertRaises(ValueError):
                app.review_question({'goal': 'Medidas', 'concept': 'Unidades', 'target_dimension': 'memory'})

if __name__ == '__main__': unittest.main()
