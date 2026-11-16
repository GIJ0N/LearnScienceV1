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


class TestHTTPServer(ThreadingHTTPServer):
    request_queue_size = 128   # las pruebas lanzan 60 peticiones a la vez


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
        self.server = TestHTTPServer(('127.0.0.1', 0), app.Handler)
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

    def test_loopback_and_tailscale_start_without_auth_as_today(self):
        for host in ('127.0.0.1', '127.0.0.5', '100.101.102.103', '100.64.0.1', '::1'):
            self.assertEqual(hosting.startup_problem(host, 'off', False), '', host)

    def test_other_private_networks_need_explicit_opt_in_without_auth(self):
        for host in ('192.168.1.5', '10.0.0.5', '172.16.0.1', 'fd00::1'):
            message = hosting.startup_problem(host, 'off', False)
            self.assertIn('se niega a arrancar sin contraseña', message, host)
            self.assertIn('LEARNSCIENCE_ALLOW_LAN_WITHOUT_AUTH=1', message)
            self.assertIn('NAT', message)
            self.assertIn('Docker', message)
            self.assertEqual(hosting.startup_problem(host, 'off', False, allow_lan=True), '', 'con el permiso explícito sí')
            self.assertEqual(hosting.startup_problem(host, 'required', True), '', 'con login sí')
        self.assertIn('se niega', hosting.startup_problem('0.0.0.0', 'off', False, allow_lan=True), '0.0.0.0 no se abre con el permiso de LAN')
        self.assertIn('se niega', hosting.startup_problem('203.0.113.5', 'off', False, allow_lan=True))

    def test_server_process_refuses_lan_without_opt_in(self):
        out = self.run_main({'LEARNSCIENCE_HOST': '192.168.1.5'})
        self.assertEqual(out.returncode, 2)
        self.assertIn('LEARNSCIENCE_ALLOW_LAN_WITHOUT_AUTH', out.stderr)
        out = self.run_main({'LEARNSCIENCE_TRUSTED_PROXIES': 'no-es-una-red'})
        self.assertEqual(out.returncode, 2)
        self.assertIn('LEARNSCIENCE_TRUSTED_PROXIES', out.stderr)

    def test_cleartext_warning(self):
        warn = lambda host, https=False, proxy=False, mode='required': hosting.cleartext_warning(host, mode, https, proxy)
        self.assertIn('en claro', warn('0.0.0.0'))
        self.assertIn('en claro', warn('203.0.113.5'))
        self.assertEqual(warn('0.0.0.0', https=True), '')
        self.assertEqual(warn('0.0.0.0', proxy=True), '')
        self.assertEqual(warn('100.101.102.103'), '', 'red privada: sin aviso')
        self.assertEqual(warn('0.0.0.0', mode='off'), '')

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
        self.assertEqual(resp.getheader('Content-Security-Policy'), "default-src 'self' 'unsafe-inline';connect-src 'self';base-uri 'none';frame-ancestors 'none'")
        self.assertEqual(resp.getheader('X-Content-Type-Options'), 'nosniff')
        self.assertEqual(resp.getheader('X-Frame-Options'), 'DENY')
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
        cookie = resp.msg.get_all('Set-Cookie')[0]
        attrs = [a.strip() for a in cookie.split(';')]
        self.assertTrue(attrs[0].startswith('ruta_session='))
        self.assertGreaterEqual(len(attrs[0].split('=', 1)[1]), 40, 'token aleatorio largo')
        for expected in ('HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000'):
            self.assertIn(expected, attrs)
        self.assertNotIn('Secure', attrs, 'por HTTP plano (Tailscale) no puede ir Secure o el navegador la descarta')
        self.assertNotIn(attrs[0].split('=', 1)[1].encode(), body)

    def test_secure_only_behind_trusted_proxy(self):
        sess = lambda resp: resp.msg.get_all('Set-Cookie')[0]
        _, resp, _ = self.login(headers={'X-Forwarded-Proto': 'https'})
        self.assertNotIn('Secure', sess(resp), 'X-Forwarded-Proto se ignora sin LEARNSCIENCE_TRUST_PROXY=1')
        with patch.object(app, 'TRUST_PROXY', True):
            _, resp, _ = self.login(headers={'X-Forwarded-Proto': 'https'})
            self.assertIn('Secure', [a.strip() for a in sess(resp).split(';')])
            self.assertTrue(all('Secure' in c for c in resp.msg.get_all('Set-Cookie')), 'también la cookie de dispositivo')
            _, resp, _ = self.login(headers={'X-Forwarded-Proto': 'http'})
            self.assertNotIn('Secure', sess(resp))

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
    def test_hard_lock_per_ip_with_growing_wait_and_reset(self):
        clock = [1000.0]
        lim = hosting.LoginLimiter(clock=lambda: clock[0])
        for _ in range(lim.IP_FREE):
            self.assertEqual(lim.begin('1.1.1.1'), (True, 0))
        ok, first = lim.begin('1.1.1.1')
        self.assertFalse(ok)
        self.assertGreater(first, 0)
        self.assertEqual(lim.begin('2.2.2.2'), (True, 0), 'otra IP no se bloquea por esta')
        clock[0] += first + 1
        self.assertTrue(lim.begin('1.1.1.1')[0])
        ok, second = lim.begin('1.1.1.1')
        self.assertFalse(ok)
        self.assertGreater(second, first, 'la espera crece')
        lim.success('1.1.1.1')
        self.assertTrue(lim.begin('1.1.1.1')[0])

    def test_attempt_is_reserved_before_verifying_so_a_race_cannot_slip_through(self):
        lim = hosting.LoginLimiter()
        results, barrier = [], threading.Barrier(60)

        def attempt():
            barrier.wait()
            results.append(lim.begin('9.9.9.9')[0])
        threads = [threading.Thread(target=attempt) for _ in range(60)]
        [t.start() for t in threads]; [t.join() for t in threads]
        self.assertEqual(sum(results), lim.IP_FREE, 'solo IP_FREE intentos pasan aunque lleguen a la vez')

    def test_release_undoes_a_reservation(self):
        lim = hosting.LoginLimiter()
        for _ in range(lim.IP_FREE):
            self.assertTrue(lim.begin('1.1.1.1')[0])
            lim.release('1.1.1.1')
        self.assertTrue(lim.begin('1.1.1.1')[0], 'los intentos no verificados (servidor ocupado) no cuentan')

    def test_global_volume_only_slows_and_never_blocks(self):
        lim = hosting.LoginLimiter(clock=lambda: 5000.0)
        self.assertEqual(lim.global_delay(), 0)
        for i in range(lim.GLOBAL_FREE + 30):
            ip = f'9.9.{i // 200}.{i % 200}'
            self.assertTrue(lim.begin(ip)[0])
            lim.fail()
        self.assertTrue(lim.begin('7.7.7.7')[0], 'una IP nueva no se bloquea por los fallos de otras')
        self.assertGreater(lim.global_delay(), 0)
        self.assertLessEqual(lim.global_delay(), lim.GLOBAL_MAX_DELAY)
        lim.success('7.7.7.7')
        self.assertEqual(lim.global_delay(), 0, 'un acierto del dueño reinicia el ralentizador')

    def test_known_device_has_its_own_counter(self):
        lim = hosting.LoginLimiter()
        for _ in range(lim.IP_FREE):
            lim.begin('1.1.1.1')
        self.assertFalse(lim.begin('1.1.1.1')[0], 'la IP está bloqueada')
        self.assertTrue(lim.begin('1.1.1.1', device_id='d' * 32)[0], 'el dispositivo conocido entra')
        for _ in range(lim.DEVICE_FREE - 1):
            self.assertTrue(lim.begin('1.1.1.1', device_id='d' * 32)[0])
        self.assertFalse(lim.begin('1.1.1.1', device_id='d' * 32)[0], 'el dispositivo también tiene su límite')
        self.assertTrue(lim.begin('1.1.1.1', device_id='e' * 32)[0], 'otro dispositivo no se ve afectado')

    def test_idle_forgets(self):
        clock = [0.0]
        lim = hosting.LoginLimiter(clock=lambda: clock[0])
        for _ in range(lim.IP_FREE):
            lim.begin('1.1.1.1')
        self.assertFalse(lim.begin('1.1.1.1')[0])
        clock[0] += lim.IDLE_RESET + 1
        self.assertTrue(lim.begin('1.1.1.1')[0])

    def test_dictionary_is_bounded_lru(self):
        lim = hosting.LoginLimiter()
        lim.MAX_ENTRIES = 10_000
        for i in range(10_050):
            lim.begin(f'ip-{i}')
        self.assertEqual(len(lim), 10_000)
        self.assertNotIn(('i', 'ip-0'), lim._entries)
        self.assertIn(('i', 'ip-10049'), lim._entries)

    def test_device_cookie_value_roundtrip_and_forgery(self):
        secret = 'ab' * 32
        device = hosting.new_device_id()
        value = hosting.device_cookie_value(secret, device)
        self.assertEqual(hosting.parse_device_cookie(secret, value), device)
        for bad in (device + '.' + '0' * 32, device, 'x.y', '', None, value + 'a', hosting.device_cookie_value('cd' * 32, device)):
            self.assertIsNone(hosting.parse_device_cookie(secret, bad))


class ProxyHelpers(unittest.TestCase):
    def test_forwarded_client_ip_skips_trusted_hops_and_ignores_garbage(self):
        nets = hosting.parse_trusted_proxies('')
        self.assertEqual(hosting.forwarded_client_ip('172.18.0.2', '203.0.113.9', nets), '203.0.113.9')
        self.assertEqual(hosting.forwarded_client_ip('172.18.0.2', '6.6.6.6, 203.0.113.9, 10.0.0.3', nets), '203.0.113.9', 'se cree al proxy, no al valor que puso el cliente')
        self.assertEqual(hosting.forwarded_client_ip('172.18.0.2', 'basura', nets), '172.18.0.2')
        self.assertEqual(hosting.forwarded_client_ip('172.18.0.2', '', nets), '172.18.0.2')

    def test_default_and_custom_trusted_networks(self):
        nets = hosting.parse_trusted_proxies(None)
        for ip in ('127.0.0.1', '10.1.1.1', '172.20.0.5', '192.168.1.1', '::1'):
            self.assertTrue(hosting.ip_in_nets(ip, nets), ip)
        for ip in ('203.0.113.9', '8.8.8.8', '100.101.102.103'):
            self.assertFalse(hosting.ip_in_nets(ip, nets), ip)
        self.assertTrue(hosting.ip_in_nets('172.18.0.9', hosting.parse_trusted_proxies('172.18.0.0/16')))
        with self.assertRaises(ValueError):
            hosting.parse_trusted_proxies('172.18.0.0/16,mi-proxy')

    def test_hostnames(self):
        self.assertEqual(hosting.hostname_of('100.101.102.103:8765'), '100.101.102.103')
        self.assertEqual(hosting.hostname_of('localhost:8765'), 'localhost')
        self.assertEqual(hosting.hostname_of('[::1]:8765'), '::1')
        self.assertEqual(hosting.hostname_of('Tutor.Ejemplo.com'), 'tutor.ejemplo.com')
        names = hosting.allowed_hostnames('100.101.102.103', ('http://127.0.0.1:8765', 'https://tutor.ejemplo.com'))
        self.assertTrue({'127.0.0.1', 'localhost', '100.101.102.103', 'tutor.ejemplo.com'} <= names)
        self.assertNotIn('0.0.0.0', hosting.allowed_hostnames('0.0.0.0', ()))


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
        blocked = [p for p in sorted(app.ROUTES) if p != '/api/logout/all' and self.req('POST', p, {}, cookie=cookie)[0] in (401, 403)]
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
        with patch.object(app, 'EXTRA_ORIGINS', ('https://tutor.ejemplo.com',)):
            cookie = self.session_cookie()
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
        self.assertEqual(resp.getheader('Content-Security-Policy'), "default-src 'self' 'unsafe-inline';connect-src 'self';base-uri 'none';frame-ancestors 'none'")


# ------------------------------------------------------------------ H. correcciones de la auditoría
def cookies_of(resp):
    return {c.split('=', 1)[0]: c for c in resp.msg.get_all('Set-Cookie') or []}


class LimiterOverHttp(Server, unittest.TestCase):
    def test_owner_gets_in_after_20_foreign_failures(self):
        for i in range(25):
            app._LOGIN_LIMITER.begin(f'198.51.100.{i}')
            app._LOGIN_LIMITER.fail()
        self.assertGreater(app._LOGIN_LIMITER.global_delay(), 0)
        with patch.object(app.time, 'sleep') as slept:
            status, resp, _ = self.login()
        self.assertEqual(status, 200, 'el volumen global solo ralentiza')
        self.assertTrue(slept.called and slept.call_args[0][0] <= hosting.LoginLimiter.GLOBAL_MAX_DELAY)
        self.assertEqual(app._LOGIN_LIMITER.global_delay(), 0)

    def test_device_cookie_attributes_and_exemption_from_ip_lock(self):
        status, resp, _ = self.login()
        dev = cookies_of(resp)['ruta_device']
        attrs = [a.strip() for a in dev.split(';')]
        for expected in ('HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=31536000'):
            self.assertIn(expected, attrs)
        device_cookie = attrs[0]
        for _ in range(hosting.LoginLimiter.IP_FREE):
            self.assertEqual(self.login('mala-contraseña-larga')[0], 401)
        self.assertEqual(self.login()[0], 429, 'sin cookie de dispositivo la IP sigue bloqueada')
        status, resp, _ = self.login(headers={'Cookie': device_cookie})
        self.assertEqual(status, 200, 'el dispositivo conocido entra aunque la IP esté bloqueada')
        self.assertNotIn(device_cookie.split('=')[0], '', 'la cookie se reutiliza')

    def test_device_has_its_own_counter(self):
        device_cookie = cookies_of(self.login()[1])['ruta_device'].split(';')[0]
        for _ in range(hosting.LoginLimiter.DEVICE_FREE):
            self.assertEqual(self.login('mala-contraseña-larga', headers={'Cookie': device_cookie})[0], 401)
        self.assertEqual(self.login(headers={'Cookie': device_cookie})[0], 429)

    def test_forged_or_stale_device_cookie_is_ignored(self):
        device_cookie = cookies_of(self.login()[1])['ruta_device'].split(';')[0]
        forged = 'ruta_device=' + 'a' * 32 + '.' + 'b' * 32
        for _ in range(hosting.LoginLimiter.IP_FREE):
            self.login('mala-contraseña-larga', headers={'Cookie': forged})
        self.assertEqual(self.login(headers={'Cookie': forged})[0], 429, 'una cookie falsificada no exime')
        app._LOGIN_LIMITER = hosting.LoginLimiter()
        self.memory.set_password_hash(hosting.hash_password('nueva-contraseña-larga', iterations=100_000))   # rota el secreto
        for _ in range(hosting.LoginLimiter.IP_FREE):
            self.login('mala-contraseña-larga')
        self.assertEqual(self.login('nueva-contraseña-larga', headers={'Cookie': device_cookie})[0], 429, 'tras cambiar la contraseña los dispositivos dejan de ser conocidos')

    def test_parallel_attempts_verify_at_most_ip_free_times(self):
        calls, real = [], hosting.verify_password

        def counting(*a, **k):
            calls.append(1)
            return real(*a, **k)
        statuses, barrier = [], threading.Barrier(60)

        def attempt():
            barrier.wait()
            statuses.append(self.login('mala-contraseña-larga')[0])
        with patch.object(hosting, 'verify_password', counting):
            threads = [threading.Thread(target=attempt) for _ in range(60)]
            [t.start() for t in threads]; [t.join() for t in threads]
        self.assertLessEqual(len(calls), hosting.LoginLimiter.IP_FREE, 'las 60 peticiones simultáneas no se cuelan')
        self.assertEqual(statuses.count(401), len(calls))
        self.assertEqual(statuses.count(429), 60 - len(calls))

    def test_busy_server_answers_429_and_releases_the_reservation(self):
        busy = threading.BoundedSemaphore(1)
        busy.acquire()
        with patch.object(app, '_VERIFY_SLOTS', busy), patch.object(busy, 'acquire', lambda timeout=None: False):
            status, resp, _ = self.login()
        self.assertEqual(status, 429)
        self.assertEqual(self.login()[0], 200)
        for _ in range(hosting.LoginLimiter.IP_FREE):
            app._LOGIN_LIMITER.begin('127.0.0.1'); app._LOGIN_LIMITER.release('127.0.0.1')

    def test_pbkdf2_concurrency_is_bounded(self):
        self.assertIsInstance(app._VERIFY_SLOTS, type(threading.BoundedSemaphore(1)))
        self.assertTrue(app._VERIFY_SLOTS.acquire(blocking=False) and app._VERIFY_SLOTS.acquire(blocking=False))
        self.assertFalse(app._VERIFY_SLOTS.acquire(blocking=False), 'solo 2 a la vez')
        app._VERIFY_SLOTS.release(); app._VERIFY_SLOTS.release()


class CalendarLimiterTests(Server, unittest.TestCase):
    def setup_link(self):
        pid = self.make_profile()
        cookie = self.session_cookie()
        return json.loads(self.req('POST', '/api/reminders/save', {'profile_id': pid, 'time': '20:00', 'days': [0, 1, 2, 3, 4, 5, 6]}, cookie=cookie)[2])['link_path']

    def test_valid_token_always_served_even_after_foreign_and_own_failures(self):
        link = self.setup_link()
        for i in range(25):
            app._ICS_LIMITER.begin(f'198.51.100.{i}')
        for i in range(hosting.LoginLimiter.IP_FREE + 1):
            self.req('GET', '/calendar/' + chr(65 + i) * 30 + '.ics')
        self.assertEqual(self.req('GET', '/calendar/' + 'Q' * 30 + '.ics')[0], 429, 'los fallos de esta IP sí se limitan')
        self.assertEqual(self.req('GET', link)[0], 200, 'un token válido se sirve siempre')

    def test_query_string_is_ignored(self):
        link = self.setup_link()
        self.assertEqual(self.req('GET', link + '?x=1&y=2')[0], 200)
        self.assertEqual(hosting.calendar_token_from_path('/calendar/' + 'A' * 30 + '.ics?z=1'), 'A' * 30)
        self.assertIsNone(hosting.calendar_token_from_path('/calendar/' + 'A' * 30 + '.ics/extra'))


class ProxyTrustTests(Server, unittest.TestCase):
    def test_untrusted_peer_cannot_spoof_forwarded_headers(self):
        with patch.object(app, 'TRUST_PROXY', True), patch.object(app, 'TRUSTED_PROXY_NETS', hosting.parse_trusted_proxies('203.0.113.0/24')):
            for i in range(hosting.LoginLimiter.IP_FREE):
                self.assertEqual(self.login('mala-contraseña-larga', headers={'X-Forwarded-For': f'6.6.6.{i}'})[0], 401)
            self.assertEqual(self.login('mala-contraseña-larga', headers={'X-Forwarded-For': '6.6.6.99'})[0], 429, 'el XFF falso no da una IP nueva')
            app._LOGIN_LIMITER = hosting.LoginLimiter()
            _, resp, _ = self.login(headers={'X-Forwarded-Proto': 'https'})
            self.assertNotIn('Secure', resp.msg.get_all('Set-Cookie')[0], 'ni X-Forwarded-Proto de un par no confiable')

    def test_trusted_proxy_peer_is_believed(self):
        with patch.object(app, 'TRUST_PROXY', True):   # 127.0.0.1 es de confianza por defecto
            for i in range(hosting.LoginLimiter.IP_FREE):
                self.login('mala-contraseña-larga', headers={'X-Forwarded-For': '203.0.113.7'})
            self.assertEqual(self.login('mala-contraseña-larga', headers={'X-Forwarded-For': '203.0.113.7'})[0], 429)
            self.assertEqual(self.login(headers={'X-Forwarded-For': '203.0.113.8'})[0], 200, 'otro cliente real, otro contador')

    def test_trust_proxy_off_ignores_everything(self):
        for i in range(hosting.LoginLimiter.IP_FREE):
            self.login('mala-contraseña-larga', headers={'X-Forwarded-For': f'6.6.6.{i}'})
        self.assertEqual(self.login(headers={'X-Forwarded-For': '6.6.6.200'})[0], 429)


class ProxyWarningOffMode(Server, unittest.TestCase):
    mode = 'off'

    def test_warns_once_when_a_proxy_fronts_an_open_server(self):
        err = io.StringIO()
        with patch.object(app, '_PROXY_WARNED', [False]), patch('sys.stderr', err):
            self.req('GET', '/api/health', headers={'X-Forwarded-For': '203.0.113.7'})
            self.req('GET', '/api/health', headers={'X-Forwarded-For': '203.0.113.7'})
        self.assertEqual(err.getvalue().count('hay un proxy delante'), 1)
        err = io.StringIO()
        with patch.object(app, '_PROXY_WARNED', [False]), patch('sys.stderr', err):
            self.req('GET', '/api/health')
        self.assertNotIn('proxy', err.getvalue(), 'sin X-Forwarded-For no avisa')


class SecureCookieTests(Server, unittest.TestCase):
    def test_default_plain_names(self):
        self.assertFalse(app.cookie_secure_configured())
        self.assertIn('ruta_session=', self.login()[1].msg.get_all('Set-Cookie')[0])

    def test_env_flag_gives_host_prefixed_secure_cookie(self):
        with patch.object(app, 'COOKIE_SECURE_ENV', True):
            status, resp, _ = self.login()
            session = resp.msg.get_all('Set-Cookie')[0]
            self.assertTrue(session.startswith('__Host-ruta_session='))
            attrs = [a.strip() for a in session.split(';')]
            for expected in ('Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/'):
                self.assertIn(expected, attrs)
            self.assertNotIn('Domain', session)
            cookie = attrs[0]
            self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=cookie)[0], 200)
            self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=cookie.replace('__Host-', ''))[0], 401, 'con HTTPS declarado el nombre sin prefijo no vale')
            out = self.req('POST', '/api/logout', {}, cookie=cookie)[1].msg.get_all('Set-Cookie')[0]
            self.assertTrue(out.startswith('__Host-ruta_session=;') and 'Max-Age=0' in out and 'Secure' in out)

    def test_https_origin_declares_https_automatically(self):
        with patch.object(app, 'EXTRA_ORIGINS', ('https://tutor.ejemplo.com',)):
            self.assertTrue(app.cookie_secure_configured())
            self.assertTrue(self.login()[1].msg.get_all('Set-Cookie')[0].startswith('__Host-ruta_session='))
        with patch.object(app, 'EXTRA_ORIGINS', ('http://mi-pc.ts.net:8765',)):
            self.assertFalse(app.cookie_secure_configured())


class SessionHardening(Server, unittest.TestCase):
    def test_absolute_expiry_even_with_daily_use(self):
        cookie = self.session_cookie()
        th = hosting.token_hash(cookie.split('=', 1)[1])
        now = int(time.time())
        for day in range(10, 90, 10):
            self.assertTrue(self.memory.check_session(th, hosting.SESSION_TTL_SECONDS, now=now + day * 86400), day)
        self.assertFalse(self.memory.check_session(th, hosting.SESSION_TTL_SECONDS, now=now + 91 * 86400), 'a los 90 días caduca aunque se use a diario')

    def test_logout_all_revokes_every_session(self):
        a, b = self.session_cookie(), self.session_cookie()
        self.assertEqual(self.memory.session_count(), 2)
        status, resp, _ = self.req('POST', '/api/logout/all', {}, cookie=a)
        self.assertEqual(status, 200)
        self.assertIn('Max-Age=0', resp.msg.get_all('Set-Cookie')[0])
        for cookie in (a, b):
            self.assertEqual(self.req('POST', '/api/profiles/list', {}, cookie=cookie)[0], 401)
        self.assertEqual(self.req('POST', '/api/logout/all', {})[0], 401, 'sin sesión no se puede')


class HostHeaderTests(Server, unittest.TestCase):
    mode = 'off'

    def get(self, host, path='/api/health'):
        return self.req('GET', path, headers={'Host': host})[0]

    def test_foreign_host_rejected_everywhere(self):
        for host in ('evil.example.com', 'evil.example.com:8765', '127.0.0.1.evil.com', '100.101.102.103:8765', 'localhost.evil.com'):
            self.assertEqual(self.get(host), 403, host)
            self.assertEqual(self.get(host, '/'), 403)
            self.assertEqual(self.req('POST', '/api/profiles/list', {}, headers={'Host': host})[0], 403)
        status, _, body = self.req('GET', '/', headers={'Host': 'evil.example.com'})
        self.assertEqual(json.loads(body), {'error': 'Host no autorizado.'})

    def test_loopback_names_allowed_with_any_port(self):
        for host in ('127.0.0.1', '127.0.0.1:8765', 'localhost:8765', 'LOCALHOST:8765', '[::1]:8765', f'127.0.0.1:{self.port}'):
            self.assertEqual(self.get(host), 200, host)

    def test_bound_host_and_declared_origin_hosts_allowed(self):
        with patch.object(app, 'HOST', '100.101.102.103'):
            self.assertEqual(self.get('100.101.102.103:8765'), 200)
        with patch.object(app, 'EXTRA_ORIGINS', ('https://tutor.ejemplo.com', 'http://mi-pc.tail1234.ts.net:8765')):
            self.assertEqual(self.get('tutor.ejemplo.com'), 200)
            self.assertEqual(self.get('mi-pc.tail1234.ts.net:8765'), 200)
            self.assertEqual(self.get('otro.ejemplo.com'), 403)

    def test_all_interfaces_does_not_allow_arbitrary_hosts(self):
        with patch.object(app, 'HOST', '0.0.0.0'):
            self.assertEqual(self.get('192.168.1.20:8765'), 403)

    def test_rebinding_blocked_in_required_mode_too(self):
        with patch.object(app, 'AUTH_MODE', 'required'):
            self.assertEqual(self.get('evil.example.com'), 403)
            self.assertEqual(self.req('POST', '/api/login', {'password': PASSWORD}, headers={'Host': 'evil.example.com'})[0], 403)


class OwnerTailscaleScenario(Server, unittest.TestCase):
    """RESTRICCIÓN PRIORITARIA: LEARNSCIENCE_HOST=<IP Tailscale>, sin auth, iPhone en http://100.x.y.z:8765 y localhost."""
    mode = 'off'
    TS = '100.101.102.103'

    def setUp(self):
        super().setUp()
        for p in (patch.object(app, 'HOST', self.TS), patch.object(app, 'PORT', 8765), patch.object(app, 'EXTRA_ORIGINS', ())):
            p.start(); self.addCleanup(p.stop)

    def test_startup_is_allowed_without_any_new_variable(self):
        self.assertEqual(hosting.startup_problem(self.TS, 'off', False), '')
        self.assertEqual(hosting.parse_auth_mode(None), 'off')
        self.assertEqual(app.network_settings({'LEARNSCIENCE_HOST': self.TS}), (self.TS, ()))
        self.assertEqual(hosting.cleartext_warning(self.TS, 'off', False, False), '')

    def test_iphone_over_tailscale_works_end_to_end(self):
        iphone = {'Host': f'{self.TS}:8765'}
        status, resp, body = self.req('GET', '/', headers=iphone)
        self.assertEqual(status, 200)
        self.assertIn(b'const KEY=', body)
        self.assertEqual(self.req('GET', '/api/health', headers=iphone)[0], 200)
        status, _, body = self.req('POST', '/api/profiles/list', {}, origin=f'http://{self.TS}:8765', headers=iphone)
        self.assertEqual(status, 200)
        self.assertEqual(self.req('POST', '/api/profile/create', {'name': 'iPhone'}, origin=f'http://{self.TS}:8765', headers=iphone)[0], 200)
        self.assertEqual(self.req('GET', '/manifest.webmanifest', headers=iphone)[0], 200)
        self.assertEqual(json.loads(self.req('GET', '/api/auth/status', headers=iphone)[2]), {'auth': 'off', 'logged_in': True})
        self.assertIsNone(self.req('GET', '/', headers=iphone)[1].getheader('Set-Cookie'))

    def test_localhost_and_pc_still_work(self):
        for host in ('127.0.0.1:8765', 'localhost:8765'):
            self.assertEqual(self.req('GET', '/', headers={'Host': host})[0], 200, host)
        self.assertEqual(self.req('POST', '/api/profiles/list', {}, origin='http://127.0.0.1:8765', headers={'Host': '127.0.0.1:8765'})[0], 200)
        self.assertEqual(self.req('POST', '/api/profiles/list', {}, origin=None)[0], 200, 'sin Origin como antes')

    def test_calendar_subscription_over_tailscale(self):
        pid = self.make_profile()
        iphone = {'Host': f'{self.TS}:8765'}
        d = json.loads(self.req('POST', '/api/reminders/save', {'profile_id': pid, 'time': '20:00', 'days': [0, 1, 2, 3, 4, 5, 6]}, origin=f'http://{self.TS}:8765', headers=iphone)[2])
        self.assertEqual(self.req('GET', d['link_path'], headers=iphone)[0], 200)

    def test_other_site_and_other_host_still_blocked(self):
        self.assertEqual(self.req('POST', '/api/profiles/list', {}, origin='https://sitio-malicioso.com', headers={'Host': f'{self.TS}:8765'})[0], 403)
        self.assertEqual(self.req('GET', '/', headers={'Host': 'rebind.example.com:8765'})[0], 403)


class ReminderAnchorTests(unittest.TestCase):
    def test_anchor_is_the_clients_local_date_not_the_servers(self):
        night = int(datetime.datetime(2026, 11, 17, 3, 0, tzinfo=datetime.timezone.utc).timestamp() * 1000)   # servidor en UTC: ya es 17; en Monterrey (UTC-6) aún es 16
        base = {'time': '20:00', 'days': [0], 'utc_offset_minutes': -360}
        self.assertEqual(hosting.clean_reminder_settings(base, now_ms=night)['anchor_date'], '2026-11-16')
        self.assertEqual(hosting.clean_reminder_settings(dict(base, timezone='America/Monterrey'), now_ms=night)['anchor_date'], '2026-11-16')
        self.assertEqual(hosting.clean_reminder_settings(dict(base, utc_offset_minutes=0), now_ms=night)['anchor_date'], '2026-11-17')
        settings = hosting.clean_reminder_settings(dict(base, timezone='America/Monterrey'), now_ms=night)
        text = unfold(hosting.build_calendar('p', make_store(), settings, now_ms=night))
        self.assertIn('DTSTART:20261116T200000', text)

    def test_missing_anchor_falls_back_to_client_zone(self):
        night = int(datetime.datetime(2026, 11, 17, 3, 0, tzinfo=datetime.timezone.utc).timestamp() * 1000)
        text = unfold(hosting.build_calendar('p', make_store(), {'hour': 20, 'minute': 0, 'days': list(range(7)), 'utc_offset_minutes': -360}, now_ms=night))
        self.assertIn('DTSTART:20261116T200000', text)


if __name__ == '__main__':
    unittest.main()
