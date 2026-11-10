"""expert_profile_v1: competencias terminales propuestas por el modelo, validadas localmente; nada se guarda."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app

CLEAN = {'issues': [], 'checked': True}
AREAS = [{'id': 'ar1', 'name': 'Preparación de superficie', 'outcome': 'Superficie lista'}, {'id': 'ar2', 'name': 'Aplicación', 'outcome': 'Capa uniforme'}, {'id': 'ar3', 'name': 'Curado', 'outcome': 'Curado completo'}]


def comp(name, risk='medium', ids=('ar1',), criterion='Mide el espesor de película y lo compara con el rango del proveedor.'):
    return {'name': name, 'criterion': criterion, 'risk': risk, 'area_ids': list(ids)}


def profile(n=4, **over):
    items = [comp(f'Competencia {i}', ids=(AREAS[i % 3]['id'],)) for i in range(n)]
    for k, v in over.items():
        items[0][k] = v
    return {'competencies': items}


class Base(unittest.TestCase):
    def make(self, *raws, audit=CLEAN, areas=AREAS):
        data = {'goal': 'Pintura electrostática en polvo', 'depth': 'experto', 'areas': areas}
        with patch.object(app, 'gemini', side_effect=list(raws)) as g, patch.object(app, 'audit_content', return_value=audit):
            try:
                return app.make_expert_profile(data)
            finally:
                self.calls = g.call_count


class Valid(Base):
    def test_valid_profile(self):
        out = self.make(profile(5))
        self.assertEqual(out['schema_version'], 'expert_profile_v1')
        self.assertEqual([c['id'] for c in out['competencies']], ['comp-%d' % i for i in range(1, 6)])
        self.assertEqual(self.calls, 1)
        self.assertIn('/api/goal/expert-profile', app.ROUTES)

    def test_bounds_four_and_eight_ok(self):
        self.assertEqual(len(self.make(profile(4))['competencies']), 4)
        self.assertEqual(len(self.make(profile(8))['competencies']), 8)

    def test_retry_with_reason_then_ok(self):
        out = self.make(profile(3), profile(4))
        self.assertEqual(self.calls, 2)
        self.assertEqual(len(out['competencies']), 4)


class Rejections(Base):
    def reject(self, raw):
        with self.assertRaises(ValueError):
            self.make(raw, raw)
        self.assertEqual(self.calls, 2, 'un reintento y luego error')

    def test_three_or_nine(self):
        self.reject(profile(3))
        self.reject(profile(9))

    def test_repeated_names(self):
        raw = profile(4)
        raw['competencies'][1]['name'] = 'competencia 0!'
        self.reject(raw)

    def test_area_ids_empty_or_foreign(self):
        self.reject(profile(4, area_ids=[]))
        self.reject(profile(4, area_ids=['ar9']))
        self.reject(profile(4, area_ids=['ar1', 'ajena']))

    def test_invalid_risk(self):
        self.reject(profile(4, risk='extreme'))

    def test_criterion_length(self):
        self.reject(profile(4, criterion='corto'))
        self.reject(profile(4, criterion='x' * 221))

    def test_audit_issue_rejects_and_not_a_dict(self):
        with self.assertRaises(ValueError):
            self.make(profile(4), profile(4), audit={'issues': ['dato falso'], 'checked': True})
        with self.assertRaises(ValueError):
            self.make(None, None)

    def test_missing_goal_or_areas(self):
        with self.assertRaises(ValueError):
            self.make(profile(4), areas=[])
        with self.assertRaises(ValueError):
            app.make_expert_profile({'goal': '', 'areas': AREAS})


if __name__ == '__main__':
    unittest.main()
