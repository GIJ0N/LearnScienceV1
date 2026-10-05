"""Check that app.js matches the JavaScript served by app_legacy.py."""

import ast
import sys
from pathlib import Path
from typing import Optional, TextIO


ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "app.js"
LEGACY_PATH = ROOT / "app_legacy.py"


def canonical_line_endings(content: bytes) -> bytes:
    """Canonicalize only CRLF and isolated CR line endings to LF."""
    return content.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def embedded_javascript(legacy_path: Path) -> bytes:
    source = legacy_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(legacy_path))
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
    if html.count("<script>") != 1 or html.count("</script>") != 1:
        raise ValueError("app_legacy.py debe contener exactamente una pareja <script>...</script>.")
    start = html.index("<script>") + len("<script>")
    closing = html.index("</script>", start)
    return html[start:closing].encode("utf-8")


def mismatch_offset(left: bytes, right: bytes) -> Optional[int]:
    limit = min(len(left), len(right))
    for index in range(limit):
        if left[index] != right[index]:
            return index
    return limit if len(left) != len(right) else None


def byte_context(content: bytes, offset: int, radius: int = 50) -> str:
    start = max(0, offset - radius)
    end = min(len(content), offset + radius)
    return "bytes {0}:{1} {2!r}".format(start, end, content[start:end])


def check_parity(app_path: Path, legacy_path: Path, output: TextIO, errors: TextIO) -> int:
    try:
        app_bytes = app_path.read_bytes()
        embedded_bytes = embedded_javascript(legacy_path)
    except (OSError, SyntaxError, ValueError) as error:
        print("PARITY ERROR: {0}".format(error), file=errors)
        return 1

    canonical_app = canonical_line_endings(app_bytes)
    canonical_embedded = canonical_line_endings(embedded_bytes)
    only_line_endings = app_bytes != embedded_bytes and canonical_app == canonical_embedded

    if canonical_app == canonical_embedded:
        print("PARITY PASS: app.js y el JavaScript incrustado coinciden tras canonicalizar finales de línea a LF.", file=output)
        print("Longitud canónica: app.js={0} bytes; incrustado={1} bytes.".format(len(canonical_app), len(canonical_embedded)), file=output)
        print("Diferencia original solo de finales de línea: {0}.".format("sí" if only_line_endings else "no"), file=output)
        return 0

    offset = mismatch_offset(canonical_app, canonical_embedded)
    print("PARITY FAIL: app.js y el JavaScript incrustado en app_legacy.py están desincronizados.", file=errors)
    print("Longitud canónica: app.js={0} bytes; incrustado={1} bytes.".format(len(canonical_app), len(canonical_embedded)), file=errors)
    print("Diferencia original solo de finales de línea: no.", file=errors)
    print("Primer byte distinto: {0}.".format(offset), file=errors)
    print("Contexto app.js: {0}".format(byte_context(canonical_app, offset)), file=errors)
    print("Contexto incrustado: {0}".format(byte_context(canonical_embedded, offset)), file=errors)
    return 1


def main() -> int:
    return check_parity(APP_PATH, LEGACY_PATH, sys.stdout, sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())

