"""hosting_ready_v1: inicio de sesión opcional, calendario suscribible, manifiesto. SQLite temporal, servidor real en un hilo, sin red externa."""
import base64
import datetime
import hashlib
import http.client
import io
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app
import hosting
from memory_store import DurableMemory

PASSWORD = 'correcto-caballo-1'
FAST_HASH = hosting.hash_password(PASSWORD, iterations=100_000)   # solo para acelerar las pruebas; el valor por defecto se comprueba aparte
SENT = {'answer': 'SENTINEL_ANSWER_81', 'learner': 'SENTINEL_LEARNER_82', 'node': 'SENTINEL_NODE_83', 'context': 'SENTINEL_CONTEXT_84', 'question': 'SENTINEL_QUESTION_85'}
NOW_MS = int(datetime.datetime(2026, 11, 16, 15, 0, tzinfo=datetime.timezone.utc).timestamp() * 1000)
DAY_MS = 86400000


def make_store(goal_name='Pintura en polvo; básica, con coma'):
    return {'active': 'g1', 'goals': [{
        'id': 'g1', 'goal': goal_name, 'context': SENT['context'], 'learner': {'note': SENT['learner']},
        'nodes': [{'id': n, 'name': SENT['node'], 'prerequisites': []} for n in ('a', 'b', 'c', 'd', 'e')],
        'reviews': [{'id': 'a', 'due': NOW_MS - 3 * DAY_MS, 'question': {'prompt': SENT['question']}}, {'id': 'b', 'due': NOW_MS - DAY_MS},
                    {'id': 'c', 'due': NOW_MS - 1000}, {'id': 'd', 'due': NOW_MS + 3 * DAY_MS}, {'id': 'e', 'due': NOW_MS + 3 * DAY_MS},
                    {'id': 'zzz', 'due': NOW_MS - DAY_MS}, {'id': 'a2', 'due': 'no'}],
        'events': [{'type': 'EVIDENCE', 'answer': SENT['answer'], 'result': 'CORRECT', 'attempt_id': 'x'}]}]}


class Server:
    """Servidor real en un hilo con memoria temporal. Los POST llevan Origin del propio servidor, como un navegador."""
    mode = 'required'

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = DurableMemory(Path(self.tmp.name) / 'n.sqlite')
        self.memory.set_password_hash(FAST_HASH)
        self.patches = [patch.object(app, 'memory', return_value=self.memory), patch.object(app, '_TEST_MEMORY', True), patch.object(app, 'AUTH_MODE', self.mode),
                        patch.object(app, '_LOGIN_LIMITER', hosting.LoginLimiter()), patch.object(app, '_ICS_LIMITER', hosting.LoginLimiter()),
                        patch.object(urllib.request, 'urlopen', side_effect=AssertionError('sin red externa en estas pruebas'))]
        for p in self.patches:
            p.start()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        self.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f'http://127.0.0.1:{app.PORT}'

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=2)
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def req(self, method, path, body=None, cookie=None, origin='default', headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        h = dict(headers or {})
        if method == 'POST':
            h['Content-Type'] = 'application/json'
            if origin == 'default':
                h['Origin'] = self.origin
            elif origin:
                h['Origin'] = origin
        if cookie:
            h['Cookie'] = cookie
        conn.request(method, path, body=json.dumps(body if body is not None else {}).encode() if method == 'POST' else None, headers=h)
        r = conn.getresponse()
        data = r.read()
        out = (r.status, r, data)
        conn.close()
        return out

    def login(self, password=PASSWORD, **kw):
        return self.req('POST', '/api/login', {'password': password}, **kw)

    def session_cookie(self):
        status, resp, _ = self.login()
        assert status == 200, status
        return resp.getheader('Set-Cookie').split(';')[0]

    def make_profile(self, store=None, name='Perfil'):
        pid = self.memory.create_profile(name)['profile_id']
        with self.memory._connect() as db:
            db.execute('UPDATE stores SET store_json=? WHERE profile_id=?', (json.dumps(store or make_store()), pid))
        return pid


# ------------------------------------------------------------------ A. arranque
class StartupPolicy(unittest.TestCase):
    def test_private_and_public_hosts(self):
        for host in ('127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.20', '100.64.0.1', '100.101.102.103', '::1', 'fc00::1', 'fd12:3456::1'):
            self.assertTrue(hosting.host_is_private(host), host)
        for host in ('0.0.0.0', '::', '8.8.8.8', '203.0.113.5', '172.32.0.1', '100.128.0.1', '11.0.0.1', 'mi-pc', '', 'fe80::1', '2001:db8::1'):
            self.assertFalse(hosting.host_is_private(host), host)

    def test_public_or_all_interfaces_refused_without_auth(self):
        for host in ('0.0.0.0', '::', '203.0.113.5'):
            message = hosting.startup_problem(host, 'off', True)
            self.assertIn('se niega a arrancar', message)
            self.assertEqual(hosting.startup_problem(host, 'required', True), '', 'con auth required y contraseña sí puede')

    def test_private_hosts_start_without_auth_as_today(self):
        for host in ('127.0.0.1', '100.101.102.103', '192.168.1.5'):
            self.assertEqual(hosting.startup_problem(host, 'off', False), '')

    def test_required_without_password_refuses(self):
        self.assertIn('--set-password', hosting.startup_problem('127.0.0.1', 'required', False))

    def test_auth_value_validation(self):
        self.assertEqual(hosting.parse_auth_mode(None), 'off')
        self.assertEqual(hosting.parse_auth_mode(''), 'off')
        self.assertEqual(hosting.parse_auth_mode(' Required '), 'required')
        with self.assertRaises(ValueError):
            hosting.parse_auth_mode('si')

    def run_main(self, env_extra):
        env = {**os.environ, 'RUTA_DB_PATH': str(Path(tempfile.mkdtemp()) / 'x.sqlite3'), **env_extra}
        env.pop('GEMINI_API_KEY', None)
        return subprocess.run([sys.executable, str(ROOT / 'app_legacy.py')], env=env, capture_output=True, text=True, timeout=30)

    def test_server_process_refuses_to_start(self):
        out = self.run_main({'LEARNSCIENCE_HOST': '0.0.0.0'})
        self.assertEqual(out.returncode, 2)
        self.assertIn('se niega a arrancar', out.stderr)
        out = self.run_main({'LEARNSCIENCE_HOST': '203.0.113.5', 'LEARNSCIENCE_AUTH': 'off'})
        self.assertEqual(out.returncode, 2)
        out = self.run_main({'LEARNSCIENCE_AUTH': 'required'})
        self.assertEqual(out.returncode, 2)
        self.assertIn('--set-password', out.stderr)
        out = self.run_main({'LEARNSCIENCE_AUTH': 'quizas'})
        self.assertEqual(out.returncode, 2)
        self.assertIn('LEARNSCIENCE_AUTH', out.stderr)

    def test_default_process_starts_and_serves_like_before(self):
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
        env = {**os.environ, 'PORT': str(port), 'RUTA_DB_PATH': str(Path(tempfile.mkdtemp()) / 'x.sqlite3')}
        for key in ('GEMINI_API_KEY', 'LEARNSCIENCE_AUTH', 'LEARNSCIENCE_HOST', 'LEARNSCIENCE_ORIGINS'):
            env.pop(key, None)
        proc = subprocess.Popen([sys.executable, str(ROOT / 'app_legacy.py')], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            body = None
            for _ in range(60):
                try:
                    body = urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=2).read()
                    break
                except Exception:
                    time.sleep(0.25)
            self.assertIsNotNone(body, 'el servidor por defecto no arrancó')
            self.assertIn('provider', json.loads(body))
            req = urllib.request.Request(f'http://127.0.0.1:{port}/api/profiles/list', data=b'{}', headers={'Content-Type': 'application/json'}, method='POST')
            self.assertEqual(urllib.request.urlopen(req, timeout=5).status, 200, 'sin contraseña y sin Origin, como hoy')
        finally:
            proc.kill(); proc.wait(timeout=5)
            proc.stdout.close(); proc.stderr.close()


class OffModeUnchanged(Server, unittest.TestCase):
    mode = 'off'

    def test_everything_open_as_before(self):
        status, resp, body = self.req('POST', '/api/profiles/list', {}, origin=None)
        self.assertEqual(status, 200, 'sin Origin ni cookie sigue permitido')
        self.assertEqual(self.req('POST', '/api/profiles/list', {})[0], 200)
        self.assertEqual(self.req('POST', '/api/profiles/list', {}, origin='https://sitio-malicioso.com')[0], 403, 'la comprobación de origen de antes sigue')
        self.assertIsNone(resp.getheader('Set-Cookie'))
        status, resp, body = self.req('GET', '/')
        self.assertEqual(status, 200)
        self.assertNotIn(b'login-form', body)
        self.assertIn(b'const KEY=', body)
        status, _, body = self.req('GET', '/api/health')
        self.assertEqual(status, 200)
        self.assertIn('provider', json.loads(body))
        self.assertEqual(json.loads(self.req('GET', '/api/auth/status')[2]), {'auth': 'off', 'logged_in': True})
        self.assertEqual(self.req('GET', '/api/models')[0], 200)
        self.assertEqual(self.req('POST', '/api/login', {'password': 'x'})[0], 400)
        self.assertEqual(self.req('GET', '/nada')[0], 404)

    def test_csp_and_security_headers_unchanged(self):
        _, resp, _ = self.req('GET', '/api/health')
        self.assertEqual(resp.getheader('Content-Security-Policy'), "default-src 'self' 'unsafe-inline';connect-src 'self';base-uri 'none'")
        self.assertEqual(resp.getheader('X-Content-Type-Options'), 'nosniff')
        self.assertEqual(resp.getheader('Cache-Control'), 'no-store')

    def test_calendar_works_without_login_in_off_mode(self):
        pid = self.make_profile()
        d = json.loads(self.req('POST', '/api/reminders/save', {'profile_id': pid, 'time': '20:00', 'days': [0, 1, 2, 3, 4, 5, 6]})[2])
        status, resp, body = self.req('GET', d['link_path'])
        self.assertEqual(status, 200)
        self.assertTrue(resp.getheader('Content-Type').startswith('text/calendar'))


# ------------------------------------------------------------------ B. contraseña
class PasswordTests(unittest.TestCase):
    def test_hash_format_and_defaults(self):
        self.assertGreaterEqual(hosting.PBKDF2_ITERATIONS, 600_000)
        encoded = hosting.hash_password('una contraseña larga')
        scheme, iters, salt, digest = encoded.split('$')
        self.assertEqual(scheme, 'pbkdf2_sha256')
        self.assertGreaterEqual(int(iters), 600_000)
        self.assertEqual(len(base64.b64decode(salt)), 16)
        self.assertNotIn('una contraseña larga', encoded)
        self.assertNotEqual(encoded, hosting.hash_password('una contraseña larga'), 'sal aleatoria')

    def test_verify(self):
        self.assertTrue(hosting.verify_password(PASSWORD, FAST_HASH))
        for bad in ('', 'otra-contraseña-larga', PASSWORD + ' ', PASSWORD.upper(), None, 12345):
            self.assertFalse(hosting.verify_password(bad, FAST_HASH))
        for broken in ('', 'x', 'pbkdf2_sha256$1$a$b', 'md5$100000$AA==$AA==', 'pbkdf2_sha256$abc$AA==$AA==', None):
            self.assertFalse(hosting.verify_password(PASSWORD, broken))

    def test_constant_time_compare_is_used(self):
        import inspect
        self.assertIn('hmac.compare_digest', inspect.getsource(hosting.verify_password))

    def test_short_password_rejected(self):
        with self.assertRaises(ValueError):
            hosting.hash_password('a' * 11)
        hosting.hash_password('a' * 12, iterations=100_000)

    def test_set_password_command(self):
        tmp = tempfile.TemporaryDirectory()
        mem = DurableMemory(Path(tmp.name) / 'p.sqlite')
        prompts, outputs = [], []

        def reader(answers):
            it = iter(answers)
            return lambda prompt='': (prompts.append(prompt), next(it))[1]
        app.set_password_command(read=reader(['una-clave-muy-larga', 'una-clave-muy-larga']), mem=mem, out=outputs.append)
        stored = mem.get_meta('auth_password_hash')
        self.assertTrue(hosting.verify_password('una-clave-muy-larga', stored))
        self.assertNotIn('una-clave-muy-larga', stored + ''.join(outputs))
        for answers in (['corta', 'corta'], ['una-clave-muy-larga', 'otra-clave-muy-larga']):
            with self.assertRaises(SystemExit), patch('sys.stderr', io.StringIO()):
                app.set_password_command(read=reader(answers), mem=mem, out=outputs.append)
        self.assertEqual(mem.get_meta('auth_password_hash'), stored, 'un intento fallido no cambia la contraseña')
        tmp.cleanup()

    def test_password_is_read_with_getpass_never_argv_or_env(self):
        import getpass
        self.assertIs(app.set_password_command.__defaults__[0], getpass.getpass)
        source = (ROOT / 'app_legacy.py').read_text(encoding='utf-8')
        self.assertNotIn("os.getenv('LEARNSCIENCE_PASSWORD", source)
        self.assertNotIn("argv[", source[source.index('def set_password_command'):source.index("if __name__=='__main__':")])

    def test_changing_password_invalidates_all_sessions(self):
        tmp = tempfile.TemporaryDirectory()
        mem = DurableMemory(Path(tmp.name) / 'p.sqlite')
        mem.set_password_hash(FAST_HASH)
        for token in ('t1', 't2'):
            mem.create_session(hosting.token_hash(token), 1000)
        self.assertEqual(mem.session_count(), 2)
        app.set_password_command(read=lambda prompt='': 'otra-clave-muy-larga', mem=mem, out=lambda *_: None)
        self.assertEqual(mem.session_count(), 0)
        self.assertFalse(mem.check_session(hosting.token_hash('t1'), 1000))
        tmp.cleanup()


# ------------------------------------------------------------------ C. login y sesión
class LoginTests(Server, unittest.TestCase):
    def test_wrong_password_is_generic_and_sets_no_cookie(self):
        status, resp, body = self.login('mala-contraseña-larga')
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(body), {'error': 'No se pudo iniciar sesión.'})
        self.assertIsNone(resp.getheader('Set-Cookie'))
        status, _, body2 = self.req('POST', '/api/login', {})
        self.assertEqual((status, json.loads(body2)), (401, {'error': 'No se pudo iniciar sesión.'}), 'misma respuesta sin contraseña')
        self.assertEqual(self.req('POST', '/api/login', {'password': ['x']})[0], 401)

    def test_login_cookie_attributes(self):
        status, resp, body = self.login()
        self.assertEqual(status, 200)
        cookie = resp.getheader('Set-Cookie')
        attrs = [a.strip() for a in cookie.split(';')]
        self.assertTrue(attrs[0].startswith('ruta_session='))
        self.assertGreaterEqual(len(attrs[0].split('=', 1)[1]), 40, 'token aleatorio largo')
        for expected in ('HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=2592000'):
            self.assertIn(expected, attrs)
        self.assertNotIn('Secure', attrs, 'por HTTP plano (Tailscale) no puede ir Secure o el navegador la descarta')
        self.assertNotIn(attrs[0].split('=', 1)[1].encode(), body)

    def test_secure_only_behind_trusted_proxy(self):
        _, resp, _ = self.login(headers={'X-Forwarded-Proto': 'https'})
        self.assertNotIn('Secure', resp.getheader('Set-Cookie'), 'X-Forwarded-Proto se ignora sin LEARNSCIENCE_TRUST_PROXY=1')
        with patch.object(app, 'TRUST_PROXY', True):
            _, resp, _ = self.login(headers={'X-Forwarded-Proto': 'https'})
            self.assertIn('Secure', [a.strip() for a in resp.getheader('Set-Cookie').split(';')])
            _, resp, _ = self.login(headers={'X-Forwarded-Proto': 'http'})
            self.assertNotIn('Secure', resp.getheader('Set-Cookie'))

    def test_only_hash_of_the_session_token_is_stored(self):
        cookie = self.session_cookie()
        token = cookie.split('=', 1)[1]
        with self.memory._connect() as db:
            rows = [r[0] for r in db.execute('SELECT token_hash FROM auth_sessions')]
            dump = ' '.join(str(v) for r in db.execute("SELECT key,value FROM metadata") for v in r)
        self.assertEqual(rows, [hashlib.sha256(token.encode()).hexdigest()])
        self.assertNotIn(token, rows)
        self.assertNotIn(PASSWORD, dump)

    def test_session_grants_access_and_garbage_does_not(self):
        cookie = self.session_cookie()
        self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=cookie)[0], 200)
        for bad in ('ruta_session=inventada', 'ruta_session=', 'otra=' + cookie.split('=', 1)[1], 'ruta_session=' + cookie.split('=', 1)[1] + 'x'):
            self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=bad)[0], 401, bad)

    def test_session_expiry_is_sliding(self):
        cookie = self.session_cookie()
        th = hosting.token_hash(cookie.split('=', 1)[1])
        ttl = hosting.SESSION_TTL_SECONDS
        self.assertEqual(ttl, 30 * 24 * 3600)
        now = int(time.time())
        self.assertTrue(self.memory.check_session(th, ttl, now=now + 20 * 24 * 3600))
        self.assertTrue(self.memory.check_session(th, ttl, now=now + 40 * 24 * 3600), 'se renovó a los 20 días, vale hasta el día 50')
        self.assertFalse(self.memory.check_session(th, ttl, now=now + 80 * 24 * 3600), 'caducada')
        self.assertFalse(self.memory.check_session(th, ttl, now=now + 81 * 24 * 3600), 'y se borró')
        self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=cookie)[0], 401)

    def test_expired_session_is_rejected_over_http(self):
        cookie = self.session_cookie()
        with self.memory._connect() as db:
            db.execute('UPDATE auth_sessions SET expires_at=?', (int(time.time()) - 5,))
        status, _, body = self.req('POST', '/api/profiles/list', {}, cookie=cookie)
        self.assertEqual(status, 401)
        self.assertTrue(json.loads(body)['login_required'])

    def test_logout_revokes_and_clears_cookie(self):
        cookie = self.session_cookie()
        status, resp, _ = self.req('POST', '/api/logout', {}, cookie=cookie)
        self.assertEqual(status, 200)
        self.assertIn('Max-Age=0', resp.getheader('Set-Cookie'))
        self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=cookie)[0], 401)
        self.assertEqual(self.memory.session_count(), 0)

    def test_password_change_invalidates_open_sessions_over_http(self):
        cookie = self.session_cookie()
        self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=cookie)[0], 200)
        self.memory.set_password_hash(hosting.hash_password('nueva-contraseña-larga', iterations=100_000))
        self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=cookie)[0], 401)
        self.assertEqual(self.login()[0], 401, 'la contraseña anterior ya no sirve')
        self.assertEqual(self.login('nueva-contraseña-larga')[0], 200)

    def test_rate_limit_over_http(self):
        for _ in range(hosting.LoginLimiter.IP_FREE):
            self.assertEqual(self.login('mala-contraseña-larga')[0], 401)
        status, resp, body = self.login('mala-contraseña-larga')
        self.assertEqual(status, 429)
        self.assertGreater(int(resp.getheader('Retry-After')), 0)
        status, resp, _ = self.login(PASSWORD)
        self.assertEqual(status, 429, 'ni la contraseña correcta entra durante la espera')
        self.assertIsNone(resp.getheader('Set-Cookie'))

    def test_login_and_logout_need_allowed_origin(self):
        self.assertEqual(self.login(origin=None)[0], 403)
        self.assertEqual(self.login(origin='https://sitio-malicioso.com')[0], 403)
        self.assertEqual(self.req('POST', '/api/logout', {}, origin='https://sitio-malicioso.com')[0], 403)

    def test_nothing_secret_in_server_log(self):
        err = io.StringIO()
        with patch('sys.stderr', err):
            cookie = self.session_cookie()
            self.req('POST', '/api/profiles/list', {}, cookie=cookie)
            self.login('mala-contraseña-larga')
        text = err.getvalue()
        self.assertTrue(text)
        for secret in (PASSWORD, cookie.split('=', 1)[1], 'mala-contraseña-larga'):
            self.assertNotIn(secret, text)


class LimiterTests(unittest.TestCase):
    def test_growing_wait_per_ip_and_reset(self):
        clock = [1000.0]
        lim = hosting.LoginLimiter(clock=lambda: clock[0])
        for _ in range(lim.IP_FREE):
            self.assertEqual(lim.retry_after('1.1.1.1'), 0)
            lim.failure('1.1.1.1')
        first = lim.retry_after('1.1.1.1')
        self.assertGreater(first, 0)
        self.assertEqual(lim.retry_after('2.2.2.2'), 0, 'otra IP no se bloquea por esta')
        clock[0] += first + 1
        self.assertEqual(lim.retry_after('1.1.1.1'), 0)
        lim.failure('1.1.1.1')
        second = lim.retry_after('1.1.1.1')
        self.assertGreater(second, first, 'la espera crece')
        lim.success('1.1.1.1')
        self.assertEqual(lim.retry_after('1.1.1.1'), 0)

    def test_global_limit_across_ips(self):
        lim = hosting.LoginLimiter(clock=lambda: 5000.0)
        for i in range(lim.GLOBAL_FREE):
            lim.failure(f'9.9.{i // 200}.{i % 200}')
        self.assertGreater(lim.retry_after('7.7.7.7'), 0, 'una IP nueva también espera si el ataque es distribuido')

    def test_idle_forgets(self):
        clock = [0.0]
        lim = hosting.LoginLimiter(clock=lambda: clock[0])
        for _ in range(10):
            lim.failure('1.1.1.1')
        self.assertGreater(lim.retry_after('1.1.1.1'), 0)
        clock[0] += lim.IDLE_RESET + 1
        self.assertEqual(lim.retry_after('1.1.1.1'), 0)


# ------------------------------------------------------------------ D. todas las rutas protegidas
class RouteProtection(Server, unittest.TestCase):
    EXPECTED_PUBLIC_GET = {'/', '/api/health', '/api/auth/status', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'}
    EXPECTED_PUBLIC_POST = {'/api/login', '/api/logout'}

    def test_public_lists_are_exactly_the_reviewed_ones(self):
        self.assertEqual(set(app.PUBLIC_GET), self.EXPECTED_PUBLIC_GET)
        self.assertEqual(set(app.PUBLIC_POST), self.EXPECTED_PUBLIC_POST)

    def test_every_post_route_requires_a_session(self):
        self.assertGreater(len(app.ROUTES), 60)
        unprotected = []
        for path in sorted(app.ROUTES):
            status, _, body = self.req('POST', path, {})
            if status != 401 or not json.loads(body).get('login_required'):
                unprotected.append((path, status))
        self.assertEqual(unprotected, [], 'rutas sin sesión: añade la ruta a la protección o revisa PUBLIC_POST')

    def test_every_post_route_is_reachable_with_a_session(self):
        cookie = self.session_cookie()
        blocked = [p for p in sorted(app.ROUTES) if self.req('POST', p, {}, cookie=cookie)[0] in (401, 403)]
        self.assertEqual(blocked, [])

    def test_every_get_path_requires_a_session_except_the_public_ones(self):
        candidates = {'/api/models', '/api/profile/export', '/api/profiles/list', '/exports', '/export', '/calendar.ics', '/static/app.js', '/index.html', '/app.js', '/api/usage/summary',
                      '/docs/', '/.git/config', '/memory.sqlite3', '/api/reminders/get', '/api/anything-new'} | set(app.ROUTES)
        leaks = []
        for path in sorted(candidates):
            status, _, _ = self.req('GET', path)
            if status != 401:
                leaks.append((path, status))
        self.assertEqual(leaks, [])

    def test_public_get_paths_answer_without_session(self):
        for path in sorted(self.EXPECTED_PUBLIC_GET):
            self.assertEqual(self.req('GET', path)[0], 200, path)

    def test_login_page_exposes_none_of_the_app(self):
        _, _, body = self.req('GET', '/')
        text = body.decode()
        self.assertIn('login-form', text)
        for marker in ('const KEY=', 'ruta-adaptativa-v4', '/api/profile', 'VISUAL_CSS'):
            self.assertNotIn(marker, text)
        cookie = self.session_cookie()
        _, _, body = self.req('GET', '/', cookie=cookie)
        self.assertIn(b'const KEY=', body)
        self.assertNotIn(b'login-form', body)

    def test_health_is_minimal_without_session(self):
        self.assertEqual(json.loads(self.req('GET', '/api/health')[2]), {'ok': True})
        full = json.loads(self.req('GET', '/api/health', cookie=self.session_cookie())[2])
        self.assertIn('provider', full)

    def test_auth_status(self):
        self.assertEqual(json.loads(self.req('GET', '/api/auth/status')[2]), {'auth': 'required', 'logged_in': False})
        self.assertEqual(json.loads(self.req('GET', '/api/auth/status', cookie=self.session_cookie())[2]), {'auth': 'required', 'logged_in': True})

    def test_unknown_post_route_is_404(self):
        self.assertEqual(self.req('POST', '/api/no-existe', {})[0], 404)

    def test_calendar_route_has_its_own_credential(self):
        self.assertEqual(self.req('GET', '/calendar/x.ics')[0], 401, 'forma de token inválida: cae en la regla por defecto')
        self.assertEqual(self.req('GET', '/calendar/' + 'A' * 32 + '.ics')[0], 404, 'forma válida pero token desconocido: 404 genérico, sin sesión')


# ------------------------------------------------------------------ E. CSRF
class CsrfTests(Server, unittest.TestCase):
    def test_post_needs_allowed_origin_even_with_valid_cookie(self):
        cookie = self.session_cookie()
        self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=cookie)[0], 200)
        self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=cookie, origin='https://sitio-malicioso.com')[0], 403)
        self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=cookie, origin='http://localhost:8765')[0], 403)
        self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=cookie, origin=None)[0], 403, 'con auth activo el Origin es obligatorio')

    def test_configured_extra_origin_is_allowed(self):
        cookie = self.session_cookie()
        with patch.object(app, 'EXTRA_ORIGINS', ('https://tutor.ejemplo.com',)):
            self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=cookie, origin='https://tutor.ejemplo.com')[0], 200)
            self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=cookie, origin='https://otro.ejemplo.com')[0], 403)


# ------------------------------------------------------------------ F. calendario
def unfold(text):
    return text.replace('\r\n ', '')


class CalendarTests(Server, unittest.TestCase):
    def setup_link(self, store=None, **settings):
        pid = self.make_profile(store)
        cookie = self.session_cookie()
        body = {'profile_id': pid, 'time': '20:30', 'days': [0, 1, 2, 3, 4, 5, 6], **settings}
        status, _, raw = self.req('POST', '/api/reminders/save', body, cookie=cookie)
        self.assertEqual(status, 200, raw)
        return pid, cookie, json.loads(raw)

    def fetch(self, path):
        status, resp, body = self.req('GET', path)
        return status, resp, body.decode('utf-8')

    def test_valid_icalendar_and_no_learner_data(self):
        pid, _, d = self.setup_link()
        status, resp, text = self.fetch(d['link_path'])
        self.assertEqual(status, 200)
        self.assertEqual(resp.getheader('Content-Type'), 'text/calendar; charset=utf-8')
        self.assertTrue(text.startswith('BEGIN:VCALENDAR\r\n') and text.endswith('END:VCALENDAR\r\n'))
        self.assertNotIn('\n', text.replace('\r\n', ''), 'solo CRLF')
        self.assertNotIn('\r', text.replace('\r\n', ''))
        for line in text.split('\r\n')[:-1]:
            self.assertLessEqual(len(line.encode('utf-8')), 75, line)
        flat = unfold(text)
        self.assertIn('VERSION:2.0', flat)
        self.assertIn('PRODID:', flat)
        self.assertIn('BEGIN:VALARM', flat)
        self.assertIn('RRULE:FREQ=DAILY', flat)
        self.assertIn('DTSTART:', flat)
        self.assertRegex(flat, r'DTSTAMP:\d{8}T\d{6}Z')
        self.assertEqual(flat.count('BEGIN:VEVENT'), flat.count('END:VEVENT'))
        self.assertIn('SUMMARY:Estudiar: Pintura en polvo\\; básica\\, con coma', flat, 'texto escapado')
        for value in list(SENT.values()) + [pid, 'profile-', 'attempt', 'CORRECT']:
            self.assertNotIn(value, text)

    def test_review_events_grouped_by_day_from_stored_due(self):
        _, _, d = self.setup_link()
        with patch.object(hosting.time, 'time', return_value=NOW_MS / 1000.0):
            _, _, text = self.fetch(d['link_path'])
        flat = unfold(text)
        summaries = re.findall(r'SUMMARY:(\d+ repasos? de [^\r\n]*)', flat)
        self.assertEqual(sorted(summaries), ['2 repasos de Pintura en polvo\\; básica\\, con coma', '3 repasos de Pintura en polvo\\; básica\\, con coma'])
        self.assertIn('DTSTART;VALUE=DATE:20261116', flat, 'los vencidos van a hoy')
        self.assertIn('DTSTART;VALUE=DATE:20261119', flat)
        self.assertNotIn('4 repasos', flat, 'ni el nodo inexistente ni la fecha inválida cuentan')

    def test_uids_are_stable_and_unique(self):
        _, _, d = self.setup_link()
        with patch.object(hosting.time, 'time', return_value=NOW_MS / 1000.0):
            a = unfold(self.fetch(d['link_path'])[2]); b = unfold(self.fetch(d['link_path'])[2])
        uids = re.findall(r'UID:(\S+)', a)
        self.assertEqual(uids, re.findall(r'UID:(\S+)', b))
        self.assertEqual(len(uids), len(set(uids)))
        self.assertTrue(all(u.endswith('@ruta.local') for u in uids))

    def test_hide_goal_name(self):
        _, _, d = self.setup_link(hide_goal_name=True)
        flat = unfold(self.fetch(d['link_path'])[2])
        self.assertNotIn('Pintura', flat)
        self.assertIn('SUMMARY:Estudiar\r\n', flat)
        self.assertRegex(flat, r'SUMMARY:\d+ repasos\r\n')

    def test_day_selection_rrule(self):
        _, _, d = self.setup_link(days=[0, 2, 4])
        self.assertIn('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', unfold(self.fetch(d['link_path'])[2]))

    def test_long_non_ascii_line_folds_without_breaking_characters(self):
        name = 'ñandú ' * 30
        _, _, d = self.setup_link(store=make_store(name))
        status, resp, body = self.req('GET', d['link_path'])
        raw = body
        for line in raw.split(b'\r\n')[:-1]:
            self.assertLessEqual(len(line), 75)
            line.decode('utf-8')   # ninguna línea física parte un carácter
        flat = unfold(raw.decode('utf-8'))
        self.assertIn('SUMMARY:Estudiar: ' + name[:80], flat)
        self.assertEqual(hosting.ics_fold('A' * 75), 'A' * 75)
        self.assertEqual(hosting.ics_fold('A' * 76), 'A' * 75 + '\r\n A')

    def test_escaping(self):
        self.assertEqual(hosting.ics_escape('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne')
        self.assertNotIn('\x00', hosting.ics_escape('x\x00y'))

    def test_invalid_tokens_are_a_generic_404(self):
        _, _, d = self.setup_link()
        good = d['link_path']
        tampered = good[:-5] + ('A' if good[-5] != 'A' else 'B') + good[-4:]
        for path in (tampered, '/calendar/' + 'A' * 32 + '.ics', '/calendar/' + 'a' * 22 + '.ics'):
            status, _, text = self.fetch(path)
            self.assertEqual((status, json.loads(text)), (404, {'error': 'No existe esta ruta.'}), path)

    def test_token_strength_and_storage(self):
        pid, _, d = self.setup_link()
        token = re.match(r'/calendar/(.+)\.ics', d['link_path']).group(1)
        self.assertGreaterEqual(len(base64.urlsafe_b64decode(token + '=' * (-len(token) % 4))) * 8, 128)
        with self.memory._connect() as db:
            stored = [r[0] for r in db.execute('SELECT token_hash FROM reminders')]
            everything = json.dumps([list(r) for r in db.execute('SELECT * FROM reminders')])
        self.assertEqual(stored, [hosting.token_hash(token)])
        self.assertNotIn(token, everything)

    def test_get_never_returns_the_token(self):
        pid, cookie, d = self.setup_link()
        token = re.match(r'/calendar/(.+)\.ics', d['link_path']).group(1)
        status, _, raw = self.req('POST', '/api/reminders/get', {'profile_id': pid}, cookie=cookie)
        self.assertEqual(status, 200)
        self.assertNotIn(token, raw.decode())
        info = json.loads(raw)
        self.assertTrue(info['has_link'])
        self.assertTrue(info['settings']['enabled'])
        status, _, raw = self.req('POST', '/api/reminders/save', {'profile_id': pid, 'time': '07:05', 'days': [0]}, cookie=cookie)
        self.assertIsNone(json.loads(raw)['link_path'], 'guardar de nuevo no vuelve a mostrar ni cambia el enlace')
        self.assertEqual(self.fetch(d['link_path'])[0], 200)

    def test_regenerate_revokes_previous_link(self):
        pid, cookie, d = self.setup_link()
        self.assertEqual(self.fetch(d['link_path'])[0], 200)
        status, _, raw = self.req('POST', '/api/reminders/regenerate', {'profile_id': pid}, cookie=cookie)
        new = json.loads(raw)['link_path']
        self.assertNotEqual(new, d['link_path'])
        self.assertEqual(self.fetch(d['link_path'])[0], 404)
        self.assertEqual(self.fetch(new)[0], 200)

    def test_disable_revokes_and_can_be_reenabled_with_new_link(self):
        pid, cookie, d = self.setup_link()
        status, _, raw = self.req('POST', '/api/reminders/disable', {'profile_id': pid}, cookie=cookie)
        self.assertFalse(json.loads(raw)['has_link'])
        self.assertEqual(self.fetch(d['link_path'])[0], 404)
        status, _, raw = self.req('POST', '/api/reminders/save', {'profile_id': pid, 'time': '20:00', 'days': [1]}, cookie=cookie)
        again = json.loads(raw)['link_path']
        self.assertTrue(again and again != d['link_path'])
        self.assertEqual(self.fetch(d['link_path'])[0], 404)
        self.assertEqual(self.fetch(again)[0], 200)

    def test_regenerate_requires_prior_activation(self):
        pid = self.make_profile()
        status, _, raw = self.req('POST', '/api/reminders/regenerate', {'profile_id': pid}, cookie=self.session_cookie())
        self.assertEqual(status, 400)

    def test_profile_isolation(self):
        other = make_store('Meta del otro perfil SENTINEL_OTRO')
        other['goals'][0]['id'] = 'g9'; other['active'] = 'g9'
        pid1, cookie, d1 = self.setup_link()
        pid2 = self.make_profile(other, 'Otro')
        _, _, raw = self.req('POST', '/api/reminders/save', {'profile_id': pid2, 'time': '09:00', 'days': [0, 1, 2, 3, 4, 5, 6]}, cookie=cookie)
        d2 = json.loads(raw)
        t1, t2 = self.fetch(d1['link_path'])[2], self.fetch(d2['link_path'])[2]
        self.assertIn('Pintura en polvo', t1)
        self.assertNotIn('SENTINEL_OTRO', t1)
        self.assertIn('SENTINEL_OTRO', t2)
        self.assertNotIn('Pintura', t2)
        self.assertNotEqual(re.findall(r'UID:(\S+)', t1)[0], re.findall(r'UID:(\S+)', t2)[0])
        self.assertIn('DTSTART:' + datetime.date.today().strftime('%Y%m%d') + 'T090000', unfold(t2))

    def test_deleting_profile_removes_its_link(self):
        pid, cookie, d = self.setup_link()
        self.req('POST', '/api/profile/delete', {'profile_id': pid}, cookie=cookie)
        self.assertEqual(self.fetch(d['link_path'])[0], 404)

    def test_bad_settings_rejected(self):
        pid = self.make_profile(); cookie = self.session_cookie()
        for body in ({'time': '25:00', 'days': [0]}, {'time': '20:00', 'days': []}, {'time': '20:00', 'days': [7]}, {'time': '20:00', 'days': 'todos'}, {'time': 'x', 'days': [0]}, {'days': [0]}):
            self.assertEqual(self.req('POST', '/api/reminders/save', {'profile_id': pid, **body}, cookie=cookie)[0], 400, body)
        self.assertEqual(self.req('POST', '/api/reminders/save', {'profile_id': 'profile-no-existe', 'time': '20:00', 'days': [0]}, cookie=cookie)[0], 400)

    def test_token_not_written_to_server_log(self):
        _, _, d = self.setup_link()
        token = re.match(r'/calendar/(.+)\.ics', d['link_path']).group(1)
        err = io.StringIO()
        with patch('sys.stderr', err):
            self.fetch(d['link_path'])
            self.fetch('/calendar/' + 'Z' * 30 + '.ics')
        self.assertIn('/calendar/<oculto>.ics', err.getvalue())
        self.assertNotIn(token, err.getvalue())
        self.assertNotIn('ZZZZZZZZZZ', err.getvalue())

    def test_probing_tokens_is_rate_limited(self):
        statuses = [self.fetch('/calendar/' + chr(65 + i) * 30 + '.ics')[0] for i in range(hosting.LoginLimiter.IP_FREE + 1)]
        self.assertEqual(statuses[:-1], [404] * hosting.LoginLimiter.IP_FREE)
        self.assertEqual(statuses[-1], 429)


class TimeZoneTests(unittest.TestCase):
    base = {'hour': 20, 'minute': 30, 'days': list(range(7)), 'anchor_date': '2026-03-01'}

    def test_daily_event_is_floating_local_time(self):
        for now in (datetime.datetime(2026, 3, 7, 12, tzinfo=datetime.timezone.utc), datetime.datetime(2026, 3, 9, 12, tzinfo=datetime.timezone.utc)):   # a ambos lados del cambio de horario de EE. UU.
            text = unfold(hosting.build_calendar('p', make_store(), dict(self.base, timezone='America/New_York', utc_offset_minutes=-300), now_ms=int(now.timestamp() * 1000)))
            self.assertIn('DTSTART:20260301T203000\r\n', text, 'hora del reloj, sin Z ni TZID: el cambio de horario no la mueve')
            self.assertNotIn('TZID', text)
            self.assertNotRegex(text, r'DTSTART:\d{8}T\d{6}Z')

    def test_review_date_uses_the_client_offset(self):
        due = int(datetime.datetime(2026, 11, 16, 5, 30, tzinfo=datetime.timezone.utc).timestamp() * 1000)   # 23:30 del día 15 en UTC-6
        store = {'active': 'g', 'goals': [{'id': 'g', 'goal': 'M', 'nodes': [{'id': 'a'}], 'reviews': [{'id': 'a', 'due': due}]}]}
        now = int(datetime.datetime(2026, 11, 10, 12, tzinfo=datetime.timezone.utc).timestamp() * 1000)
        self.assertEqual([g[0].isoformat() for g in hosting.due_review_groups(store, now, '', -360)], ['2026-11-15'])
        self.assertEqual([g[0].isoformat() for g in hosting.due_review_groups(store, now, '', 0)], ['2026-11-16'])
        try:
            import zoneinfo
            zoneinfo.ZoneInfo('America/Mexico_City')
        except Exception:
            return
        self.assertEqual([g[0].isoformat() for g in hosting.due_review_groups(store, now, 'America/Mexico_City', 0)], ['2026-11-15'], 'la zona IANA manda sobre el desfase')

    def test_clean_settings_sanitizes_timezone(self):
        s = hosting.clean_reminder_settings({'time': '7:05', 'days': [2, 0, 2], 'timezone': '<script>', 'utc_offset_minutes': 99999})
        self.assertEqual((s['hour'], s['minute'], s['days'], s['timezone'], s['utc_offset_minutes']), (7, 5, [0, 2], '', 0))


# ------------------------------------------------------------------ G. instalable
class InstallableTests(Server, unittest.TestCase):
    def test_manifest(self):
        status, resp, body = self.req('GET', '/manifest.webmanifest')
        self.assertEqual(status, 200)
        self.assertTrue(resp.getheader('Content-Type').startswith('application/manifest+json'))
        m = json.loads(body)
        self.assertEqual((m['display'], m['start_url'], m['short_name']), ('standalone', '/', 'Ruta'))
        self.assertTrue({'192x192', '512x512'} <= {i['sizes'] for i in m['icons']})
        for icon in m['icons']:
            self.assertEqual(self.req('GET', icon['src'])[0], 200, icon['src'])

    def test_icons_are_valid(self):
        status, resp, body = self.req('GET', '/icon.svg')
        self.assertEqual(resp.getheader('Content-Type'), 'image/svg+xml')
        self.assertTrue(body.startswith(b'<svg'))
        import struct
        import zlib
        for path, size in (('/icon-192.png', 192), ('/icon-512.png', 512), ('/apple-touch-icon.png', 180)):
            status, resp, png = self.req('GET', path)
            self.assertEqual(resp.getheader('Content-Type'), 'image/png')
            self.assertEqual(png[:8], b'\x89PNG\r\n\x1a\n')
            width, height = struct.unpack('>II', png[16:24])
            self.assertEqual((width, height), (size, size))
            idat = png[png.index(b'IDAT') + 4:png.index(b'IEND') - 8]
            self.assertEqual(len(zlib.decompress(idat)), size * (size * 3 + 1))

    def test_page_head_has_install_metadata_and_no_service_worker(self):
        cookie = self.session_cookie()
        _, _, body = self.req('GET', '/', cookie=cookie)
        text = body.decode()
        for needle in ('rel="manifest"', 'rel="apple-touch-icon"', 'apple-mobile-web-app-capable', 'apple-mobile-web-app-title', 'name="theme-color"', 'prefers-color-scheme: dark'):
            self.assertIn(needle, text)
        self.assertNotIn('serviceWorker', text)
        self.assertNotEqual(self.req('GET', '/sw.js', cookie=cookie)[0], 200)

    def test_login_page_is_installable_and_themed(self):
        _, _, body = self.req('GET', '/')
        text = body.decode()
        self.assertIn('rel="manifest"', text)
        self.assertIn('prefers-color-scheme:dark', text)
        self.assertIn('name="viewport"', text)
        self.assertIn('type="password"', text)
        self.assertIn('autocomplete="current-password"', text)

    def test_csp_not_relaxed(self):
        _, resp, _ = self.req('GET', '/manifest.webmanifest')
        self.assertEqual(resp.getheader('Content-Security-Policy'), "default-src 'self' 'unsafe-inline';connect-src 'self';base-uri 'none'")


if __name__ == '__main__':
    unittest.main()
