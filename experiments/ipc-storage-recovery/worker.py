"""Disposable DuckDB worker for the recovery experiment; no user code execution."""
import json
import os
import struct
import sys
import threading
import time
import duckdb

MAX = 1024 * 1024
base = sys.argv[1]
generation = int(sys.argv[2])
db_path = os.path.join(base, "analytics.duckdb")
send_lock = threading.Lock()
jobs = {}
deferred = None

def send(obj):
    payload = json.dumps(obj, separators=(",", ":")).encode()
    with send_lock:
        sys.stdout.buffer.write(struct.pack(">I", len(payload)) + payload)
        sys.stdout.buffer.flush()

def read():
    head = sys.stdin.buffer.read(4)
    if not head:
        return None
    if len(head) != 4:
        return "bad_frame"
    size = struct.unpack(">I", head)[0]
    if not 0 < size <= MAX:
        return "oversized"
    data = sys.stdin.buffer.read(size)
    if len(data) != size:
        return "bad_frame"
    try:
        return json.loads(data)
    except (ValueError, UnicodeError):
        return "malformed"

send({"kind": "hello", "major": 2 if generation == 99 else 1, "minor": 0, "generation": generation})
while True:
    msg = read()
    if msg is None:
        break
    if isinstance(msg, str):
        send({"kind": "error", "code": msg, "generation": generation})
        if msg in ("oversized", "bad_frame"):
            break
        continue
    req = msg.get("request_id")
    op = msg.get("operation_id")
    kind = msg.get("kind")
    if msg.get("major") != 1 or msg.get("generation") != generation:
        send({"kind": "error", "request_id": req, "code": "version_or_generation", "generation": generation})
    elif kind == "echo":
        send({"kind": "ok", "request_id": req, "generation": generation, "value": msg.get("value")})
        if deferred is not None:
            send(deferred)
            deferred = None
    elif kind == "defer":
        deferred = {"kind": "ok", "request_id": req, "generation": generation, "value": msg.get("value")}
    elif kind == "long_start":
        cancel = threading.Event()
        jobs[req] = cancel
        def finish():
            if not cancel.wait(2):
                send({"kind": "ok", "request_id": req, "generation": generation})
        threading.Thread(target=finish, daemon=True).start()
    elif kind == "cancel":
        target = msg.get("target")
        if target in jobs:
            jobs[target].set()
            send({"kind": "cancelled", "request_id": req, "target": target, "generation": generation})
        else:
            send({"kind": "error", "request_id": req, "code": "unknown_target", "generation": generation})
    elif kind == "duplicate":
        response = {"kind": "ok", "request_id": req, "generation": generation}
        send(response)
        send(response)
    elif kind == "sleep":
        time.sleep(2)
        send({"kind": "ok", "request_id": req, "generation": generation})
    elif kind == "crash":
        os._exit(29)
    elif kind == "write_representation":
        if not isinstance(op, str) or not op.isascii() or not op.replace("_", "").isalnum():
            send({"kind": "error", "request_id": req, "code": "bad_operation_id", "generation": generation})
            continue
        con = duckdb.connect(db_path)
        try:
            con.execute(f'CREATE TABLE IF NOT EXISTS "rep_{op}" AS SELECT 1 AS value')
            con.close()
            send({"kind": "ok", "request_id": req, "operation_id": op, "generation": generation})
        except Exception:
            con.close()
            send({"kind": "error", "request_id": req, "code": "duckdb_write", "generation": generation})
    elif kind == "list_representations":
        con = duckdb.connect(db_path)
        names = [r[0] for r in con.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='main'").fetchall()]
        con.close()
        send({"kind": "ok", "request_id": req, "generation": generation, "tables": names})
    elif kind == "quarantine_representation":
        if not isinstance(op, str) or not op.isascii() or not op.replace("_", "").isalnum():
            send({"kind": "error", "request_id": req, "code": "bad_operation_id", "generation": generation})
            continue
        con = duckdb.connect(db_path)
        names = {r[0] for r in con.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='main'").fetchall()}
        if f"rep_{op}" in names:
            con.execute(f'ALTER TABLE "rep_{op}" RENAME TO "quarantine_{op}"')
        con.close()
        send({"kind": "ok", "request_id": req, "generation": generation})
    else:
        send({"kind": "error", "request_id": req, "code": "unsupported_capability", "generation": generation})
