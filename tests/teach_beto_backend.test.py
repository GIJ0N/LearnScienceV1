"""teach_beto_v1: creencia privada, turnos acotados, estados válidos, sin filtrar la idea correcta, idempotencia."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory

NODE = {'id': 'n1', 'name': 'Flotación', 'outcome': 'Explicar por qué flota un objeto'}
BELIEF = 'Los objetos flotan solo porque son ligeros.'
CORRECT = 'Un objeto flota cuando su densidad media es menor que la del fluido.'
START = {'belief': BELIEF, 'correct_idea': CORRECT, 'opening': 'Yo creo que un barco de acero flota porque es muy ligero. ¿Por qué entonces se hunde una moneda?'}


def turn_reply(status='PERSISTS', reply='Mmm, ¿y qué pasa con un tronco pesado que sí flota?', **extra):
    out = {'beto_reply': reply, 'status': status, 'learner_issues': ['No explicó la densidad.'], 'debrief': 'Faltó hablar de densidad.'}
    out.update(extra)
    return out


class TeachBeto(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'b.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.patches = [patch.object(app, 'memory', return_value=self.memory), patch.object(app, 'CONTENT_VERIFY', False)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def start(self, raw=None, **extra):
        data = {'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Entender barcos', 'node': NODE}
        data.update(extra)
        with patch.object(app, 'gemini', return_value=raw or START) as g:
            return app.beto_start(data), g

    def turn(self, session, reply, message='Un objeto flota si su densidad es menor que la del agua, por eso un barco hueco flota.', attempt='t1', history=None, **extra):
        data = {'profile_id': self.profile, 'goal_id': 'g1', 'item_id': session['item_id'], 'attempt_id': attempt, 'message': message,
                'history': history if history is not None else [{'role': 'beto', 'text': session['opening']}]}
        data.update(extra)
        with patch.object(app, 'gemini', return_value=reply) as g:
            return app.beto_turn(data), g

    # --- inicio ---
    def test_start_exposes_only_the_opening(self):
        out, g = self.start()
        self.assertTrue(out['item_id'].startswith('beto-'))
        self.assertEqual(out['opening'], START['opening'])
        self.assertEqual(out['max_turns'], 4)
        self.assertNotIn('belief', out)
        self.assertNotIn('correct_idea', out)
        stored = self.memory.load_placement_item(self.profile, out['item_id'])
        self.assertEqual(stored['private'], {'belief': BELIEF, 'correct_idea': CORRECT})
        self.assertIn('UNA idea equivocada', g.call_args[0][0])

    def test_start_rejects_incomplete_or_degenerate_output(self):
        for raw in ({'belief': '', 'correct_idea': CORRECT, 'opening': 'hola'}, {'belief': BELIEF, 'correct_idea': CORRECT}, {'belief': CORRECT, 'correct_idea': CORRECT, 'opening': 'hola'}, 'texto'):
            with self.assertRaises(ValueError):
                self.start(raw)
        with self.assertRaisesRegex(ValueError, 'Falta perfil'):
            self.start(node={})

    def test_start_is_audited_and_nothing_is_saved_when_it_fails(self):
        with patch.object(app, 'CONTENT_VERIFY', True), patch.object(app, 'gemini', side_effect=[START, {'issues': [{'item': 0, 'problem': 'La idea correcta es falsa.'}]}]):
            with self.assertRaisesRegex(ValueError, 'revisión de contenido'):
                app.beto_start({'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Entender barcos', 'node': NODE})

    # --- turnos ---
    def test_intermediate_turn_hides_the_private_data(self):
        session, _ = self.start()
        out, g = self.turn(session, turn_reply('PARTIAL'))
        self.assertEqual((out['turn'], out['status'], out['final'], out['provisional']), (1, 'PARTIAL', False, True))
        for key in ('correct_idea', 'debrief', 'learner_issues'):
            self.assertNotIn(key, out)
        prompt = g.call_args[0][0]
        self.assertIn(BELIEF, prompt)
        self.assertIn('Nunca digas la idea correcta', prompt)
        self.assertIn('<<<Un objeto flota si su densidad', prompt)

    def test_corrected_ends_the_session_and_reveals_the_idea(self):
        session, _ = self.start()
        out, _ = self.turn(session, turn_reply('CORRECTED', 'Ahora entiendo: depende de cuánto pesa por volumen.'))
        self.assertTrue(out['final'])
        self.assertEqual(out['correct_idea'], CORRECT)
        self.assertEqual(out['learner_issues'], ['No explicó la densidad.'])
        self.assertTrue(out['debrief'])

    def test_the_last_allowed_turn_is_final_even_without_convincing_beto(self):
        session, _ = self.start()
        history = [{'role': 'beto', 'text': 'a'}, {'role': 'learner', 'text': 'b'}, {'role': 'beto', 'text': 'c'}, {'role': 'learner', 'text': 'd'}, {'role': 'beto', 'text': 'e'}, {'role': 'learner', 'text': 'f'}, {'role': 'beto', 'text': 'g'}]
        out, _ = self.turn(session, turn_reply('PERSISTS'), history=history, attempt='t4')
        self.assertEqual(out['turn'], 4)
        self.assertTrue(out['final'])
        self.assertEqual(out['status'], 'PERSISTS')
        too_many = history + [{'role': 'learner', 'text': 'h'}, {'role': 'beto', 'text': 'i'}]
        with self.assertRaisesRegex(ValueError, 'ya terminó'):
            self.turn(session, turn_reply(), history=too_many, attempt='t5')

    def test_invalid_states_and_leaks_are_rejected_and_nothing_is_stored(self):
        session, _ = self.start()
        with self.assertRaisesRegex(ValueError, 'incompleta'):
            self.turn(session, turn_reply('GENIAL'))
        with self.assertRaisesRegex(ValueError, 'incompleta'):
            self.turn(session, turn_reply('PERSISTS', ''))
        with self.assertRaisesRegex(ValueError, 'reveló la idea correcta'):
            self.turn(session, turn_reply('PARTIAL', 'Ah, ¿entonces ' + CORRECT.lower() + '?'))
        self.assertIsNone(self.memory.load_choice_answer(self.profile, 'g1', session['item_id'], 't1'))

    def test_message_validation_and_session_ownership(self):
        session, _ = self.start()
        with self.assertRaisesRegex(ValueError, 'con tus palabras'):
            self.turn(session, turn_reply(), message='no sé')
        with self.assertRaisesRegex(ValueError, 'no existe para esta meta'):
            self.turn(session, turn_reply(), goal_id='otra')
        with self.assertRaisesRegex(ValueError, 'no existe para esta meta'):
            self.turn({**session, 'item_id': 'beto-inexistente'}, turn_reply())
        placement_like = {'schema_version': 'placement_v1', 'item_id': 'placement-x', 'node_id': 'n1'}
        self.memory.save_placement_items(self.profile, 'g1', [(placement_like, {'correct_option_id': 'a', 'explanation': 'x', 'misconceptions': {}})])
        with self.assertRaisesRegex(ValueError, 'no existe para esta meta'):
            self.turn({**session, 'item_id': 'placement-x'}, turn_reply())

    def test_idempotent_by_attempt_and_conflict_on_other_text(self):
        session, _ = self.start()
        first, _ = self.turn(session, turn_reply('PARTIAL'))
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe volver a llamar al modelo')):
            again = app.beto_turn({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': session['item_id'], 'attempt_id': 't1',
                                   'message': 'Un objeto flota si su densidad es menor que la del agua, por eso un barco hueco flota.', 'history': [{'role': 'beto', 'text': session['opening']}]})
            self.assertEqual(again['status'], first['status'])
            with self.assertRaisesRegex(ValueError, 'otro mensaje'):
                app.beto_turn({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': session['item_id'], 'attempt_id': 't1',
                               'message': 'Un mensaje completamente distinto del anterior.', 'history': []})

    def test_other_activities_cannot_be_answered_as_beto(self):
        session, _ = self.start()
        key = {'profile_id': self.profile, 'goal_id': 'g1', 'item_id': session['item_id'], 'attempt_id': 'x', 'selected_option_id': 'a'}
        with self.assertRaisesRegex(ValueError, 'otra actividad'):
            app.answer_error_hunt_item(key)

    def test_routes_registered(self):
        self.assertIs(app.ROUTES['/api/beto/start'], app.beto_start)
        self.assertIs(app.ROUTES['/api/beto/turn'], app.beto_turn)


if __name__ == '__main__':
    unittest.main()
