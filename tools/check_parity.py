"""Check that the JavaScript served by app_legacy.py is app.js byte-for-byte."""

import ast
import sys
from pathlib import Path
from typing import Optional


ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "app.js"
LEGACY_PATH = ROOT / "app_legacy.py"


def embedded_javascript() -> bytes:
    source = LEGACY_PATH.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(LEGACY_PATH))
    values = []
    for statement in tree.body:
        if isinstance(statement, ast.Assign):
            if any(isinstance(target, ast.Name) and target.id == "HTML" for target in statement.targets):
                values.append(statement.value)
        elif isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name):
            if statement.target.id == "HTML":
                values.append(statement.value)
    if len(values) != 1:
        raise ValueError("No se encontró una asignación única de HTML en app_legacy.py.")
    html = ast.literal_eval(values[0])
    if not isinstance(html, str):
        raise ValueError("La asignación HTML de app_legacy.py no es una cadena.")
    opening = html.find("<script>")
    if opening < 0:
        raise ValueError("app_legacy.py no contiene la etiqueta <script> esperada.")
    start = opening + len("<script>")
    closing = html.find("</script>", start)
    if closing < 0:
        raise ValueError("app_legacy.py no contiene el cierre </script> esperado.")
    return html[start:closing].encode("utf-8")


def mismatch_offset(left: bytes, right: bytes) -> Optional[int]:
    limit = min(len(left), len(right))
    for index in range(limit):
        if left[index] != right[index]:
            return index
    return limit if len(left) != len(right) else None


def main() -> int:
    try:
        app_bytes = APP_PATH.read_bytes()
        embedded_bytes = embedded_javascript()
    except (OSError, SyntaxError, ValueError) as error:
        print(f"PARITY ERROR: {error}", file=sys.stderr)
        return 1

    if app_bytes != embedded_bytes:
        offset = mismatch_offset(app_bytes, embedded_bytes)
        print("PARITY FAIL: app.js y el JavaScript incrustado en app_legacy.py están desincronizados.")
        print(f"Primer byte distinto: {offset}; app.js={len(app_bytes)} bytes; incrustado={len(embedded_bytes)} bytes.")
        return 1

    print("PARITY PASS: app.js y el JavaScript incrustado en app_legacy.py son idénticos.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

