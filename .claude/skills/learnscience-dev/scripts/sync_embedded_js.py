#!/usr/bin/env python3
"""Copy app.js into the <script> block of the HTML literal in app_legacy.py.

app.js is the editable source; app_legacy.py serves an embedded copy that must
stay byte-identical (tools/check_parity.py enforces it). This replaces only the
value of the single top-level `HTML = '...'` assignment, re-serialized with
repr(), and leaves every other line of app_legacy.py untouched.

Usage: python sync_embedded_js.py [--repo PATH] [--check]
  --check  report whether a sync is needed without writing (exit 1 if needed)
"""
import argparse
import ast
import sys
from pathlib import Path


def locate_html(source: str):
    tree = ast.parse(source)
    hits = [n for n in tree.body if isinstance(n, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "HTML" for t in n.targets)]
    if len(hits) != 1:
        raise SystemExit("Se esperaba exactamente una asignación HTML en app_legacy.py.")
    return hits[0].value


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    repo = Path(args.repo).resolve()
    legacy = repo / "app_legacy.py"
    js = (repo / "app.js").read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n").decode("utf-8")
    source = legacy.read_text(encoding="utf-8")
    node = locate_html(source)
    html = ast.literal_eval(node)
    if html.count("<script>") != 1 or html.count("</script>") != 1:
        raise SystemExit("El HTML debe contener exactamente una pareja <script>...</script>.")
    start = html.index("<script>") + len("<script>")
    end = html.index("</script>", start)
    if html[start:end] == js:
        print("Paridad OK: no hace falta sincronizar.")
        return 0
    if args.check:
        print("app.js y el JS incrustado difieren: hace falta sincronizar.")
        return 1
    new_html = html[:start] + js + html[end:]
    lines = source.split("\n")
    if node.lineno != node.end_lineno:
        raise SystemExit("El literal HTML ocupa varias líneas; sincroniza manualmente.")
    i = node.lineno - 1
    line = lines[i]
    lines[i] = line[:node.col_offset] + repr(new_html) + line[node.end_col_offset:]
    out = "\n".join(lines)
    if ast.literal_eval(locate_html(out)) != new_html:
        raise SystemExit("Verificación posterior fallida; no se escribió nada.")
    legacy.write_text(out, encoding="utf-8", newline="\n")
    print(f"Sincronizado: {len(js)} caracteres de app.js incrustados en app_legacy.py.")
    print("Ejecuta ahora: python tools/check_parity.py && python app_legacy.py --self-test")
    return 0


if __name__ == "__main__":
    sys.exit(main())
