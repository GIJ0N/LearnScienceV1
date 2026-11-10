"""usage_telemetry_v1: tokens por ruta, fallos registrados, el registro nunca rompe la llamada y el contador sobrevive al reinicio."""
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
import urllib.error
from datetime import date
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app
from memory_store import DurableMemory

KEY = 'CLAVE-SECRETA-TEST'
PROMPT = 'PROMPT-PRIVADO-TEST'
SCHEMA = {'type': 'OBJECT'}


class Fake:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return io.BytesIO(json.dumps(self.body).encode())

    def __exit__(self, *a):
        pass


def gemini_body(usage=True):
    body = {'candidates': [{'content': {'parts': [{'text': json.dumps({'ok': 1})}]}}]}
    if usage:
        body['usageMetadata'] = {'promptTokenCount': 120, 'candidatesTokenCount': 40, 'thoughtsTokenCount': 300}
    return body


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'u.sqlite'
        self.mem = DurableMemory(self.path)
        self.old = (app._MEMORY, app._TEST_MEMORY)
        app.set_memory_for_tests(self.mem)
        app._CALL_CONTEXT.route = '/api/evaluate'
        app.CALLS.clear()
        env = patch.dict(os.environ, {'GEMINI_API_KEY': KEY, 'ANTHROPIC_API_KEY': KEY})
        env.start()
        self.addCleanup(env.stop)

    def tearDown(self):
        app._MEMORY, app._TEST_MEMORY = self.old
        app.CALLS.clear()
        self.tmp.cleanup()

    def rows(self):
        db = sqlite3.connect(str(self.path))
        db.row_factory = sqlite3.Row
        try:
            return [dict(r) for r in db.execute('SELECT * FROM llm_calls ORDER BY call_id')]
        finally:
            db.close()


class Recording(Base):
    def test_usage_metadata_is_recorded(self):
        with patch('urllib.request.urlopen', return_value=Fake(gemini_body())):
            self.assertEqual(app._gemini_call(PROMPT, SCHEMA, 100), {'ok': 1})
        (row,) = self.rows()
        self.assertEqual((row['input_tokens'], row['output_tokens'], row['thinking_tokens']), (120, 40, 300))
        self.assertEqual((row['provider'], row['route'], row['ok'], row['day']), ('gemini', '/api/evaluate', 1, date.today().isoformat()))
        self.assertGreaterEqual(row['latency_ms'], 0)

    def test_missing_usage_metadata_stores_null_and_call_works(self):
        with patch('urllib.request.urlopen', return_value=Fake(gemini_body(usage=False))):
            self.assertEqual(app._gemini_call(PROMPT, SCHEMA, 100), {'ok': 1})
        (row,) = self.rows()
        self.assertEqual((row['input_tokens'], row['output_tokens'], row['thinking_tokens'], row['ok']), (None, None, None, 1))

    def test_http_429_is_recorded_as_failure(self):
        err = urllib.error.HTTPError('u', 429, 'x', {}, io.BytesIO(b'{}'))
        with patch('urllib.request.urlopen', side_effect=err):
            with self.assertRaises(ValueError):
                app._gemini_call(PROMPT, SCHEMA, 100)
        (row,) = self.rows()
        self.assertEqual((row['ok'], row['input_tokens']), (0, None))

    def test_incomplete_output_counts_tokens_but_is_not_ok(self):
        body = {'candidates': [{'finishReason': 'MAX_TOKENS', 'content': {'parts': [{'text': '{'}]}}], 'usageMetadata': {'promptTokenCount': 5, 'candidatesTokenCount': 9}}
        with patch('urllib.request.urlopen', return_value=Fake(body)):
            with self.assertRaises(ValueError):
                app._gemini_call(PROMPT, SCHEMA, 100)
        (row,) = self.rows()
        self.assertEqual((row['ok'], row['input_tokens'], row['output_tokens']), (0, 5, 9))

    def test_anthropic_usage_has_no_thinking_tokens(self):
        body = {'content': [{'type': 'tool_use', 'name': app.ANTHROPIC_TOOL, 'input': {'ok': 1}}], 'usage': {'input_tokens': 11, 'output_tokens': 22}}
        with patch('urllib.request.urlopen', return_value=Fake(body)):
            self.assertEqual(app._anthropic_call(PROMPT, SCHEMA, 100), {'ok': 1})
        (row,) = self.rows()
        self.assertEqual((row['provider'], row['input_tokens'], row['output_tokens'], row['thinking_tokens']), ('anthropic', 11, 22, None))

    def test_quota_refusal_and_missing_key_are_not_recorded(self):
        with patch.object(app, 'LIMIT', 0):
            with self.assertRaises(ValueError):
                app._gemini_call(PROMPT, SCHEMA, 100)
        with patch.dict(os.environ, {'GEMINI_API_KEY': ''}):
            with self.assertRaises(ValueError):
                app._gemini_call(PROMPT, SCHEMA, 100)
        self.assertEqual(self.rows(), [])


class Resilience(Base):
    def test_record_failure_never_breaks_the_call(self):
        with patch('urllib.request.urlopen', return_value=Fake(gemini_body())), patch.object(self.mem, 'record_llm_call', side_effect=RuntimeError('disco lleno')):
            self.assertEqual(app._gemini_call(PROMPT, SCHEMA, 100), {'ok': 1})

    def test_no_memory_means_no_logging_and_no_error(self):
        app._MEMORY = None
        with patch('urllib.request.urlopen', return_value=Fake(gemini_body())):
            self.assertEqual(app._gemini_call(PROMPT, SCHEMA, 100), {'ok': 1})
        self.assertEqual(self.rows(), [])

    def test_table_never_holds_key_or_prompt(self):
        with patch('urllib.request.urlopen', return_value=Fake(gemini_body())):
            app._gemini_call(PROMPT, SCHEMA, 100)
        db = sqlite3.connect(str(self.path))
        columns = [r[1] for r in db.execute('PRAGMA table_info(llm_calls)')]
        dump = json.dumps([list(r) for r in db.execute('SELECT * FROM llm_calls')])
        db.close()
        self.assertNotIn('profile_id', columns)
        self.assertFalse({'prompt', 'key', 'api_key', 'answer'} & set(columns))
        self.assertNotIn(KEY, dump)
        self.assertNotIn(PROMPT, dump)


class DailyCounter(Base):
    def test_counter_restarts_from_persisted_rows(self):
        with patch('urllib.request.urlopen', return_value=Fake(gemini_body())):
            for _ in range(3):
                app._gemini_call(PROMPT, SCHEMA, 100)
        self.assertEqual(app.CALLS[date.today().isoformat()], 3)
        # «Reiniciar»: contador en cero y una instancia nueva sobre la misma SQLite.
        app.CALLS.clear()
        app.set_memory_for_tests(DurableMemory(self.path))
        app._seed_calls_from_memory()
        self.assertEqual(app.CALLS[date.today().isoformat()], 3)

    def test_seed_never_lowers_the_counter(self):
        app.CALLS[date.today().isoformat()] = 9
        app._seed_calls_from_memory()
        self.assertEqual(app.CALLS[date.today().isoformat()], 9)


class Reading(Base):
    def test_summary_groups_by_route_and_clamps_days(self):
        today = date.today().isoformat()
        self.mem.record_llm_call(today, 'gemini', 'm', '/api/lesson', 10, 5, 1, 30, True)
        self.mem.record_llm_call(today, 'gemini', 'm', '/api/lesson', 20, 5, None, 30, True)
        self.mem.record_llm_call(today, 'gemini', 'm', '/api/evaluate', None, None, None, 30, False)
        out = app.usage_summary({'days': 999})['days']
        by = {r['route']: r for r in out}
        self.assertEqual((by['/api/lesson']['calls'], by['/api/lesson']['input_tokens'], by['/api/lesson']['thinking_tokens']), (2, 30, 1))
        self.assertEqual(by['/api/evaluate']['calls'], 1)
        self.assertEqual(app.usage_summary({'days': 'x'})['days'], out)
        self.assertEqual(app._tokens_today(), {'input': 30, 'output': 10, 'thinking': 1})

    def test_empty_database_reads_zero(self):
        self.assertEqual(app._tokens_today(), {'input': 0, 'output': 0, 'thinking': 0})
        self.assertEqual(app.usage_summary({})['days'], [])

    def test_route_is_registered(self):
        self.assertIs(app.ROUTES['/api/usage/summary'], app.usage_summary)


if __name__ == '__main__':
    unittest.main()
