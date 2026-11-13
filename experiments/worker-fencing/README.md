# Windows worker fencing experiment

This is an isolated, synthetic experiment. It does not run DataForge code or use user datasets. `runs/matrix/` and `results.json` are generated evidence and are ignored by Git. Rerunning replaces only `runs/matrix/` after checking that its resolved path remains below this experiment's `runs/` directory.

## Setup and run

Requirements: Windows, .NET 10 SDK, Python 3.12, and `uv`. The experiment uses a pinned DuckDB 1.4.2 in its own virtual environment; this is not a production dependency.

From the repository root in PowerShell:

```powershell
uv venv experiments/worker-fencing/.venv --python 3.12
uv pip install --python experiments/worker-fencing/.venv/Scripts/python.exe -r experiments/worker-fencing/requirements.txt
$env:DOTNET_CLI_HOME = (Resolve-Path experiments/worker-fencing).Path + '/.dotnet-home'
$env:NUGET_PACKAGES = (Resolve-Path experiments/worker-fencing).Path + '/.nuget'
dotnet build experiments/worker-fencing/WorkerFencing.csproj -c Release
& experiments/worker-fencing/.venv/Scripts/python.exe experiments/worker-fencing/run.py
```

`run.py` prints the assertion count and writes identities, exit observations, operation rows, timestamps, and per-case events to `experiments/worker-fencing/results.json`. An assertion count is evidence for this harness and Windows configuration only. The process tests use actual Job Objects; the stale-response test is only a local state-filter model.

## Cases and limitations

The matrix includes clean exit, host termination, an immediate replacement-host race, a spawned descendant, a `CREATE_BREAKAWAY_FROM_JOB` attempt, ten repeated descendant/restart races, missing ownership evidence, uncertain process identity, and a stale-response state model. A file with `stop` asks the synthetic worker to exit. All database writes are small inserts into disposable `analytics.duckdb` files.

The harness does not test WMI/COM/brokered process creation, a malicious worker duplicating a Job handle, simultaneous replacement hosts, actual IPC transport, power failure, every Windows version/edition, or production Rust supervision. Those are release-blocking gaps, not implied passes.

## Cleanup

After confirming the harness has exited, remove only this experiment's generated `runs/`, `results.json`, `.venv/`, `.uv-cache/`, `.dotnet-home/`, `.nuget/`, `bin/`, and `obj/` directories/files if no longer needed. Preserve `results.json` and `runs/matrix/` when retaining raw evidence. Do not remove `experiments/ipc-storage-recovery/`.
