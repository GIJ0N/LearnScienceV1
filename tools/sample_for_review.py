#!/usr/bin/env python
"""judge_model_v1: exporta una muestra de contenido generado a Markdown para revisarla a mano.

Solo lectura sobre la SQLite del usuario (modo `ro` + `query_only`), sin llamar a ningún proveedor
y limitada al perfil indicado. Ver docs/judge_model_v1.md.

Uso:
    python tools/sample_for_review.py --db RUTA.sqlite --profile ID_PERFIL [--n 30] [--out muestra.md]
    python tools/sample_for_review.py --db RUTA.sqlite --list-profiles
"""
import argparse
import json
import sqlite3
import sys
from pathlib import Path

CATEGORIES = ('lesson', 'question', 'ladder', 'verdict')
TITLES = {'lesson': 'Lección', 'question': 'Pregunta con clave', 'ladder': 'Explicación de la escalera', 'verdict': 'Veredicto del juez'}


def open_readonly(db_path):
    path = Path(db_path).resolve()
    if not path.is_file():
        raise SystemExit(f'No existe la base de datos: {path}')
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA query_only=ON')
    return db


def _loads(text):
    try:
        value = json.loads(text)
    except (TypeError, ValueError):
        return None
    return value


def _clip(value, limit=1200):
    text = ' '.join(str(value if value is not None else '').split())
    return text if len(text) <= limit else text[:limit - 1] + '…'


def _question_lines(q, label='Pregunta'):
    if not isinstance(q, dict) or not q.get('prompt'):
        return []
    lines = [f'**{label}:** {_clip(q.get("prompt"))}']
    if q.get('reference'):
        lines.append(f'**Referencia/clave:** {_clip(q.get("reference"))}')
    return lines


def collect(db, profile_id):
    """Devuelve {categoria: [(orden, titulo, lineas)]} del perfil, lo más reciente primero."""
    found = {c: [] for c in CATEGORIES}
    row = db.execute('SELECT store_json FROM stores WHERE profile_id=?', (profile_id,)).fetchone()
    store = _loads(row['store_json']) if row else None
    goals = store.get('goals', []) if isinstance(store, dict) else []
    rank = 0
    for goal in goals:
        if not isinstance(goal, dict):
            continue
        goal_name = _clip(goal.get('goal'), 120)
        names = {n.get('id'): n.get('name') for n in goal.get('nodes', []) if isinstance(n, dict)}
        lessons = goal.get('lessons') if isinstance(goal.get('lessons'), dict) else {}
        for node_id, lesson in reversed(list(lessons.items())):
            if not isinstance(lesson, dict) or not lesson.get('explanation'):
                continue
            rank += 1
            lines = [f'**Meta:** {goal_name} · **Tema:** {_clip(names.get(node_id) or node_id, 90)}',
                     f'**Explicación:** {_clip(lesson.get("explanation"))}',
                     f'**Ejemplo:** {_clip(lesson.get("example"))}',
                     f'**Error habitual:** {_clip(lesson.get("common_error"))}']
            for key, label in (('check', 'Comprensión'), ('guided', 'Guiada'), ('independent', 'Independiente'), ('integration', 'Integración')):
                lines += _question_lines(lesson.get(key), label)
            found['lesson'].append((rank, f'{goal_name} / {_clip(names.get(node_id) or node_id, 60)}', lines))
        session = goal.get('session') if isinstance(goal.get('session'), dict) else {}
        direct = session.get('direct') if isinstance(session.get('direct'), dict) else {}
        package = direct.get('package') if isinstance(direct.get('package'), dict) else None
        ladder = session.get('ladder') if isinstance(session.get('ladder'), dict) else {}
        # Solo persisten la oferta activa (session.direct.package) y los textos que la escalera evita repetir (avoid).
        if package:
            body = package.get('model_answer') or ' '.join(str(s.get('body', '')) for s in package.get('steps', []) if isinstance(s, dict))
            if body:
                found['ladder'].append((0, f'{goal_name} / peldaño {direct.get("rung", "?")}', [f'**Explicación mostrada:** {_clip(body)}']))
        for key, entry in ladder.items():
            for text in (entry.get('avoid') if isinstance(entry, dict) and isinstance(entry.get('avoid'), list) else [])[::-1]:
                rank += 1
                found['ladder'].append((rank, f'{goal_name} / explicación previa', [f'**Explicación previa (recortada):** {_clip(text, 450)}']))
    for r in db.execute('SELECT item_id, public_json, private_json, created_at FROM placement_items WHERE profile_id=? ORDER BY created_at DESC', (profile_id,)):
        public, private = _loads(r['public_json']), _loads(r['private_json'])
        if not isinstance(public, dict) or not public.get('prompt'):
            continue
        options = '; '.join(f'{o.get("id")}) {_clip(o.get("text"), 160)}' for o in public.get('options', []) if isinstance(o, dict))
        key = ''
        if isinstance(private, dict):
            key = private.get('correct_option_id') or private.get('fix_reference') or private.get('correct_idea') or private.get('success_criteria') or ''
        lines = [f'**Pregunta:** {_clip(public.get("prompt"))}']
        if options:
            lines.append(f'**Opciones:** {options}')
        lines.append(f'**Clave/referencia:** {_clip(key)}')
        if isinstance(private, dict) and private.get('explanation'):
            lines.append(f'**Explicación de la clave:** {_clip(private.get("explanation"))}')
        found['question'].append((r['created_at'], f'item {r["item_id"]}', lines))
    for r in db.execute('SELECT attempt_id, phase, response_text, question_json, evaluation_json, event_json, occurred_at FROM attempts WHERE profile_id=? ORDER BY occurred_at DESC', (profile_id,)):
        evaluation = _loads(r['evaluation_json'])
        question = _loads(r['question_json'])
        if not isinstance(evaluation, dict) or not (evaluation.get('result') or evaluation.get('status') or evaluation.get('overall')):
            continue
        lines = _question_lines(question)
        lines.append(f'**Respuesta del aprendiz:** {_clip(r["response_text"], 900)}')
        lines.append(f'**Veredicto:** {evaluation.get("result") or evaluation.get("status") or evaluation.get("overall")}')
        if evaluation.get('feedback'):
            lines.append(f'**Feedback del juez:** {_clip(evaluation.get("feedback"), 700)}')
        lines.append(f'**Modelo juez:** {(evaluation.get("judge_model") or (_loads(r["event_json"]) or {}).get("judge_model")) or "no registrado (dato anterior)"}')
        found['verdict'].append((r['occurred_at'], f'intento {r["phase"] or ""}', lines))
    for r in db.execute('SELECT item_id, result_json, created_at FROM placement_answers WHERE profile_id=? ORDER BY created_at DESC', (profile_id,)):
        result = _loads(r['result_json'])
        if not isinstance(result, dict) or not result.get('status') or not result.get('feedback') or result.get('judge_model') is None and result.get('evaluator_version') is None:
            continue
        lines = [f'**Veredicto:** {result.get("status")}', f'**Feedback:** {_clip(result.get("feedback"), 700)}',
                 f'**Modelo juez:** {result.get("judge_model") or "no registrado (dato anterior)"}']
        found['verdict'].append((r['created_at'], f'respuesta {r["item_id"]}', lines))
    for category in found:
        found[category].sort(key=lambda x: x[0], reverse=True)
    return found


def pick(found, n):
    """Reparte en rondas entre categorías para variar, tomando lo más reciente de cada una."""
    chosen, cursors = [], {c: 0 for c in CATEGORIES}
    while len(chosen) < n:
        progressed = False
        for category in CATEGORIES:
            if len(chosen) >= n:
                break
            i = cursors[category]
            if i < len(found[category]):
                chosen.append((category, found[category][i]))
                cursors[category] += 1
                progressed = True
        if not progressed:
            break
    return chosen


def render(chosen, profile_id, missing):
    out = ['# Muestra para revisión manual', '',
           f'Perfil: `{profile_id}` · elementos: {len(chosen)}. Generado sin llamar a ningún proveedor. Marca cada casilla a mano.', '']
    for i, (category, (_, title, lines)) in enumerate(chosen, 1):
        out += [f'## {i}. {TITLES[category]} — {title}', '']
        out += [f'{line}  ' for line in lines]
        out += ['', '- ¿Correcto? [ ] sí  [ ] no  [ ] dudoso', '- ¿Claro? [ ] sí  [ ] no', '- Nota: ', '']
    if not chosen:
        out += ['No hay contenido para este perfil.', '']
    if missing:
        out += ['---', '', 'Tipos sin elementos en esta base: ' + ', '.join(TITLES[c] for c in missing) + '. '
                'Si un tipo no aparece, puede que no se persista (las explicaciones de la escalera solo conservan la oferta activa y los textos a evitar).']
    return '\n'.join(out) + '\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--db', required=True, help='ruta de la SQLite (se abre solo lectura)')
    ap.add_argument('--profile', help='profile_id del que se muestrea (obligatorio salvo --list-profiles)')
    ap.add_argument('--n', type=int, default=30, help='máximo de elementos (por defecto 30)')
    ap.add_argument('--out', default='muestra_revision.md', help='archivo Markdown de salida')
    ap.add_argument('--list-profiles', action='store_true', help='lista id y nombre de los perfiles y termina')
    args = ap.parse_args(argv)
    db = open_readonly(args.db)
    try:
        if args.list_profiles:
            for r in db.execute('SELECT profile_id, name FROM profiles ORDER BY created_at'):
                print(f'{r["profile_id"]}\t{r["name"]}')
            return 0
        if not args.profile:
            raise SystemExit('Indica --profile ID (usa --list-profiles para verlos).')
        if not 1 <= args.n <= 500:
            raise SystemExit('--n debe estar entre 1 y 500.')
        if not db.execute('SELECT 1 FROM profiles WHERE profile_id=?', (args.profile,)).fetchone():
            raise SystemExit('El perfil indicado no existe en esta base.')
        found = collect(db, args.profile)
        chosen = pick(found, args.n)
        missing = [c for c in CATEGORIES if not found[c]]
    finally:
        db.close()
    Path(args.out).write_text(render(chosen, args.profile, missing), encoding='utf-8')
    print(f'{len(chosen)} elementos escritos en {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
