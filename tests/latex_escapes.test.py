"""LaTeX escapes in model JSON: tolerant retry, object repair and the command table shared with app.js.

Model text is passed RAW to the parser (r-strings), exactly as the model emits it. No provider is contacted.
"""
import io
import json
import os
import re
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app

SECRET = 'sk-ant-TEST-SECRET-123'
SCHEMA = app.obj_schema({'prompt': app.T})


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Fake:
    def __init__(self, payload):
        self.payload = payload
        self.requests = []

    def __call__(self, req, timeout=None):
        self.requests.append(req)
        return _Resp(json.dumps(self.payload).encode())


def gemini_envelope(raw_text):
    # The envelope is JSON; the candidate text is kept verbatim, as Gemini returns it.
    return {'candidates': [{'content': {'parts': [{'text': raw_text}]}}], 'usageMetadata': {}}


def tool_answer(data):
    return {'stop_reason': 'tool_use', 'content': [{'type': 'tool_use', 'name': app.ANTHROPIC_TOOL, 'input': data}]}


def app_js_commands():
    """Command names that the TEX_* tables and the parser of app.js accept."""
    src = (ROOT / 'app.js').read_text(encoding='utf-8')
    names = set()
    for table in ('TEX_GREEK', 'TEX_SYMBOLS', 'TEX_BIGOPS'):
        m = re.search(r'const ' + table + r'=new Map\(Object\.entries\(\{(.*?)\}\)\);', src)
        names |= set(re.findall(r"([A-Za-z]+):'", m.group(1)))
    for table in ('TEX_FUNCS', 'TEX_TEXTCMDS', 'TEX_FRAC'):
        m = re.search(r'const ' + table + r"=new Set\(\[(.*?)\]\);", src)
        names |= set(re.findall(r"'([A-Za-z]+)'", m.group(1)))
    m = re.search(r'const TEX_SPACES=new Map\(\[(.*?)\]\);', src)
    names |= set(re.findall(r"\['([A-Za-z]+)',", m.group(1)))
    names |= set(re.findall(r"\bn==='([A-Za-z]+)'", src))
    names |= set(re.findall(r"tk\.v==='([A-Za-z]+)'", src))
    return names


class GeminiRawText(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'LLM_PROVIDER': 'gemini', 'GEMINI_API_KEY': 'test-key'})
        self.env.start()
        app.PROVIDER = 'gemini'
        app.CALLS.clear()

    def tearDown(self):
        app.PROVIDER = os.getenv('LLM_PROVIDER', 'gemini')
        self.env.stop()

    def gem(self, raw_text, schema=SCHEMA):
        fake = Fake(gemini_envelope(raw_text))
        with patch.object(app, 'LIMIT', 10 ** 6), patch.object(app.urllib.request, 'urlopen', side_effect=fake):
            return app.gemini('Pregunta de prueba', schema, 900)

    def test_single_backslash_commands_keep_their_backslash(self):
        raw = r'{"prompt": "$\frac{1}{2}\beta\times\neq\rho\tau$"}'
        self.assertEqual(self.gem(raw)['prompt'], '$\\frac{1}{2}\\beta\\times\\neq\\rho\\tau$')

    def test_text_that_starts_with_a_command_keeps_it(self):
        raw = r'{"prompt": "\frac{1}{2} de torta"}'
        self.assertEqual(self.gem(raw)['prompt'], '\\frac{1}{2} de torta')

    def test_invalid_json_escapes_are_repaired(self):
        commands = ['\\sqrt{2}', '\\alpha', '\\cdot', '\\pm', '\\sin x', '\\infty', '\\left( x \\right)',
                    '\\(x\\) = 2', '\\upsilon', '\\mathrm{mm}']
        for cmd in commands:
            with self.subTest(command=cmd):
                raw = '{"prompt": "' + cmd + '"}'
                self.assertEqual(self.gem(raw)['prompt'], cmd)

    def test_already_escaped_backslashes_are_not_doubled(self):
        raw = r'{"prompt": "\\frac{1}{2} y \\sqrt{2}"}'
        self.assertEqual(self.gem(raw)['prompt'], '\\frac{1}{2} y \\sqrt{2}')

    def test_legitimate_text_with_control_letters_is_untouched(self):
        raw = r'{"prompt": "línea\nel resultado\nequipo\r\nfin\tfin"}'
        self.assertEqual(self.gem(raw)['prompt'], 'línea\nel resultado\nequipo\r\nfin\tfin')

    def test_display_math_with_real_newlines_is_untouched(self):
        raw = r'{"prompt": "$$\na=b\n$$"}'
        self.assertEqual(self.gem(raw)['prompt'], '$$\na=b\n$$')

    def test_windows_path_with_escaped_backslashes_is_untouched(self):
        raw = r'{"prompt": "C:\\new\\temp"}'
        self.assertEqual(self.gem(raw)['prompt'], 'C:\\new\\temp')

    def test_broken_json_still_reports_incomplete_output(self):
        with self.assertRaises(ValueError) as ctx:
            self.gem(r'{"prompt": "\sqrt{2}')
        self.assertIn('incompleta', str(ctx.exception))


class AnthropicRepair(unittest.TestCase):
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

    def ant(self, data):
        fake = Fake(tool_answer(data))
        with patch.object(app, 'LIMIT', 10 ** 6), patch.object(app.urllib.request, 'urlopen', side_effect=fake):
            return app.gemini('Pregunta de prueba', SCHEMA, 900)

    def test_form_feed_from_tool_input_becomes_backslash_f(self):
        self.assertEqual(self.ant({'prompt': '\x0crac{1}{2}'})['prompt'], '\\frac{1}{2}')

    def test_backspace_from_tool_input_becomes_backslash_b(self):
        self.assertEqual(self.ant({'prompt': '\x08eta'})['prompt'], '\\beta')

    def test_keys_are_never_modified(self):
        self.assertEqual(self.ant({'prompt': '\x0crac', '\x0cfrac': 'a'}), {'prompt': '\\frac', '\x0cfrac': 'a'})

    def test_nested_values_are_repaired(self):
        out = self.ant({'prompt': 'x', 'items': [{'prompt': '\x0crac'}]})
        self.assertEqual(out['items'], [{'prompt': '\\frac'}])


class RepairFunction(unittest.TestCase):
    def test_repair_is_idempotent(self):
        sample = {'p': ['\x0crac{1}', '\x08eta', '\times\neq', 'ya \\frac y \\sqrt'], 'q': '\x0crho'}
        once = app.repair_latex_escapes(sample)
        self.assertEqual(app.repair_latex_escapes(once), once)

    def test_text_with_bare_control_letters_is_not_a_command(self):
        self.assertEqual(app.repair_latex_escapes('a\nequipo y \nel \r\n'), 'a\nequipo y \nel \r\n')


class CommandTable(unittest.TestCase):
    def test_python_list_matches_app_js_tables(self):
        js = app_js_commands()
        self.assertGreater(len(js), 60)
        for name in ('frac', 'beta', 'times', 'neq', 'rho', 'sqrt', 'right', 'left', 'text', 'tan', 'to'):
            self.assertIn(name, js)
        self.assertEqual(set(app.LATEX_COMMAND_NAMES), js)


if __name__ == '__main__':
    unittest.main()
