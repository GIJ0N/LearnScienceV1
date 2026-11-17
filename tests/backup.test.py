"""Copia de seguridad diaria (backup_v1): SQLite temporal, sin red, sin proveedor."""
import datetime
import http.client
import io
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app
import backup
import hosting
from memory_store import DurableMemory, LocalDatabaseServerLock

UTC = datetime.timezone.utc
T0 = datetime.datetime(2026, 11, 16, 12, 0, 0, tzinfo=UTC)
PASSWORD = 'correcto-caballo-1'


def make_db(path, rows=50):
    db = sqlite3.connect(str(path))
    db.execute('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)')
    db.executemany('INSERT INTO t(v) VALUES(?)', [(f'fila {i} ñ',) for i in range(rows)])
    db.commit()
    db.close()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='Copia de seguridad ñ áé ')
        self.root = Path(self.tmp.name)
        self.db = self.root / 'Base de datos ü.sqlite3'
        self.dir = self.root / 'Mis copias' / 'backups'
        backup.reset_for_tests()
        self.env = patch.dict(os.environ, {'LEARNSCIENCE_BACKUP_DIR': str(self.dir)})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def fake_backups(self, n, start=T0 - datetime.timedelta(days=40)):
        self.dir.mkdir(parents=True, exist_ok=True)
        names = []
        for i in range(n):
            name = f'{backup.PREFIX}{(start + datetime.timedelta(days=i)).strftime("%Y%m%dT%H%M%SZ")}.sqlite3'
            (self.dir / name).write_bytes(b'x')
            names.append(name)
        return names


class CopyTests(Base):
    def test_paths_with_spaces_and_accents_and_verified_copy(self):
        make_db(self.db)
        out = backup.make_backup(self.db, now=T0)
        self.assertIsNotNone(out)
        self.assertEqual(out.parent, self.dir.resolve())
        self.assertTrue(backup.integrity_ok(out))
        copy = sqlite3.connect(str(out))
        self.assertEqual(copy.execute('SELECT COUNT(*) FROM t').fetchone()[0], 50)
        copy.close()
        self.assertEqual([p.name for p in self.dir.iterdir() if p.name.startswith('.tmp')], [], 'sin temporales')
        self.assertEqual((self.dir / '.gitignore').read_text(), '*\n')

    @unittest.skipIf(os.name == 'nt', 'en Windows el archivo hereda los permisos de la carpeta')
    def test_copy_permissions_are_owner_only(self):
        make_db(self.db)
        out = backup.make_backup(self.db, now=T0)
        self.assertEqual(out.stat().st_mode & 0o777, 0o600)

    def test_consistent_copy_with_concurrent_writer(self):
        make_db(self.db, rows=30000)
        stop = threading.Event()
        errors = []

        def writer():
            db = sqlite3.connect(str(self.db), timeout=30)
            try:
                while not stop.is_set():
                    # Dos filas por transacción: una copia consistente nunca ve una sola.
                    with db:
                        db.execute('INSERT INTO t(v) VALUES(?)', ('par-a',))
                        db.execute('INSERT INTO t(v) VALUES(?)', ('par-b',))
            except Exception as exc:
                errors.append(exc)
            finally:
                db.close()

        thread = threading.Thread(target=writer)
        thread.start()
        try:
            out = backup.make_backup(self.db, now=T0)
        finally:
            stop.set()
            thread.join(timeout=10)
        self.assertEqual(errors, [])
        self.assertIsNotNone(out)
        copy = sqlite3.connect(str(out))
        a = copy.execute("SELECT COUNT(*) FROM t WHERE v='par-a'").fetchone()[0]
        b = copy.execute("SELECT COUNT(*) FROM t WHERE v='par-b'").fetchone()[0]
        base = copy.execute("SELECT COUNT(*) FROM t WHERE v LIKE 'fila %'").fetchone()[0]
        copy.close()
        self.assertEqual((a, base), (b, 30000), 'instantánea consistente')
        self.assertTrue(backup.integrity_ok(out))

    def test_failed_integrity_discards_copy_and_keeps_previous_latest(self):
        make_db(self.db)
        first = backup.make_backup(self.db, now=T0)
        err = io.StringIO()
        with patch.object(backup, 'integrity_ok', return_value=False), patch('sys.stderr', err):
            out = backup.make_backup(self.db, now=T0 + datetime.timedelta(days=2))
        self.assertIsNone(out)
        self.assertEqual([p.name for p in self.dir.iterdir() if p.name != '.gitignore'], [first.name])
        self.assertEqual(backup.latest_backup(self.dir), first)
        self.assertIn('descartada', err.getvalue())
        self.assertEqual(backup.status(self.db, now=T0)['last_attempt'], 'failed')

    def test_real_integrity_check_detects_corruption(self):
        make_db(self.db, rows=2000)
        bad = self.root / 'mala.sqlite3'
        bad.write_bytes(self.db.read_bytes())
        data = bytearray(bad.read_bytes())
        for i in range(4096 + 100, len(data) - 100, 997):
            data[i] ^= 0xFF
        bad.write_bytes(bytes(data))
        self.assertFalse(backup.integrity_ok(bad))
        self.assertTrue(backup.integrity_ok(self.db))

    def test_does_not_take_the_server_lock(self):
        self.assertNotIn('LocalDatabaseServerLock', Path(backup.__file__).read_text(encoding='utf-8'))
        make_db(self.db)
        with LocalDatabaseServerLock(self.db):      # el servidor «está en marcha» con su bloqueo exclusivo
            lock_path = Path(str(self.db) + '.server.lock')
            before = lock_path.read_bytes()
            out = backup.make_backup(self.db, now=T0)
            self.assertIsNotNone(out)
            self.assertEqual(lock_path.read_bytes(), before)
        self.assertNotIn('.server.lock', ' '.join(p.name for p in self.dir.iterdir()))

    def test_source_is_not_modified(self):
        make_db(self.db)
        backup.make_backup(self.db, now=T0)
        db = sqlite3.connect(str(self.db))
        self.assertEqual(db.execute('SELECT COUNT(*) FROM t').fetchone()[0], 50)
        db.close()

    def test_no_restore_function_exists(self):
        self.assertFalse([n for n in dir(backup) if 'restor' in n.lower()])


class RotationTests(Base):
    def test_keeps_14_and_never_touches_foreign_files(self):
        names = self.fake_backups(20)
        foreign = ['notas.txt', 'ruta-backup-20260101.sqlite3', 'otra-20200101T000000Z.sqlite3', 'ruta-backup-20200101T000000Z.sqlite3.bak', '.gitignore']
        for name in foreign:
            (self.dir / name).write_bytes(b'ajeno')
        sub = self.dir / f'{backup.PREFIX}20190101T000000Z.sqlite3'
        sub.mkdir()
        outside = self.root / f'{backup.PREFIX}20180101T000000Z.sqlite3'
        outside.write_bytes(b'fuera')
        backup.rotate(self.dir)
        left = sorted(p.name for p in self.dir.iterdir() if backup.NAME_RE.match(p.name) and p.is_file())
        self.assertEqual(left, sorted(names[-14:]))
        for name in foreign:
            self.assertTrue((self.dir / name).exists(), name)
        self.assertTrue(sub.is_dir())
        self.assertTrue(outside.exists())

    def test_make_backup_rotates(self):
        make_db(self.db)
        self.fake_backups(20)
        out = backup.make_backup(self.db, now=T0)
        files = backup.list_backups(self.dir)
        self.assertEqual(len(files), 14)
        self.assertEqual(files[-1], out)


class ScheduleTests(Base):
    def test_runs_once_and_only_when_last_is_older_than_24h(self):
        make_db(self.db)
        self.assertIsNotNone(backup.run_startup_backup(self.db, now=T0))
        self.assertIsNone(backup.run_startup_backup(self.db, now=T0 + datetime.timedelta(days=3)), 'una vez por ejecución')
        self.assertEqual(len(backup.list_backups(self.dir)), 1)
        backup.reset_for_tests()
        self.assertIsNone(backup.run_startup_backup(self.db, now=T0 + datetime.timedelta(hours=23)), 'copia reciente: no se repite')
        backup.reset_for_tests()
        self.assertIsNotNone(backup.run_startup_backup(self.db, now=T0 + datetime.timedelta(hours=25)))
        self.assertEqual(len(backup.list_backups(self.dir)), 2)

    def test_failure_never_raises_and_thread_is_daemon(self):
        err = io.StringIO()
        with patch('sys.stderr', err):
            self.assertIsNone(backup.run_startup_backup(self.root / 'no-existe.sqlite3', now=T0))   # base inexistente
            backup.reset_for_tests()
            make_db(self.db)
            with patch.object(backup.sqlite3, 'connect', side_effect=sqlite3.OperationalError('disco lleno')):
                self.assertIsNone(backup.run_startup_backup(self.db, now=T0))
            backup.reset_for_tests()
            with patch.object(backup, 'backup_dir', side_effect=OSError('sin acceso')):
                self.assertIsNone(backup.run_startup_backup(self.db, now=T0))
            backup.reset_for_tests()
            thread = backup.start_in_background(self.root / 'no-existe.sqlite3')
            thread.join(timeout=5)
        self.assertTrue(thread.daemon)
        self.assertFalse(thread.is_alive())
        self.assertEqual(backup.list_backups(self.dir), [])
        self.assertEqual([p for p in self.dir.glob('.tmp*')], [])

    def test_default_dir_is_never_inside_the_repo(self):
        with patch.dict(os.environ, {'LEARNSCIENCE_BACKUP_DIR': ''}):
            os.environ.pop('LEARNSCIENCE_BACKUP_DIR')
            inside = ROOT / 'data' / 'ruta-memory.sqlite3'
            chosen = backup.backup_dir(inside)
            self.assertFalse(backup._inside(chosen, ROOT), chosen)
            outside = self.db
            self.assertEqual(backup.backup_dir(outside), outside.resolve().parent / 'backups')
        self.assertEqual(backup.backup_dir(self.db), self.dir.resolve())


class HttpTests(Base):
    def setUp(self):
        super().setUp()
        self.memory = DurableMemory(self.root / 'n.sqlite')
        self.memory.set_password_hash(hosting.hash_password(PASSWORD, iterations=100_000))
        self.patches = [patch.object(app, 'memory', return_value=self.memory), patch.object(app, '_TEST_MEMORY', True), patch.object(app, 'AUTH_MODE', 'required'),
                        patch.object(app, '_LOGIN_LIMITER', hosting.LoginLimiter()), patch.object(urllib.request, 'urlopen', side_effect=AssertionError('sin red'))]
        for p in self.patches:
            p.start()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        self.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=2)
        for p in self.patches:
            p.stop()
        super().tearDown()

    def call(self, method, path, body=None, cookie=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        h = {}
        if method == 'POST':
            h['Content-Type'] = 'application/json'
            h['Origin'] = f'http://127.0.0.1:{app.PORT}'
        if cookie:
            h['Cookie'] = cookie
        conn.request(method, path, body=json.dumps(body).encode() if body is not None else None, headers=h)
        r = conn.getresponse()
        data = r.read()
        conn.close()
        return r.status, r, data

    def cookie(self):
        status, resp, _ = self.call('POST', '/api/login', {'password': PASSWORD})
        self.assertEqual(status, 200)
        return resp.getheader('Set-Cookie').split(';')[0]

    def test_status_requires_session_and_leaks_nothing(self):
        make_db(self.memory.path)
        backup.make_backup(self.memory.path, now=datetime.datetime.now(UTC))
        self.assertEqual(self.call('GET', '/api/backup/status')[0], 401)
        status, _, raw = self.call('GET', '/api/backup/status', cookie=self.cookie())
        self.assertEqual(status, 200)
        data = json.loads(raw)
        self.assertEqual(set(data), {'has_backup', 'recent', 'last_at', 'size_bytes', 'verified', 'count', 'last_attempt'})
        self.assertTrue(data['has_backup'] and data['recent'] and data['verified'])
        text = raw.decode('utf-8')
        for secret in (self.tmp.name, str(self.dir), 'Mis copias', 'sqlite3', backup.PREFIX, 'Base de datos', self.memory.auth_password_hash() if hasattr(self.memory, 'auth_password_hash') else 'pbkdf2'):
            self.assertNotIn(secret, text)

    def test_status_without_backup(self):
        status, _, raw = self.call('GET', '/api/backup/status', cookie=self.cookie())
        data = json.loads(raw)
        self.assertEqual((status, data['has_backup'], data['recent'], data['verified']), (200, False, False, False))

    def test_backup_failure_does_not_block_requests(self):
        with patch.object(backup.sqlite3, 'connect', side_effect=sqlite3.OperationalError('falla')), patch('sys.stderr', io.StringIO()):
            self.assertIsNone(backup.run_startup_backup(self.memory.path, now=T0))
        cookie = self.cookie()
        self.assertEqual(self.call('GET', '/api/health', cookie=cookie)[0], 200)
        self.assertEqual(self.call('GET', '/api/backup/status', cookie=cookie)[0], 200)
        pid = self.memory.create_profile('P')['profile_id']
        self.assertEqual(self.call('POST', '/api/reminders/get', {'profile_id': pid}, cookie=cookie)[0], 200)

    def test_backups_are_not_served_over_http_nor_in_exports(self):
        out = backup.make_backup(self.memory.path, now=T0)
        cookie = self.cookie()
        for path in ('/backups/' + out.name, '/' + out.name, '/api/backup/' + out.name, '/api/backup/download', '/api/backup/'):
            self.assertIn(self.call('GET', path, cookie=cookie)[0], (404,), path)
        pid = self.memory.create_profile('P')['profile_id']
        exported = json.dumps(self.memory.export(pid), ensure_ascii=False)
        for forbidden in (out.name, str(self.dir), 'backups', 'auth_password_hash', 'pbkdf2', 'auth_sessions', 'calendar_token'):
            self.assertNotIn(forbidden, exported)
        status = json.dumps(self.call('GET', '/api/backup/status', cookie=cookie)[2].decode())
        self.assertNotIn(out.name, status)


if __name__ == '__main__':
    unittest.main()
