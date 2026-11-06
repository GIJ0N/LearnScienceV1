"""real_world_challenges_v1: contrato y seguridad del reto, predicción bloqueada en el servidor, informe provisional e idempotente."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory

NODE = {'id': 'n1', 'name': 'Caída libre', 'outcome': 'Predecir la caída de objetos'}
CHALLENGE = {'title': 'Hoja contra libro', 'scenario': 'Tienes una hoja y un libro.', 'prediction_prompt': '¿Cuál llegará primero al suelo y por qué?', 'minutes': 15,
             'materials': ['hoja de papel', 'libro'], 'steps': ['Suelta ambos a la vez desde la misma altura baja.', 'Anota cuál llegó primero.'],
             'evidence_fields': [{'id': 'primero', 'label': 'Cuál llegó primero'}, {'id': 'tiempo', 'label': 'Tiempo aproximado'}],
             'safety_note': 'Hazlo a poca altura.', 'success_criteria': 'El libro llega primero por la resistencia del aire sobre la hoja.'}
REPORT = {'status': 'SUPPORTED', 'prediction_match': 'YES', 'feedback': 'Citaste que el libro llegó primero.', 'next_step': 'Arruga la hoja y repite.'}
PRED = 'Creo que el libro llegará primero por el aire'
EVID = {'primero': 'El libro llegó primero siempre', 'tiempo': 'Menos de un segundo en ambos'}
REFL = 'Coincidió con mi predicción porque el aire frena la hoja.'


class Challenges(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'c.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.patches = [patch.object(app, 'memory', return_value=self.memory), patch.object(app, 'CONTENT_VERIFY', False)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def start(self, raw=None, **extra):
        data = {'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Física', 'node': NODE}
        data.update(extra)
        with patch.object(app, 'gemini', return_value=raw if raw is not None else CHALLENGE) as g:
            return app.challenge_start(data), g

    def commit(self, item, attempt='c1', prediction=PRED, confidence=70):
        return app.challenge_commit({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': attempt, 'prediction': prediction, 'confidence': confidence})

    def report(self, item, raw=None, attempt='r1', evidence=None, reflection=REFL, commit_id='c1'):
        data = {'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': attempt, 'prediction_attempt_id': commit_id,
                'evidence': evidence if evidence is not None else EVID, 'reflection': reflection}
        with patch.object(app, 'gemini', return_value=raw if raw is not None else REPORT) as g:
            return app.challenge_report(data), g

    def test_start_hides_the_task_until_the_prediction_is_locked(self):
        out, g = self.start()
        self.assertTrue(out['item_id'].startswith('chal-'))
        for k in ('steps', 'materials', 'evidence_fields', 'success_criteria', 'safety_note'):
            self.assertNotIn(k, out)
        self.assertEqual(out['prediction_prompt'], CHALLENGE['prediction_prompt'])
        stored = self.memory.load_placement_item(self.profile, out['item_id'])
        self.assertEqual(stored['private']['steps'], CHALLENGE['steps'])
        self.assertIn('MUY BAJO riesgo', g.call_args[0][0])

    def test_start_rejects_broken_contracts_and_saves_nothing(self):
        bad = [{**CHALLENGE, 'steps': ['uno']}, {**CHALLENGE, 'minutes': 90}, {**CHALLENGE, 'minutes': 'x'}, {**CHALLENGE, 'title': ''},
               {**CHALLENGE, 'evidence_fields': [{'id': 'a', 'label': 'A'}]}, {**CHALLENGE, 'materials': []}, {**CHALLENGE, 'success_criteria': ''}, 'texto', None]
        for raw in bad:
            with self.assertRaises(ValueError, msg=str(raw)[:60]):
                self.start(raw if raw is not None else {})
        with self.assertRaisesRegex(ValueError, 'Falta perfil'):
            self.start(node={})

    def test_start_filters_unsafe_challenges(self):
        for steps in (['Enciende una vela', 'Mide la llama'], ['Hierve agua', 'Anota'], ['Usa un cuchillo', 'Corta'], ['Conecta al enchufe', 'Mide']):
            with self.assertRaisesRegex(ValueError, 'seguridad'):
                self.start({**CHALLENGE, 'steps': steps})
        out, _ = self.start()
        self.assertTrue(out['item_id'])

    def test_start_audit_blocks_the_challenge(self):
        with patch.object(app, 'CONTENT_VERIFY', True), patch.object(app, 'audit_content', return_value={'checked': True, 'issues': ['x'], 'items': []}):
            with self.assertRaisesRegex(ValueError, 'revisión'):
                self.start()

    def test_commit_locks_prediction_and_releases_task(self):
        item, _ = self.start()
        with self.assertRaisesRegex(ValueError, 'predicción'):
            self.commit(item, prediction='corta')
        for conf in (-1, 101, 'x', None):
            with self.assertRaisesRegex(ValueError, 'confianza'):
                self.commit(item, confidence=conf)
        out = self.commit(item)
        self.assertEqual(out['steps'], CHALLENGE['steps'])
        self.assertEqual(out['evidence_fields'], CHALLENGE['evidence_fields'])
        self.assertEqual(out['confidence'], 70)
        self.assertEqual(self.commit(item), out, 'idempotente')
        with self.assertRaisesRegex(ValueError, 'CONFLICT'):
            self.commit(item, prediction='Creo que caerán al mismo tiempo siempre')

    def test_commit_rejects_foreign_goal_and_unknown_item(self):
        item, _ = self.start()
        with self.assertRaisesRegex(ValueError, 'no existe'):
            app.challenge_commit({'profile_id': self.profile, 'goal_id': 'otra', 'item_id': item['item_id'], 'attempt_id': 'c1', 'prediction': PRED, 'confidence': 50})
        with self.assertRaisesRegex(ValueError, 'no existe'):
            app.challenge_commit({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': 'chal-x', 'attempt_id': 'c1', 'prediction': PRED, 'confidence': 50})

    def test_report_requires_a_prior_commit(self):
        item, _ = self.start()
        with self.assertRaisesRegex(ValueError, 'bloquear tu predicción'):
            self.report(item)
        other, _ = self.start()
        self.commit(other, attempt='c9')
        with self.assertRaisesRegex(ValueError, 'bloquear tu predicción'):
            self.report(item, commit_id='c9')

    def test_report_local_gates_run_before_the_model(self):
        item, _ = self.start()
        self.commit(item)
        with patch.object(app, 'gemini') as g:
            with self.assertRaisesRegex(ValueError, 'Completa'):
                app.challenge_report({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': 'r1', 'prediction_attempt_id': 'c1', 'evidence': {'primero': 'sí'}, 'reflection': REFL})
            with self.assertRaisesRegex(ValueError, 'reflexión'):
                app.challenge_report({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': 'r1', 'prediction_attempt_id': 'c1', 'evidence': EVID, 'reflection': 'corta'})
            g.assert_not_called()

    def test_report_is_provisional_uses_stored_prediction_and_is_idempotent(self):
        item, _ = self.start()
        self.commit(item)
        out, g = self.report(item)
        self.assertTrue(out['provisional'])
        self.assertEqual((out['status'], out['prediction_match'], out['prediction_confidence']), ('SUPPORTED', 'YES', 70))
        prompt = g.call_args[0][0]
        self.assertIn(PRED, prompt)
        self.assertIn(CHALLENGE['success_criteria'], prompt)
        with patch.object(app, 'gemini') as g2:
            again = app.challenge_report({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': 'r1', 'prediction_attempt_id': 'c1', 'evidence': EVID, 'reflection': REFL})
            g2.assert_not_called()
        self.assertEqual(again, out)
        with self.assertRaisesRegex(ValueError, 'CONFLICT'):
            self.report(item, evidence={**EVID, 'tiempo': 'Unos tres segundos en total'})

    def test_report_rejects_invalid_model_output_and_normalizes_match(self):
        item, _ = self.start()
        self.commit(item)
        for raw in ({**REPORT, 'status': 'GENIAL'}, {**REPORT, 'feedback': ''}, 'texto'):
            with self.assertRaises(ValueError):
                self.report(item, raw, attempt='rx')
        out, _ = self.report(item, {**REPORT, 'prediction_match': 'quizá'}, attempt='r2')
        self.assertEqual(out['prediction_match'], 'PARTIAL')
        out, _ = self.report(item, {**REPORT, 'status': 'INSUFFICIENT'}, attempt='r3')
        self.assertEqual(out['status'], 'INSUFFICIENT')

    def test_routes_registered(self):
        for r in ('/api/challenge/start', '/api/challenge/commit', '/api/challenge/report'):
            self.assertIn(r, app.ROUTES)


if __name__ == '__main__':
    unittest.main()
