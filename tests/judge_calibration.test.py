"""judge_calibration_v1: informe de calibración del juez (solo lectura).

SQLite temporal con eventos sintéticos, sin red ni proveedor.
"""
import hashlib
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import judge_calibration as jc

PROFILE = 'perfil-secreto-12345678'
ANSWER = 'RESPUESTA_PRIVADA_DEL_APRENDIZ'
PROMPT = 'PREGUNTA_PRIVADA_DEL_TUTOR'


def make_db(path, evidence_rows, confirmations=(), profile=PROFILE):
    db = sqlite3.connect(path)
    db.executescript('''
    CREATE TABLE profiles(profile_id TEXT PRIMARY KEY, name TEXT, preferences_json TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE stores(profile_id TEXT PRIMARY KEY, store_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE attempts(profile_id TEXT NOT NULL, goal_id TEXT NOT NULL, node_id TEXT, attempt_id TEXT NOT NULL, activity_id TEXT, phase TEXT, result TEXT,
      help_used INTEGER NOT NULL, response_text TEXT, question_json TEXT, evaluation_json TEXT NOT NULL, event_json TEXT NOT NULL, occurred_at INTEGER NOT NULL,
      PRIMARY KEY(profile_id, attempt_id));
    ''')
    db.execute('INSERT INTO profiles VALUES(?,?,?,?,?)', (profile, 'Sintético', '{}', 1, 1))
    db.execute('INSERT INTO stores VALUES(?,?,?,?)', (profile, json.dumps({'goals': [{'id': 'g', 'events': list(confirmations)}]}), 1, 1))
    for i, ev in enumerate(evidence_rows):
        ev = {'type': 'EVIDENCE', **ev}
        db.execute('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                   (profile, 'g', 'n', ev.get('attempt_id', f'a{i}'), 'act', 'INDEPENDENT', ev.get('result'), 0, ANSWER,
                    json.dumps({'prompt': PROMPT}), '{}', json.dumps(ev), i))
    db.commit()
    db.close()


def ev(i, result='CORRECT', model='gemini-x', **extra):
    e = {'attempt_id': f'a{i}', 'evidence_id': f'e{i}', 'result': result, 'error_type': 'none' if result == 'CORRECT' else 'concept', 'answer': ANSWER}
    if model:
        e['judge_model'] = model
    e.update(extra)
    return e


def conf(i, status='CORRECT'):
    return {'type': 'CONFIRMATION', 'confirms_attempt_id': f'a{i}', 'status': status, 'confirms_type': 'OPEN_ANSWER'}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class JudgeCalibration(unittest.TestCase):
    def run_report(self, evidence, confirmations=()):
        tmp = tempfile.mkdtemp()
        db, out = str(Path(tmp) / 'm.sqlite3'), str(Path(tmp) / 'informe.md')
        make_db(db, evidence, confirmations)
        before = sha(db)
        self.assertEqual(jc.main(['--db', db, '--out', out]), 0)
        self.assertEqual(sha(db), before, 'la base no debe modificarse')
        return Path(out).read_text(encoding='utf-8')

    def row(self, report, model):
        return next(line for line in report.splitlines() if line.startswith(f'| {model} |'))

    def test_agreement_with_local_confirmation(self):
        evidence = [ev(i) for i in range(30)]
        report = self.run_report(evidence, [conf(i) for i in range(30)])
        self.assertIn('30/30 = 100.0 %', self.row(report, 'gemini-x'))

    def test_disagreement_is_not_agreement(self):
        evidence = [ev(i) for i in range(30)]
        report = self.run_report(evidence, [conf(i, 'CORRECT' if i < 24 else 'MISCONCEPTION') for i in range(30)])
        self.assertIn('24/30 = 80.0 %', self.row(report, 'gemini-x'))

    def test_manual_correction_counted_apart(self):
        evidence = [ev(i) for i in range(30)]
        evidence += [{'attempt_id': f'c{i}', 'evidence_id': f'ce{i}', 'result': 'MISCONCEPTION', 'correction_of': f'e{i}', 'original_attempt_id': f'a{i}',
                      'source': 'manual_correction', 'actor': 'user', 'judge_model': None} for i in range(3)]
        report = self.run_report(evidence)
        line = self.row(report, 'gemini-x')
        self.assertIn('3/30 = 10.0 %', line)
        self.assertIn('| 30 | 30 | 0 | 0 |', line)  # 30 evaluaciones: las correcciones no son evaluaciones del juez
        self.assertIn('corrección manual encontrados (no son evaluaciones del juez): 3', report)
        self.assertIn('insuficiente (n=0)', line)  # sin confirmación no hay acuerdo

    def test_unknown_never_counts_as_agreement(self):
        evidence = [ev(i, 'UNKNOWN') for i in range(30)] + [ev(30 + i) for i in range(30)]
        confirmations = [conf(i) for i in range(30)] + [conf(30 + i, 'UNKNOWN') for i in range(30)]
        report = self.run_report(evidence, confirmations)
        line = self.row(report, 'gemini-x')
        self.assertIn('insuficiente (n=0)', line)
        self.assertNotIn('100.0 %', line)
        cells = [c.strip() for c in line.strip('|').split('|')]
        self.assertEqual(cells[1:5], ['60', '30', '30', '0'])  # evaluaciones, válidas, UNKNOWN, inválidas
        self.assertEqual(cells[6], '30')  # confirmación UNKNOWN aparte

    def test_legacy_missing_fields_are_unknown_not_agreement(self):
        evidence = [ev(i, model=None) for i in range(30)] + [{'attempt_id': f'x{i}', 'evidence_id': f'xe{i}', 'judge_model': 'gemini-x'} for i in range(30)]
        report = self.run_report(evidence, [conf(i) for i in range(30)])
        legacy = self.row(report, jc.UNKNOWN_MODEL)
        self.assertIn('30/30 = 100.0 %', legacy)  # el veredicto existe; solo el modelo es desconocido
        invalid = self.row(report, 'gemini-x')
        cells = [c.strip() for c in invalid.strip('|').split('|')]
        self.assertEqual(cells[1:5], ['30', '0', '0', '30'])  # sin campo result: inválidas, nunca aciertos
        self.assertIn('insuficiente (n=0)', invalid)

    def test_small_cell_marked_insufficient(self):
        evidence = [ev(i) for i in range(29)]
        report = self.run_report(evidence, [conf(i) for i in range(29)])
        line = self.row(report, 'gemini-x')
        self.assertIn('insuficiente (n=29)', line)
        self.assertNotIn('%', line)

    def test_report_has_no_private_text_or_profile_id(self):
        evidence = [ev(i) for i in range(5)]
        report = self.run_report(evidence, [conf(i) for i in range(5)])
        for secret in (ANSWER, PROMPT, PROFILE):
            self.assertNotIn(secret, report)
        self.assertIn(jc.short_hash(PROFILE), report)

    def test_rejects_database_as_output_and_missing_profile(self):
        tmp = tempfile.mkdtemp()
        db = str(Path(tmp) / 'm.sqlite3')
        make_db(db, [ev(0)])
        with self.assertRaises(SystemExit):
            jc.main(['--db', db, '--out', db])
        with self.assertRaises(SystemExit):
            jc.main(['--db', db, '--profile', 'no-existe', '--out', str(Path(tmp) / 'x.md')])

    def test_error_type_distribution_and_local_grader(self):
        evidence = [ev(i, 'MISCONCEPTION') for i in range(31)] + [ev(100 + i, model=None, evaluator_trust='deterministic') for i in range(3)]
        report = self.run_report(evidence)
        self.assertIn('- gemini-x: concept=31 (100.0 %)', report)
        self.assertIn(jc.LOCAL, report)


if __name__ == '__main__':
    unittest.main()
