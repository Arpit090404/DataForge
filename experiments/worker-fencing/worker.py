"""Synthetic, bounded DuckDB writer used only in the Windows Job Object spike."""
import json
import os
import subprocess
import sys
import time
import ctypes
from pathlib import Path
import duckdb

base = Path(sys.argv[1])
mode = sys.argv[2]
base.mkdir(parents=True, exist_ok=True)
if mode != "child":
    member = ctypes.c_int()
    inherited = ctypes.windll.kernel32.IsProcessInJob(ctypes.windll.kernel32.GetCurrentProcess(),
                        ctypes.c_void_p(int(sys.argv[3])), ctypes.byref(member))
    (base / "job_handle_inherited.txt").write_text("1" if inherited and member.value else "0")
desc = None
if mode in ("descendant", "breakaway"):
    flags = subprocess.CREATE_NO_WINDOW
    if mode == "breakaway":
        flags |= subprocess.CREATE_BREAKAWAY_FROM_JOB
    try:
        desc = subprocess.Popen([sys.executable, str(Path(__file__)), str(base), "child"],
                                creationflags=flags, close_fds=True)
        (base / "descendant.pid").write_text(str(desc.pid))
    except OSError as e:
        (base / "breakaway_error.txt").write_text(f"winerror={getattr(e,'winerror',None)}")

if mode == "child":
    (base / "child_ready").write_text(str(os.getpid()))
    while True:
        with (base / "child_ticks.log").open("a") as f:
            f.write("tick\n")
        time.sleep(0.03)

con = duckdb.connect(str(base / "analytics.duckdb"))
con.execute("CREATE TABLE IF NOT EXISTS ticks(id BIGINT)")
(base / "worker_ready").write_text(str(os.getpid()))
n = 0
while not (base / "stop").exists():
    con.execute("INSERT INTO ticks VALUES (?)", [n])
    n += 1
    (base / "rows_written.txt").write_text(str(n))
    time.sleep(0.03)
con.close()
if desc:
    desc.terminate()
    desc.wait(timeout=5)
