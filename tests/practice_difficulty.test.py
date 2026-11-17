"""practice_difficulty_v1: la banda de la práctica es un parámetro de selección; nunca concede crédito.

Servidor con proveedor controlado (SQLite temporal, sin red, con contador de llamadas) y, para las reglas que viven en app.js
(suficiencia, banda, histéresis), un puente a Node con historias sintéticas (practice_difficulty_runner.js).
"""
import copy
import inspect
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
from memory_store import DurableMemory, validate_store

CLEAN = {'issues': [], 'checked': True, 'items': []}
NODE = {'id': 'n1', 'name': 'Espesor de película', 'outcome': 'Calcular espesor'}
NUMERIC = {'applicable': True, 'prompt': 'Se aplican 120 g de polvo de manera uniforme sobre 2 m² de superficie. ¿Cuál es la masa aplicada por unidad de área, en g/m²?',
           'solution': 'Masa entre área: 120/2.', 'value': 60, 'unit': 'g/m²'}


def q(text):
    return {'prompt': text, 'reference': 'Criterio: ' + text, 'kind': 'explanation', 'observable_dimensions': ['conceptual']}


def lesson_raw():
    return {'explanation': 'Explicación', 'example': 'Ejemplo', 'common_error': 'Error', 'check': q('c'), 'guided': q('g'), 'independent': q('i'), 'integration': q('t')}


def confirmation_raw():
    return {'question': {'prompt': 'Convierte 3 km a metros y explica el paso', 'reference': 'Criterio', 'kind': 'units', 'observable_dimensions': ['units']}}


def attempts(mode):
    base = {'attempt_id': 'a1', 'phase': 'INDEPENDENT', 'response_text': 'x'}
    return {'initial': [],
            'repair': [{**base, 'result': 'MISCONCEPTION', 'help_used': 0, 'event': {'observed_dimensions': []}}],
            'scaffold': [{**base, 'result': 'CORRECT', 'help_used': 1, 'event': {'observed_dimensions': []}}],
            'consolidate': [{**base, 'result': 'CORRECT', 'help_used': 0, 'event': {'is_independent': True, 'observed_dimensions': []}}]}[mode]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'p.sqlite'
        self.mem = DurableMemory(self.path)
        self.old = (app._MEMORY, app._TEST_MEMORY)
        app.set_memory_for_tests(self.mem)
        self.pid = self.mem.create_profile('Prueba')['profile_id']
        self.other = self.mem.create_profile('Otra')['profile_id']
        self.prompts = []
        self.calls = 0

    def tearDown(self):
        app._MEMORY, app._TEST_MEMORY = self.old
        self.tmp.cleanup()

    def provider(self, raw):
        def fake(prompt, *args, **kwargs):
            self.calls += 1
            self.prompts.append(prompt)
            return copy.deepcopy(raw)
        return fake

    def forbidden(self, name):
        def fail(*args, **kwargs):
            raise AssertionError(name + ' no debe llamarse: la banda no añade llamadas al modelo.')
        return fail

    def run_node(self, scenarios):
        done = subprocess.run(['node', str(ROOT / 'tests' / 'practice_difficulty_runner.js')], input=json.dumps({'scenarios': scenarios}),
                              text=True, capture_output=True, cwd=ROOT, check=False)
        self.assertEqual(done.returncode, 0, done.stderr or done.stdout)
        return json.loads(done.stdout)


class ServerBands(Base):
    def lesson(self, data=None, mode='initial', raw=None):
        payload = {'goal': 'Pintura en polvo', 'name': 'Curado', 'profile_id': self.pid, 'goal_id': 'g1', 'node_id': 'n1', **(data or {})}
        memory = {'reason': None, 'sources': [], 'attempts': attempts(mode)}
        with patch.object(app, 'gemini', side_effect=self.provider(raw or lesson_raw())), patch.object(app, 'audit_content', return_value=CLEAN), \
                patch.object(app, 'judge_gemini', side_effect=self.forbidden('judge_gemini')), patch.object(app, 'audit_gemini', side_effect=self.forbidden('audit_gemini')), \
                patch.object(self.mem, 'relevant_memory', return_value=memory):
            return app.make_lesson(payload)

    def confirmation(self, **extra):
        data = {'goal': 'Conversión de unidades', 'concept': 'Unidades', 'target_dimension': 'units', 'previous': [], **extra}
        with patch.object(app, 'gemini', side_effect=self.provider(confirmation_raw())), \
                patch.object(app, 'judge_gemini', side_effect=self.forbidden('judge_gemini')), patch.object(app, 'audit_gemini', side_effect=self.forbidden('audit_gemini')):
            return app.evidence_confirmation(data)

    def production(self, raw=None, **extra):
        data = {'profile_id': self.pid, 'goal_id': 'g1', 'goal': 'Pintura en polvo', 'node': NODE, 'kind': 'numeric', **extra}
        with patch.object(app, 'gemini', side_effect=self.provider(raw or NUMERIC)), patch.object(app, 'audit_content', return_value=CLEAN):
            return app.make_production_item(data)

    # --- sin historial = standard, idéntico a hoy ---
    def test_absent_difficulty_is_standard_and_prompt_is_unchanged(self):
        without = self.confirmation()
        self.assertEqual(without['difficulty_band'], 'standard')
        explicit = self.confirmation(difficulty='standard')
        self.assertEqual(self.prompts[0], self.prompts[1], 'standard no añade nada al prompt')
        self.assertEqual(without['question'], explicit['question'])
        self.assertNotIn('Nivel de práctica base', self.prompts[0])
        self.assertNotIn('restricción relevante', self.prompts[0])
        self.lesson()
        self.lesson({'difficulty_band': 'standard'})
        self.assertEqual(self.prompts[2], self.prompts[3])
        self.assertNotIn('Nivel de práctica base', self.prompts[2])

    # --- /api/confirmation: lista cerrada ---
    def test_confirmation_accepts_the_three_bands_and_rejects_others(self):
        for band in ('base', 'standard', 'challenge'):
            out = self.confirmation(difficulty=band)
            self.assertEqual((out['difficulty_band'], out['difficulty_policy_version']), (band, 'practice_difficulty_v1'))
        self.assertIn('Nivel de práctica base', self.prompts[0])
        self.assertIn('restricción relevante', self.prompts[2])
        calls = self.calls
        for bad in ('hard', 'Base', 'CHALLENGE', '', None, 7, True, ['base'], {'x': 1}):
            with self.assertRaisesRegex(ValueError, 'Dificultad inválida'):
                self.confirmation(difficulty=bad)
        self.assertEqual(self.calls, calls, 'un valor fuera de lista no llama al modelo')
        self.assertIs(app.ROUTES['/api/confirmation'], app.evidence_confirmation)

    def test_production_validates_and_stores_the_band_with_the_item(self):
        for band in ('base', 'standard', 'challenge'):
            item = self.production(difficulty_band=band)
            self.assertEqual((item['difficulty_band'], item['difficulty_policy_version']), (band, 'practice_difficulty_v1'))
            stored = self.mem.load_placement_item(self.pid, item['item_id'])
            self.assertEqual(stored['public']['difficulty_band'], band)
        self.assertIn('Nivel de práctica base', self.prompts[0])
        self.assertNotIn('Nivel de práctica base', self.prompts[1])
        self.assertIn('restricción relevante', self.prompts[2])
        calls, items = self.calls, self.count_items()
        for bad in ('hard', '', None, 3):
            with self.assertRaisesRegex(ValueError, 'Dificultad inválida'):
                self.production(difficulty_band=bad)
        self.assertEqual(self.calls, calls)
        self.assertEqual(self.count_items(), items, 'nada guardado con un valor inválido')
        # Sin banda = standard.
        self.assertEqual(self.production()['difficulty_band'], 'standard')

    def count_items(self):
        import sqlite3
        db = sqlite3.connect(str(self.path))
        try:
            return db.execute('SELECT COUNT(*) FROM placement_items').fetchone()[0]
        finally:
            db.close()

    def test_lesson_rejects_invalid_band_before_calling_the_model(self):
        for bad in ('hard', '', None, 1, 'Base'):
            with self.assertRaisesRegex(ValueError, 'Dificultad inválida'):
                self.lesson({'difficulty_band': bad})
        self.assertEqual(self.calls, 0)

    # --- precedencia con lesson_adaptation ---
    def test_lesson_depth_wins_over_the_band(self):
        expected = {('base', 'repair'): 'base', ('base', 'scaffold'): 'base', ('base', 'consolidate'): 'standard', ('base', 'initial'): 'standard'}
        for requested in ('base', 'standard', 'challenge'):
            for mode in ('initial', 'repair', 'scaffold', 'consolidate'):
                self.prompts.clear()
                out = self.lesson({'difficulty_band': requested}, mode)
                self.assertEqual(out['adaptation_mode'], mode, 'la banda no cambia la profundidad de la lección')
                self.assertEqual(out['difficulty_requested'], requested)
                want = expected.get((requested, mode), 'standard')
                self.assertEqual(out['difficulty_band'], want, (requested, mode))
                self.assertEqual(out['difficulty_policy_version'], 'practice_difficulty_v1')
                self.assertEqual('Nivel de práctica base' in self.prompts[0], want == 'base', (requested, mode))
                depth = app.lesson_adaptation(attempts(mode))[2]
                self.assertIn(depth, self.prompts[0], 'la profundidad de la lección sigue en el prompt')
        self.assertEqual(app.lesson_band('challenge', 'consolidate'), 'standard', 'una lección nunca es desafío')

    def test_lesson_adaptation_function_is_untouched_by_the_band(self):
        for mode in ('initial', 'repair', 'scaffold', 'consolidate'):
            self.assertEqual(app.lesson_adaptation(attempts(mode))[0], mode)

    # --- cero llamadas nuevas ---
    def test_one_provider_call_per_request_whatever_the_band(self):
        for band in ('base', 'standard', 'challenge'):
            self.calls = 0
            self.lesson({'difficulty_band': band}, 'scaffold')
            self.assertEqual(self.calls, 1, 'lección: una llamada de generación (la auditoría se simula limpia)')
            self.calls = 0
            self.confirmation(difficulty=band)
            self.assertEqual(self.calls, 1)
            self.calls = 0
            self.production(difficulty_band=band)
            self.assertEqual(self.calls, 1)
        for fn in (app.practice_band, app.lesson_band):
            source = inspect.getsource(fn)
            self.assertNotIn('gemini', source)
            self.assertNotIn('memory()', source)

    def test_production_band_does_not_change_grading_or_isolation(self):
        item = self.production(difficulty_band='base')
        result = app.answer_production_item({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': 'att-1', 'value': 60, 'unit': 'g/m²'})
        self.assertEqual(result['status'], 'CORRECT')
        self.assertNotIn('difficulty_band', result, 'la corrección no hereda la banda: la banda no es crédito')
        with self.assertRaises(ValueError):
            app.answer_production_item({'profile_id': self.other, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': 'att-2', 'value': 60, 'unit': 'g/m²'})
        self.assertIsNone(self.mem.load_placement_item(self.other, item['item_id']))
        with self.assertRaises(ValueError):
            app.answer_production_item({'profile_id': self.pid, 'goal_id': 'otra-meta', 'item_id': item['item_id'], 'attempt_id': 'att-3', 'value': 60, 'unit': 'g/m²'})


class ClientRules(Base):
    """Reglas de app.js ejecutadas con historias sintéticas."""

    def test_rules_through_node(self):
        names = {
            'empty': ('', False), 'base_only': ('bSbS', True), 'base_hits_ramp': ('bSbSbS', False), 'standard_pair': ('SS', False),
            'help_only': ('SSH', False), 'unknown': ('SSUUUUUU', False), 'unknown_fails': ('FFUUUUUU', False),
            'duplicate': ('SSD', False), 'legacy': ('lSlSlS', False), 'hysteresis_8': ('FFFSSSS', False), 'hysteresis_9': ('FFFSSSSS', False),
            'hysteresis_10': ('FFFSSSSSS', False), 'base_fail': ('SS bF', True), 'stuck_4_of_5': ('FFSSSFSSS', False), 'sufficient': ('SS', True), 'challenge_fail': ('SS cF', True), 'standard_fail': ('SS F', True),
            'challenge_low': ('SS cF cF cF', True), 'standard_fails_down': ('FFF', False),
        }
        out = self.run_node([{'name': n, 'history': h, 'sufficient': s} for n, (h, s) in names.items()])
        self.assertEqual(out['empty']['band'], 'standard', 'sin historial: standard')
        self.assertEqual(out['base_only']['independent'], 0, 'una práctica base no suma para suficiencia')
        self.assertFalse(out['base_only']['direct_sufficient'])
        self.assertFalse(out['base_hits_ramp']['direct_sufficient'])
        self.assertEqual(out['standard_pair']['replayed'], 'standard')
        self.assertTrue(out['sufficient']['mastered'])
        self.assertEqual(out['help_only']['replayed'], 'standard', 'un acierto con pista no sube')
        self.assertEqual((out['unknown']['replayed'], out['unknown']['evidences']), ('standard', 2), 'UNKNOWN no mueve la banda')
        self.assertEqual(out['unknown_fails']['replayed'], 'standard')
        self.assertEqual(out['duplicate']['evidences'], 2, 'un duplicado no cuenta dos veces')
        self.assertEqual(out['duplicate']['replayed'], 'standard')
        self.assertEqual(out['legacy']['band'], 'standard', 'eventos sin banda: standard')
        self.assertEqual(out['hysteresis_8']['replayed'], 'standard')
        self.assertEqual(out['hysteresis_9']['replayed'], 'standard', 'la histéresis impide dos cambios seguidos')
        self.assertEqual(out['hysteresis_10']['replayed'], 'challenge')
        self.assertEqual(out['hysteresis_8']['replayed'], 'standard', 'salir de base con 4 de 5')
        self.assertEqual(out['stuck_4_of_5']['replayed'], 'standard', 'la secuencia FFSSSFSSS ya no se queda en base')
        self.assertFalse(out['base_fail']['mastered'], 'un fallo en base contradice y quita la suficiencia')
        self.assertTrue(out['challenge_fail']['mastered'], 'un fallo en desafío no cambia sufficient()')
        self.assertEqual(out['challenge_fail']['independent'], out['sufficient']['independent'], 'no borra aciertos previos')
        self.assertFalse(out['standard_fail']['mastered'], 'el mismo fallo en estándar sí')
        self.assertEqual(out['challenge_low']['replayed'], 'base', 'los fallos en desafío sí cuentan como dato de la banda')
        self.assertTrue(out['challenge_low']['mastered'], 'y aun así no quitan la suficiencia')
        self.assertEqual(out['standard_fails_down']['replayed'], 'base')


class StoreCompatibility(Base):
    def store(self, events, coverage_evidence=None):
        node = {'id': 'n1', 'name': 'Espesor', 'outcome': 'Medir', 'level': 0, 'kind': 'concept', 'prerequisites': [], 'probe': None}
        coverage = [{'id': 'n1', 'dimensions': [{'id': 'direct_application', 'evidence': coverage_evidence if coverage_evidence is not None else []}]}]
        return {'goals': [{'id': 'goal-1', 'goal': 'Meta', 'nodes': [node], 'coverage': coverage, 'learner': {}, 'lessons': {}, 'reviews': [], 'events': events,
                           'session': {'mode': 'DIAGNOSTIC', 'node': None, 'stack': [], 'stage': 'teach', 'tries': 0}, 'repairEpisodes': [], 'contextStack': [], 'map_updates': []}], 'active': 'goal-1'}

    def event(self, n, **extra):
        return {'type': 'EVIDENCE', 'node_id': 'n1', 'attempt_id': f'att-{n}', 'evidence_id': f'ev-{n}', 'result': 'CORRECT', 'phase': 'INDEPENDENT', **extra}

    def test_legacy_events_without_band_pass_and_stay_untouched(self):
        raw = self.store([self.event(1), self.event(2)], [self.event(3)])
        checked = validate_store(copy.deepcopy(raw), self.pid)[0]
        for ev in checked['goals'][0]['events'] + checked['goals'][0]['coverage'][0]['dimensions'][0]['evidence']:
            self.assertNotIn('difficulty_band', ev, 'no se inventan bandas')
            self.assertNotIn('difficulty_policy_version', ev)

    def test_valid_band_is_kept_and_invalid_is_dropped_without_rejecting(self):
        good = {'difficulty_band': 'base', 'difficulty_policy_version': 'practice_difficulty_v1'}
        raw = self.store([self.event(1, **good), self.event(2, difficulty_band='challenge'), self.event(3, difficulty_band='raro', difficulty_policy_version='practice_difficulty_v1'),
                          self.event(4, difficulty_band='base', difficulty_policy_version='otra')], [self.event(5, **good), self.event(6, difficulty_band='challenge')])
        goal = validate_store(copy.deepcopy(raw), self.pid)[0]['goals'][0]
        events = goal['events']
        self.assertEqual((events[0]['difficulty_band'], events[0]['difficulty_policy_version']), ('base', 'practice_difficulty_v1'))
        for bad in events[1:]:
            self.assertNotIn('difficulty_band', bad)
            self.assertNotIn('difficulty_policy_version', bad)
        evidence = goal['coverage'][0]['dimensions'][0]['evidence']
        self.assertEqual(evidence[0]['difficulty_band'], 'base')
        self.assertNotIn('difficulty_band', evidence[1], 'un desafío sin versión no puede eximir fallos')

    def test_discarded_band_does_not_keep_the_challenge_exemption(self):
        exempt = {'result': 'MISCONCEPTION', 'evidence_role': 'learning', 'contradicts_sufficiency': False, 'counts_as_learning_failure': False}
        raw = self.store([self.event(1, **exempt, difficulty_band='challenge'),  # sin versión: la banda se descarta
                          self.event(2, **exempt, difficulty_band='challenge', difficulty_policy_version='practice_difficulty_v1'),  # banda verificable: se conserva
                          self.event(3, **{**exempt, 'evidence_role': 'evaluation_audit'}, difficulty_band='raro')])
        events = validate_store(copy.deepcopy(raw), self.pid)[0]['goals'][0]['events']
        self.assertNotIn('difficulty_band', events[0])
        self.assertIs(events[0]['contradicts_sufficiency'], True, 'sin banda verificable el fallo contradice')
        self.assertIs(events[0]['counts_as_learning_failure'], True)
        self.assertEqual(events[1]['difficulty_band'], 'challenge')
        self.assertIs(events[1]['contradicts_sufficiency'], False)
        self.assertIs(events[2]['contradicts_sufficiency'], False, 'una auditoría no se convierte en fallo')

    def test_restore_backup_round_trips_and_profiles_stay_isolated(self):
        good = {'difficulty_band': 'challenge', 'difficulty_policy_version': 'practice_difficulty_v1'}
        self.mem.save(self.pid, self.store([self.event(1, **good), self.event(2)]))
        backup = self.mem.export(self.pid)
        self.mem.save(self.pid, self.store([]))
        self.mem.restore(self.pid, backup)
        events = self.mem.load(self.pid)['store']['goals'][0]['events']
        self.assertEqual(events[0]['difficulty_band'], 'challenge')
        self.assertNotIn('difficulty_band', events[1])
        other = self.mem.load(self.other)
        self.assertEqual((other.get('store') or {}).get('goals', []), [], 'otro perfil no ve las bandas')


if __name__ == '__main__':
    unittest.main()
