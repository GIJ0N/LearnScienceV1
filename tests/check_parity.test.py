"""Regression tests for the portable app.js/app_legacy.py parity check."""

import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools import check_parity


def legacy_source(html):
    return "HTML = {0}\n".format(repr(html))


class CheckParityTests(unittest.TestCase):
    def run_check(self, app_bytes, html):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app_path = root / "app.js"
            legacy_path = root / "app_legacy.py"
            app_path.write_bytes(app_bytes)
            legacy_path.write_text(legacy_source(html), encoding="utf-8")
            output = io.StringIO()
            errors = io.StringIO()
            result = check_parity.check_parity(app_path, legacy_path, output, errors)
            return result, output.getvalue(), errors.getvalue()

    def html(self, script):
        return "<html><script>{0}</script></html>".format(script)

    def test_lf_app_and_lf_script_pass(self):
        result, output, errors = self.run_check(b"const x = 1;\n", self.html("const x = 1;\n"))
        self.assertEqual(0, result)
        self.assertIn("PARITY PASS", output)
        self.assertEqual("", errors)

    def test_crlf_app_and_lf_script_pass(self):
        result, output, errors = self.run_check(b"const x = 1;\r\n", self.html("const x = 1;\n"))
        self.assertEqual(0, result)
        self.assertIn("solo de finales de línea: sí", output)
        self.assertEqual("", errors)

    def test_lf_app_and_crlf_script_pass(self):
        result, output, errors = self.run_check(b"const x = 1;\n", self.html("const x = 1;\r\n"))
        self.assertEqual(0, result)
        self.assertIn("solo de finales de línea: sí", output)
        self.assertEqual("", errors)

    def test_real_character_difference_fails(self):
        result, output, errors = self.run_check(b"const x = 1;\n", self.html("const x = 2;\n"))
        self.assertEqual(1, result)
        self.assertEqual("", output)
        self.assertIn("Primer byte distinto", errors)
        self.assertIn("Contexto app.js", errors)

    def test_added_byte_fails(self):
        result, _, errors = self.run_check(b"const x = 1;\n", self.html("const x = 1;!\n"))
        self.assertEqual(1, result)
        self.assertIn("Longitud canónica", errors)

    def test_removed_byte_fails(self):
        result, _, errors = self.run_check(b"const x = 1;!\n", self.html("const x = 1;\n"))
        self.assertEqual(1, result)
        self.assertIn("Longitud canónica", errors)

    def test_missing_script_is_an_error(self):
        result, _, errors = self.run_check(b"const x = 1;\n", "<html></html>")
        self.assertEqual(1, result)
        self.assertIn("PARITY ERROR", errors)

    def test_multiple_script_tags_are_ambiguous(self):
        result, _, errors = self.run_check(b"const x = 1;\n", "<script>const x = 1;\n</script><script></script>")
        self.assertEqual(1, result)
        self.assertIn("exactamente una pareja", errors)

    def test_python_escapes_and_utf8_are_decoded(self):
        script = 'const etiqueta = "á";\n'
        result, output, errors = self.run_check(script.encode("utf-8"), self.html(script))
        self.assertEqual(0, result)
        self.assertIn("PARITY PASS", output)
        self.assertEqual("", errors)


if __name__ == "__main__":
    unittest.main()
