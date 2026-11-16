#!/usr/bin/env python3
"""Garantiza Playwright y Chromium para tests/browser_smoke.test.js.

En GitHub Actions (variable CI=true) instala Playwright y Chromium. En local no
instala nada: solo comprueba que Playwright se pueda resolver y falla con un
mensaje claro si no (la prueba de navegador nunca se omite en silencio).
"""
import os
import shutil
import subprocess
import sys

PLAYWRIGHT_VERSION = '1.63.0'  # versión con la que se validó la prueba; súbela a propósito, no por inercia

RESOLVE = ("let p;try{p=require.resolve('playwright')}catch{p=require("
           "require('path').join(require('child_process').execSync('npm root -g').toString().trim(),'playwright')"
           "+'/package.json')}console.log(p)")


def resolvable() -> bool:
    return subprocess.run(['node', '-e', RESOLVE], capture_output=True).returncode == 0


def run(cmd):
    print('+ ' + ' '.join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def main() -> int:
    npm, npx = shutil.which('npm'), shutil.which('npx')
    if os.environ.get('CI') == 'true':
        if not npm or not npx:
            print('FALLO: npm/npx no están disponibles.'); return 1
        if not resolvable():
            run([npm, 'install', '-g', 'playwright@' + PLAYWRIGHT_VERSION])
        run([npx, '--yes', 'playwright@' + PLAYWRIGHT_VERSION, 'install', '--with-deps', 'chromium'])
    if not resolvable():
        print('FALLO: Playwright no está disponible. Instálalo con «npm install -g playwright» y «npx playwright install chromium».')
        return 1
    print('Playwright disponible.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
