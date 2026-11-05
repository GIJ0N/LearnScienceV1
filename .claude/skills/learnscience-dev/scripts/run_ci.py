#!/usr/bin/env python3
"""Run every `run:` command from .github/workflows/ci.yml locally, then
`git diff --check`. Prints a pass/fail table and exits non-zero on any failure.

Usage: python run_ci.py [--repo PATH] [--only SUBSTRING] [--timeout SECONDS]
No YAML dependency: it parses `run: cmd` and `run: |` blocks by indentation.
"""
import argparse
import subprocess
import sys
import time
from pathlib import Path


def commands(ci_text: str):
    lines = ci_text.splitlines()
    out, i = [], 0
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        if stripped.startswith("run:"):
            rest = stripped[4:].strip()
            if rest in ("|", ">"):
                base = len(raw) - len(raw.lstrip())
                i += 1
                while i < len(lines):
                    nxt = lines[i]
                    if nxt.strip() and (len(nxt) - len(nxt.lstrip())) <= base:
                        break
                    if nxt.strip() and not nxt.strip().startswith("#"):
                        out.append(nxt.strip())
                    i += 1
                continue
            if rest:
                out.append(rest)
        i += 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--only", default="")
    ap.add_argument("--timeout", type=int, default=300)
    a = ap.parse_args()
    repo = Path(a.repo).resolve()
    ci = repo / ".github" / "workflows" / "ci.yml"
    cmds = [c for c in commands(ci.read_text(encoding="utf-8")) if a.only in c]
    cmds.append("git diff --check")
    failures = []
    for cmd in cmds:
        t0 = time.time()
        try:
            r = subprocess.run(cmd, shell=True, cwd=repo, capture_output=True, text=True, timeout=a.timeout)
            ok, tail = r.returncode == 0, (r.stdout + r.stderr).strip().splitlines()[-6:]
        except subprocess.TimeoutExpired:
            ok, tail = False, [f"timeout {a.timeout}s"]
        print(f"{'OK  ' if ok else 'FAIL'} {time.time()-t0:5.1f}s  {cmd}")
        if not ok:
            failures.append((cmd, tail))
    for cmd, tail in failures:
        print(f"\n--- {cmd}\n" + "\n".join(tail))
    print(f"\n{len(cmds)-len(failures)}/{len(cmds)} comandos OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
