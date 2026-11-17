"""SQLite persistence for Ruta's local profiles and durable learning memory."""

import copy
import datetime
import hashlib
import json
import os
import hmac
import re
import secrets
import sqlite3
import threading
import time
import uuid
import explore_expr
from contextlib import contextmanager
from pathlib import Path

HINT_LADDER_VERSION = "graded_hints_v1"
HINT_LEVEL_MAX = 5


def normalize_hint_level(value):
    """Return None when no hint was used, otherwise an integer 0..5.

    Unparseable values are treated as the most revealing hint (5): when we cannot
    tell how much was revealed, the conservative reading is that it was a lot.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return HINT_LEVEL_MAX
    try:
        number = float(value)
    except (TypeError, ValueError):
        return HINT_LEVEL_MAX
    if number != number or number in (float("inf"), float("-inf")):
        return HINT_LEVEL_MAX
    rounded = int(number) if number == int(number) else int(number) + (1 if number > 0 else 0)
    return max(0, min(HINT_LEVEL_MAX, rounded))


SCHEMA_VERSION = 2
STORE_SCHEMA_VERSION = 5
PROFILE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$")
DEFAULT_PREFERENCES = {
    "engineering_context": False,
    "concrete_examples": False,
    "questions_before_explanation": False,
}
GOAL_RELATION_TYPES = {"prerequisite", "shared_principle", "application", "analogy", "related_candidate"}
GOAL_RELATION_STATES = {"proposed", "confirmed", "rejected"}


def database_path(path=None):
    configured = path or os.getenv("RUTA_DB_PATH")
    raw = Path(configured) if configured else Path(__file__).resolve().parent / "data" / "ruta-memory.sqlite3"
    return Path(os.path.normcase(os.path.realpath(str(raw.expanduser()))))


class LocalDatabaseServerLock:
    """Single-host, single-server lock for one canonical SQLite path."""

    def __init__(self, sqlite_path):
        self.sqlite_path = database_path(sqlite_path)
        self.path = Path(str(self.sqlite_path) + ".server.lock")
        self._handle = None

    @property
    def acquired(self):
        return self._handle is not None

    def acquire(self):
        if self._handle is not None:
            return self
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(self.path, "a+b")
        try:
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, IOError) as exc:
            handle.close()
            raise RuntimeError(f"Ya existe un servidor usando la SQLite local: {self.sqlite_path}") from exc
        self._handle = handle
        return self

    def release(self):
        handle, self._handle = self._handle, None
        if handle is None:
            return
        try:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *_):
        self.release()


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _copy(value):
    return copy.deepcopy(value)


def _profile_id(value):
    value = str(value or "").strip()
    if not PROFILE_ID.fullmatch(value):
        raise ValueError("profile_id inválido.")
    return value


_MODEL_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")


def _valid_model_name(value):
    return isinstance(value, str) and _MODEL_NAME_RE.fullmatch(value) is not None and ".." not in value


def _finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and abs(value) != float("inf")


def _sanitize_review_schedule(review):
    """adaptive_schedule_v1: `deferrals` es una lista de objetos con números finitos y `schedule_note` un objeto; si no, se descartan."""
    if "deferrals" in review:
        value = review["deferrals"]
        clean = []
        if isinstance(value, list):
            for item in value[:10]:
                if isinstance(item, dict) and all(_finite_number(item.get(key)) for key in ("from_due", "to_due", "days", "at")):
                    entry = dict(item)
                    reason = entry.get("reason")
                    entry["reason"] = reason[:200] if isinstance(reason, str) else ""
                    clean.append(entry)
        review["deferrals"] = clean
    if "schedule_note" in review:
        note = review["schedule_note"]
        if not isinstance(note, dict):
            del review["schedule_note"]
        else:
            reason = note.get("reason")
            note["reason"] = reason[:200] if isinstance(reason, str) else ""
            if "due" in note and not _finite_number(note["due"]):
                del note["due"]


EXPLORE_RAW_MAX_BYTES = 8000      # tope de lectura antes de validar; el tamaño guardado lo fija explore_expr.STORED_MAX_BYTES
_EXPLORE_CACHE = {}               # hash del bloque -> bloque limpio (o None); acotado
_EXPLORE_CACHE_MAX = 256


def _clean_explore(value):
    """Bloque `explore` limpio o None. Resultado en caché por hash: guardar cientos de veces no revalida lo ya validado."""
    try:
        raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError, OverflowError):
        return None
    if len(raw.encode("utf-8")) > EXPLORE_RAW_MAX_BYTES:
        return None
    key = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    if key in _EXPLORE_CACHE:
        hit = _EXPLORE_CACHE[key]
        return copy.deepcopy(hit) if hit is not None else None
    clean = None
    try:
        if isinstance(value, dict):
            clean = explore_expr.validate_explore(value)
            explore_id = value.get("explore_id")
            if isinstance(explore_id, str) and 0 < len(explore_id) <= 80:
                clean["explore_id"] = explore_id
    except (ValueError, TypeError, OverflowError):
        clean = None
    if len(_EXPLORE_CACHE) >= _EXPLORE_CACHE_MAX:
        _EXPLORE_CACHE.pop(next(iter(_EXPLORE_CACHE)))
    _EXPLORE_CACHE[key] = copy.deepcopy(clean) if clean is not None else None
    return clean


def _sanitize_lesson_explore(lesson):
    """rich_content_v1: `explore` debe pasar el mismo contrato local que el generador (expresión segura, rangos finitos, tamaño acotado).
    Si no, se elimina; `explore_na` solo se conserva si es booleano. La lección y el resto del almacén no se rechazan."""
    if not isinstance(lesson, dict):
        return
    if "explore" in lesson:
        clean = _clean_explore(lesson["explore"])
        if clean is None:
            del lesson["explore"]
        else:
            lesson["explore"] = clean
    if "explore_na" in lesson and not isinstance(lesson["explore_na"], bool):
        del lesson["explore_na"]


# authentic_performance_v1: atestaciones declaradas de un mentor (capa propia; nunca evidencia calificada).
MENTOR_POLICY_VERSION = "authentic_performance_v1"
MENTOR_CODE_RE = re.compile(r"[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}")
MENTOR_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
MENTOR_SOURCE_KINDS = ("case", "challenge")
CASE_FORBIDDEN_CLIENT_KEYS = frozenset({"rubric", "private", "private_json", "model_answer", "typical_errors", "irrelevant_labels", "ambiguity", "criteria_private"})


def _text_field(value, lo, hi, message):
    text = value.strip() if isinstance(value, str) else ""
    if not lo <= len(text) <= hi:
        raise ValueError(message)
    return text


def _mentor_values(raw):
    """Campos editables de una atestación; lanza ValueError en español."""
    name = _text_field(raw.get("mentor_name"), 2, 80, "La atestación del mentor necesita su nombre (2 a 80 caracteres).")
    role = _text_field(raw.get("mentor_role"), 2, 80, "La atestación del mentor necesita su rol (2 a 80 caracteres).")
    date_text = raw.get("date")
    if not isinstance(date_text, str) or not MENTOR_DATE_RE.fullmatch(date_text):
        raise ValueError("La fecha de la atestación debe tener el formato AAAA-MM-DD.")
    try:
        datetime.date.fromisoformat(date_text)
    except ValueError:
        raise ValueError("La fecha de la atestación no es válida.")
    levels = raw.get("levels")
    if not isinstance(levels, dict) or not 1 <= len(levels) <= 8:
        raise ValueError("La atestación necesita un nivel por criterio.")
    clean = {}
    for key, value in levels.items():
        if not isinstance(key, str) or not re.fullmatch(r"[a-z0-9_]{1,40}", key) or isinstance(value, bool) or value not in (0, 1, 2, 3):
            raise ValueError("Los niveles de la atestación deben ser 0, 1, 2 o 3 por criterio.")
        clean[key] = int(value)
    comment = raw.get("comment", "")
    if comment is None:
        comment = ""
    if not isinstance(comment, str) or len(comment.strip()) > 400:
        raise ValueError("El comentario del mentor admite hasta 400 caracteres.")
    return {"mentor_name": name, "mentor_role": role, "date": date_text, "levels": clean, "comment": comment.strip()}


MENTOR_MAC_FIELDS = ("attestation_id", "goal_id", "source", "node_ids", "mentor_name", "mentor_role", "date", "levels", "comment", "code", "content_digest", "at")
MENTOR_FUTURE_SLACK_MS = 86_400_000


def mentor_event_mac(key_hex, event):
    """HMAC (secreto local del servidor) del evento canónico de la atestación. Autentica el REGISTRO hecho en esta instalación, no al mentor."""
    payload = json.dumps({key: event.get(key) for key in MENTOR_MAC_FIELDS}, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hmac.new(bytes.fromhex(key_hex), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def canonical_mentor_event(raw, allowed_nodes, known_attestations, goal_id=None, mac_key=None, now_ms=None, voided=None, revision_ids=None):
    """Forma canónica de MENTOR_ATTESTATION / MENTOR_ATTESTATION_REVISION. known_attestations: dict id -> set(niveles esperados) de las atestaciones anteriores.
    code_verified solo es True si attestation_mac coincide con el HMAC local (mac_key); sin MAC o con otro secreto queda False."""
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    voided = set() if voided is None else voided
    revision_ids = set() if revision_ids is None else revision_ids
    if raw.get("type") == "MENTOR_ATTESTATION":
        attestation_id = _text_field(raw.get("attestation_id"), 1, 120, "La atestación no tiene identidad.")
        if attestation_id in known_attestations:
            raise ValueError("El respaldo contiene atestaciones de mentor duplicadas.")
        source = raw.get("source")
        if not isinstance(source, dict) or source.get("kind") not in MENTOR_SOURCE_KINDS:
            raise ValueError("La atestación no conserva su fuente.")
        source_id = _text_field(source.get("id"), 1, 120, "La atestación no conserva su fuente.")
        attempt = source.get("attempt_id")
        if attempt is not None and not (isinstance(attempt, str) and 1 <= len(attempt) <= 120):
            raise ValueError("La atestación no conserva su fuente.")
        node_ids = raw.get("node_ids")
        if not isinstance(node_ids, list) or not 1 <= len(node_ids) <= 8 or len(set(map(str, node_ids))) != len(node_ids) or any(str(n) not in allowed_nodes for n in node_ids):
            raise ValueError("La atestación apunta a temas inexistentes.")
        code = raw.get("code")
        if not isinstance(code, str) or not MENTOR_CODE_RE.fullmatch(code):
            raise ValueError("La atestación no conserva un código de verificación válido.")
        at = raw.get("at")
        if not _finite_number(at) or at < 0:
            raise ValueError("La atestación no conserva una fecha de registro válida.")
        if at > now_ms + MENTOR_FUTURE_SLACK_MS:
            raise ValueError("La fecha de registro de la atestación no puede ser futura.")
        if raw.get("goal_id") is not None and goal_id is not None and str(raw["goal_id"]) != str(goal_id):
            raise ValueError("La atestación pertenece a otra meta.")
        if _mentor_values(raw)["date"] > (datetime.date.fromtimestamp(now_ms / 1000) + datetime.timedelta(days=1)).isoformat():
            raise ValueError("La fecha de la validación no puede ser futura.")
        digest = raw.get("content_digest")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("La atestación no conserva la huella del contenido.")
        event = {"type": "MENTOR_ATTESTATION", "attestation_id": attestation_id, "source": {"kind": source["kind"], "id": source_id, **({"attempt_id": attempt} if attempt else {})},
                 "node_ids": [str(n) for n in node_ids], **_mentor_values(raw), "code": code, "content_digest": digest, "declared_by": "learner", "code_verified": False,
                 "at": at, "policy_version": MENTOR_POLICY_VERSION}
        if goal_id is not None:
            event["goal_id"] = str(goal_id)[:120]
        elif raw.get("goal_id") is not None:
            event["goal_id"] = str(raw["goal_id"])[:120]
        mac = raw.get("attestation_mac")
        if isinstance(mac, str) and re.fullmatch(r"[0-9a-f]{64}", mac):
            event["attestation_mac"] = mac
            if mac_key and hmac.compare_digest(mac, mentor_event_mac(mac_key, event)):
                event["code_verified"] = True
        return event
    attestation_id = _text_field(raw.get("attestation_id"), 1, 120, "La revisión no apunta a una atestación.")
    if attestation_id not in known_attestations:
        raise ValueError("La revisión apunta a una atestación inexistente.")
    revision_id = _text_field(raw.get("revision_id"), 1, 120, "La revisión no tiene identidad.")
    if revision_id in revision_ids:
        raise ValueError("El respaldo contiene revisiones de mentor duplicadas.")
    action = raw.get("action")
    at = raw.get("at")
    if action not in ("edit", "void") or not _finite_number(at) or at < 0:
        raise ValueError("La revisión de la atestación es inválida.")
    if at > now_ms + MENTOR_FUTURE_SLACK_MS:
        raise ValueError("La fecha de la revisión no puede ser futura.")
    if attestation_id in voided:
        raise ValueError("Una atestación anulada no admite más revisiones.")
    event = {"type": "MENTOR_ATTESTATION_REVISION", "revision_id": revision_id, "attestation_id": attestation_id, "action": action, "at": at, "policy_version": MENTOR_POLICY_VERSION}
    if action == "void":
        event["reason"] = _text_field(raw.get("reason"), 3, 300, "Anular una atestación exige un motivo (3 a 300 caracteres).")
    else:
        values = _mentor_values(raw)
        if set(values["levels"]) != known_attestations[attestation_id]:
            raise ValueError("Los niveles editados deben cubrir los mismos criterios de la atestación.")
        event.update(values)
        reason = raw.get("reason")
        if reason:
            event["reason"] = _text_field(reason, 3, 300, "El motivo de la edición admite de 3 a 300 caracteres.")
    return event


def _find_forbidden_keys(value, depth=0):
    """True si el valor contiene una clave de las reservadas a lo privado del caso (defensa del almacén del cliente)."""
    if depth > 8:
        return False
    if isinstance(value, dict):
        return any(k in CASE_FORBIDDEN_CLIENT_KEYS or _find_forbidden_keys(v, depth + 1) for k, v in value.items())
    if isinstance(value, list):
        return any(_find_forbidden_keys(v, depth + 1) for v in value[:200])
    return False


def _check_case_evidence(event, goal_id, info):
    """authentic_performance_v1: la evidencia de una etapa debe coincidir con lo que el servidor calificó.
    - Caso conocido de esta instalación: fase CASE, misma meta, etapa, tema, intento y resultado; si algo no coincide se RECHAZA el almacén
      (un cliente honesto nunca lo produce); no se «corrige» en silencio porque eso ocultaría la manipulación.
    - Caso desconocido aquí (restauración o importación desde otra instalación): no se puede verificar. Se conserva el registro (un fallo no se oculta)
      pero un CORRECT deja de ser independiente y se marca case_unverified; no se inventa ni se borra nada."""
    result = event.get("result") or event.get("status")
    if info is None:
        if result == "CORRECT" or event.get("is_independent") or event.get("independent") or event.get("is_novel_variant"):
            for key in ("is_independent", "independent", "is_novel_variant", "varied"):
                if key in event:
                    event[key] = False
            event["is_independent"] = False
        event["case_unverified"] = True
        return
    stage = event.get("case_stage")
    stages = info["stages"]
    saved = stages.get(stage) if isinstance(stage, int) and not isinstance(stage, bool) else None
    node_status = (saved or {}).get("nodes", {}).get(event.get("node_id"))
    problem = None
    if info["goal_id"] != goal_id:
        problem = "pertenece a otra meta"
    elif event.get("phase") != "CASE":
        problem = "no tiene la fase CASE"
    elif saved is None or node_status is None:
        problem = "no corresponde a una etapa calificada por el servidor"
    elif event.get("attempt_id") != f"{saved['attempt_id']}#{event.get('node_id')}":
        problem = "no corresponde al intento calificado"
    elif result != node_status or event.get("status", result) != node_status:
        problem = "no coincide con el veredicto del servidor"
    elif not saved["eligible"] or saved["help_used"] != 0 or saved["dont_know"]:
        problem = "corresponde a una etapa que no cuenta como evidencia"
    if problem:
        raise ValueError(f"La evidencia del caso {problem}; el servidor no la registró así.")
    event["case_unverified"] = False


def validate_store(raw, profile_id, allow_profile_rebind=False, ctx=None):
    """Validate relations and add ownership metadata without inventing evidence."""
    profile_id = _profile_id(profile_id)
    ctx = ctx or {}
    mac_key = ctx.get("mac_key")
    server_cases = ctx.get("cases") or {}
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
        for lesson in lessons.values():
            _sanitize_lesson_explore(lesson)  # rich_content_v1: el bloque `explore` malformado se descarta sin rechazar el almacén
        reviews = goal.get("reviews", [])
        if not isinstance(reviews, list) or any(not isinstance(item, dict) or item.get("id") not in allowed_nodes for item in reviews):
            raise ValueError("Los repasos contienen referencias de nodo inválidas.")
        for review in reviews:
            _sanitize_review_schedule(review)  # adaptive_schedule_v1: metadatos de calendario; lo malformado se descarta sin rechazar la meta
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
            if "judge_model" in event and not _valid_model_name(event["judge_model"]):
                del event["judge_model"]  # judge_model_v1: metadato; un valor inválido se descarta sin rechazar el evento
            if event.get("node_id") is not None and event.get("node_id") not in allowed_nodes:
                raise ValueError("El ledger contiene una referencia de nodo inválida.")
            if event.get("type") == "EVIDENCE" and "hint_level_max" in event:
                level = normalize_hint_level(event.get("hint_level_max"))
                event["hint_level_max"] = level
                if level is not None:
                    # Any recorded hint blocks independence, whatever the stored flags say.
                    event["help_used"] = max(1, int(event.get("help_used") or event.get("help") or 0))
                    event["is_independent"] = False
                    if "independent" in event:
                        event["independent"] = False
            if event.get("type") == "EVIDENCE" and "case_id" in event:
                if isinstance(event["case_id"], str) and 1 <= len(event["case_id"]) <= 120:
                    pass
                else:
                    del event["case_id"]  # authentic_performance_v1: metadato del caso; un valor inválido se descarta sin rechazar el evento
            if event.get("type") == "EVIDENCE" and "case_id" in event:
                _check_case_evidence(event, goal_id, server_cases.get(event["case_id"]))
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
        mentor_ids = {}
        mentor_voided = set()
        mentor_revisions = set()
        for index, event in enumerate(events):
            if event.get("type") in ("MENTOR_ATTESTATION", "MENTOR_ATTESTATION_REVISION"):
                canonical = canonical_mentor_event(event, allowed_nodes, mentor_ids, goal_id=goal_id, mac_key=mac_key, voided=mentor_voided, revision_ids=mentor_revisions)
                if canonical["type"] == "MENTOR_ATTESTATION":
                    mentor_ids[canonical["attestation_id"]] = set(canonical["levels"])
                else:
                    mentor_revisions.add(canonical["revision_id"])
                    if canonical["action"] == "void":
                        mentor_voided.add(canonical["attestation_id"])
                canonical["profile_id"] = profile_id
                events[index] = canonical
        for key in ("cases", "case_draft"):
            if key in goal and _find_forbidden_keys(goal[key]):
                raise ValueError("El estado del caso del cliente no puede contener la rúbrica ni la respuesta modelo.")
        criterion_assessments = goal.get("criterion_assessments", [])
        if not isinstance(criterion_assessments, list):
            raise ValueError("Las evaluaciones por criterio son inválidas.")
        criterion_attempts = set()
        for assessment in criterion_assessments:
            if not isinstance(assessment, dict) or assessment.get("schema_version") != "criterion_assessment_v1" or not assessment.get("attempt_id") or not assessment.get("activity_id"):
                raise ValueError("La evaluación por criterio no tiene un contrato válido.")
            attempt_id = str(assessment["attempt_id"])
            if attempt_id in criterion_attempts or attempt_id not in goal_attempt_ids:
                raise ValueError("La evaluación por criterio no corresponde a un intento único del ledger.")
            criterion_attempts.add(attempt_id)
        draft = goal.get("criterion_draft")
        if draft is not None:
            if not isinstance(draft, dict) or draft.get("schema_version") != "criterion_assessment_v1" or not str(draft.get("goal_id") or "") or not str(draft.get("profile_id") or ""):
                raise ValueError("El borrador de criterios no conserva su identidad.")
            if draft.get("status") not in {"DRAFT", "EVALUATING", "EVALUATION_PENDING", "EVALUATED", "UNAVAILABLE"}:
                raise ValueError("El borrador de criterios tiene un estado inválido.")
            activity = draft.get("activity")
            if not isinstance(activity, dict) or "correct_option_id" in activity or not activity.get("activity_id") or not isinstance(activity.get("options"), list):
                raise ValueError("El borrador no conserva un contrato público válido.")
            option_ids = [str(item.get("id") or "") for item in activity["options"] if isinstance(item, dict)]
            if len(option_ids) != len(activity["options"]) or len(option_ids) != len(set(option_ids)) or any(not item for item in option_ids):
                raise ValueError("El borrador contiene opciones inválidas.")
            draft["profile_id"] = profile_id
            draft["goal_id"] = goal_id
        pending = goal.get("pending_repair_diagnosis")
        if pending is not None:
            if not isinstance(pending, dict) or pending.get("version") != "repair_diagnosis_recovery_v1":
                raise ValueError("El diagnóstico pendiente tiene una versión incompatible.")
            if pending.get("status") not in {"PENDING", "REQUESTING", "ERROR", "POSTPONED"}:
                raise ValueError("El diagnóstico pendiente tiene un estado inválido.")
            if not pending.get("request_id") or not isinstance(pending.get("request"), dict):
                raise ValueError("El diagnóstico pendiente no conserva su solicitud.")
            if pending.get("parent_node_id") not in allowed_nodes:
                raise ValueError("El diagnóstico pendiente apunta a un nodo inexistente.")
            if str(pending.get("parent_attempt_id") or "") not in goal_attempt_ids:
                raise ValueError("El diagnóstico pendiente apunta a un intento padre inexistente.")
            parent = next((event for event in events if str(event.get("attempt_id") or "") == str(pending.get("parent_attempt_id") or "")), None)
            if not parent or str(parent.get("activity_id") or "") != str(pending.get("parent_activity_id") or ""):
                raise ValueError("El diagnóstico pendiente no corresponde a la actividad padre.")
            pending["profile_id"] = profile_id
            pending["goal_id"] = goal["id"]
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
            plan_version = episode.get("plan_version") or "microtutoring_repair_episode_v1"
            if plan_version == "repair_teaching_v2":
                gaps = episode.get("suspected_gaps", [])
                gap_ids = {str(item.get("gap_id")) for item in gaps if isinstance(item, dict) and item.get("gap_id")}
                selected = episode.get("selected_gap")
                if selected is not None and (not isinstance(selected, dict) or str(selected.get("gap_id") or "") not in gap_ids):
                    raise ValueError("La enseñanza apunta a una laguna inexistente.")
                package = episode.get("teaching_package")
                if package is not None:
                    if not isinstance(package, dict) or package.get("plan_version") != "repair_teaching_v2":
                        raise ValueError("El paquete de enseñanza tiene una versión incompatible.")
                    selected_id = str(selected.get("gap_id") or "") if isinstance(selected, dict) else ""
                    if not selected_id or str(package.get("gap_id") or "") != selected_id or str(episode.get("plan_gap_id") or "") != selected_id:
                        raise ValueError("El paquete de enseñanza no corresponde a la laguna seleccionada.")
                    activities = package.get("repair_activities")
                    if not isinstance(activities, dict) or any(not isinstance(activities.get(stage), dict) for stage in ("CHECK", "GUIDED", "INDEPENDENT")):
                        raise ValueError("El paquete de enseñanza no contiene todas las actividades.")
                    retries = package.get("independent_retries")
                    if not isinstance(retries, list) or len(retries) != 1 or not isinstance(retries[0], dict):
                        raise ValueError("El paquete no conserva la actividad independiente alternativa.")
                checkpoint = episode.get("attempt_checkpoint")
                if checkpoint is not None:
                    if not isinstance(checkpoint, dict) or not checkpoint.get("attempt_id") or checkpoint.get("status") not in {"EVALUATING", "EVALUATED", "APPLYING", "APPLIED"}:
                        raise ValueError("El checkpoint del intento de reparación es inválido.")
                    if checkpoint.get("status") in {"EVALUATED", "APPLYING", "APPLIED"} and not isinstance(checkpoint.get("evaluation"), dict):
                        raise ValueError("El checkpoint evaluado no conserva su evaluación.")
            episode["profile_id"] = profile_id
        stack = goal.get("contextStack", [])
        if not isinstance(stack, list):
            raise ValueError("La pila de contextos es inválida.")
        episode_ids = {str(item["episode_id"]) for item in episodes}
        if any(event.get("type") == "CONTENT_EXPOSURE" and str(event.get("episode_id") or "") not in episode_ids for event in events):
            raise ValueError("Una exposición apunta a un episodio inexistente.")
        if any(not isinstance(item, dict) or (item.get("episode_id") is not None and str(item.get("episode_id")) not in episode_ids) for item in stack):
            raise ValueError("La pila de contextos apunta a un episodio inexistente.")
        counts["goals"] += 1
        counts["nodes"] += len(nodes)
        counts["repair_episodes"] += len(episodes)
    active = store.get("active")
    if active is not None and active not in goal_ids:
        raise ValueError("La meta activa no existe en el respaldo.")
    relations = store.get("goal_relations", [])
    if not isinstance(relations, list) or len(relations) > 1000:
        raise ValueError("Las relaciones entre metas son inválidas.")
    relation_ids = set()
    goals_by_id = {str(goal["id"]): goal for goal in store["goals"]}
    normalized_relations = []
    for relation in relations:
        if not isinstance(relation, dict) or relation.get("schema_version") != "goal_relation_v1":
            raise ValueError("La relación entre metas no tiene una versión compatible.")
        relation_id = str(relation.get("relation_id") or "").strip()
        if not relation_id or relation_id in relation_ids:
            raise ValueError("Los IDs de relación deben existir y ser únicos.")
        relation_ids.add(relation_id)
        relation_profile = str(relation.get("profile_id") or "").strip()
        if relation_profile and relation_profile != profile_id and not allow_profile_rebind:
            raise ValueError("La relación entre metas pertenece a otro perfil.")
        source = relation.get("source")
        target = relation.get("target")
        if not isinstance(source, dict) or not isinstance(target, dict):
            raise ValueError("La relación no conserva sus extremos.")
        source_goal = str(source.get("goal_id") or "").strip()
        target_goal = str(target.get("goal_id") or "").strip()
        source_node = str(source.get("node_id") or "").strip()
        target_node = str(target.get("node_id") or "").strip()
        if not all((source_goal, target_goal, source_node, target_node)) or source_goal == target_goal:
            raise ValueError("La relación debe unir habilidades concretas de metas distintas.")
        relation_type = str(relation.get("type") or "").strip()
        state = str(relation.get("status") or "").strip()
        explanation = str(relation.get("explanation") or "").strip()
        provenance = relation.get("provenance")
        created_at = relation.get("created_at")
        if relation_type not in GOAL_RELATION_TYPES or state not in GOAL_RELATION_STATES or not explanation or len(explanation) > 800:
            raise ValueError("La relación no conserva tipo, estado y explicación válidos.")
        if not isinstance(provenance, dict) or not str(provenance.get("source") or "").strip():
            raise ValueError("La relación no conserva su procedencia.")
        if not isinstance(created_at, (int, float)) or created_at < 0:
            raise ValueError("La relación no conserva una fecha válida.")
        source_exists = source_goal in goals_by_id and source_node in {str(node["id"]) for node in goals_by_id[source_goal].get("nodes", [])}
        target_exists = target_goal in goals_by_id and target_node in {str(node["id"]) for node in goals_by_id[target_goal].get("nodes", [])}
        normalized_relations.append({
            **_copy(relation), "schema_version": "goal_relation_v1", "relation_id": relation_id,
            "profile_id": profile_id, "source": {"goal_id": source_goal, "node_id": source_node},
            "target": {"goal_id": target_goal, "node_id": target_node}, "type": relation_type,
            "explanation": explanation, "provenance": _copy(provenance), "created_at": created_at,
            "status": state, "endpoint_status": "available" if source_exists and target_exists else "missing",
        })
    graph = {}
    for relation in normalized_relations:
        if relation["type"] != "prerequisite" or relation["status"] == "rejected" or relation["endpoint_status"] == "missing":
            continue
        graph.setdefault(relation["source"]["goal_id"], set()).add(relation["target"]["goal_id"])
    visiting, visited = set(), set()
    def visit(goal_id):
        if goal_id in visiting:
            return True
        if goal_id in visited:
            return False
        visiting.add(goal_id)
        if any(visit(target) for target in graph.get(goal_id, ())):
            return True
        visiting.remove(goal_id)
        visited.add(goal_id)
        return False
    if any(visit(goal_id) for goal_id in tuple(graph)):
        raise ValueError("Las relaciones de prerrequisito entre metas contienen un ciclo.")
    store["goal_relations"] = normalized_relations
    return store, counts


def _question_for(goal, event):
    if isinstance(event.get("question"), dict) and event["question"].get("prompt"):
        return _copy(event["question"])
    if event.get("criterion_assessment"):
        return None  # una actividad de criterios no usa las preguntas de la lección actual
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
        self.path = database_path(path)
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
            CREATE TABLE IF NOT EXISTS auth_sessions(
              token_hash TEXT PRIMARY KEY,
              created_at INTEGER NOT NULL,
              last_seen INTEGER NOT NULL,
              expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reminders(
              profile_id TEXT PRIMARY KEY REFERENCES profiles(profile_id) ON DELETE CASCADE,
              token_hash TEXT UNIQUE,
              settings_json TEXT NOT NULL,
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
            CREATE TABLE IF NOT EXISTS criterion_activities(
              profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
              goal_id TEXT NOT NULL,
              activity_id TEXT NOT NULL,
              public_contract_json TEXT NOT NULL,
              private_contract_json TEXT NOT NULL,
              schema_version TEXT NOT NULL,
              status TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              PRIMARY KEY(profile_id, activity_id)
            );
            CREATE INDEX IF NOT EXISTS criterion_activities_goal
              ON criterion_activities(profile_id, goal_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS criterion_evaluations(
              profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
              goal_id TEXT NOT NULL,
              activity_id TEXT NOT NULL,
              attempt_id TEXT NOT NULL,
              fingerprint TEXT NOT NULL,
              status TEXT NOT NULL,
              assessment_json TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              PRIMARY KEY(profile_id, attempt_id)
            );
            CREATE INDEX IF NOT EXISTS criterion_evaluations_activity
              ON criterion_evaluations(profile_id, activity_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS placement_items(
              profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
              goal_id TEXT NOT NULL,
              item_id TEXT NOT NULL,
              node_id TEXT NOT NULL,
              public_json TEXT NOT NULL,
              private_json TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              PRIMARY KEY(profile_id, item_id)
            );
            CREATE TABLE IF NOT EXISTS sources(
              profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
              goal_id TEXT NOT NULL,
              source_id TEXT NOT NULL,
              title TEXT NOT NULL,
              source_date TEXT NOT NULL,
              sha256 TEXT NOT NULL,
              chars INTEGER NOT NULL,
              created_at INTEGER NOT NULL,
              PRIMARY KEY(profile_id, source_id)
            );
            CREATE TABLE IF NOT EXISTS source_chunks(
              profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
              source_id TEXT NOT NULL,
              chunk_index INTEGER NOT NULL,
              text TEXT NOT NULL,
              norm TEXT NOT NULL,
              PRIMARY KEY(profile_id, source_id, chunk_index)
            );
            CREATE TABLE IF NOT EXISTS content_reports(
              report_id INTEGER PRIMARY KEY AUTOINCREMENT,
              profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
              goal_id TEXT NOT NULL,
              node_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              excerpt TEXT NOT NULL,
              note TEXT NOT NULL,
              created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS excluded_items(
              profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
              item_id TEXT NOT NULL,
              reason TEXT NOT NULL DEFAULT '',
              created_at INTEGER NOT NULL,
              PRIMARY KEY(profile_id, item_id)
            );
            CREATE TABLE IF NOT EXISTS placement_answers(
              profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
              attempt_id TEXT NOT NULL,
              goal_id TEXT NOT NULL,
              item_id TEXT NOT NULL,
              fingerprint TEXT NOT NULL,
              result_json TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              PRIMARY KEY(profile_id, attempt_id)
            );
            CREATE TABLE IF NOT EXISTS cases(
              profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
              goal_id TEXT NOT NULL,
              case_id TEXT NOT NULL,
              status TEXT NOT NULL,
              state_json TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              PRIMARY KEY(profile_id, case_id)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS cases_one_active ON cases(profile_id, goal_id) WHERE status='ACTIVE';
            CREATE TABLE IF NOT EXISTS knowledge_props(
              profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
              goal_id TEXT NOT NULL,
              prop_id TEXT NOT NULL,
              statement TEXT NOT NULL,
              norm TEXT NOT NULL,
              sources_json TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              PRIMARY KEY(profile_id, prop_id),
              UNIQUE(profile_id, goal_id, norm)
            );
            CREATE TABLE IF NOT EXISTS knowledge_chains(
              profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
              goal_id TEXT NOT NULL,
              chain_id TEXT NOT NULL,
              node_id TEXT NOT NULL,
              premises_json TEXT NOT NULL,
              conclusion_id TEXT NOT NULL,
              chain_key TEXT NOT NULL,
              sources_json TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              PRIMARY KEY(profile_id, chain_id),
              UNIQUE(profile_id, goal_id, chain_key)
            );
            CREATE TABLE IF NOT EXISTS llm_calls(
              call_id INTEGER PRIMARY KEY AUTOINCREMENT,
              day TEXT NOT NULL,
              provider TEXT NOT NULL,
              model TEXT NOT NULL,
              route TEXT NOT NULL,
              input_tokens INTEGER,
              output_tokens INTEGER,
              thinking_tokens INTEGER,
              latency_ms INTEGER NOT NULL,
              ok INTEGER NOT NULL,
              created_at INTEGER NOT NULL
            );
            """)
            columns = {row[1] for row in db.execute("PRAGMA table_info(criterion_evaluations)").fetchall()}
            if "owner_token" not in columns:
                db.execute("ALTER TABLE criterion_evaluations ADD COLUMN owner_token TEXT")
            db.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('schema_version',?)", (str(SCHEMA_VERSION),))

    def record_llm_call(self, day, provider, model, route, input_tokens, output_tokens, thinking_tokens, latency_ms, ok):
        """usage_telemetry_v1: counts and timings only; never prompts, answers, keys or profile ids."""
        def count(value):
            return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0 else None
        with self._lock, self._connect() as db:
            db.execute(
                "INSERT INTO llm_calls(day,provider,model,route,input_tokens,output_tokens,thinking_tokens,latency_ms,ok,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (str(day), str(provider)[:40], str(model)[:80], str(route or "unknown")[:120], count(input_tokens), count(output_tokens),
                 count(thinking_tokens), max(0, int(latency_ms or 0)), 1 if ok else 0, time.time_ns()))

    def llm_calls_on(self, day):
        with self._lock, self._connect() as db:
            return int(db.execute("SELECT COUNT(*) FROM llm_calls WHERE day=?", (str(day),)).fetchone()[0])

    def tokens_on(self, day):
        with self._lock, self._connect() as db:
            row = db.execute(
                "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(thinking_tokens),0) FROM llm_calls WHERE day=?",
                (str(day),)).fetchone()
        return {"input": int(row[0]), "output": int(row[1]), "thinking": int(row[2])}

    def usage_summary(self, days=7):
        days = min(30, max(1, int(days or 7)))
        since = (datetime.date.today() - datetime.timedelta(days=days - 1)).isoformat()
        with self._lock, self._connect() as db:
            rows = db.execute(
                "SELECT day, route, COUNT(*) AS calls, COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(thinking_tokens),0) "
                "FROM llm_calls WHERE day>=? GROUP BY day, route ORDER BY day DESC, route", (since,)).fetchall()
        return [{"day": r[0], "route": r[1], "calls": int(r[2]), "input_tokens": int(r[3]), "output_tokens": int(r[4]), "thinking_tokens": int(r[5])} for r in rows]

    # hosting_ready_v1: contraseña única del dueño (solo hash), sesiones (solo hash del token) y recordatorios por perfil.
    def get_meta(self, key):
        with self._lock, self._connect() as db:
            row = db.execute("SELECT value FROM metadata WHERE key=?", (str(key),)).fetchone()
        return row["value"] if row else None

    def set_password_hash(self, encoded):
        """Guarda el hash y revoca TODAS las sesiones en la misma transacción."""
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('auth_password_hash',?)", (str(encoded),))
            db.execute("DELETE FROM auth_sessions")
            db.execute("DELETE FROM metadata WHERE key='device_cookie_secret'")   # los dispositivos conocidos también dejan de serlo

    def device_secret(self):
        """Secreto local (hex) para firmar la cookie de dispositivo conocido; se crea una vez y se rota al cambiar la contraseña."""
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT value FROM metadata WHERE key='device_cookie_secret'").fetchone()
            if row:
                return row["value"]
            value = secrets.token_hex(32)
            db.execute("INSERT INTO metadata(key,value) VALUES('device_cookie_secret',?)", (value,))
            return value

    def delete_all_sessions(self):
        with self._lock, self._connect() as db:
            return db.execute("DELETE FROM auth_sessions").rowcount

    def create_session(self, token_hash, ttl_seconds, now=None):
        now = int(time.time() if now is None else now)
        with self._lock, self._connect() as db:
            db.execute("DELETE FROM auth_sessions WHERE expires_at<=?", (now,))
            db.execute("INSERT INTO auth_sessions(token_hash,created_at,last_seen,expires_at) VALUES(?,?,?,?)", (token_hash, now, now, now + int(ttl_seconds)))

    def check_session(self, token_hash, ttl_seconds, now=None, renew_after=300, absolute_seconds=90 * 24 * 3600):
        """True si la sesión existe y no caducó; la caducidad se desliza (se renueva como mucho cada `renew_after` s)."""
        now = int(time.time() if now is None else now)
        with self._lock, self._connect() as db:
            row = db.execute("SELECT created_at,last_seen,expires_at FROM auth_sessions WHERE token_hash=?", (token_hash,)).fetchone()
            if not row:
                return False
            if row["expires_at"] <= now or now - row["created_at"] >= absolute_seconds:
                db.execute("DELETE FROM auth_sessions WHERE token_hash=?", (token_hash,))
                return False
            if now - row["last_seen"] >= renew_after:
                db.execute("UPDATE auth_sessions SET last_seen=?,expires_at=? WHERE token_hash=?", (now, min(now + int(ttl_seconds), row["created_at"] + absolute_seconds), token_hash))
            return True

    def delete_session(self, token_hash):
        with self._lock, self._connect() as db:
            db.execute("DELETE FROM auth_sessions WHERE token_hash=?", (token_hash,))

    def session_count(self):
        with self._lock, self._connect() as db:
            return int(db.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0])

    def reminder_get(self, profile_id):
        """(ajustes, tiene_enlace) del perfil; nunca devuelve el token ni su hash."""
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            if not db.execute("SELECT 1 FROM profiles WHERE profile_id=?", (profile_id,)).fetchone():
                raise ValueError("El perfil local no existe.")
            row = db.execute("SELECT token_hash,settings_json FROM reminders WHERE profile_id=?", (profile_id,)).fetchone()
        if not row:
            return None, False
        return json.loads(row["settings_json"]), bool(row["token_hash"])

    def reminder_put(self, profile_id, settings, token_hash=None, keep_token=True):
        """Guarda ajustes. token_hash nuevo = regenerar (el anterior deja de valer); keep_token=False y sin token = revocar."""
        profile_id = _profile_id(profile_id)
        now = time.time_ns()
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("SELECT 1 FROM profiles WHERE profile_id=?", (profile_id,)).fetchone():
                raise ValueError("El perfil local no existe.")
            row = db.execute("SELECT token_hash FROM reminders WHERE profile_id=?", (profile_id,)).fetchone()
            current = row["token_hash"] if row else None
            final = token_hash if token_hash else (current if keep_token else None)
            db.execute("INSERT INTO reminders(profile_id,token_hash,settings_json,updated_at) VALUES(?,?,?,?) "
                       "ON CONFLICT(profile_id) DO UPDATE SET token_hash=excluded.token_hash,settings_json=excluded.settings_json,updated_at=excluded.updated_at",
                       (profile_id, final, _json(settings), now))

    def reminder_by_token(self, token_hash):
        """(profile_id, ajustes) si el hash del token está vigente y los recordatorios activos; si no, None."""
        with self._lock, self._connect() as db:
            row = db.execute("SELECT profile_id,settings_json FROM reminders WHERE token_hash=?", (token_hash,)).fetchone()
        if not row:
            return None
        settings = json.loads(row["settings_json"])
        return (row["profile_id"], settings) if settings.get("enabled") else None

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

    def delete_profile(self, profile_id):
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            deleted = db.execute("DELETE FROM profiles WHERE profile_id=?", (profile_id,)).rowcount
        if not deleted:
            raise ValueError("El perfil local no existe.")
        return {"deleted": True, "profile_id": profile_id}

    def save_placement_items(self, profile_id, goal_id, items):
        """Store placement questions; the private part (answer key) never leaves the server."""
        profile_id = _profile_id(profile_id)
        goal_id = str(goal_id or "").strip()
        if not goal_id or not isinstance(items, list):
            raise ValueError("Las preguntas de diagnóstico están incompletas.")
        now = time.time_ns()
        with self._lock, self._connect() as db:
            if not db.execute("SELECT 1 FROM profiles WHERE profile_id=?", (profile_id,)).fetchone():
                raise ValueError("El perfil local no existe.")
            for public, private in items:
                db.execute("INSERT INTO placement_items VALUES(?,?,?,?,?,?,?)",
                           (profile_id, goal_id, public["item_id"], public["node_id"], _json(public), _json(private), now))

    # grounded_sources_v1: texto pegado por la persona; se trocea y se recupera sin modelo.
    def add_source(self, profile_id, goal_id, title, source_date, sha256, chars, chunks, max_sources=20):
        profile_id = _profile_id(profile_id)
        goal_id = str(goal_id or "").strip()
        if not goal_id:
            raise ValueError("Falta la meta de la fuente.")
        with self._lock, self._connect() as db:
            if not db.execute("SELECT 1 FROM profiles WHERE profile_id=?", (profile_id,)).fetchone():
                raise ValueError("El perfil local no existe.")
            row = db.execute("SELECT source_id,title,source_date,chars,created_at FROM sources WHERE profile_id=? AND goal_id=? AND sha256=?", (profile_id, goal_id, sha256)).fetchone()
            if row:
                return {"source_id": row[0], "title": row[1], "source_date": row[2], "chars": row[3], "created_at": row[4]}, False
            if db.execute("SELECT COUNT(*) FROM sources WHERE profile_id=? AND goal_id=?", (profile_id, goal_id)).fetchone()[0] >= max_sources:
                raise ValueError("Esta meta ya tiene el máximo de %d fuentes; borra una antes de añadir otra." % max_sources)
            source_id = "src-" + uuid.uuid4().hex
            created = time.time_ns()
            db.execute("INSERT INTO sources VALUES(?,?,?,?,?,?,?,?)", (profile_id, goal_id, source_id, title, source_date, sha256, int(chars), created))
            for index, (text, norm) in enumerate(chunks):
                db.execute("INSERT INTO source_chunks VALUES(?,?,?,?,?)", (profile_id, source_id, index, text, norm))
            return {"source_id": source_id, "title": title, "source_date": source_date, "chars": int(chars), "created_at": created}, True

    def list_sources(self, profile_id, goal_id):
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            rows = db.execute("SELECT source_id,title,source_date,chars,created_at FROM sources WHERE profile_id=? AND goal_id=? ORDER BY created_at, source_id", (profile_id, str(goal_id or ""))).fetchall()
        return [{"source_id": r[0], "title": r[1], "source_date": r[2], "chars": r[3], "created_at": r[4]} for r in rows]

    def delete_source(self, profile_id, goal_id, source_id):
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            if not db.execute("SELECT 1 FROM sources WHERE profile_id=? AND goal_id=? AND source_id=?", (profile_id, str(goal_id or ""), str(source_id or ""))).fetchone():
                raise ValueError("La fuente no existe en esta meta.")
            db.execute("DELETE FROM source_chunks WHERE profile_id=? AND source_id=?", (profile_id, str(source_id)))
            db.execute("DELETE FROM sources WHERE profile_id=? AND source_id=?", (profile_id, str(source_id)))
        return {"deleted": True, "source_id": str(source_id)}

    def source_chunks_for_goal(self, profile_id, goal_id):
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            rows = db.execute("SELECT s.source_id,s.title,s.source_date,c.chunk_index,c.text,c.norm FROM sources s JOIN source_chunks c ON c.profile_id=s.profile_id AND c.source_id=s.source_id WHERE s.profile_id=? AND s.goal_id=? ORDER BY s.source_id, c.chunk_index", (profile_id, str(goal_id or ""))).fetchall()
        return [{"source_id": r[0], "title": r[1], "source_date": r[2], "chunk_index": r[3], "text": r[4], "norm": r[5]} for r in rows]

    def save_content_report(self, profile_id, goal_id, node_id, kind, excerpt, note):
        """Learner flag on generated content. It never creates or removes evidence."""
        profile_id = _profile_id(profile_id)
        goal_id = str(goal_id or "").strip()
        if not goal_id or kind not in ("lesson", "question", "placement", "step"):
            raise ValueError("El reporte de contenido está incompleto.")
        with self._lock, self._connect() as db:
            if not db.execute("SELECT 1 FROM profiles WHERE profile_id=?", (profile_id,)).fetchone():
                raise ValueError("El perfil local no existe.")
            db.execute("INSERT INTO content_reports(profile_id,goal_id,node_id,kind,excerpt,note,created_at) VALUES(?,?,?,?,?,?,?)",
                       (profile_id, goal_id, str(node_id or ""), kind, str(excerpt or "")[:600], str(note or "")[:400], time.time_ns()))

    def exclude_item(self, profile_id, item_id, reason=""):
        """A reported question stops being answerable. Existing evidence is untouched."""
        profile_id = _profile_id(profile_id)
        item_id = str(item_id or "").strip()
        if not item_id:
            raise ValueError("Falta la pregunta a excluir.")
        with self._lock, self._connect() as db:
            if not db.execute("SELECT 1 FROM profiles WHERE profile_id=?", (profile_id,)).fetchone():
                raise ValueError("El perfil local no existe.")
            db.execute("INSERT OR IGNORE INTO excluded_items(profile_id,item_id,reason,created_at) VALUES(?,?,?,?)",
                       (profile_id, item_id, str(reason or "")[:400], time.time_ns()))
        return True

    def is_item_excluded(self, profile_id, item_id):
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            return db.execute("SELECT 1 FROM excluded_items WHERE profile_id=? AND item_id=?", (profile_id, str(item_id or ""))).fetchone() is not None

    def load_content_reports(self, profile_id, goal_id=None):
        profile_id = _profile_id(profile_id)
        query, args = "SELECT * FROM content_reports WHERE profile_id=?", [profile_id]
        if goal_id:
            query += " AND goal_id=?"; args.append(str(goal_id))
        with self._lock, self._connect() as db:
            return [dict(r) for r in db.execute(query + " ORDER BY report_id", args).fetchall()]

    def placement_prompts(self, profile_id):
        """Prompts of every stored private-key item of the profile (placement, confirmation, direct, steps...)."""
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            rows = db.execute("SELECT public_json FROM placement_items WHERE profile_id=?", (profile_id,)).fetchall()
        out = []
        for row in rows:
            try:
                out.append(str(json.loads(row["public_json"]).get("prompt") or ""))
            except (ValueError, AttributeError):
                continue
        return out

    def load_placement_item(self, profile_id, item_id):
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            row = db.execute("SELECT * FROM placement_items WHERE profile_id=? AND item_id=?", (profile_id, str(item_id or ""))).fetchone()
        if not row:
            return None
        return {"goal_id": row["goal_id"], "node_id": row["node_id"], "public": json.loads(row["public_json"]), "private": json.loads(row["private_json"])}

    def save_graph(self, profile_id, goal_id, node_id, props, chains, source):
        """Store propositions (deduplicated by normalized statement within the goal) and chains with provenance.

        props: [{"statement", "norm"}]; chains: [{"premises": [index], "conclusion": index}] indexing props.
        """
        profile_id = _profile_id(profile_id)
        goal_id = str(goal_id or "").strip()
        node_id = str(node_id or "").strip()
        if not goal_id or not node_id or not isinstance(props, list) or not isinstance(chains, list):
            raise ValueError("El grafo está incompleto.")
        now = time.time_ns()
        with self._lock, self._connect() as db:
            if not db.execute("SELECT 1 FROM profiles WHERE profile_id=?", (profile_id,)).fetchone():
                raise ValueError("El perfil local no existe.")
            ids = []
            for p in props:
                row = db.execute("SELECT prop_id, sources_json FROM knowledge_props WHERE profile_id=? AND goal_id=? AND norm=?",
                                 (profile_id, goal_id, p["norm"])).fetchone()
                if row:
                    sources = json.loads(row["sources_json"])
                    if source not in sources:
                        sources.append(source)
                        db.execute("UPDATE knowledge_props SET sources_json=? WHERE profile_id=? AND prop_id=?", (_json(sources), profile_id, row["prop_id"]))
                    ids.append(row["prop_id"])
                else:
                    pid = "prop-" + uuid.uuid4().hex
                    db.execute("INSERT INTO knowledge_props VALUES(?,?,?,?,?,?,?)", (profile_id, goal_id, pid, p["statement"], p["norm"], _json([source]), now))
                    ids.append(pid)
            out = []
            for c in chains:
                premises = [ids[i] for i in c["premises"]]
                conclusion = ids[c["conclusion"]]
                key = "|".join(sorted(premises)) + ">" + conclusion
                row = db.execute("SELECT chain_id, sources_json FROM knowledge_chains WHERE profile_id=? AND goal_id=? AND chain_key=?",
                                 (profile_id, goal_id, key)).fetchone()
                if row:
                    sources = json.loads(row["sources_json"])
                    if source not in sources:
                        sources.append(source)
                        db.execute("UPDATE knowledge_chains SET sources_json=? WHERE profile_id=? AND chain_id=?", (_json(sources), profile_id, row["chain_id"]))
                    cid = row["chain_id"]
                else:
                    cid = "chain-" + uuid.uuid4().hex
                    db.execute("INSERT INTO knowledge_chains VALUES(?,?,?,?,?,?,?,?,?)", (profile_id, goal_id, cid, node_id, _json(premises), conclusion, key, _json([source]), now))
                out.append(cid)
        return {"prop_ids": ids, "chain_ids": out}

    def load_graph(self, profile_id, goal_id, chain_ids=None):
        """Return the goal's propositions and chains (optionally only the given chains and the propositions they use)."""
        profile_id = _profile_id(profile_id)
        goal_id = str(goal_id or "").strip()
        with self._lock, self._connect() as db:
            chains = [dict(r) for r in db.execute("SELECT * FROM knowledge_chains WHERE profile_id=? AND goal_id=? ORDER BY created_at, chain_id", (profile_id, goal_id)).fetchall()]
            if chain_ids is not None:
                wanted = {str(x) for x in chain_ids}
                chains = [c for c in chains if c["chain_id"] in wanted]
            props = {r["prop_id"]: dict(r) for r in db.execute("SELECT * FROM knowledge_props WHERE profile_id=? AND goal_id=?", (profile_id, goal_id)).fetchall()}
        out_chains = [{"chain_id": c["chain_id"], "node_id": c["node_id"], "premises": json.loads(c["premises_json"]), "conclusion": c["conclusion_id"],
                       "sources": json.loads(c["sources_json"])} for c in chains]
        if chain_ids is not None:
            used = {i for c in out_chains for i in c["premises"] + [c["conclusion"]]}
            props = {k: v for k, v in props.items() if k in used}
        return {"propositions": [{"prop_id": k, "statement": v["statement"], "sources": json.loads(v["sources_json"])} for k, v in props.items()],
                "chains": out_chains}

    def load_choice_answer(self, profile_id, goal_id, item_id, attempt_id):
        """Return the stored grading result of an answered private-key question, or None."""
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            row = db.execute("SELECT result_json FROM placement_answers WHERE profile_id=? AND attempt_id=? AND goal_id=? AND item_id=?",
                             (profile_id, str(attempt_id or ""), str(goal_id or ""), str(item_id or ""))).fetchone()
        return json.loads(row["result_json"]) if row else None

    def item_first_answer(self, profile_id, goal_id, item_id):
        """Resultado ya registrado de una pregunta (cualquier attempt_id), o None. Evita calificar dos veces la misma pregunta abierta."""
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            row = db.execute("SELECT result_json FROM placement_answers WHERE profile_id=? AND goal_id=? AND item_id=? ORDER BY created_at LIMIT 1",
                             (profile_id, str(goal_id or ""), str(item_id or ""))).fetchone()
        return json.loads(row["result_json"]) if row else None

    def placement_answer_time(self, profile_id, attempt_id):
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            row = db.execute("SELECT created_at FROM placement_answers WHERE profile_id=? AND attempt_id=?", (profile_id, str(attempt_id or ""))).fetchone()
        return row["created_at"] if row else 0

    def record_placement_answer(self, profile_id, goal_id, item_id, attempt_id, fingerprint, result):
        """Idempotent by attempt_id: the same answer returns the stored result; a different one is rejected."""
        profile_id = _profile_id(profile_id)
        attempt_id = str(attempt_id or "").strip()
        if not attempt_id:
            raise ValueError("Falta attempt_id para la respuesta de diagnóstico.")
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM placement_answers WHERE profile_id=? AND attempt_id=?", (profile_id, attempt_id)).fetchone()
            if row:
                if row["fingerprint"] != fingerprint:
                    raise ValueError("PLACEMENT_ATTEMPT_CONFLICT: este attempt_id ya registró otra respuesta.")
                return json.loads(row["result_json"])
            db.execute("INSERT INTO placement_answers VALUES(?,?,?,?,?,?,?)",
                       (profile_id, attempt_id, str(goal_id), str(item_id), fingerprint, _json(result), time.time_ns()))
        return _copy(result)

    # authentic_performance_v1: casos largos. Lo público y lo privado del caso viven en placement_items (patrón de las claves privadas);
    # el estado de progreso en `cases`. Nada de esto entra en `store_json`, en la exportación ni en profile_load.
    def mentor_secret(self):
        """Secreto local del servidor para los códigos de verificación. Se crea una vez; no sale en ninguna respuesta ni respaldo."""
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT value FROM metadata WHERE key='mentor_code_secret'").fetchone()
            if row:
                return row["value"]
            value = secrets.token_hex(32)
            db.execute("INSERT INTO metadata(key,value) VALUES('mentor_code_secret',?)", (value,))
            return value

    def create_case(self, profile_id, goal_id, public, private):
        profile_id = _profile_id(profile_id)
        goal_id = str(goal_id or "").strip()
        now = time.time_ns()
        state = {"stages": {}, "model_viewed_at": None}
        try:
            with self._lock, self._connect() as db:
                if not db.execute("SELECT 1 FROM profiles WHERE profile_id=?", (profile_id,)).fetchone():
                    raise ValueError("El perfil local no existe.")
                db.execute("INSERT INTO placement_items VALUES(?,?,?,?,?,?,?)",
                           (profile_id, goal_id, public["item_id"], public["node_id"], _json(public), _json(private), now))
                db.execute("INSERT INTO cases VALUES(?,?,?,?,?,?,?)", (profile_id, goal_id, public["item_id"], "ACTIVE", _json(state), now, now))
        except sqlite3.IntegrityError:
            raise ValueError("CASE_ACTIVE: ya tienes un caso activo en esta meta. Termínalo o abandónalo antes de pedir otro.")

    def _case_row(self, db, profile_id, case_id):
        row = db.execute("SELECT c.goal_id,c.status,c.state_json,c.created_at,c.updated_at,p.public_json,p.private_json FROM cases c JOIN placement_items p ON p.profile_id=c.profile_id AND p.item_id=c.case_id "
                         "WHERE c.profile_id=? AND c.case_id=?", (profile_id, str(case_id or ""))).fetchone()
        if not row:
            return None
        return {"goal_id": row["goal_id"], "status": row["status"], "state": json.loads(row["state_json"]), "created_at": row["created_at"], "updated_at": row["updated_at"],
                "public": json.loads(row["public_json"]), "private": json.loads(row["private_json"])}

    def load_case(self, profile_id, case_id):
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            return self._case_row(db, profile_id, case_id)

    def active_case_id(self, profile_id, goal_id):
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            row = db.execute("SELECT case_id FROM cases WHERE profile_id=? AND goal_id=? AND status='ACTIVE'", (profile_id, str(goal_id or ""))).fetchone()
        return row["case_id"] if row else None

    def list_cases(self, profile_id, goal_id):
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            rows = db.execute("SELECT case_id,status,created_at FROM cases WHERE profile_id=? AND goal_id=? ORDER BY created_at DESC", (profile_id, str(goal_id or ""))).fetchall()
        return [{"case_id": r["case_id"], "status": r["status"], "created_at": r["created_at"]} for r in rows]

    def record_case_stage(self, profile_id, case_id, stage_index, attempt_id, fingerprint, result, total_stages):
        """Cierra una etapa. Idempotente por (attempt_id, fingerprint); una segunda respuesta a una etapa ya calificada se rechaza."""
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self._case_row(db, profile_id, case_id)
            if not row:
                raise ValueError("El caso no existe para este perfil.")
            stages = row["state"]["stages"]
            key = str(stage_index)
            if key in stages:
                saved = stages[key]
                if saved["attempt_id"] == attempt_id and saved["fingerprint"] == fingerprint:
                    return {"result": saved, "status": row["status"], "duplicate": True}
                raise ValueError("CASE_STAGE_CONFLICT: esta etapa ya fue calificada con otra respuesta; no se puede reintentar.")
            if row["status"] != "ACTIVE":
                raise ValueError("CASE_CLOSED: este caso ya no admite respuestas.")
            if stage_index != len(stages):
                raise ValueError("CASE_STAGE_ORDER: las etapas se responden en orden.")
            if any(s["attempt_id"] == attempt_id for s in stages.values()):
                raise ValueError("CASE_STAGE_CONFLICT: este attempt_id ya se usó en otra etapa.")
            saved = {**result, "attempt_id": attempt_id, "fingerprint": fingerprint}
            stages[key] = saved
            status = "FINISHED" if len(stages) >= total_stages else "ACTIVE"
            db.execute("UPDATE cases SET status=?,state_json=?,updated_at=? WHERE profile_id=? AND case_id=?", (status, _json(row["state"]), time.time_ns(), profile_id, str(case_id)))
        return {"result": saved, "status": status, "duplicate": False}

    def close_case(self, profile_id, case_id, new_status, mark_model=False):
        """ACTIVE -> ABANDONED / CLOSED_MODEL_VIEWED; mark_model registra que se vio la respuesta modelo (también en FINISHED)."""
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self._case_row(db, profile_id, case_id)
            if not row:
                raise ValueError("El caso no existe para este perfil.")
            state, status = row["state"], row["status"]
            if mark_model and not state.get("model_viewed_at"):
                state["model_viewed_at"] = time.time_ns()
            if status == "ACTIVE" and new_status in ("ABANDONED", "CLOSED_MODEL_VIEWED"):
                status = new_status
            db.execute("UPDATE cases SET status=?,state_json=?,updated_at=? WHERE profile_id=? AND case_id=?", (status, _json(state), time.time_ns(), profile_id, str(case_id)))
        return {"status": status, "model_viewed_at": state.get("model_viewed_at")}


    def save_criterion_activity(self, profile_id, goal_id, public_contract, private_contract):
        """Insert an immutable activity contract, or return its identical original.

        Identity is (profile_id, activity_id). Goal ownership and both canonical
        contracts are immutable attributes of that identity. BEGIN IMMEDIATE
        makes compare-and-insert atomic across SQLite connections/processes.
        """
        profile_id = _profile_id(profile_id)
        goal_id = str(goal_id or "").strip()
        activity_id = str((public_contract or {}).get("activity_id") or "").strip()
        if not goal_id or not activity_id or not isinstance(public_contract, dict) or not isinstance(private_contract, dict):
            raise ValueError("El contrato durable de criterios está incompleto.")
        if "correct_option_id" not in private_contract or "criteria" not in private_contract:
            raise ValueError("El contrato privado de criterios está incompleto.")
        public_json = _json(public_contract)
        private_json = _json(private_contract)
        schema_version = str(public_contract.get("schema_version") or "criterion_assessment_v1")
        now = time.time_ns()
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            profile = db.execute("SELECT 1 FROM profiles WHERE profile_id=?", (profile_id,)).fetchone()
            if not profile:
                raise ValueError("El perfil local no existe.")
            row = db.execute("SELECT * FROM criterion_activities WHERE profile_id=? AND activity_id=?", (profile_id, activity_id)).fetchone()
            if row:
                try:
                    stored_public_json = _json(json.loads(row["public_contract_json"]))
                    stored_private_json = _json(json.loads(row["private_contract_json"]))
                except (TypeError, ValueError, json.JSONDecodeError):
                    raise ValueError("CRITERION_ACTIVITY_CONFLICT: el contrato histórico no puede compararse de forma segura.")
                equivalent = (row["goal_id"] == goal_id and
                              stored_public_json == public_json and
                              stored_private_json == private_json and
                              row["schema_version"] == schema_version)
                if not equivalent:
                    raise ValueError("CRITERION_ACTIVITY_CONFLICT: activity_id ya identifica un contrato inmutable diferente en este perfil.")
                return {"saved": False, "reused": True, "profile_id": profile_id,
                        "goal_id": row["goal_id"], "activity_id": row["activity_id"],
                        "created_at": row["created_at"], "updated_at": row["updated_at"]}
            db.execute("""INSERT INTO criterion_activities
              (profile_id,goal_id,activity_id,public_contract_json,private_contract_json,schema_version,status,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?)""",
                       (profile_id, goal_id, activity_id, public_json, private_json,
                        schema_version, "ACTIVE", now, now))
        return {"saved": True, "reused": False, "profile_id": profile_id,
                "goal_id": goal_id, "activity_id": activity_id,
                "created_at": now, "updated_at": now}

    def load_criterion_activity(self, profile_id, activity_id):
        profile_id = _profile_id(profile_id)
        activity_id = str(activity_id or "").strip()
        with self._connect() as db:
            row = db.execute("SELECT * FROM criterion_activities WHERE profile_id=? AND activity_id=?", (profile_id, activity_id)).fetchone()
        if not row:
            return None
        return {"profile_id": row["profile_id"], "goal_id": row["goal_id"], "activity_id": row["activity_id"],
                "public_contract": json.loads(row["public_contract_json"]),
                "private_contract": json.loads(row["private_contract_json"]),
                "schema_version": row["schema_version"], "status": row["status"],
                "created_at": row["created_at"], "updated_at": row["updated_at"]}

    def begin_criterion_evaluation(self, profile_id, goal_id, activity_id, attempt_id, fingerprint, owner_token=None):
        profile_id = _profile_id(profile_id)
        values = (profile_id, str(goal_id or ""), str(activity_id or ""), str(attempt_id or ""), str(fingerprint or ""))
        now = time.time_ns()
        with self._lock, self._connect() as db:
            row = db.execute("SELECT * FROM criterion_evaluations WHERE profile_id=? AND attempt_id=?", (profile_id, values[3])).fetchone()
            if row:
                if row["fingerprint"] != values[4]:
                    raise ValueError("attempt_id ya fue usado con una respuesta o condición distinta.")
                if row["status"] == "PENDING" and owner_token and row["owner_token"] != owner_token:
                    db.execute("UPDATE criterion_evaluations SET owner_token=?,updated_at=? WHERE profile_id=? AND attempt_id=?", (str(owner_token), now, profile_id, values[3]))
                    return {"status": "PENDING", "assessment": None, "created": True, "recovered": True}
                return {"status": row["status"], "assessment": json.loads(row["assessment_json"]) if row["assessment_json"] else None, "created": False}
            db.execute("""INSERT INTO criterion_evaluations
              (profile_id,goal_id,activity_id,attempt_id,fingerprint,status,assessment_json,created_at,updated_at,owner_token)
              VALUES(?,?,?,?,?,'PENDING',NULL,?,?,?)""", values + (now, now, str(owner_token or "")))
        return {"status": "PENDING", "assessment": None, "created": True}

    def release_criterion_evaluation(self, profile_id, attempt_id, fingerprint, owner_token=None):
        """Drops a PENDING reservation that never produced an assessment, so the same attempt can be retried. Never touches EVALUATED rows."""
        profile_id = _profile_id(profile_id)
        with self._lock, self._connect() as db:
            cursor = db.execute("DELETE FROM criterion_evaluations WHERE profile_id=? AND attempt_id=? AND fingerprint=? AND status='PENDING' AND (?='' OR owner_token=?)",
                                (profile_id, str(attempt_id), str(fingerprint), str(owner_token or ""), str(owner_token or "")))
        return cursor.rowcount > 0

    def finish_criterion_evaluation(self, profile_id, attempt_id, fingerprint, assessment, owner_token=None):
        profile_id = _profile_id(profile_id)
        now = time.time_ns()
        with self._lock, self._connect() as db:
            row = db.execute("SELECT fingerprint,owner_token,status FROM criterion_evaluations WHERE profile_id=? AND attempt_id=?", (profile_id, str(attempt_id))).fetchone()
            if not row:
                raise ValueError("La evaluación no fue reservada.")
            if row["fingerprint"] != str(fingerprint):
                raise ValueError("La evaluación no coincide con su fingerprint.")
            if owner_token and row["owner_token"] != str(owner_token):
                raise ValueError("La evaluación pertenece a otra solicitud activa o recuperada.")
            if row["status"] == "EVALUATED":
                return json.loads(db.execute("SELECT assessment_json FROM criterion_evaluations WHERE profile_id=? AND attempt_id=?", (profile_id, str(attempt_id))).fetchone()[0])
            db.execute("UPDATE criterion_evaluations SET status='EVALUATED',assessment_json=?,updated_at=? WHERE profile_id=? AND attempt_id=?", (_json(assessment), now, profile_id, str(attempt_id)))
        return assessment

    def load_criterion_evaluation(self, profile_id, attempt_id):
        profile_id = _profile_id(profile_id)
        with self._connect() as db:
            row = db.execute("SELECT * FROM criterion_evaluations WHERE profile_id=? AND attempt_id=?", (profile_id, str(attempt_id))).fetchone()
        if not row:
            return None
        return {"status": row["status"], "fingerprint": row["fingerprint"], "assessment": json.loads(row["assessment_json"]) if row["assessment_json"] else None,
                "goal_id": row["goal_id"], "activity_id": row["activity_id"], "attempt_id": row["attempt_id"]}

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

    def _validation_ctx(self, profile_id, known_cases=True):
        """Secreto y resultados de casos de ESTA instalación para validate_store. known_cases=False (restaurar) trata todo caso como desconocido."""
        cases = {}
        if known_cases:
            with self._lock, self._connect() as db:
                rows = db.execute("SELECT case_id,goal_id,state_json FROM cases WHERE profile_id=?", (profile_id,)).fetchall()
            for row in rows:
                stages = {}
                for key, saved in json.loads(row["state_json"]).get("stages", {}).items():
                    stages[int(key)] = {"attempt_id": saved.get("attempt_id"), "eligible": bool(saved.get("evidence_eligible")), "help_used": int(saved.get("help_used") or 0), "dont_know": bool(saved.get("dont_know")),
                                        "nodes": {n["node_id"]: n["status"] for n in saved.get("node_results", []) if isinstance(n, dict)}}
                cases[row["case_id"]] = {"goal_id": row["goal_id"], "stages": stages}
        return {"mac_key": self.mentor_secret(), "cases": cases}

    def save(self, profile_id, raw_store, expected_revision=None):
        profile_id = _profile_id(profile_id)
        store, counts = validate_store(raw_store, profile_id, ctx=self._validation_ctx(profile_id))
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
            source = {"attempt_id": item["attempt_id"], "phase": item["phase"], "result": item["result"], "help_used": item["help_used"], "hint_level_max": normalize_hint_level(event.get("hint_level_max")), "observed_dimensions": event.get("observed_dimensions", []), "at": item["occurred_at"]}
            if event.get("learner_signal_version"):
                source["learner_confidence"] = event.get("learner_confidence")
                source["calibration_signal"] = event.get("calibration_signal")
            sources.append(source)
        if not sources:
            reason = "No hay intentos anteriores pertinentes para esta habilidad."
        elif sources[0].get("calibration_signal") == "committed_misconception":
            reason = "Seleccionada porque el último intento fue incorrecto con confianza alta: posible idea errónea consolidada."
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
        canonical, counts = validate_store(raw_store, profile_id, allow_profile_rebind=True, ctx=self._validation_ctx(profile_id))
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
        store, counts = validate_store(backup["store"], profile_id, allow_profile_rebind=True, ctx=self._validation_ctx(profile_id, known_cases=False))
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
            # A public backup never carries private criterion contracts. Any
            # previous registry for this profile must not be reused silently.
            db.execute("DELETE FROM criterion_evaluations WHERE profile_id=?", (profile_id,))
            db.execute("DELETE FROM criterion_activities WHERE profile_id=?", (profile_id,))
            # authentic_performance_v1: los casos (con su rúbrica privada) tampoco se reutilizan tras restaurar un respaldo público.
            db.execute("DELETE FROM placement_items WHERE profile_id=? AND item_id IN (SELECT case_id FROM cases WHERE profile_id=?)", (profile_id, profile_id))
            db.execute("DELETE FROM cases WHERE profile_id=?", (profile_id,))
            db.execute("UPDATE stores SET store_json=?,revision=?,updated_at=? WHERE profile_id=?", (_json(store), revision, now, profile_id))
            db.execute("UPDATE profiles SET preferences_json=?,updated_at=? WHERE profile_id=?", (_json(preferences), now, profile_id))
            db.execute("DELETE FROM attempts WHERE profile_id=?", (profile_id,))
            db.executemany("INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        return {"saved": True, "restored": True, "revision": revision, "updated_at": now, "counts": counts, "preferences": preferences}
