#!/usr/bin/env python3
"""Banco de evaluación de prompts: reproduce respuestas grabadas del modelo a través de los contratos locales.

Modos
  replay (por defecto, sin red ni clave): usa `recorded` de cada caso en evals/prompts/cases.json.
  --live [--record]: llama al proveedor configurado (LLM_PROVIDER + clave), muestra la misma métrica y, con
                     --record, guarda las respuestas como nuevas grabaciones (source=real).

Mide por caso: ítems propuestos vs aceptados, motivos de descarte, tamaño del prompt (tokens aproximados),
presupuesto de salida y sesgos del modelo antes de barajar (posición de la clave y opción correcta más larga).
"""
import argparse
import json
import sys
import tempfile
from collections import Counter
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app  # noqa: E402
from memory_store import DurableMemory  # noqa: E402

CASES = ROOT / 'evals' / 'prompts' / 'cases.json'
CHARS_PER_TOKEN = 3.5


def _raw_items(response):
    """Items the model proposed, whatever the flow calls them."""
    if isinstance(response, dict):
        if isinstance(response.get('items'), list):
            return response['items']
        if isinstance(response.get('steps'), list):
            return [s.get('check') for s in response['steps'] if isinstance(s, dict)]
    return []


def _bias(raw_responses):
    keys, longest, total = Counter(), 0, 0
    for response in raw_responses:
        for item in _raw_items(response):
            if not isinstance(item, dict) or not isinstance(item.get('options'), list):
                continue
            options = [o for o in item['options'] if isinstance(o, dict) and isinstance(o.get('text'), str)]
            ids = [o.get('id') for o in options]
            if item.get('correct_option_id') not in ids:
                continue
            total += 1
            keys[ids.index(item['correct_option_id'])] += 1
            lengths = [len(o['text']) for o in options]
            right = next(o for o in options if o.get('id') == item['correct_option_id'])
            if len(right['text']) == max(lengths) and lengths.count(max(lengths)) == 1:
                longest += 1
    return {'items': total, 'key_first_rate': round(keys[0] / total, 2) if total else None,
            'correct_longest_rate': round(longest / total, 2) if total else None}


def _call_flow(flow, payload, memory):
    data = {'profile_id': memory.profile, **payload}
    if flow == 'placement':
        return app.make_placement_items(data)
    if flow == 'steps':
        return app.make_lesson_steps(data)
    if flow == 'discrimination':
        return app.make_discrimination_items(data)
    if flow == 'composition':
        # Composition needs stored chains: extract them first with the case's own recorded graph.
        with patch.object(app, 'gemini', return_value=payload['_graph']):
            graph = app.extract_graph({'profile_id': memory.profile, 'goal_id': payload['goal_id'], 'node_id': payload['node_id'], 'goal': payload['goal'], 'name': payload['name'], 'material': 'm'})
        memory.chain_ids = [c['chain_id'] for c in graph['chains']]
        return app.make_composition_items({**data, 'chain_ids': memory.chain_ids})
    if flow == 'graph':
        return app.extract_graph(data)
    if flow == 'area_map':
        return app.make_area_map(data)
    raise ValueError('Flujo desconocido: ' + flow)


def run_case(case, live=False):
    with tempfile.TemporaryDirectory() as tmp:
        memory = DurableMemory(Path(tmp) / 'bench.sqlite')
        memory.profile = memory.create_profile('Banco')['profile_id']
        rejected, calls, raws = Counter(), [], []
        real_build = app._build_choice_item
        real_gemini = app.gemini
        queue = list(case.get('recorded') or [])

        def counting_build(raw, allowed, version):
            try:
                return real_build(raw, allowed, version)
            except ValueError as error:
                rejected[str(error).replace('Pregunta descartada por calidad: ', 'calidad: ')[:80]] += 1
                raise

        def fake(prompt, schema, max_tokens):
            calls.append({'chars': len(prompt), 'max_tokens': max_tokens})
            if live:
                response = real_gemini(prompt, schema, max_tokens)
            else:
                if not queue:
                    raise ValueError('El caso no tiene suficientes respuestas grabadas.')
                response = queue.pop(0)
            if getattr(memory, 'chain_ids', None):
                response = json.loads(json.dumps(response).replace('__CHAIN__', memory.chain_ids[0]))
            raws.append(response)
            return response

        error = ''
        with patch.object(app, 'memory', return_value=memory), patch.object(app, 'gemini', side_effect=fake), patch.object(app, '_build_choice_item', side_effect=counting_build):
            try:
                out = _call_flow(case['flow'], dict(case['input']), memory)
            except ValueError as exc:
                out, error = None, str(exc)
        proposed = sum(len(_raw_items(r)) for r in raws)
        accepted = 0
        if isinstance(out, dict):
            accepted = len(out.get('items') or out.get('steps') or out.get('propositions') or out.get('areas') or out.get('nodes') or [])
        return {'id': case['id'], 'flow': case['flow'], 'source': case.get('source', 'synthetic'), 'model_calls': len(calls),
                'prompt_tokens_approx': round(sum(c['chars'] for c in calls) / CHARS_PER_TOKEN), 'max_output_tokens': sum(c['max_tokens'] for c in calls),
                'proposed_items': proposed, 'accepted': accepted, 'rejected': dict(rejected), 'error': error, 'bias_before_shuffle': _bias(raws), 'raw': raws}


def evaluate(case, result):
    """Return the list of violated expectations (empty = pass)."""
    expect, problems = case.get('expect') or {}, []
    if 'error_contains' in expect:
        if expect['error_contains'] not in result['error']:
            problems.append(f"se esperaba un error con «{expect['error_contains']}», fue «{result['error']}»")
        return problems
    if result['error']:
        problems.append('error inesperado: ' + result['error'])
    if result['accepted'] < expect.get('min_accepted', 1):
        problems.append(f"aceptados {result['accepted']} < {expect.get('min_accepted', 1)}")
    for reason, minimum in (expect.get('min_rejected') or {}).items():
        got = sum(n for r, n in result['rejected'].items() if reason in r)
        if got < minimum:
            problems.append(f"descartes por «{reason}»: {got} < {minimum}")
    if 'max_model_calls' in expect and result['model_calls'] > expect['max_model_calls']:
        problems.append(f"llamadas {result['model_calls']} > {expect['max_model_calls']}")
    return problems


def report(results):
    lines = ['| caso | fuente | llamadas | tokens prompt≈ | tokens salida máx | propuestos | aceptados | descartes | clave en 1.ª pos. | correcta más larga |', '|---|---|---|---|---|---|---|---|---|---|']
    for r in results:
        b = r['bias_before_shuffle']
        lines.append(f"| {r['id']} | {r['source']} | {r['model_calls']} | {r['prompt_tokens_approx']} | {r['max_output_tokens']} | {r['proposed_items']} | {r['accepted']} | "
                     f"{sum(r['rejected'].values())} | {b['key_first_rate'] if b['key_first_rate'] is not None else '—'} | {b['correct_longest_rate'] if b['correct_longest_rate'] is not None else '—'} |")
    return '\n'.join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--live', action='store_true', help='Llama al proveedor real (requiere clave).')
    parser.add_argument('--record', action='store_true', help='Con --live, guarda las respuestas en cases.json.')
    parser.add_argument('--case', action='append', help='Ejecuta solo estos casos.')
    args = parser.parse_args(argv)
    cases = json.loads(CASES.read_text(encoding='utf-8'))
    selected = [c for c in cases if not args.case or c['id'] in args.case]
    results, failed = [], 0
    for case in selected:
        result = run_case(case, live=args.live)
        problems = evaluate(case, result)
        results.append(result)
        failed += bool(problems)
        print(('FALLA ' if problems else 'OK    ') + case['id'] + ''.join('\n   - ' + p for p in problems))
        if args.live and args.record and not result['error']:
            case['recorded'], case['source'] = result['raw'], 'real'
    print('\n' + report(results))
    if args.live and args.record:
        CASES.write_text(json.dumps(cases, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        print('\nGrabaciones reales guardadas en', CASES)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
