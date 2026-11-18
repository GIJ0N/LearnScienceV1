#!/usr/bin/env python
"""judge_calibration_v1: informe de calibración del juez, SOLO LECTURA.

Mide cuánto acuerdan el veredicto del modelo juez, la confirmación local y la corrección manual
del aprendiz. No decide nada: no cambia el juez, los umbrales, las reglas de evidencia, los eventos
ni los datos. Abre la SQLite en modo `ro` + `query_only`, no llama a ningún proveedor y no incluye
texto de respuestas ni de preguntas ni ids de perfil en claro (solo conteos, tasas y un hash corto).
Ver docs/judge_calibration_v1.md.

Uso:
    python tools/judge_calibration.py --db RUTA.sqlite [--profile ID_PERFIL] [--out informe.md]
"""
import argparse
import hashlib
import json
import re
import sqlite3
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sample_for_review import check_out_path, open_readonly  # noqa: E402

MIN_CELL = 30
VALID = ('CORRECT', 'PARTIAL', 'MISCONCEPTION')
RESULTS = VALID + ('UNKNOWN',)
MODEL_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
ERROR_RE = re.compile(r'^[a-z][a-z0-9_]{0,39}$')
LOCAL = 'local (sin modelo)'
UNKNOWN_MODEL = 'unknown (dato anterior)'


def short_hash(profile_id):
    return hashlib.sha256(str(profile_id).encode('utf-8')).hexdigest()[:8]


def _loads(text):
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return None


def _dict(value):
    return value if isinstance(value, dict) else {}


def norm_result(value):
    """CORRECT/PARTIAL/MISCONCEPTION/UNKNOWN; cualquier otra cosa (ausente, null, tipo raro) es 'invalid'."""
    if isinstance(value, str) and value.strip().upper() in RESULTS:
        return value.strip().upper()
    return 'invalid'


def judge_label(event):
    """Quién juzgó, según lo que el evento guardó. Nunca se infiere un modelo."""
    if event.get('evaluator_trust') == 'deterministic':
        return LOCAL
    model = event.get('judge_model')
    if isinstance(model, str) and MODEL_RE.match(model) and '..' not in model:
        return model
    return UNKNOWN_MODEL


def error_label(event):
    value = event.get('error_type')
    if value is None:
        return 'unknown'
    if isinstance(value, str) and ERROR_RE.match(value):
        return value
    return 'otro'


def _tables(db):
    return {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def load_profile(db, profile_id, tables):
    """Devuelve (eventos EVIDENCE de attempts, eventos CONFIRMATION del store). Solo lectura."""
    evidence, confirmations = [], []
    if 'attempts' in tables:
        for row in db.execute('SELECT event_json FROM attempts WHERE profile_id=?', (profile_id,)):
            event = _loads(row[0])
            evidence.append(event if isinstance(event, dict) else {})
    if 'stores' in tables:
        row = db.execute('SELECT store_json FROM stores WHERE profile_id=?', (profile_id,)).fetchone()
        store = _dict(_loads(row[0])) if row else {}
        for goal in store.get('goals') if isinstance(store.get('goals'), list) else []:
            for event in _dict(goal).get('events') if isinstance(_dict(goal).get('events'), list) else []:
                if isinstance(event, dict) and event.get('type') == 'CONFIRMATION':
                    confirmations.append(event)
    return evidence, confirmations


def analyze(evidence, confirmations, stats=None, errors=None):
    """Cuenta por modelo de juez. No guarda ningún texto: solo etiquetas acotadas y números."""
    corrected_ids = set()
    for e in evidence:
        for key in ('correction_of', 'original_attempt_id'):
            if isinstance(e.get(key), str) and e.get(key):
                corrected_ids.add(e[key])
    confirm_by_attempt = {}
    for c in confirmations:
        key = c.get('confirms_attempt_id')
        if isinstance(key, str) and key and key not in confirm_by_attempt:
            confirm_by_attempt[key] = norm_result(c.get('status'))
    stats = defaultdict(Counter) if stats is None else stats
    errors = defaultdict(Counter) if errors is None else errors
    for e in evidence:
        is_correction = e.get('correction_of') or e.get('source') == 'manual_correction' or e.get('actor') == 'user'
        if is_correction:
            stats['__corrections__']['total'] += 1  # las correcciones no son evaluaciones del juez
            continue
        model = judge_label(e)
        s = stats[model]
        s['evaluations'] += 1
        result = norm_result(e.get('result') if 'result' in e else e.get('status'))
        if result == 'invalid':
            s['invalid'] += 1
            continue
        if result == 'UNKNOWN':
            s['unknown'] += 1
            continue
        s['valid'] += 1
        errors[model][error_label(e)] += 1
        corrected = any(isinstance(e.get(k), str) and e.get(k) in corrected_ids for k in ('evidence_id', 'attempt_id'))
        if corrected:
            s['corrected'] += 1
        confirmation = confirm_by_attempt.get(e.get('attempt_id')) if isinstance(e.get('attempt_id'), str) else None
        if confirmation is None:
            s['no_confirmation'] += 1
        elif confirmation not in ('CORRECT', 'MISCONCEPTION'):
            s['confirmation_unknown'] += 1  # UNKNOWN o inválido: nunca acuerdo
        else:
            s['compared'] += 1
            positive = result == 'CORRECT'
            if positive == (confirmation == 'CORRECT'):
                s['agree'] += 1
    return stats, errors


def cell(numerator, n):
    """Celda con n; por debajo de MIN_CELL no se destaca ningún porcentaje."""
    if n < MIN_CELL:
        return f'insuficiente (n={n})'
    return f'{numerator}/{n} = {100.0 * numerator / n:.1f} %'


def render(stats, errors, profiles_hashes, scope):
    out = ['# Informe de calibración del juez (solo lectura)', '',
           f'Alcance: {scope}. Perfiles (hash corto): {", ".join(profiles_hashes) or "ninguno"}.',
           f'Celdas con menos de {MIN_CELL} casos se marcan «insuficiente»: no hay porcentaje que interpretar.',
           'Este informe solo informa: no decide cambiar el juez ni los umbrales. UNKNOWN y evaluaciones inválidas se cuentan aparte y nunca como acuerdo ni acierto.', '']
    models = sorted(k for k in stats if k != '__corrections__')
    out += ['## Por modelo de juez', '',
            '| Modelo de juez | Evaluaciones | Válidas | UNKNOWN | Inválidas | Acuerdo juez↔confirmación local | Con confirmación UNKNOWN | Sin confirmación | Corrección manual |',
            '|---|---|---|---|---|---|---|---|---|']
    for m in models:
        s = stats[m]
        out.append(f'| {m} | {s["evaluations"]} | {s["valid"]} | {s["unknown"]} | {s["invalid"]} | {cell(s["agree"], s["compared"])} | '
                   f'{s["confirmation_unknown"]} | {s["no_confirmation"]} | {cell(s["corrected"], s["valid"])} |')
    if not models:
        out.append('| (sin evaluaciones) | 0 | 0 | 0 | 0 | insuficiente (n=0) | 0 | 0 | insuficiente (n=0) |')
    out += ['', f'Eventos de corrección manual encontrados (no son evaluaciones del juez): {stats["__corrections__"]["total"]}.', '',
            '## Distribución de error_type por modelo de juez (solo evaluaciones válidas)', '']
    for m in models:
        counts = {k: v for k, v in errors[m].items() if v}
        total = sum(counts.values())
        if total < MIN_CELL:
            out.append(f'- {m}: insuficiente (n={total})' + (': ' + ', '.join(f'{k}={v}' for k, v in sorted(counts.items())) if counts else ''))
        else:
            out.append(f'- {m}: ' + ', '.join(f'{k}={v} ({100.0 * v / total:.1f} %)' for k, v in sorted(counts.items())))
    out += ['', '## Cómo leerlo', '',
            '- Acuerdo: la confirmación local (opción múltiple con clave privada) y el juez coinciden en acierto / no acierto. PARTIAL y MISCONCEPTION cuentan como no acierto.',
            '- Datos anteriores sin `judge_model` van en «unknown (dato anterior)»; no se les inventa modelo.',
            '- La corrección manual es la tasa de intentos válidos del juez que el aprendiz corrigió después.',
            '- Cualquier cambio de juez o de umbrales requiere su propio lote.', '']
    return '\n'.join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--db', required=True, help='ruta de la SQLite (se abre solo lectura)')
    ap.add_argument('--profile', help='profile_id a analizar (por defecto, todos los perfiles de la base)')
    ap.add_argument('--out', default=str(Path(tempfile.gettempdir()) / 'judge_calibration_report.md'), help='archivo Markdown de salida (por defecto fuera del repo)')
    args = ap.parse_args(argv)
    check_out_path(args.out, args.db)
    db = open_readonly(args.db)
    try:
        tables = _tables(db)
        if 'profiles' not in tables:
            raise SystemExit('La base no tiene la tabla de perfiles.')
        if args.profile:
            if not db.execute('SELECT 1 FROM profiles WHERE profile_id=?', (args.profile,)).fetchone():
                raise SystemExit('El perfil indicado no existe en esta base.')
            ids = [args.profile]
        else:
            ids = [r[0] for r in db.execute('SELECT profile_id FROM profiles ORDER BY created_at')]
        stats, errors = defaultdict(Counter), defaultdict(Counter)
        for pid in ids:  # por perfil: los attempt_id no se cruzan entre perfiles
            ev, co = load_profile(db, pid, tables)
            analyze(ev, co, stats, errors)
    finally:
        db.close()
    text = render(stats, errors, [short_hash(p) for p in ids], 'un perfil' if args.profile else 'todos los perfiles')
    Path(args.out).write_text(text, encoding='utf-8')
    print(f'Informe escrito en {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
