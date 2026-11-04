"""Operator-reviewed real acceptance; never imported by the production server.

State, synthetic SQLite, provider outputs and review notes live outside Git.
Every outbound Gemini request is durably reserved before opening the connection.
Interrupted requests consume budget. No automatic retries or budget reset command.
"""
import argparse
import json
import sqlite3
import subprocess
import sys
import time
import urllib.parse
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_legacy as app
from memory_store import DurableMemory, validate_store

STATE = ROOT.parent / 'learnscience-joint-acceptance'
MAX_REQUESTS = 10
OPERATIONS = {name: getattr(app, name) for name in (
    'make_criterion_activity', 'evaluate_criterion_activity', 'evaluate',
    'repair_diagnosis', 'repair_teaching')}


class StopAcceptance(RuntimeError):
    pass


class Ledger:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS requests (
              id INTEGER PRIMARY KEY, operation TEXT NOT NULL, started REAL NOT NULL,
              outcome TEXT NOT NULL DEFAULT 'reserved', review TEXT, note TEXT);
            CREATE TABLE IF NOT EXISTS control (id INTEGER PRIMARY KEY CHECK(id=1), reason TEXT);
            INSERT OR IGNORE INTO control VALUES (1, NULL);
            """)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=20)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def reserve(self, operation):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            reason = db.execute('SELECT reason FROM control').fetchone()[0]
            count = db.execute('SELECT count(*) FROM requests').fetchone()[0]
            pending = db.execute('SELECT count(*) FROM requests WHERE review IS NULL').fetchone()[0]
            if reason or count >= MAX_REQUESTS or pending:
                raise StopAcceptance(reason or ('budget exhausted' if count >= MAX_REQUESTS else 'review required (including interrupted requests)'))
            return db.execute('INSERT INTO requests(operation,started) VALUES (?,?)', (operation, time.time())).lastrowid

    def stop(self, reason):
        with self.connect() as db:
            db.execute('UPDATE control SET reason=?', (reason,))

    def finish(self, number, outcome):
        with self.connect() as db:
            db.execute('UPDATE requests SET outcome=? WHERE id=?', (outcome, number))

    def review(self, number, verdict, note):
        if verdict not in ('accepted', 'contract_rejected', 'leak', 'false_evidence', 'fatal') or not note.strip():
            raise ValueError('Explicit review verdict and rationale required')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT outcome,review FROM requests WHERE id=?', (number,)).fetchone()
            if not row or row[1] is not None or row[0] == 'reserved':
                raise ValueError('Unknown, interrupted, or already reviewed request; interrupted runs must stop')
            db.execute('UPDATE requests SET review=?,note=? WHERE id=?', (verdict, note, number))
            last = db.execute('SELECT review FROM requests ORDER BY id DESC LIMIT 2').fetchall()
            if verdict in ('leak', 'false_evidence', 'fatal') or last == [('contract_rejected',), ('contract_rejected',)]:
                db.execute('UPDATE control SET reason=?', ('human review stop: ' + verdict,))

    def status(self):
        with self.connect() as db:
            rows = db.execute('SELECT id,operation,outcome,review,note FROM requests ORDER BY id').fetchall()
            return dict(maximum=MAX_REQUESTS, requests=len(rows), remaining=MAX_REQUESTS-len(rows),
                        stopped=db.execute('SELECT reason FROM control').fetchone()[0], rows=rows)


def invoke(operation, payload, ledger, output_dir, transport=None):
    """Wrap the actual HTTP boundary, including failures hidden by app abstention."""
    original = transport or app.urllib.request.urlopen
    numbers = []
    fatal = []
    raw_outputs = []
    real_gemini = app.gemini

    def guarded_open(request, *args, **kwargs):
        parsed = urllib.parse.urlsplit(request.full_url)
        if parsed.scheme != 'https' or parsed.hostname != 'generativelanguage.googleapis.com':
            raise StopAcceptance('Unexpected outbound destination')
        number = ledger.reserve(operation)
        numbers.append(number)
        try:
            response = original(request, *args, **kwargs)
        except BaseException as exc:
            code = getattr(exc, 'code', None)
            # Do not persist exception text, headers, URLs or credentials.
            ledger.finish(number, 'transport_error_' + str(code or type(exc).__name__))
            ledger.stop('provider transport failure: ' + str(code or type(exc).__name__))
            fatal.append(number)
            raise
        ledger.finish(number, 'response_received')
        return response

    def observed_gemini(*args, **kwargs):
        raw = real_gemini(*args, **kwargs)
        raw_outputs.append(raw)
        return raw

    result = None
    error = None
    try:
        with patch.object(app.urllib.request, 'urlopen', guarded_open), patch.object(app, 'gemini', observed_gemini):
            result = OPERATIONS[operation](payload)
    except Exception as exc:
        # Detailed provider errors may contain reflected input; keep only the type.
        error = type(exc).__name__
    if numbers:
        target = Path(output_dir) / ('request-%02d.json' % numbers[0])
        record = dict(operation=operation, request_numbers=numbers, input=payload,
                      provider_content=raw_outputs, server_result=result, error_type=error,
                      model=app.MODEL, review_required=True)
        target.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
        target.chmod(0o600)
    if fatal:
        raise StopAcceptance('Provider failure; acceptance stopped; no retry')
    if error:
        raise StopAcceptance('Operation rejected: ' + error + '; review recorded response before continuing')
    if ledger.status()['stopped']:
        raise StopAcceptance(ledger.status()['stopped'])
    return result


def policy_step(payload):
    """Persist a production-policy function step, then verify reload equivalence."""
    profile = json.loads((STATE / 'profile.json').read_text())
    pid = profile['profile_id']
    current = app.memory().load(pid)
    request = dict(payload, store=current['store'])
    process = subprocess.run(['node', str(ROOT / 'tools/accept_joint_policy.js')],
                             input=json.dumps(request), text=True, capture_output=True)
    if process.returncode:
        raise StopAcceptance('Policy bridge rejected step: ' + process.stderr[-1800:])
    result = json.loads(process.stdout)
    if payload['action'] != 'snapshot':
        expected, _ = validate_store(result['store'], pid)
        app.memory().save(pid, result['store'], current['revision'])
        recovered = DurableMemory(STATE / 'synthetic.sqlite3').load(pid)
        if recovered['store'] != expected:
            raise StopAcceptance('Persistence mismatch')
    elif app.memory().load(pid) != current:
        raise StopAcceptance('Map inspection wrote durable state')
    (STATE / 'policy-latest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    return dict(result=result['result'], current=result['current'],
                revision=app.memory().load(pid)['revision'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('init')
    sub.add_parser('status')
    call = sub.add_parser('call')
    call.add_argument('operation', choices=OPERATIONS)
    call.add_argument('payload', type=Path, help='Synthetic request JSON outside repository')
    policy = sub.add_parser('policy')
    policy.add_argument('payload', type=Path, help='Policy step JSON outside repository')
    review = sub.add_parser('review')
    review.add_argument('number', type=int)
    review.add_argument('verdict', choices=['accepted','contract_rejected','leak','false_evidence','fatal'])
    review.add_argument('note')
    args = parser.parse_args()
    STATE.mkdir(mode=0o700, exist_ok=True)
    ledger = Ledger(STATE / 'request-ledger.sqlite3')
    app.set_memory_for_tests(DurableMemory(STATE / 'synthetic.sqlite3'))
    if args.command == 'init':
        marker = STATE / 'profile.json'
        if marker.exists():
            raise StopAcceptance('Already initialized; use existing profile and ledger')
        profile = app.memory().create_profile('JOINT ACCEPTANCE SYNTHETIC')
        marker.write_text(json.dumps(profile), encoding='utf-8')
        print(json.dumps(profile))
    elif args.command == 'call':
        if ROOT == args.payload.resolve() or ROOT in args.payload.resolve().parents:
            raise StopAcceptance('Acceptance input must be outside repository')
        if not (STATE / 'profile.json').exists():
            raise StopAcceptance('Initialize synthetic profile first')
        payload = json.loads(args.payload.read_text(encoding='utf-8'))
        profile = json.loads((STATE / 'profile.json').read_text())
        if payload.get('profile_id') != profile['profile_id']:
            raise StopAcceptance('Only the synthetic acceptance profile is permitted')
        print(json.dumps(invoke(args.operation, payload, ledger, STATE), ensure_ascii=False, indent=2))
    elif args.command == 'policy':
        if ROOT in args.payload.resolve().parents:
            raise StopAcceptance('Acceptance input must be outside repository')
        print(json.dumps(policy_step(json.loads(args.payload.read_text())), ensure_ascii=False, indent=2))
    elif args.command == 'review':
        ledger.review(args.number, args.verdict, args.note)
        print(json.dumps(ledger.status(), ensure_ascii=False))
    else:
        print(json.dumps(ledger.status(), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (StopAcceptance, ValueError) as exc:
        print('STOP: ' + str(exc), file=sys.stderr)
        raise SystemExit(2)
