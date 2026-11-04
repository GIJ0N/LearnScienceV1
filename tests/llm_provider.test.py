"""LLM provider switch: Anthropic transport contract, schema translation, quota and error hygiene.

All network calls are replaced by a fake urlopen. No provider is contacted.
"""
import io
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_legacy as app

SECRET = 'sk-ant-TEST-SECRET-123'


class Fake:
    def __init__(self, payload, status=None):
        self.payload = payload
        self.status = status
        self.requests = []

    def __call__(self, req, timeout=None):
        self.requests.append(req)
        if self.status:
            import urllib.error
            body = io.BytesIO(json.dumps({'error': {'message': 'boom ' + SECRET}}).encode())
            raise urllib.error.HTTPError(req.full_url, self.status, 'x', {}, body)
        return _Resp(json.dumps(self.payload).encode())


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def tool_answer(data, stop='tool_use'):
    return {'stop_reason': stop, 'content': [{'type': 'tool_use', 'name': app.ANTHROPIC_TOOL, 'input': data}]}


SCHEMA = app.obj_schema({'items': {'type': 'ARRAY', 'items': app.obj_schema({'prompt': app.T})}})


class SchemaTranslation(unittest.TestCase):
    def test_uppercase_types_become_json_schema(self):
        out = app._json_schema(SCHEMA)
        self.assertEqual(out['type'], 'object')
        self.assertEqual(out['properties']['items']['type'], 'array')
        self.assertEqual(out['properties']['items']['items']['properties']['prompt']['type'], 'string')
        self.assertEqual(out['required'], ['items'])

    def test_every_top_level_schema_is_an_object(self):
        # Anthropic tools require an object at the root; every schema the app sends must qualify.
        names = [n for n in dir(app) if n.endswith('SCHEMA') and isinstance(getattr(app, n), dict)]
        self.assertTrue(names)
        for name in names:
            with self.subTest(schema=name):
                self.assertEqual(app._json_schema(getattr(app, name))['type'], 'object')


class AnthropicTransport(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'LLM_PROVIDER': 'anthropic', 'ANTHROPIC_API_KEY': SECRET,
                                           'ANTHROPIC_MODEL': 'claude-sonnet-5-5'})
        self.env.start()
        app.PROVIDER = 'anthropic'
        app.ANTHROPIC_MODEL = 'claude-sonnet-5-5'
        app.CALLS.clear()

    def tearDown(self):
        app.PROVIDER = os.getenv('LLM_PROVIDER', 'gemini')
        self.env.stop()

    def run_call(self, fake, schema=SCHEMA, max_tokens=900):
        with patch.object(app.urllib.request, 'urlopen', side_effect=fake):
            return app.gemini('Pregunta de prueba', schema, max_tokens)

    def test_request_shape(self):
        fake = Fake(tool_answer({'items': []}))
        self.run_call(fake)
        req = fake.requests[0]
        self.assertEqual(req.full_url, 'https://api.anthropic.com/v1/messages')
        self.assertEqual(req.get_header('X-api-key'), SECRET)
        self.assertEqual(req.get_header('Anthropic-version'), '2023-06-01')
        body = json.loads(req.data)
        self.assertEqual(body['model'], 'claude-sonnet-5-5')
        self.assertEqual(body['max_tokens'], 900)
        self.assertEqual(body['system'], app.SYSTEM)
        self.assertEqual(body['messages'], [{'role': 'user', 'content': 'Pregunta de prueba'}])
        self.assertEqual(body['tool_choice'], {'type': 'tool', 'name': app.ANTHROPIC_TOOL})
        self.assertEqual(body['tools'][0]['input_schema']['type'], 'object')
        self.assertNotIn('GEMINI', json.dumps(body))

    def test_returns_the_structured_tool_input(self):
        out = self.run_call(Fake(tool_answer({'items': [{'prompt': 'x'}]})))
        self.assertEqual(out, {'items': [{'prompt': 'x'}]})

    def test_truncated_output_is_refused(self):
        with self.assertRaises(ValueError) as ctx:
            self.run_call(Fake(tool_answer({'items': []}, stop='max_tokens')))
        self.assertIn('incompleta', str(ctx.exception))

    def test_missing_tool_block_is_refused(self):
        with self.assertRaises(ValueError):
            self.run_call(Fake({'stop_reason': 'end_turn', 'content': [{'type': 'text', 'text': 'hola'}]}))

    def test_errors_map_to_spanish_and_never_echo_the_key(self):
        for status, fragment in ((401, 'rechazó la clave'), (429, 'límite'), (500, 'rechazó la solicitud')):
            with self.subTest(status=status):
                with self.assertRaises(ValueError) as ctx:
                    self.run_call(Fake({}, status=status))
                self.assertIn(fragment, str(ctx.exception))
                self.assertNotIn(SECRET, str(ctx.exception))

    def test_missing_key_fails_before_any_request(self):
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': ''}):
            with patch.object(app.urllib.request, 'urlopen', side_effect=AssertionError('no debe llamarse')):
                with self.assertRaises(ValueError):
                    app.gemini('x', SCHEMA)

    def test_quota_applies_to_anthropic_too(self):
        app.CALLS.clear()
        with patch.object(app, 'LIMIT', 1):
            self.run_call(Fake(tool_answer({'items': []})))
            with patch.object(app.urllib.request, 'urlopen', side_effect=AssertionError('no debe llamarse')):
                with self.assertRaises(ValueError):
                    app.gemini('segunda', SCHEMA)


class ProviderSelection(unittest.TestCase):
    def test_default_stays_gemini(self):
        with patch.object(app, 'PROVIDER', 'gemini'):
            with patch.object(app, '_gemini_call', return_value={'ok': 1}) as g, patch.object(app, '_anthropic_call') as a:
                self.assertEqual(app.gemini('x', SCHEMA), {'ok': 1})
                g.assert_called_once()
                a.assert_not_called()

    def test_unknown_provider_is_rejected(self):
        with patch.object(app, 'PROVIDER', 'otro'):
            with self.assertRaises(ValueError):
                app.gemini('x', SCHEMA)

    def test_health_reports_active_provider_without_secrets(self):
        with patch.object(app, 'PROVIDER', 'anthropic'), patch.dict(os.environ, {'ANTHROPIC_API_KEY': SECRET}):
            handler = app.Handler.__new__(app.Handler)
            sent = {}
            handler.respond = lambda status, content, mime=None: sent.update(content=content)
            handler.path = '/api/health'
            handler.do_GET()
        self.assertEqual(sent['content']['provider'], 'anthropic')
        self.assertTrue(sent['content']['configured'])
        self.assertIn('daily_limit', sent['content'])
        self.assertIn('calls_today', sent['content'])
        self.assertNotIn(SECRET, json.dumps(sent['content']))


if __name__ == '__main__':
    unittest.main()
