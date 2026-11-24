# DuckDB Rust/Windows compatibility check

On Windows with the MSVC Rust toolchain, run from the repository root:

```powershell
cargo run --locked --manifest-path experiments/duckdb-rust-spike/Cargo.toml
```

The pinned `duckdb-rs` 1.4.5 bundled build completed on this machine and the program printed `DuckDB v1.4.5 returned 42`. Its first link failed because the bundled DuckDB library referenced Windows Restart Manager symbols; `build.rs` explicitly links the Windows SDK `rstrtmgr` import library. This checks compilation and one embedded in-memory query, not the DataForge application or resource/security behavior.

## Disposable SQL boundary probe

From the repository root, build and run:

```powershell
cargo build --locked --offline --manifest-path experiments/duckdb-rust-spike/Cargo.toml --bin sql_boundary_prototype
node experiments/duckdb-rust-spike/sql-boundary-proof.cjs
```

The probe uses a synthetic database and sentinel under `sql-boundary-fixture/` only. It recreates those files and writes ignored `results.json`. It needs the separately installed DuckDB 1.4.2 CLI at `../duckdb-sql-boundary/tools/duckdb.exe` for its candidate AST policy; the execution worker is embedded DuckDB 1.4.5. It is **not a production boundary**: the parser versions differ, the child has the user's OS permissions, DuckDB memory settings are not an OS memory limit, and Node termination covers only the direct child. The worker's `probe` mode intentionally bypasses the candidate policy to test DuckDB settings and must never be called from the application. See `spec/NOTEBOOK_SQL_EXECUTION_GATE.md` for results and remaining gates.

## Disposable Windows isolation probe

After the Rust build and SQL boundary fixture above, from the repository root:

```powershell
dotnet restore experiments/duckdb-rust-spike/windows-isolation/WindowsIsolation.csproj --ignore-failed-sources
dotnet build experiments/duckdb-rust-spike/windows-isolation/WindowsIsolation.csproj --no-restore
dotnet run --no-build --project experiments/duckdb-rust-spike/windows-isolation/WindowsIsolation.csproj
```

The .NET 10 harness creates a uniquely named AppContainer profile with no capabilities, grants its SID read access only to a copied synthetic DuckDB file and executable, starts the worker suspended, assigns a non-breakaway Job Object, then resumes it. Job limits include kill-on-close, two active processes, 128 MiB per process and 192 MiB per job. It tests approved reads/query, denied project/approved writes, a live loopback connection, normal-child membership and termination, a self-executable breakaway attempt, 256 MiB allocation controls, timeout, cancellation, and fixture hashes. It deletes its AppContainer profile in `finally`; generated fixtures and `isolation-results.json` remain ignored under `windows-isolation-fixture/`. The harness fails if an asserted case fails. It does not establish a production boundary or exercise brokered escapes, inherited writable handles, multiple Windows builds, scratch disk quota, or crash recovery. See the execution gate for the go/no-go decision.
