# IPC and storage recovery experiment

Disposable proof only. The Rust driver owns a SQLite journal, execution records, artifact references, IPC framing, and reconciliation. `worker.py` is a Python process using embedded DuckDB 1.4.2 for synthetic representation writes. `run.py` creates only synthetic data under `runs/matrix/`, injects faults, inspects outcomes, and writes ignored `results.json`. No DataForge application module imports this code.

## Reproduce on Windows PowerShell

From this directory, with Rust 1.97.1 and `uv` available:

```powershell
$env:UV_PYTHON_INSTALL_DIR = Join-Path (Get-Location) '.python'
uv --cache-dir .uv-cache python install 3.12.12
uv --cache-dir .uv-cache venv .venv --python (Join-Path $env:UV_PYTHON_INSTALL_DIR 'cpython-3.12.12-windows-x86_64-none/python.exe')
uv --cache-dir .uv-cache pip install --python .venv/Scripts/python.exe -r requirements.txt
$env:CARGO_HOME = Join-Path (Get-Location) '.cargo-home'
cargo build --release --locked --offline
& .venv/Scripts/python.exe run.py
```

The first Cargo build needs crate downloads; omit `--offline` for that initial build. `Cargo.lock` pins the experiment's Rust transitive dependencies. `requirements.txt` pins DuckDB. The generated Python runtime, virtual environment, Cargo cache/build output, synthetic runs, and results are ignored by `.gitignore`. The run takes roughly one minute on the tested machine.

The runner verifies the fixed `runs/matrix/` target remains inside this experiment before replacing its disposable data. To clean generated runs and `results.json`, run `./cleanup.ps1`; it verifies the resolved target before recursive removal. The downloaded tools and build caches remain for reproducibility and can be removed manually after review.

The 1 MiB IPC frame cap, fault barriers, operation names, and retry policy are experiment values. `disk_stage` and `disk_promote` inject errors at filesystem boundaries; they do **not** fill a Windows volume or prove actual `ENOSPC` behavior. See `../../spec/IPC_STORAGE_RECOVERY_FEASIBILITY_REPORT.md` for the result and limits.
