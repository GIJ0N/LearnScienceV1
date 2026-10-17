"""SQLite persistence for Ruta's local profiles and durable learning memory."""

import copy
import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from assessment_service import validate_task, EVALUATION_VERSION
from contextlib import contextmanager
from pathlib import Path


SCHEMA_VERSION = 1
STORE_SCHEMA_VERSION = 5
PROFILE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$")
DEFAULT_PREFERENCES = {
    "engineering_context": False,
    "concrete_examples": False,
    "questions_before_explanation": False,
}


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _copy(value):
    return copy.deepcopy(value)


def _profile_id(value):
    value = str(value or "").strip()
    if not PROFILE_ID.fullmatch(value):
        raise ValueError("profile_id inválido.")
    return value


def validate_store(raw, profile_id):
    """Validate relations and add ownership metadata without inventing evidence."""
    profile_id = _profile_id(profile_id)
    if not isinstance(raw, dict) or not isinstance(raw.get("goals"), list):
        raise ValueError("El respaldo no contiene un store válido.")
    if len(raw["goals"]) > 100:
        raise ValueError("El respaldo contiene demasiadas metas.")
    store = _copy(raw)
    store["schema_version"] = STORE_SCHEMA_VERSION
    store["profile_id"] = profile_id
    goal_ids = set()
    attempt_ids = set()
    evidence_ids = set()
    counts = {"goals": 0, "nodes": 0, "attempts": 0, "repair_episodes": 0}
    for goal in store["goals"]:
        goal_attempt_ids = set()
        if not isinstance(goal, dict):
            raise ValueError("La meta importada es inválida.")
        goal_id = str(goal.get("id") or "").strip()
        if not goal_id or goal_id in goal_ids:
            raise ValueError("Los IDs de meta deben existir y ser únicos.")
        goal_ids.add(goal_id)
        goal["profile_id"] = profile_id
        nodes = goal.get("nodes", [])
        if not isinstance(nodes, list):
            raise ValueError("Los nodos de la meta son inválidos.")
        node_ids = [str(node.get("id") or "") for node in nodes if isinstance(node, dict)]
        if len(node_ids) != len(nodes) or any(not value for value in node_ids) or len(node_ids) != len(set(node_ids)):
            raise ValueError("Los IDs de nodo deben existir y ser únicos dentro de la meta.")
        allowed_nodes = set(node_ids)
        for node in nodes:
            deps = node.get("prerequisites", [])
            if not isinstance(deps, list) or any(dep not in allowed_nodes or dep == node["id"] for dep in deps):
                raise ValueError("La meta contiene una relación de prerrequisito inválida.")
        coverage = goal.get("coverage", [])
        if not isinstance(coverage, list) or any(not isinstance(item, dict) or item.get("id") not in allowed_nodes for item in coverage):
            raise ValueError("La cobertura contiene referencias de nodo inválidas.")
        learner = goal.get("learner", {})
        lessons = goal.get("lessons", {})
        if not isinstance(learner, dict) or any(node_id not in allowed_nodes for node_id in learner):
            raise ValueError("El estado del estudiante contiene referencias de nodo inválidas.")
        if not isinstance(lessons, dict) or any(node_id not in allowed_nodes for node_id in lessons):
            raise ValueError("Las microlecciones contienen referencias de nodo inválidas.")
        reviews = goal.get("reviews", [])
        if not isinstance(reviews, list) or any(not isinstance(item, dict) or item.get("id") not in allowed_nodes for item in reviews):
            raise ValueError("Los repasos contienen referencias de nodo inválidas.")
        session = goal.get("session")
        if not isinstance(session, dict):
            session = {"mode": "DIAGNOSTIC", "node": None, "stack": [], "stage": "teach", "tries": 0}
            goal["session"] = session
        if session.get("node") is not None and session.get("node") not in allowed_nodes:
            raise ValueError("La sesión apunta a un nodo inexistente.")
        session["profile_id"] = profile_id
        events = goal.get("events", [])
        if not isinstance(events, list):
            raise ValueError("El ledger de eventos es inválido.")
        for event in events:
            if not isinstance(event, dict):
                raise ValueError("El ledger contiene un evento inválido.")
            event["profile_id"] = profile_id
            if event.get("node_id") is not None and event.get("node_id") not in allowed_nodes:
                raise ValueError("El ledger contiene una referencia de nodo inválida.")
            attempt_id = event.get("attempt_id")
            if event.get("type") == "EVIDENCE" and attempt_id:
                attempt_id = str(attempt_id)
                if attempt_id in attempt_ids:
                    raise ValueError("El respaldo contiene attempt_id duplicados.")
                attempt_ids.add(attempt_id)
                goal_attempt_ids.add(attempt_id)
                counts["attempts"] += 1
            evidence_id = event.get("evidence_id")
            if evidence_id:
                evidence_id = str(evidence_id)
                if evidence_id in evidence_ids:
                    raise ValueError("El respaldo contiene evidence_id duplicados.")
                evidence_ids.add(evidence_id)
        tasks = goal.get("authentic_tasks", [])
        assessments = goal.get("authentic_attempts", [])
        if not isinstance(tasks, list) or not isinstance(assessments, list):
            raise ValueError("Tareas o evaluaciones auténticas inválidas.")
        task_ids = set()
        for task in tasks:
            validate_task(task)
            if task["task_id"] in task_ids or task["node_id"] not in allowed_nodes:
                raise ValueError("Identidad o habilidad de tarea inválida.")
            task_ids.add(task["task_id"])
        if any(t.get("source_task_id") and t["source_task_id"] not in task_ids for t in tasks):
            raise ValueError("La tarea perdió su referencia de origen.")
        assessment_ids = set()
        for attempt in assessments:
            if not isinstance(attempt, dict) or not attempt.get("attempt_id") or attempt["attempt_id"] in assessment_ids or attempt.get("task_id") not in task_ids:
                raise ValueError("Identidad de evaluación auténtica inválida.")
            evaluation = attempt.get("evaluation", {})
            if evaluation.get("version") != EVALUATION_VERSION or evaluation.get("attempt_id") != attempt["attempt_id"] or evaluation.get("task_id") != attempt["task_id"]:
                raise ValueError("La evaluación no corresponde a su tarea e intento.")
            assessment_ids.add(attempt["attempt_id"])
        episodes = goal.get("repairEpisodes", [])
        if not isinstance(episodes, list):
            raise ValueError("Los episodios de reparación son inválidos.")
        for episode in episodes:
            if not isinstance(episode, dict) or not episode.get("episode_id"):
                raise ValueError("El episodio de reparación no tiene identidad.")
            if episode.get("parent_node_id") is not None and episode.get("parent_node_id") not in allowed_nodes:
                raise ValueError("El episodio de reparación apunta a un nodo inexistente.")
            if episode.get("parent_attempt_id") is not None and str(episode.get("parent_attempt_id")) not in goal_attempt_ids:
                raise ValueError("El episodio de reparación apunta a un intento padre inexistente.")
            episode["profile_id"] = profile_id
        stack = goal.get("contextStack", [])
        if not isinstance(stack, list):
            raise ValueError("La pila de contextos es inválida.")
        episode_ids = {str(item["episode_id"]) for item in episodes}
        if any(not isinstance(item, dict) or (item.get("episode_id") is not None and str(item.get("episode_id")) not in episode_ids) for item in stack):
            raise ValueError("La pila de contextos apunta a un episodio inexistente.")
        counts["goals"] += 1
        counts["nodes"] += len(nodes)
        counts["repair_episodes"] += len(episodes)
    active = store.get("active")
    if active is not None and active not in goal_ids:
        raise ValueError("La meta activa no existe en el respaldo.")
    return store, counts


def _question_for(goal, event):
    if isinstance(event.get("question"), dict) and event["question"].get("prompt"):
        return _copy(event["question"])
    node_id = event.get("node_id")
    phase = event.get("phase")
    if phase == "DIAGNOSTIC":
        node = next((item for item in goal.get("nodes", []) if item.get("id") == node_id), None)
        return _copy(node.get("probe")) if node and isinstance(node.get("probe"), dict) else None
    lesson = goal.get("lessons", {}).get(node_id, {}) if isinstance(goal.get("lessons"), dict) else {}
    key = {"COMPREHENSION": "check", "GUIDED": "guided", "INDEPENDENT": "independent", "INTEGRATE": "integration"}.get(phase)
    question = lesson.get(key) if key and isinstance(lesson, dict) else None
    return _copy(question) if isinstance(question, dict) else None


class DurableMemory:
    def __init__(self, path=None):
        configured = path or os.getenv("RUTA_DB_PATH")
        self.path = Path(configured) if configured else Path(__file__).resolve().parent / "data" / "ruta-memory.sqlite3"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.initialize()

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(str(self.path), timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self):
        with self._lock, self._connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS metadata(
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS profiles(
              profile_id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              preferences_json TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS stores(
              profile_id TEXT PRIMARY KEY REFERENCES profiles(profile_id) ON DELETE CASCADE,
              store_json TEXT NOT NULL,
              revision INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS attempts(
              profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
              goal_id TEXT NOT NULL,
              node_id TEXT,
              attempt_id TEXT NOT NULL,
              activity_id TEXT,
              phase TEXT,
              result TEXT,
              help_used INTEGER NOT NULL,
              response_text TEXT,
              question_json TEXT,
              evaluation_json TEXT NOT NULL,
              event_json TEXT NOT NULL,
              occurred_at INTEGER NOT NULL,
              PRIMARY KEY(profile_id, attempt_id)
            );
            CREATE INDEX IF NOT EXISTS attempts_lookup
              ON attempts(profile_id, goal_id, node_id, occurred_at DESC);
            CREATE TABLE IF NOT EXISTS imports(
              profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
              import_hash TEXT NOT NULL,
              counts_json TEXT NOT NULL,
              imported_at INTEGER NOT NULL,
              PRIMARY KEY(profile_id, import_hash)
            );
            """)
            db.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('schema_version',?)", (str(SCHEMA_VERSION),))

    def create_profile(self, name):
        name = str(name or "").strip()[:80]
        if not name:
            raise ValueError("Escribe un nombre para el perfil local.")
        profile_id = "profile-" + uuid.uuid4().hex
        now = time.time_ns()
        empty = {"schema_version": STORE_SCHEMA_VERSION, "profile_id": profile_id, "goals": [], "active": None}
        with self._lock, self._connect() as db:
            db.execute("INSERT INTO profiles VALUES(?,?,?,?,?)", (profile_id, name, _json(DEFAULT_PREFERENCES), now, now))
            db.execute("INSERT INTO stores VALUES(?,?,?,?)", (profile_id, _json(empty), 1, now))
        return {"profile_id": profile_id, "name": name, "preferences": _copy(DEFAULT_PREFERENCES), "revision": 1}

    def profiles(self):
        with self._connect() as db:
            rows = db.execute("SELECT profile_id,name,preferences_json,created_at,updated_at FROM profiles ORDER BY created_at").fetchall()
        out = []
        for row in rows:
            item = dict(row)
            item["preferences"] = json.loads(item.pop("preferences_json"))
            out.append(item)
        return out

    def load(self, profile_id):
        profile_id = _profile_id(profile_id)
        with self._connect() as db:
            row = db.execute("SELECT p.name,p.preferences_json,s.store_json,s.revision,s.updated_at FROM profiles p JOIN stores s USING(profile_id) WHERE profile_id=?", (profile_id,)).fetchone()
        if not row:
            raise ValueError("El perfil local no existe.")
        return {"profile_id": profile_id, "name": row["name"], "preferences": json.loads(row["preferences_json"]), "store": json.loads(row["store_json"]), "revision": row["revision"], "updated_at": row["updated_at"]}

    def _attempt_rows(self, profile_id, store):
        rows = []
        for goal in store.get("goals", []):
            goal_id = goal["id"]
            for event in goal.get("events", []):
                if event.get("type") != "EVIDENCE" or not event.get("attempt_id"):
                    continue
                question = _question_for(goal, event)
                rows.append((profile_id, goal_id, event.get("node_id"), str(event["attempt_id"]), event.get("activity_id"), event.get("phase"), event.get("result") or event.get("status"), max(0, int(event.get("help_used") or event.get("help") or 0)), event.get("answer"), _json(question) if question is not None else None, _json({key: event.get(key) for key in ("result", "status", "raw_result", "error_type", "evaluator_version", "feedback", "hint") if key in event}), _json(event), int(event.get("at") or event.get("timestamp") or 0)))
        return rows

    def save(self, profile_id, raw_store, expected_revision=None):
        profile_id = _profile_id(profile_id)
        store, counts = validate_store(raw_store, profile_id)
        now = time.time_ns()
        rows = self._attempt_rows(profile_id, store)
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = db.execute("SELECT revision FROM stores WHERE profile_id=?", (profile_id,)).fetchone()
            if not current:
                raise ValueError("El perfil local no existe.")
            if expected_revision is not None and int(expected_revision) != current["revision"]:
                raise ValueError("La memoria cambió en otra sesión; recarga antes de guardar.")
            revision = current["revision"] + 1
            db.execute("UPDATE stores SET store_json=?,revision=?,updated_at=? WHERE profile_id=?", (_json(store), revision, now, profile_id))
            db.execute("UPDATE profiles SET updated_at=? WHERE profile_id=?", (now, profile_id))
            db.execute("DELETE FROM attempts WHERE profile_id=?", (profile_id,))
            db.executemany("INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        return {"saved": True, "revision": revision, "updated_at": now, "counts": counts}

    def set_preferences(self, profile_id, preferences):
        profile_id = _profile_id(profile_id)
        if not isinstance(preferences, dict):
            raise ValueError("Preferencias inválidas.")
        clean = {key: preferences.get(key) is True for key in DEFAULT_PREFERENCES}
        now = time.time_ns()
        with self._lock, self._connect() as db:
            changed = db.execute("UPDATE profiles SET preferences_json=?,updated_at=? WHERE profile_id=?", (_json(clean), now, profile_id)).rowcount
            if not changed:
                raise ValueError("El perfil local no existe.")
        return clean

    def history(self, profile_id, goal_id=None, node_id=None, limit=100):
        profile_id = _profile_id(profile_id)
        clauses = ["profile_id=?"]
        values = [profile_id]
        if goal_id:
            clauses.append("goal_id=?"); values.append(str(goal_id))
        if node_id:
            clauses.append("node_id=?"); values.append(str(node_id))
        values.append(max(1, min(250, int(limit))))
        sql = "SELECT * FROM attempts WHERE " + " AND ".join(clauses) + " ORDER BY occurred_at DESC LIMIT ?"
        with self._connect() as db:
            rows = db.execute(sql, values).fetchall()
        out = []
        for row in rows:
            item = dict(row)
            for key in ("question_json", "evaluation_json", "event_json"):
                item[key[:-5]] = json.loads(item.pop(key)) if item[key] else None
            out.append(item)
        return out

    def relevant_memory(self, profile_id, goal_id, node_id, target_dimension=None, limit=5):
        attempts = self.history(profile_id, goal_id, node_id, limit)
        sources = []
        for item in attempts:
            event = item["event"]
            sources.append({"attempt_id": item["attempt_id"], "phase": item["phase"], "result": item["result"], "help_used": item["help_used"], "observed_dimensions": event.get("observed_dimensions", []), "at": item["occurred_at"]})
        if not sources:
            reason = "No hay intentos anteriores pertinentes para esta habilidad."
        elif sources[0]["help_used"]:
            reason = "Seleccionada porque el último intento tuvo ayuda y conviene una comprobación posterior."
        elif sources[0]["result"] in ("PARTIAL", "MISCONCEPTION"):
            reason = "Seleccionada porque el último intento pertinente todavía mostró una dificultad."
        elif target_dimension:
            reason = f"Seleccionada porque aún está pendiente la dimensión {target_dimension}."
        else:
            reason = "Seleccionada usando los intentos recientes de esta habilidad."
        return {"reason": reason, "sources": sources, "attempts": attempts}

    def import_store(self, profile_id, raw_store):
        profile_id = _profile_id(profile_id)
        canonical, counts = validate_store(raw_store, profile_id)
        digest = hashlib.sha256(_json(raw_store).encode("utf-8")).hexdigest()
        now = time.time_ns()
        rows = self._attempt_rows(profile_id, canonical)
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute("SELECT counts_json FROM imports WHERE profile_id=? AND import_hash=?", (profile_id, digest)).fetchone()
            if prior:
                return {"imported": False, "duplicate": True, "import_hash": digest, "counts": json.loads(prior["counts_json"])}
            current = db.execute("SELECT store_json,revision FROM stores WHERE profile_id=?", (profile_id,)).fetchone()
            if not current:
                raise ValueError("El perfil local no existe.")
            if json.loads(current["store_json"]).get("goals"):
                raise ValueError("La importación inicial requiere un perfil sin metas para no mezclar historiales.")
            revision = current["revision"] + 1
            db.execute("UPDATE stores SET store_json=?,revision=?,updated_at=? WHERE profile_id=?", (_json(canonical), revision, now, profile_id))
            db.execute("UPDATE profiles SET updated_at=? WHERE profile_id=?", (now, profile_id))
            db.execute("DELETE FROM attempts WHERE profile_id=?", (profile_id,))
            db.executemany("INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
            db.execute("INSERT INTO imports VALUES(?,?,?,?)", (profile_id, digest, _json(counts), now))
        return {"imported": True, "duplicate": False, "import_hash": digest, "counts": counts, "revision": revision}

    def export(self, profile_id):
        loaded = self.load(profile_id)
        return {"backup_version": 1, "schema_version": SCHEMA_VERSION, "exported_at": time.time_ns(), "profile": {"profile_id": profile_id, "name": loaded["name"], "preferences": loaded["preferences"]}, "store": loaded["store"], "revision": loaded["revision"]}

    def restore(self, profile_id, backup):
        profile_id = _profile_id(profile_id)
        if not isinstance(backup, dict) or backup.get("backup_version") != 1 or not isinstance(backup.get("store"), dict):
            raise ValueError("El respaldo durable es inválido.")
        store, counts = validate_store(backup["store"], profile_id)
        raw_preferences = backup.get("profile", {}).get("preferences", {})
        preferences = {key: raw_preferences.get(key) is True for key in DEFAULT_PREFERENCES}
        rows = self._attempt_rows(profile_id, store)
        now = time.time_ns()
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = db.execute("SELECT revision FROM stores WHERE profile_id=?", (profile_id,)).fetchone()
            if not current:
                raise ValueError("El perfil local no existe.")
            revision = current["revision"] + 1
            db.execute("UPDATE stores SET store_json=?,revision=?,updated_at=? WHERE profile_id=?", (_json(store), revision, now, profile_id))
            db.execute("UPDATE profiles SET preferences_json=?,updated_at=? WHERE profile_id=?", (_json(preferences), now, profile_id))
            db.execute("DELETE FROM attempts WHERE profile_id=?", (profile_id,))
            db.executemany("INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        return {"saved": True, "restored": True, "revision": revision, "updated_at": now, "counts": counts, "preferences": preferences}
