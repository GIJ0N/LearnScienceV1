"""Copia de seguridad diaria de la SQLite local (ver docs/backup_v1.md).

Solo lee la base (API de backup de SQLite), no toma el bloqueo del servidor y
no restaura nada: restaurar es siempre un paso manual con el servidor parado.
Ninguna función pública lanza excepciones hacia el servidor.
"""
import datetime
import os
import re
import sqlite3
import sys
import threading
from pathlib import Path

KEEP = 14
MAX_AGE_SECONDS = 24 * 3600
PREFIX = "ruta-backup-"
NAME_RE = re.compile(r"^ruta-backup-(\d{8}T\d{6}Z)\.sqlite3$")
TMP_RE = re.compile(r"^\.tmp-ruta-backup-\d{8}T\d{6}Z\.partial$")
REPO_ROOT = Path(__file__).resolve().parent

_state_lock = threading.Lock()
_ran = False
_last_attempt = {"result": "none", "at": None}


def _inside(child, parent):
    try:
        Path(os.path.realpath(str(child))).relative_to(Path(os.path.realpath(str(parent))))
        return True
    except ValueError:
        return False


def backup_dir(db_path):
    """LEARNSCIENCE_BACKUP_DIR, o junto a la base; si eso cae dentro del repo, una carpeta hermana del repo."""
    configured = os.getenv("LEARNSCIENCE_BACKUP_DIR")
    if configured:
        return Path(os.path.realpath(str(Path(configured).expanduser())))
    default = Path(db_path).resolve().parent / "backups"
    if _inside(default, REPO_ROOT):
        default = REPO_ROOT.parent / "LearnScienceV1-backups"
    return default


def _ensure_dir(directory):
    directory.mkdir(parents=True, exist_ok=True)
    guard = directory / ".gitignore"
    if not guard.exists():
        guard.write_text("*\n", encoding="utf-8")
    if os.name != "nt":
        try:
            os.chmod(directory, 0o700)
        except OSError:
            pass


def _stamp(now):
    return now.astimezone(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _parse(name):
    m = NAME_RE.match(name)
    if not m:
        return None
    return datetime.datetime.strptime(m.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)


def list_backups(directory):
    """Copias propias (por patrón de nombre), de la más antigua a la más reciente."""
    found = []
    try:
        for entry in directory.iterdir():
            when = _parse(entry.name)
            if when and entry.is_file() and not entry.is_symlink():
                found.append((when, entry))
    except OSError:
        return []
    return [entry for _, entry in sorted(found, key=lambda item: item[0])]


def integrity_ok(path):
    try:
        db = sqlite3.connect(str(path), timeout=10)
        try:
            rows = db.execute("PRAGMA integrity_check").fetchall()
        finally:
            db.close()
    except sqlite3.Error:
        return False
    return len(rows) == 1 and rows[0][0] == "ok"


def rotate(directory, keep=KEEP):
    """Borra solo copias con el patrón propio dentro de `directory`; conserva las `keep` más recientes."""
    files = list_backups(directory)
    for old in files[: max(0, len(files) - keep)]:
        try:
            old.unlink()
        except OSError:
            pass
    try:
        for entry in directory.iterdir():
            if TMP_RE.match(entry.name) and entry.is_file():
                entry.unlink()
    except OSError:
        pass


def make_backup(db_path, directory=None, now=None, keep=KEEP):
    """Crea, verifica y rota. Devuelve la ruta de la copia verificada, o None si se descartó. No lanza."""
    global _last_attempt
    now = now or datetime.datetime.now(datetime.timezone.utc)
    tmp = None
    try:
        source = Path(db_path)
        if not source.is_file():
            raise FileNotFoundError("la base no existe")
        directory = Path(directory) if directory else backup_dir(source)
        _ensure_dir(directory)
        final = directory / f"{PREFIX}{_stamp(now)}.sqlite3"
        tmp = directory / f".tmp-{PREFIX}{_stamp(now)}.partial"
        if final.exists():
            raise FileExistsError("ya existe una copia con esa marca de tiempo")
        # Se crea con permisos 0600 desde el inicio (en Windows hereda los de la carpeta).
        fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.close(fd)
        if os.name != "nt":
            os.chmod(tmp, 0o600)
        src = sqlite3.connect(str(source), timeout=30)
        try:
            dst = sqlite3.connect(str(tmp))
            try:
                src.backup(dst)   # un solo paso: instantánea consistente (por pasos, un escritor concurrente reinicia la copia sin fin)
            finally:
                dst.close()
        finally:
            src.close()
        if not integrity_ok(tmp):
            raise RuntimeError("la verificación de integridad no devolvió ok")
        os.replace(tmp, final)
        tmp = None
        rotate(directory, keep)
        _last_attempt = {"result": "ok", "at": now.timestamp()}
        return final
    except Exception as exc:  # una copia fallida nunca debe afectar al servidor
        _last_attempt = {"result": "failed", "at": now.timestamp()}
        print(f"Copia de seguridad descartada: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        if tmp is not None:
            try:
                tmp.unlink()
            except OSError:
                pass
        return None


def latest_backup(directory):
    files = list_backups(directory)
    return files[-1] if files else None


def is_stale(directory, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    last = latest_backup(directory)
    if last is None:
        return True
    return (now - _parse(last.name)).total_seconds() > MAX_AGE_SECONDS


def run_startup_backup(db_path, now=None):
    """Como mucho una vez por ejecución y solo si la última copia tiene más de 24 h."""
    global _ran
    try:
        with _state_lock:
            if _ran:
                return None
            _ran = True
        directory = backup_dir(db_path)
        if not is_stale(directory, now):
            _last_attempt.update({"result": "skipped"})
            return None
        return make_backup(db_path, directory, now)
    except Exception as exc:
        print(f"Copia de seguridad omitida: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        return None


def start_in_background(db_path):
    """Hilo daemon: no retrasa el arranque ni lo impide."""
    thread = threading.Thread(target=run_startup_backup, args=(db_path,), name="ruta-backup", daemon=True)
    thread.start()
    return thread


def reset_for_tests():
    global _ran, _last_attempt
    _ran = False
    _last_attempt = {"result": "none", "at": None}


def status(db_path, now=None):
    """Solo fecha, tamaño y resultado. Sin rutas ni contenido."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    try:
        directory = backup_dir(db_path)
        last = latest_backup(directory)
        if last is None:
            return {"has_backup": False, "recent": False, "last_at": None, "size_bytes": None,
                    "verified": False, "count": 0, "last_attempt": _last_attempt["result"]}
        when = _parse(last.name)
        return {"has_backup": True, "recent": (now - when).total_seconds() <= MAX_AGE_SECONDS,
                "last_at": when.isoformat().replace("+00:00", "Z"), "size_bytes": last.stat().st_size,
                "verified": True,  # una copia solo llega a su nombre final tras pasar integrity_check
                "count": len(list_backups(directory)), "last_attempt": _last_attempt["result"]}
    except Exception:
        return {"has_backup": False, "recent": False, "last_at": None, "size_bytes": None,
                "verified": False, "count": 0, "last_attempt": "error"}
