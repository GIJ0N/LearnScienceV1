"""content_trust_v1: auditoría de contenido, pistas por pregunta, reportes y profundidad del mapa."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
from memory_store import DurableMemory

NODES = [{'id': 'a', 'name': 'Fracciones', 'outcome': 'Operar', 'prerequisites': []},
         {'id': 'b', 'name': 'Proporciones', 'outcome': 'Resolver', 'prerequisites': ['a']}]


def q(text):
    return {'prompt': text, 'reference': 'Criterio: ' + text, 'kind': 'explanation', 'observable_dimensions': ['conceptual']}


def lesson(tag='v1'):
    return {'explanation': 'Explicación ' + tag, 'example': 'Ejemplo ' + tag, 'common_error': 'Error ' + tag,
            'check': q('c ' + tag), 'guided': q('g ' + tag), 'independent': q('i ' + tag), 'integration': q('t ' + tag)}


def choice(node_id):
    return {'node_id': node_id, 'prompt': f'Pregunta de {node_id}', 'correct_option_id': 'a', 'explanation': 'Porque sí.',
            'options': [{'id': 'a', 'text': 'Correcta', 'misconception': ''},
                        {'id': 'b', 'text': 'Falla uno', 'misconception': 'Confunde uno con otro.'},
                        {'id': 'c', 'text': 'Falla dos', 'misconception': 'Confunde dos con otro.'}]}


def issues(*pairs):
    return {'issues': [{'item': n, 'problem': p} for n, p in pairs]}


class ContentTrust(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'c.sqlite')
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.patches = [patch.object(app, 'memory', return_value=self.memory), patch.object(app, 'CONTENT_VERIFY', True)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    # --- auditoría ---
    def test_audit_fails_open_and_marks_unchecked(self):
        with patch.object(app, 'gemini', side_effect=ValueError('Límite local alcanzado')):
            r = app.audit_content('Meta', 'Tema', 'material')
        self.assertEqual(r, {'checked': False, 'issues': [], 'items': []})
        with patch.object(app, 'gemini', return_value={'otra': 1}):
            self.assertFalse(app.audit_content('Meta', 'Tema', 'material')['checked'])

    def test_audit_disabled_makes_no_call(self):
        with patch.object(app, 'CONTENT_VERIFY', False), patch.object(app, 'gemini') as g:
            self.assertFalse(app.audit_content('M', 'T', 'x')['checked'])
        g.assert_not_called()

    def test_audit_parses_issues(self):
        with patch.object(app, 'gemini', return_value=issues((0, 'El aceite es menos denso que el agua.'))):
            r = app.audit_content('Física', 'Flotación', 'material')
        self.assertTrue(r['checked'])
        self.assertEqual(r['issues'], ['El aceite es menos denso que el agua.'])

    # --- lección ---
    def test_lesson_regenerates_once_with_the_detected_errors(self):
        prompts = []
        replies = [lesson('v1'), issues((0, 'Cubo que flota con empuje mayor al peso.')), lesson('v2'), {'issues': []}]
        def fake(prompt, schema, max_tokens):
            prompts.append(prompt)
            return replies.pop(0)
        with patch.object(app, 'gemini', side_effect=fake):
            out = app.make_lesson({'goal': 'Física', 'name': 'Flotación'})
        self.assertEqual(out['explanation'], 'Explicación v2')
        self.assertEqual(out['content_check'], {'checked': True, 'attempts': 2})
        self.assertIn('Cubo que flota con empuje mayor al peso.', prompts[2])
        self.assertNotIn('Cubo que flota', prompts[0])

    def test_lesson_discarded_after_two_failed_audits(self):
        replies = [lesson('v1'), issues((0, 'Error A')), lesson('v2'), issues((0, 'Error B'))]
        with patch.object(app, 'gemini', side_effect=replies):
            with self.assertRaisesRegex(ValueError, 'revisión de contenido'):
                app.make_lesson({'goal': 'Física', 'name': 'Flotación'})

    def test_lesson_includes_reported_notes_and_unchecked_still_delivers(self):
        prompts = []
        replies = [lesson(), ValueError('sin cuota')]
        def fake(prompt, schema, max_tokens):
            prompts.append(prompt)
            r = replies.pop(0)
            if isinstance(r, Exception):
                raise r
            return r
        with patch.object(app, 'gemini', side_effect=fake):
            out = app.make_lesson({'goal': 'Física', 'name': 'Flotación', 'reported': ['El aceite no es más denso que el agua']})
        self.assertIn('El aceite no es más denso que el agua', prompts[0])
        self.assertEqual(out['content_check'], {'checked': False, 'attempts': 1})

    # --- diagnóstico ---
    def generate(self, audit):
        replies = [{'items': [choice('a'), choice('b')]}, audit]
        with patch.object(app, 'gemini', side_effect=replies):
            return app.make_placement_items({'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Aritmética', 'nodes': NODES, 'node_ids': ['a', 'b']})

    def test_placement_drops_only_the_flagged_questions(self):
        out = self.generate(issues((2, 'Ambigua')))
        self.assertEqual([i['node_id'] for i in out['items']], ['a'])

    def test_placement_all_flagged_raises_and_saves_nothing(self):
        with self.assertRaisesRegex(ValueError, 'revisión de contenido'):
            self.generate(issues((1, 'Mala'), (2, 'Peor')))

    def test_placement_whole_batch_note_does_not_drop_questions(self):
        out = self.generate(issues((0, 'Comentario general')))
        self.assertEqual(len(out['items']), 2)

    # --- pistas ---
    def hint(self, reply, **extra):
        data = {'goal': 'Física', 'name': 'Flotación', 'question': {'prompt': '¿Flota?', 'reference': 'Flota si su densidad es menor que la del agua.'}}
        data.update(extra)
        with patch.object(app, 'gemini', return_value=reply) as g:
            return app.make_hint(data), g.call_args[0][0]

    def test_hint_levels_and_prompt(self):
        out, prompt = self.hint({'hint': 'Compara la densidad del objeto con la del agua.'}, level=3, previous=['Piensa en el peso'])
        self.assertEqual(out['level'], 3)
        self.assertIn('nivel 3', prompt)
        self.assertIn('Piensa en el peso', prompt)
        out, _ = self.hint({'hint': 'Mira qué dato falta.'}, level=9)
        self.assertEqual(out['level'], 1)

    def test_hint_that_reveals_the_key_is_discarded(self):
        with self.assertRaisesRegex(ValueError, 'respuesta'):
            self.hint({'hint': 'Recuerda: Flota si su densidad es menor que la del agua.'})
        with self.assertRaises(ValueError):
            self.hint({'hint': ''})
        with self.assertRaises(ValueError):
            app.make_hint({'goal': 'x', 'name': 'y', 'question': {}})

    # --- reportes ---
    def test_report_is_stored_and_cascades_with_the_profile(self):
        r = app.report_content({'profile_id': self.profile, 'goal_id': 'g1', 'node_id': 'a', 'kind': 'lesson', 'excerpt': 'texto', 'note': 'Está mal'})
        self.assertEqual(r, {'saved': True})
        rows = self.memory.load_content_reports(self.profile, 'g1')
        self.assertEqual([(x['kind'], x['note']) for x in rows], [('lesson', 'Está mal')])
        self.memory.delete_profile(self.profile)
        other = self.memory.create_profile('Otro')['profile_id']
        self.assertEqual(self.memory.load_content_reports(other), [])

    def test_report_validation(self):
        for bad in ({'kind': 'lesson', 'goal_id': 'g1'}, {'profile_id': self.profile, 'goal_id': 'g1', 'kind': 'otra'},
                    {'profile_id': self.profile, 'kind': 'lesson'}, {'profile_id': 'no-existe', 'goal_id': 'g1', 'kind': 'lesson'}):
            with self.assertRaises(ValueError):
                app.report_content(bad)

    def test_routes_registered(self):
        self.assertIs(app.ROUTES['/api/hint'], app.make_hint)
        self.assertIs(app.ROUTES['/api/content/report'], app.report_content)


class DepthProfiles(unittest.TestCase):
    def areas(self):
        return {'scope': 'Meta.', 'areas': [{'name': f'Área {i}', 'outcome': f'R{i}', 'estimated_topics': 5} for i in range(1, 5)]}

    def nodes(self):
        names = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco']
        nodes = [{'id': f'n{i}', 'name': n, 'outcome': 'Resolver', 'level': i - 1, 'prerequisites': [f'n{i - 1}'] if i > 1 else [], 'kind': 'concept',
                  'probe': {'prompt': f'¿{n}?', 'reference': 'r', 'kind': 'explanation', 'observable_dimensions': ['conceptual']}} for i, n in enumerate(names, 1)]
        cov = [{'id': n['id'], 'name': n['name'], 'kind': 'concept', 'priority': 'important', 'prerequisites': n['prerequisites'], 'contexts': [],
                'dimensions': [{'id': 'conceptual', 'name': 'Comprensión', 'required': True}]} for n in nodes]
        return {'nodes': nodes, 'coverage': cov}

    def run_map(self, depth):
        data = {'goal': 'Entender por qué flotan los barcos', 'context': ''}
        if depth is not None:
            data['depth'] = depth
        with patch.object(app, 'gemini', side_effect=[self.areas(), self.nodes()]) as g:
            out = app.make_area_map(data)
        return out, [c[0][0] for c in g.call_args_list]

    def test_depth_shapes_both_prompts_and_is_returned(self):
        out, prompts = self.run_map('curiosidad')
        self.assertEqual(out['depth'], 'curiosidad')
        self.assertIn('curiosidad', prompts[0])
        self.assertIn('de 4 a 5', prompts[0])
        self.assertIn('4 a 6', prompts[1])

    def test_unknown_or_missing_depth_keeps_the_expert_default(self):
        for value in (None, 'otra'):
            out, prompts = self.run_map(value)
            self.assertEqual(out['depth'], 'experto')
            self.assertIn('de 5 a 10', prompts[0])

    def test_expand_receives_depth(self):
        areas = [{'id': 'area-1', 'name': 'A', 'outcome': 'o'}, {'id': 'area-2', 'name': 'B', 'outcome': 'o'}]
        nodes = self.nodes()
        with patch.object(app, 'gemini', return_value=nodes) as g:
            app.expand_map({'goal': 'Entender barcos', 'area_id': 'area-2', 'areas': areas, 'existing_nodes': [], 'depth': 'profesional'})
        self.assertIn('nivel profesional', g.call_args[0][0])


if __name__ == '__main__':
    unittest.main()
