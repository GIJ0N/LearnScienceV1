import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from memory_store import DurableMemory


class VisualDemoSeedTest(unittest.TestCase):
    def test_seed_is_synthetic_private_and_non_destructive(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "visual-demo.sqlite3"
            command = [sys.executable, str(ROOT / "tools" / "seed_visual_demo.py"), "--db", str(database)]
            first = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=True)
            result = json.loads(first.stdout)
            memory = DurableMemory(database)
            profiles = memory.profiles()
            self.assertEqual([item["name"] for item in profiles], ["DEMO VISUAL SINTÉTICA", "DEMO VISUAL VACÍA"])
            loaded = memory.load(result["profile_id"])
            goal = loaded["store"]["goals"][0]
            self.assertEqual(len(goal["nodes"]), 6)
            self.assertNotIn("correct_option_id", goal["criterion_draft"]["activity"])
            private = memory.load_criterion_activity(result["profile_id"], "criterion-visual-demo")
            self.assertEqual(private["private_contract"]["correct_option_id"], "subtract-both")
            exported = memory.export(result["profile_id"])
            self.assertNotIn("correct_option_id", json.dumps(exported))
            self.assertEqual(memory.load(result["empty_profile_id"])["store"]["goals"], [])
            second = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
            self.assertNotEqual(second.returncode, 0)
            self.assertIn("ya existe", second.stderr)


if __name__ == "__main__":
    unittest.main()
