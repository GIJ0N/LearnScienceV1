"""transfer_probe_v1 (L2b): sondeo de transferencia servidor. Proveedor controlado, SQLite temporal, sin juez ni Gemini real."""
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app
from memory_store import DurableMemory

DAY_MS = 86400000
CHECK_N1 = 'Explica con tus palabras qué mide el espesor de película seca en una pieza recién pintada.'
EXAMPLE_N1 = 'Ejemplo: una pieza de 2 m² recibe 120 g de polvo y el resultado se reporta en g/m².'
NUMERIC_PROMPT = 'Un horno procesa 240 piezas por turno de 8 horas. Si cada pieza ocupa 0,5 m² de superficie, ¿cuántos metros cuadrados se curan por hora?'
NUMERIC = {'applicable': True, 'prompt': NUMERIC_PROMPT, 'solution': 'Piezas por hora: 240/8; superficie: 30 por hora por 0,5.', 'value': 15, 'unit': 'm²/h'}
NUMERIC_OTHER = {'applicable': True, 'prompt': 'Una cabina de polvo aplica 90 g en 3 m² de chapa en la línea oeste. ¿Cuál es la masa por área en g/m²?', 'solution': 'Masa entre área: 90/3.', 'value': 30, 'unit': 'g/m²'}
NUMERIC_BANK = [
    {'applicable': True, 'prompt': 'Un transportador lleva 18 piezas por minuto a una cabina de polvo en la línea oeste. ¿Cuántas piezas llegan en 45 minutos?', 'solution': '18 por 45.', 'value': 810, 'unit': 'piezas'},
    {'applicable': True, 'prompt': 'Un taller reparte 96 kilos de pintura en 12 bidones iguales. ¿Cuántos kilos contiene cada bidón?', 'solution': '96 entre 12.', 'value': 8, 'unit': 'kg'},
    {'applicable': True, 'prompt': 'Una bodega almacena 350 cajas y envía 125 cada día. ¿Cuántos días tardará en vaciarse?', 'solution': '350 entre 125.', 'value': 2.8, 'unit': 'd'},
    {'applicable': True, 'prompt': 'Un calentador consume 4 kW durante 6 horas por ciclo. ¿Qué energía usa en un ciclo?', 'solution': '4 por 6.', 'value': 24, 'unit': 'kWh'},
]
NUMERIC_SIMILAR = dict(NUMERIC, prompt=CHECK_N1 + ' Un horno procesa 240 piezas por turno.')
STEPS = ['Limpiar y desengrasar la pieza antes de pintar', 'Colgar la pieza y asegurar el contacto de tierra', 'Aplicar el polvo con la pistola electrostática', 'Curar la pieza en el horno a la temperatura indicada']
ORDERING = {'applicable': True, 'prompt': 'Preparas una pieza nueva para recubrirla en la línea norte.', 'solution': 'Cada paso depende del anterior.', 'steps': STEPS}
NOT_APPLICABLE = {'applicable': False}
CLEAN = {'issues': [], 'checked': True}


def goal_store(goal_id='g1', nodes=('n1', 'n2'), events=None, lessons=True):
    names = {'n1': 'Espesor de película', 'n2': 'Curado'}
    node_list = [{'id': n, 'name': names[n], 'outcome': 'Resolver con criterio', 'level': i, 'kind': 'concept', 'prerequisites': [], 'probe': None} for i, n in enumerate(nodes)]
    lesson_map = {}
    if lessons and 'n1' in nodes:
        lesson_map['n1'] = {'check': {'prompt': CHECK_N1, 'kind': 'conceptual'}, 'guided': {'prompt': 'Guiado: ' + CHECK_N1}, 'independent': {'prompt': 'Independiente: ' + CHECK_N1}, 'integration': {'prompt': 'Integra: ' + CHECK_N1}, 'example': EXAMPLE_N1}
    return {'id': goal_id, 'goal': 'Pintura en polvo', 'nodes': node_list, 'coverage': [], 'learner': {}, 'lessons': lesson_map, 'reviews': [], 'events': list(events or []),
            'session': {'mode': 'DIAGNOSTIC', 'node': None, 'stack': [], 'stage': 'teach', 'tries': 0}, 'repairEpisodes': [], 'contextStack': [], 'map_updates': []}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.mem = DurableMemory(Path(self.tmp.name) / 'p.sqlite')
        self.old = (app._MEMORY, app._TEST_MEMORY)
        app.set_memory_for_tests(self.mem)
        self.pid = self.mem.create_profile('Prueba')['profile_id']
        self.store([goal_store()])
        self.old_limit = app.TRANSFER_DAILY_LIMIT
        app.TRANSFER_DAILY_LIMIT = 10
        app._TRANSFER_USAGE.clear()

    def tearDown(self):
        app._MEMORY, app._TEST_MEMORY = self.old
        app.TRANSFER_DAILY_LIMIT = self.old_limit
        self.tmp.cleanup()

    def store(self, goals, active='g1'):
        self.mem.save(self.pid, {'goals': goals, 'active': active})

    def probe(self, node='n1', goal='g1', responses=(), audit=CLEAN):
        queue = list(responses)
        with patch.object(app, 'gemini', side_effect=lambda *a, **k: queue.pop(0)) as g, patch.object(app, 'audit_content', return_value=audit):
            try:
                out = app.make_transfer_probe({'profile_id': self.pid, 'goal_id': goal, 'node_id': node})
            finally:
                self.calls = g.call_count
                self.prompts = [c.args[0] for c in g.call_args_list]
        return out

    def answer(self, item):
        return app.answer_production_item({'profile_id': self.pid, 'goal_id': 'g1', 'item_id': item['item_id'], 'attempt_id': 'att-' + item['item_id'], 'value': 15, 'unit': 'm²/h'})


class ContractAndRoute(Base):
    def test_produce_endpoint_still_rejects_transfer_before_model(self):
        with patch.object(app, 'gemini') as g:
            with self.assertRaisesRegex(ValueError, 'Propósito'):
                app.make_production_item({'profile_id': self.pid, 'goal_id': 'g1', 'goal': 'Pintura', 'node': {'id': 'n1', 'name': 'Espesor', 'outcome': 'x'}, 'kind': 'numeric', 'purpose': 'transfer'})
        self.assertEqual(g.call_count, 0)
        self.assertEqual(self.mem.placement_prompts(self.pid), [])

    def test_transfer_builder_publishes_expected_unit_and_needs_four_steps(self):
        public, _ = app._build_production_item(NUMERIC, 'n1', 'numeric', 'transfer')
        self.assertEqual(public['expected_unit'], 'm²/h')
        self.assertEqual(public['purpose'], 'transfer')
        with self.assertRaisesRegex(ValueError, 'de 4 a 6 pasos'):
            app._build_production_item(dict(ORDERING, steps=STEPS[:3]), 'n1', 'ordering', 'transfer')
        public, _ = app._build_production_item(ORDERING, 'n1', 'ordering', 'transfer')
        self.assertEqual(len(public['steps']), 4)

    def test_route_is_registered(self):
        self.assertIs(app.ROUTES['/api/practice/transfer'], app.make_transfer_probe)

    def test_unknown_node_fails_before_model(self):
        with patch.object(app, 'gemini') as g:
            with self.assertRaisesRegex(ValueError, 'tema'):
                app.make_transfer_probe({'profile_id': self.pid, 'goal_id': 'g1', 'node_id': 'zz'})
        self.assertEqual(g.call_count, 0)

    def test_public_item_is_standard_and_has_no_key(self):
        out = self.probe(responses=[NUMERIC])
        self.assertEqual(out['purpose'], 'transfer')
        self.assertEqual(out['transfer_probe_version'], 'transfer_probe_v1')
        self.assertIn(out['context_family'], app.TRANSFER_CONTEXTS)
        self.assertEqual(out['difficulty_band'], 'standard')
        self.assertTrue(out['distance_checked'])
        self.assertEqual(out['expected_unit'], 'm²/h')
        self.assertNotIn('value', out)
        self.assertNotIn('solution', out)

    def test_prompt_is_isolated_and_does_not_name_the_topic(self):
        self.probe(responses=[NUMERIC])
        prompt = self.prompts[0]
        self.assertIn('Pintura en polvo', prompt)
        self.assertIn('No nombres el tema', prompt)
        self.assertNotIn(EXAMPLE_N1, prompt)
        self.assertNotIn(CHECK_N1, prompt)
        self.assertNotIn('Independiente:', prompt)

    def test_retry_prompt_is_generic_and_does_not_quote_previous_text(self):
        out = self.probe(responses=[NUMERIC_SIMILAR, NUMERIC_OTHER])
        self.assertEqual(self.calls, 2)
        retry = self.prompts[1]
        self.assertIn('demasiado parecido a una pregunta anterior', retry)
        self.assertIn('cambia el contexto y la estructura de la situación', retry)
        self.assertNotIn('Explica con tus palabras', retry)
        self.assertNotIn('Un horno procesa 240 piezas', retry)
        self.assertNotIn('value', out)


class Reuse(Base):
    def test_unanswered_probe_is_reused_without_new_generation(self):
        first = self.probe(responses=[NUMERIC_OTHER])
        second = self.probe(responses=[])
        self.assertEqual(self.calls, 0)
        self.assertEqual(second['item_id'], first['item_id'])

    def test_answered_probe_is_not_reused(self):
        first = self.probe(responses=[NUMERIC_OTHER])
        self.answer(first)
        second = self.probe(responses=[NUMERIC_BANK[0]])
        self.assertEqual(self.calls, 1)
        self.assertNotEqual(second['item_id'], first['item_id'])

    def test_store_query_reports_probes_and_answers(self):
        item = self.probe(responses=[NUMERIC_OTHER])
        self.mem.save_placement_items(self.pid, 'g1', [({'item_id': 'practica-1', 'node_id': 'n1', 'purpose': 'practice', 'prompt': 'otra'}, {})])
        rows = self.mem.transfer_probe_items(self.pid, 'g1')
        self.assertEqual([r['item_id'] for r in rows], [item['item_id']])
        self.assertEqual(rows[0]['node_id'], 'n1')
        self.assertFalse(rows[0]['answered'])
        self.answer(item)
        self.assertTrue(self.mem.transfer_probe_items(self.pid, 'g1')[0]['answered'])


class Limits(Base):
    def fill_node(self, node='n1', count=4):
        for i in range(count):
            self.answer(self.probe(node=node, responses=[NUMERIC_BANK[i]]))

    def test_per_node_cap_counts_server_items(self):
        self.fill_node('n1', 4)
        with self.assertRaisesRegex(ValueError, 'TRANSFER_LIMIT'):
            self.probe(node='n1')
        self.assertEqual(self.calls, 0)

    def test_teaching_exposure_releases_the_cap(self):
        self.fill_node('n1', 4)
        self.store([goal_store(events=[{'type': 'TEACHING_EXPOSURE', 'node_id': 'n1', 'at': int(time.time() * 1000) + 1000, 'policy_version': 'retrieval_gap_v1'}])])
        out = self.probe(node='n1', responses=[NUMERIC_OTHER])
        self.assertEqual(self.calls, 1)
        self.assertEqual(out['purpose'], 'transfer')

    def test_seven_days_after_last_probe_releases_the_cap(self):
        self.fill_node('n1', 4)
        last = max(r['created_at'] for r in self.mem.transfer_probe_items(self.pid, 'g1'))
        with patch.object(app, '_transfer_now_ms', return_value=last // 1000000 + 7 * DAY_MS + 1):
            self.probe(node='n1', responses=[NUMERIC_OTHER])
        self.assertEqual(self.calls, 1)

    def test_daily_quota_is_per_profile(self):
        self.store([goal_store(nodes=('n1', 'n2'))])
        with patch.object(app, 'TRANSFER_DAILY_LIMIT', 1):
            self.probe(node='n1', responses=[NUMERIC_OTHER])
            with self.assertRaisesRegex(ValueError, 'TRANSFER_QUOTA'):
                self.probe(node='n2')
        self.assertEqual(self.calls, 0)

    def test_concurrent_requests_generate_once(self):
        started, release = threading.Event(), threading.Event()
        results = {}

        def slow(*a, **k):
            started.set()
            release.wait(5)
            return NUMERIC_OTHER

        def first():
            results['first'] = app.make_transfer_probe({'profile_id': self.pid, 'goal_id': 'g1', 'node_id': 'n1'})

        with patch.object(app, 'gemini', side_effect=slow) as g, patch.object(app, 'audit_content', return_value=CLEAN):
            thread = threading.Thread(target=first)
            thread.start()
            self.assertTrue(started.wait(5))
            with self.assertRaisesRegex(ValueError, 'TRANSFER_BUSY'):
                app.make_transfer_probe({'profile_id': self.pid, 'goal_id': 'g1', 'node_id': 'n1'})
            release.set()
            thread.join(5)
        self.assertEqual(g.call_count, 1)
        self.assertIn('item_id', results['first'])

    def test_both_kinds_not_applicable_is_unavailable_and_saves_nothing(self):
        with self.assertRaisesRegex(ValueError, 'TRANSFER_UNAVAILABLE'):
            self.probe(responses=[NOT_APPLICABLE, NOT_APPLICABLE])
        self.assertEqual(self.calls, 2)
        self.assertEqual(self.mem.transfer_probe_items(self.pid, 'g1'), [])


class Distance(Base):
    def test_other_goal_with_high_jaccard_does_not_reject(self):
        other = NUMERIC_PROMPT.replace('Un horno', 'El horno') + ' Revisa el reporte semanal de la línea sur.'
        self.assertGreaterEqual(app._case_jaccard(NUMERIC_PROMPT, other), 0.5)
        self.assertNotIn(NUMERIC_PROMPT, other)
        self.store([goal_store('g1'), goal_store('g2')])
        self.mem.save_placement_items(self.pid, 'g2', [({'item_id': 'otra-meta', 'node_id': 'n1', 'purpose': 'practice', 'prompt': other}, {})])
        self.probe(responses=[NUMERIC])
        self.assertEqual(self.calls, 1)

    def test_same_node_high_jaccard_rejects_and_retries(self):
        near = NUMERIC_PROMPT.replace('Un horno', 'El horno') + ' Revisa el reporte semanal.'
        goals = [goal_store()]
        goals[0]['lessons']['n1']['independent'] = {'prompt': near}
        self.store(goals)
        self.probe(responses=[NUMERIC, NUMERIC_OTHER])
        self.assertEqual(self.calls, 2)
        self.assertIn('demasiado parecido', self.prompts[1])

    def test_example_statement_is_checked_against_the_probe(self):
        goals = [goal_store()]
        goals[0]['lessons']['n1']['example'] = 'Una cabina de polvo aplica 90 g en 3 m² de chapa en la línea oeste. Paso 1: dividir la masa.'
        self.store(goals)
        self.probe(responses=[NUMERIC_OTHER, NUMERIC])
        self.assertEqual(self.calls, 2)
        self.assertIn('demasiado parecido', self.prompts[1])

    def test_identical_prompt_from_another_goal_of_the_profile_is_rejected(self):
        self.store([goal_store('g1'), goal_store('g2')])
        self.mem.save_placement_items(self.pid, 'g2', [({'item_id': 'otra-meta-igual', 'node_id': 'n9', 'purpose': 'practice', 'prompt': NUMERIC_PROMPT}, {})])
        self.probe(responses=[NUMERIC, NUMERIC_OTHER])
        self.assertEqual(self.calls, 2)


class Persistence(Base):
    def test_transfer_events_survive_save_load_export_restore(self):
        events = [
            {'type': 'TRANSFER_PROBE_ISSUED', 'node_id': 'n1', 'item_id': 'prod-x', 'context_family': 'hogar', 'at': 1700000000000, 'policy_version': 'transfer_probe_v1'},
            {'type': 'TRANSFER_UNAVAILABLE', 'node_id': 'n2', 'at': 1700000000100, 'policy_version': 'transfer_probe_v1', 'retry_used': False},
        ]
        self.store([goal_store(events=events)])
        loaded = self.mem.load(self.pid)['store']['goals'][0]['events']
        backup = self.mem.export(self.pid)
        self.mem.restore(self.pid, backup)
        restored = self.mem.load(self.pid)['store']['goals'][0]['events']
        for stored in (loaded, restored):
            kept = [{k: v for k, v in e.items() if k != 'profile_id'} for e in stored if e.get('type', '').startswith('TRANSFER_')]
            self.assertEqual(kept, events)


if __name__ == '__main__':
    unittest.main()
