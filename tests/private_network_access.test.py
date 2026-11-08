"""private_network_access_v1: acceso opcional desde otro dispositivo de una red privada. Sin configurar, todo queda como antes."""
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app
from memory_store import DurableMemory

LOCAL = f'http://127.0.0.1:{app.PORT}'


class Settings(unittest.TestCase):
    def origins(self, host, extra=()):
        with patch.object(app, 'HOST', host), patch.object(app, 'EXTRA_ORIGINS', tuple(extra)):
            return app.allowed_origins()

    def test_defaults_are_exactly_today(self):
        self.assertEqual(app.network_settings({}), ('127.0.0.1', ()))
        self.assertEqual(app.network_settings({'LEARNSCIENCE_HOST': '', 'LEARNSCIENCE_ORIGINS': ''}), ('127.0.0.1', ()))
        self.assertEqual(self.origins('127.0.0.1'), (LOCAL,), 'igual que el f"http://{HOST}:{PORT}" anterior')

    def test_module_defaults_unchanged(self):
        if 'LEARNSCIENCE_HOST' not in os.environ and 'LEARNSCIENCE_ORIGINS' not in os.environ:
            self.assertEqual(app.HOST, '127.0.0.1')
            self.assertEqual(app.EXTRA_ORIGINS, ())
            self.assertEqual(app.NETWORK_ERROR, '')
            self.assertEqual(app.allowed_origins(), (LOCAL,))

    def test_port_changed_after_import_still_applies(self):
        with patch.object(app, 'PORT', 8793):
            self.assertEqual(self.origins('127.0.0.1'), ('http://127.0.0.1:8793',))

    def test_tailscale_host_adds_its_own_origin(self):
        host, extra = app.network_settings({'LEARNSCIENCE_HOST': '100.101.102.103'})
        self.assertEqual((host, extra), ('100.101.102.103', ()))
        self.assertEqual(self.origins(host), (LOCAL, f'http://100.101.102.103:{app.PORT}'))

    def test_all_interfaces_adds_no_origin_by_itself(self):
        self.assertEqual(self.origins('0.0.0.0'), (LOCAL,))

    def test_extra_origins(self):
        _, extra = app.network_settings({'LEARNSCIENCE_HOST': '0.0.0.0', 'LEARNSCIENCE_ORIGINS': ' http://mi-pc.tail1234.ts.net:8765/ , http://192.168.1.20:8765'})
        self.assertEqual(self.origins('0.0.0.0', extra), (LOCAL, 'http://mi-pc.tail1234.ts.net:8765', 'http://192.168.1.20:8765'))

    def test_bad_values_are_rejected(self):
        for env in [{'LEARNSCIENCE_HOST': 'mi-pc'}, {'LEARNSCIENCE_HOST': '::1'}, {'LEARNSCIENCE_HOST': '300.1.1.1'},
                    {'LEARNSCIENCE_ORIGINS': '*'}, {'LEARNSCIENCE_ORIGINS': 'http://x.com/ruta'}, {'LEARNSCIENCE_ORIGINS': 'x.com:8765'},
                    {'LEARNSCIENCE_ORIGINS': 'javascript:alert(1)'}]:
            with self.assertRaises(ValueError, msg=str(env)):
                app.network_settings(env)

    def test_bad_value_stops_the_server_with_a_clear_message(self):
        env = {**os.environ, 'LEARNSCIENCE_HOST': 'mi-pc', 'RUTA_DB_PATH': str(Path(tempfile.mkdtemp()) / 'x.sqlite3')}
        env.pop('GEMINI_API_KEY', None)
        out = subprocess.run([sys.executable, str(ROOT / 'app_legacy.py')], env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 2)
        self.assertIn('LEARNSCIENCE_HOST debe ser una dirección IP', out.stderr)


class OriginCheck(unittest.TestCase):
    """Real HTTP server: only listed origins may POST."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'n.sqlite')
        self.patches = [patch.object(app, 'memory', return_value=self.memory), patch.object(app, '_TEST_MEMORY', True)]
        for p in self.patches:
            p.start()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=2)
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def post(self, origin=None):
        headers = {'Content-Type': 'application/json'}
        if origin:
            headers['Origin'] = origin
        req = urllib.request.Request(f'http://127.0.0.1:{self.server.server_port}/api/profiles/list', data=json.dumps({}).encode(), headers=headers, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status
        except urllib.error.HTTPError as exc:
            return exc.code

    def test_default_rules_unchanged(self):
        self.assertEqual(self.post(), 200, 'sin Origin (clientes no navegador) sigue permitido')
        self.assertEqual(self.post(LOCAL), 200)
        with patch.object(app, 'PORT', 8765):
            self.assertEqual(self.post('http://100.101.102.103:8765'), 403, 'sin configurar, otro dispositivo no entra')
        self.assertEqual(self.post('http://localhost:8765'), 403, 'igual que antes: localhost no estaba permitido')
        self.assertEqual(self.post('https://sitio-malicioso.com'), 403)

    def test_configured_origin_allowed_and_others_still_blocked(self):
        with patch.object(app, 'HOST', '100.101.102.103'), patch.object(app, 'PORT', 8765):
            self.assertEqual(self.post('http://100.101.102.103:8765'), 200)
            self.assertEqual(self.post(LOCAL), 200, 'la PC sigue funcionando')
            self.assertEqual(self.post('http://100.101.102.104:8765'), 403)
            self.assertEqual(self.post('https://sitio-malicioso.com'), 403)
            self.assertEqual(self.post('http://100.101.102.103:9999'), 403, 'el puerto también debe coincidir')


if __name__ == '__main__':
    unittest.main()
