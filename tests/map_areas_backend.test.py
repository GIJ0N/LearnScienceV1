"""map_areas_v1: area map creation, on-demand expansion, merge of repeated topics, no mutation of existing nodes."""
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app
import tempfile
from memory_store import DurableMemory, STORE_SCHEMA_VERSION


def probe(n):
    return {'prompt': f'Diagnóstico {n}', 'reference': 'Criterio', 'kind': 'explanation', 'observable_dimensions': ['conceptual']}


def raw_nodes(names, external_dep=None, start=1):
    nodes, coverage = [], []
    for i, name in enumerate(names, start):
        deps = [f'n{i - 1}'] if i > start else ([external_dep] if external_dep else [])
        nodes.append({'id': f'n{i}', 'name': name, 'outcome': 'Resolver', 'level': i - start, 'prerequisites': deps, 'kind': 'concept', 'probe': probe(i)})
        coverage.append({'id': f'n{i}', 'name': name, 'kind': 'concept', 'priority': 'important', 'prerequisites': deps, 'contexts': [],
                         'dimensions': [{'id': 'conceptual', 'name': 'Comprensión', 'required': True}]})
    return {'nodes': nodes, 'coverage': coverage}


def raw_areas(n=5, **extra):
    return {'scope': 'Meta amplia.', 'areas': [{'name': f'Área {i}', 'outcome': f'Resultado {i}', 'estimated_topics': 8} for i in range(1, n + 1)], **extra}


NAMES = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis']


class AreaMap(unittest.TestCase):
    def create(self, areas=None, nodes=None):
        with patch.object(app, 'gemini', side_effect=[areas or raw_areas(), nodes or raw_nodes(NAMES)]) as g:
            out = app.make_area_map({'goal': 'Dominar química orgánica', 'context': ''})
        return out, g

    def test_two_calls_first_area_expanded_rest_pending(self):
        out, g = self.create()
        self.assertEqual(g.call_count, 2)
        self.assertEqual(out['map_version'], 2)
        self.assertEqual([a['id'] for a in out['areas']], [f'area-{i}' for i in range(1, 6)])
        self.assertEqual([a['status'] for a in out['areas']], ['expanded'] + ['pending'] * 4)
        self.assertEqual(out['areas'][0]['node_ids'], [n['id'] for n in out['nodes']])
        self.assertTrue(all(n['id'].startswith('area-1-n') for n in out['nodes']))
        self.assertEqual(len(out['coverage']), len(out['nodes']))
        self.assertTrue(all(c['id'].startswith('area-1-') for c in out['coverage']))
        self.assertEqual(out['nodes'][1]['prerequisites'], ['area-1-n1'])
        self.assertEqual(out['scope'], 'Meta amplia.')

    def test_area_count_limits_and_duplicates(self):
        with patch.object(app, 'gemini', side_effect=[raw_areas(3)]):
            with self.assertRaises(ValueError):
                app.make_area_map({'goal': 'Dominar química', 'context': ''})
        dup = raw_areas(4)
        dup['areas'][1]['name'] = 'ÁREA 1!'
        with patch.object(app, 'gemini', side_effect=[dup]):
            with self.assertRaises(ValueError):
                app.make_area_map({'goal': 'Dominar química', 'context': ''})
        out, _ = self.create(areas=raw_areas(15))
        self.assertEqual(len(out['areas']), app.AREA_MAX)

    def test_short_goal_rejected_before_any_call(self):
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamarse')):
            with self.assertRaises(ValueError):
                app.make_area_map({'goal': 'ab', 'context': ''})

    def test_first_area_too_small_fails_the_creation(self):
        with self.assertRaises(ValueError):
            self.create(nodes=raw_nodes(NAMES[:3]))

    def test_legacy_flat_map_is_unchanged(self):
        with patch.object(app, 'gemini', return_value=raw_nodes(NAMES[:5])):
            out = app.make_map({'goal': 'Resolver problemas', 'context': ''})
        self.assertEqual(out['map_version'], 1)
        self.assertEqual(out['nodes'][0]['id'], 'n1')
        with self.assertRaises(ValueError):
            app.validated_map(raw_nodes([f'T{i}' for i in range(13)]))


class Expansion(unittest.TestCase):
    def setUp(self):
        with patch.object(app, 'gemini', side_effect=[raw_areas(), raw_nodes(NAMES)]):
            self.first = app.make_area_map({'goal': 'Dominar química orgánica', 'context': ''})
        self.areas = [{'id': a['id'], 'name': a['name'], 'outcome': a['outcome']} for a in self.first['areas']]
        self.existing = [{'id': n['id'], 'name': n['name'], 'outcome': n['outcome']} for n in self.first['nodes']]

    def expand(self, raw, area_id='area-2', existing=None, areas=None):
        with patch.object(app, 'gemini', return_value=raw) as g:
            out = app.expand_map({'goal': 'Dominar química orgánica', 'context': '', 'area_id': area_id,
                                  'areas': areas or self.areas, 'existing_nodes': self.existing if existing is None else existing})
        return out, g

    def test_expansion_namespaces_ids_and_can_depend_on_existing_topics(self):
        out, g = self.expand(raw_nodes(['Siete', 'Ocho', 'Nueve', 'Diez'], external_dep='area-1-n6'))
        self.assertEqual([n['id'] for n in out['nodes']], [f'area-2-n{i}' for i in range(1, 5)])
        self.assertEqual(out['nodes'][0]['prerequisites'], ['area-1-n6'])
        self.assertEqual(out['nodes'][1]['prerequisites'], ['area-2-n1'])
        self.assertIn('area-1-n6', g.call_args[0][0], 'el modelo ve los ids existentes')
        self.assertEqual(out['area_id'], 'area-2')

    def test_repeated_topic_is_merged_into_the_existing_one(self):
        raw = raw_nodes(['dos', 'Siete', 'Ocho', 'Nueve', 'Diez'])
        raw['nodes'][1]['prerequisites'] = ['n1']
        raw['coverage'][1]['prerequisites'] = ['n1']
        out, _ = self.expand(raw)
        names = [n['name'] for n in out['nodes']]
        self.assertNotIn('dos', names)
        self.assertEqual(len(out['nodes']), 4)
        siete = next(n for n in out['nodes'] if n['name'] == 'Siete')
        self.assertEqual(siete['prerequisites'], ['area-1-n2'], 'apunta al tema existente')

    def test_unknown_prerequisite_and_area_and_reopen_are_rejected(self):
        with self.assertRaises(ValueError):
            self.expand(raw_nodes(['Siete', 'Ocho', 'Nueve', 'Diez'], external_dep='area-9-n1'))
        with self.assertRaises(ValueError):
            self.expand(raw_nodes(NAMES), area_id='area-99')
        with patch.object(app, 'gemini', side_effect=AssertionError('no debe llamarse')):
            with self.assertRaises(ValueError):
                app.expand_map({'goal': 'Dominar química', 'area_id': 'area-1', 'areas': self.areas, 'existing_nodes': self.existing})

    def test_cycles_and_too_many_or_too_few_topics_are_rejected(self):
        cyc = raw_nodes(['Siete', 'Ocho', 'Nueve', 'Diez'])
        cyc['nodes'][0]['prerequisites'] = ['n4']
        with self.assertRaises(ValueError):
            self.expand(cyc)
        with self.assertRaises(ValueError):
            self.expand(raw_nodes([f'T{i}' for i in range(13)]))
        with self.assertRaises(ValueError):
            self.expand(raw_nodes(['A1', 'A2', 'A3']))

    def test_existing_ids_never_collide_with_new_ones_and_input_is_not_mutated(self):
        before = [dict(e) for e in self.existing]
        out, _ = self.expand(raw_nodes(['Siete', 'Ocho', 'Nueve', 'Diez']))
        self.assertEqual(self.existing, before)
        self.assertFalse({n['id'] for n in out['nodes']} & {e['id'] for e in self.existing})

    def test_routes(self):
        self.assertIs(app.ROUTES['/api/map'], app.make_area_map)
        self.assertIs(app.ROUTES['/api/map/expand'], app.expand_map)


class Persistence(unittest.TestCase):
    def test_large_area_goal_round_trips_through_durable_memory(self):
        with tempfile.TemporaryDirectory() as tmp:
            memory = DurableMemory(Path(tmp) / 'a.sqlite')
            pid = memory.create_profile('Sintético')['profile_id']
            ids = [f'area-{a}-n{i}' for a in (1, 2, 3) for i in range(1, 21)]
            nodes = [{'id': nid, 'name': nid, 'outcome': 'o', 'level': 0, 'prerequisites': [ids[k - 1]] if k else [], 'kind': 'concept', 'probe': None} for k, nid in enumerate(ids)]
            goal = {'id': 'g', 'goal': 'x', 'nodes': nodes, 'coverage': [{'id': i, 'name': i, 'dimensions': []} for i in ids], 'learner': {}, 'events': [], 'reviews': [], 'lessons': {}, 'session': {},
                    'areas': [{'id': f'area-{a}', 'name': f'Área {a}', 'status': 'expanded', 'node_ids': [i for i in ids if i.startswith(f'area-{a}-')]} for a in (1, 2, 3)], 'scope': 'amplia'}
            memory.save(pid, {'schema_version': STORE_SCHEMA_VERSION, 'profile_id': pid, 'goals': [goal], 'active': 'g'})
            loaded = memory.load(pid)['store']['goals'][0]
            self.assertEqual(len(loaded['nodes']), 60)
            self.assertEqual(len(loaded['areas']), 3)
            self.assertEqual(loaded['scope'], 'amplia')


if __name__ == '__main__':
    unittest.main()
