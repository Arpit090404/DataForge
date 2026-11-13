"""Run the disposable Rust/Python IPC and recovery matrix; writes results.json."""
import json
import hashlib
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
import duckdb

ROOT = Path(__file__).resolve().parent
BIN = ROOT / "target" / "release" / "ipc-storage-recovery-spike.exe"
WORKER = ROOT / "worker.py"
RUNS = ROOT / "runs" / "matrix"
if not BIN.exists():
    raise SystemExit("Build the isolated Rust driver first; see README.md")
if RUNS.exists():
    # Fixed harness-owned subtree, verified before recursive removal.
    assert RUNS.resolve().is_relative_to((ROOT / "runs").resolve())
    shutil.rmtree(RUNS)
RUNS.mkdir(parents=True)

def command(mode, base, *more):
    t = time.monotonic()
    p = subprocess.run([str(BIN), mode, str(base), sys.executable, str(WORKER), *more],
                       capture_output=True, text=True, timeout=15)
    try:
        obj = json.loads(p.stdout.strip()) if p.stdout.strip() else None
    except json.JSONDecodeError:
        obj = None
    return {"exit": p.returncode, "data": obj, "ms": round((time.monotonic()-t)*1000),
            "error": p.stderr.strip()[:180]}

def state(base):
    c = sqlite3.connect(base / "project.sqlite")
    journal = c.execute("SELECT op,phase FROM journal ORDER BY op").fetchall()
    executions = c.execute("SELECT op,status FROM executions ORDER BY op").fetchall()
    artifacts = c.execute("SELECT op,path FROM artifacts ORDER BY op").fetchall()
    c.close()
    d = duckdb.connect(str(base / "analytics.duckdb"), read_only=True)
    relations = [r[0] for r in d.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='main' ORDER BY 1").fetchall()]
    d.close()
    files = {str(p.relative_to(base)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in base.rglob("*.txt")}
    return {"journal": journal, "executions": executions, "artifacts": artifacts,
            "relations": relations, "file_hashes": files}

scenarios = {
    "journal": "after prepared journal commit, before dispatch",
    "duckdb": "after DuckDB commit and worker response, before host observation",
    "worker_success": "after host records worker_result_observed",
    "stage": "after staged artifact and outputs_verified journal phase",
    "promoted": "after artifact promotion, before final SQLite commit",
    "sqlite_fail": "injected SQLite failure during final metadata transaction",
    "worker_crash": "worker exits while operation is in progress",
    "disk_stage": "injected I/O failure before artifact staging write",
    "disk_promote": "injected I/O failure before artifact promotion rename",
    "complete": "after final SQLite commit",
    "journal_fail": "injected SQLite failure before journal entry commit",
}
EXPECTED_ARTIFACT_HASH = hashlib.sha256(b"synthetic artifact").hexdigest()
results = []
ipc = command("ipc", RUNS / "ipc")
results.append({"id": "ipc", "status": "pass" if ipc["exit"] == 0 and all(t["pass"] for t in ipc["data"]["tests"]) else "fail",
                "actual": ipc, "expected": "all IPC assertions true"})
for scenario, barrier in scenarios.items():
    for repeat in (1, 2):
        base = RUNS / f"{scenario}_{repeat}"
        base.mkdir()
        baseline = command("case", base, "complete", "opdone")
        if baseline["exit"] != 0:
            raise RuntimeError(f"baseline failed: {baseline}")
        initial = state(base)
        fault = command("case", base, scenario, "opbad")
        expected_fault_exit = (77 if scenario in ("journal", "duckdb", "worker_success", "stage", "promoted", "complete")
                               else 1 if scenario in ("journal_fail", "sqlite_fail", "disk_stage", "disk_promote") else 0)
        first = command("recover", base)
        after_first = state(base)
        second = command("recover", base)
        after_second = state(base)
        retry = command("case", base, "complete", "opretry")
        final_recovery = command("recover", base)
        final = state(base)
        duplicate_retry = command("case", base, "complete", "opretry")
        after_duplicate = state(base)
        expected_interrupted = scenario not in ("complete", "journal_fail")
        ex = dict(final["executions"])
        phases = dict(final["journal"])
        pass_case = (fault["exit"] == expected_fault_exit and duplicate_retry["exit"] != 0 and after_duplicate == final
                     and first["exit"] == second["exit"] == retry["exit"] == final_recovery["exit"] == 0
                     and after_first == after_second
                     and ex.get("opdone") == "succeeded" and ex.get("opretry") == "succeeded"
                     and (ex.get("opbad") == "interrupted" if expected_interrupted else
                          (ex.get("opbad") == "succeeded" if scenario == "complete" else "opbad" not in ex))
                     and (phases.get("opbad") == "reconciled" if expected_interrupted else True)
                     and len([x for x in final["artifacts"] if x[0] == "opretry"]) == 1
                     and final["file_hashes"].get("artifacts/opdone.txt") == EXPECTED_ARTIFACT_HASH
                     and final["file_hashes"].get("artifacts/opretry.txt") == EXPECTED_ARTIFACT_HASH
                     and "rep_opdone" in final["relations"] and "rep_opretry" in final["relations"]
                     and ("rep_opbad" not in final["relations"] if expected_interrupted else True))
        results.append({"id": f"{scenario}_{repeat}", "initial": initial,
                        "fault": scenario, "barrier": barrier, "fault_exit": fault["exit"],
                        "fault_error": fault["error"], "after_restart": after_first,
                        "expected": "baseline preserved; incomplete attempt interrupted and quarantined; repeated reconciliation stable; retry committed once",
                        "actual": final, "first_recovery": first["data"],
                        "second_recovery": second["data"], "recovery_ms": first["ms"],
                        "duplicate_retry_exit": duplicate_retry["exit"],
                        "status": "pass" if pass_case else "fail"})

out = {"environment": {"python": sys.version.split()[0], "sqlite": sqlite3.sqlite_version,
                       "duckdb": duckdb.__version__}, "results": results,
       "summary": {"pass": sum(x["status"] == "pass" for x in results),
                   "fail": sum(x["status"] == "fail" for x in results)}}
(ROOT / "results.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
print(json.dumps(out["summary"]))
