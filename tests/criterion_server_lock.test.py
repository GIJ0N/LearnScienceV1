"""Real-process coverage for one local server per SQLite database."""
import http.client
import json
import multiprocessing as mp
import socket
import subprocess
import os
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from memory_store import DurableMemory, LocalDatabaseServerLock


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def run_server(db_path, port, ready, provider_started, provider_release, provider_calls, block_provider):
    import app_legacy
    from http.server import ThreadingHTTPServer

    lock = LocalDatabaseServerLock(db_path)
    try:
        lock.acquire()
    except RuntimeError as exc:
        ready.put(("rejected", str(exc)))
        return
    try:
        app_legacy.set_memory_for_tests(DurableMemory(db_path))

        def provider(*_args, **_kwargs):
            with provider_calls.get_lock():
                provider_calls.value += 1
            provider_started.set()
            if block_provider and not provider_release.wait(5):
                raise ValueError("controlled provider timeout")
            return {"status": "SATISFIED", "observation": "Evaluación controlada."}

        app_legacy.gemini = provider
        server = ThreadingHTTPServer(("127.0.0.1", port), app_legacy.Handler)
        ready.put(("ready", port))
        server.serve_forever()
    finally:
        lock.release()


def post(port, route, payload, timeout=4):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{route}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as exc:
        return exc.code, json.load(exc)


def prepare_database(path, label):
    store = DurableMemory(path)
    profile = store.create_profile(label)
    public = {
        "schema_version": "criterion_assessment_v1", "activity_id": f"activity-{label}",
        "type": "multiple_choice_explanation", "phase": "INDEPENDENT", "prompt": "Elige y explica.",
        "options": [{"id": "a", "text": "A"}, {"id": "b", "text": "B"}],
        "criteria": [
            {"criterion_id": "option_choice", "observable_dimension": "recognition", "required": True, "description": "Elegir."},
            {"criterion_id": "explanation", "observable_dimension": "conceptual", "required": True, "description": "Explicar."},
        ],
        "required_criteria": ["option_choice", "explanation"],
        "help": {"enabled": True, "critical": True}, "variant": "lock-test", "context": "synthetic",
    }
    private = {
        "correct_option_id": "a", "criteria": public["criteria"], "rubric_version": "criterion_assessment_v1",
        "contract_digest": "lock-test-contract", "references": {"explanation": "Explicar."},
    }
    store.save_criterion_activity(profile["profile_id"], "goal-lock", public, private)
    return profile["profile_id"], public["activity_id"]


def start_process(ctx, db_path, block_provider=False):
    ready, started, release = ctx.Queue(), ctx.Event(), ctx.Event()
    calls = ctx.Value("i", 0)
    port = free_port()
    process = ctx.Process(target=run_server, args=(str(db_path), port, ready, started, release, calls, block_provider))
    process.start()
    state = ready.get(timeout=5)
    return process, port, state, started, release, calls


def stop(process):
    if process.is_alive():
        process.terminate()
    process.join(timeout=5)
    assert not process.is_alive()


def wait_health(port, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.4) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.02)
    raise AssertionError(f"El servidor {port} no quedó disponible")


def main():
    ctx = mp.get_context("spawn")
    root = Path(tempfile.mkdtemp(prefix="criterion-server-lock-"))
    db_a, db_b = root / "a.sqlite3", root / "b.sqlite3"
    profile, activity = prepare_database(db_a, "a")
    prepare_database(db_b, "b")
    payload = {
        "profile_id": profile, "goal_id": "goal-lock", "activity_id": activity,
        "attempt_id": "attempt-crash", "selected_option_id": "a",
        "explanation": "Explicación estable.", "criterion_description": "Explicar.", "help_used": 0,
    }

    # A: a live server owns the database; B cannot start or accept requests.
    server_a, port_a, state_a, started_a, release_a, calls_a = start_process(ctx, db_a, True)
    assert state_a[0] == "ready"
    server_b, _, state_b, _, _, _ = start_process(ctx, db_a)
    assert state_b[0] == "rejected" and "Ya existe un servidor" in state_b[1]
    server_b.join(timeout=5)
    assert not server_b.is_alive()

    # Reserve and enter the controlled provider, then kill A abruptly.
    interrupted = {}
    def interrupted_request():
        try:
            interrupted["result"] = post(port_a, "/api/criteria/evaluate", payload, 8)
        except OSError as exc:
            interrupted["error"] = type(exc).__name__
    request_thread = threading.Thread(target=interrupted_request)
    request_thread.start()
    assert started_a.wait(5), "A nunca inició la evaluación controlada"
    stop(server_a)
    request_thread.join(timeout=5)
    assert not request_thread.is_alive()

    # B can acquire the released OS lock and recover the exact attempt.
    recovered_server, recovered_port, recovered_state, _, _, recovered_calls = start_process(ctx, db_a)
    assert recovered_state[0] == "ready"
    status, recovered = post(recovered_port, "/api/criteria/evaluate", payload)
    assert status == 200 and recovered["attempt_id"] == payload["attempt_id"]
    assert recovered_calls.value == 1
    stop(recovered_server)

    # C: two identical requests in one server cannot run the provider twice.
    payload_concurrent = {**payload, "attempt_id": "attempt-concurrent", "explanation": "Concurrente."}
    concurrent_server, concurrent_port, concurrent_state, concurrent_started, concurrent_release, concurrent_calls = start_process(ctx, db_a, True)
    assert concurrent_state[0] == "ready"
    first = {}
    first_thread = threading.Thread(target=lambda: first.setdefault("result", post(concurrent_port, "/api/criteria/evaluate", payload_concurrent, 8)))
    first_thread.start()
    assert concurrent_started.wait(5)
    second_status, second = post(concurrent_port, "/api/criteria/evaluate", payload_concurrent)
    assert second_status == 400 and "PENDING" in second["error"]
    assert concurrent_calls.value == 1
    concurrent_release.set()
    first_thread.join(timeout=5)
    assert first.get("result", (None,))[0] == 200
    stop(concurrent_server)

    # D: different canonical SQLite paths can be served simultaneously.
    different_a, _, different_state_a, _, _, _ = start_process(ctx, db_a)
    different_b, _, different_state_b, _, _, _ = start_process(ctx, db_b)
    assert different_state_a[0] == different_state_b[0] == "ready"
    stop(different_a); stop(different_b)

    # E: close the HTTP client after sending; the committed result is recovered
    # without a second provider call.
    payload_lost = {**payload, "attempt_id": "attempt-lost-response", "explanation": "Respuesta perdida."}
    lost_server, lost_port, lost_state, lost_started, _, lost_calls = start_process(ctx, db_a)
    assert lost_state[0] == "ready"
    body = json.dumps(payload_lost).encode()
    connection = http.client.HTTPConnection("127.0.0.1", lost_port, timeout=4)
    connection.request("POST", "/api/criteria/evaluate", body=body, headers={"Content-Type": "application/json"})
    assert lost_started.wait(5)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        row = DurableMemory(db_a).load_criterion_evaluation(profile, payload_lost["attempt_id"])
        if row and row["status"] == "EVALUATED":
            break
        time.sleep(0.02)
    else:
        raise AssertionError("La evaluación no quedó persistida tras perder la respuesta HTTP")
    connection.close()
    status, replay = post(lost_port, "/api/criteria/evaluate", payload_lost)
    assert status == 200 and replay["attempt_id"] == payload_lost["attempt_id"] and lost_calls.value == 1

    # F: changed content cannot reuse the same attempt.
    changed = {**payload_lost, "selected_option_id": "b", "explanation": "Otra respuesta."}
    status, rejected = post(lost_port, "/api/criteria/evaluate", changed)
    assert status == 400 and "attempt_id" in rejected["error"]
    stop(lost_server)

    # G is also covered in criterion_durability.test.py: a stale owner cannot
    # finish after recovery and overwrite the valid result.
    assert Path(str(db_a.resolve()) + ".server.lock").exists()

    # The real app_legacy.py startup path acquires the same lock before serving.
    project = Path(__file__).resolve().parents[1]
    real_db, other_db = root / "real.sqlite3", root / "other.sqlite3"
    real_port, rejected_port, other_port = free_port(), free_port(), free_port()
    base_env = os.environ.copy(); base_env.pop("GEMINI_API_KEY", None)
    def real_process(db, port, **kwargs):
        env = {**base_env, "RUTA_DB_PATH": str(db), "PORT": str(port)}
        return subprocess.Popen([sys.executable, "app_legacy.py"], cwd=project, env=env, **kwargs)
    real_a = real_process(real_db, real_port, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    real_other = None
    try:
        wait_health(real_port)
        real_b = real_process(real_db, rejected_port, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        _, rejected_error = real_b.communicate(timeout=5)
        assert real_b.returncode == 2 and "Ya existe un servidor" in rejected_error
        real_other = real_process(other_db, other_port, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        wait_health(other_port)
    finally:
        for process in (real_a, real_other):
            if process and process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
    print("criterion_server_lock.test.py PASS")


if __name__ == "__main__":
    main()
