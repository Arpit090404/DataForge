# DuckDB SQL boundary experiment

This is isolated experimental code, not a DataForge component. It uses synthetic fixtures only. `run.js` recreates only its own `fixtures/proof.duckdb`, `source.csv`, and `not_registered.txt`, then writes `results.json`. It does not read personal files or credentials.

## Reproduce on Windows

1. Install Node.js 24 or another version supporting `node:child_process` and `String.replaceAll`.
2. Download the official DuckDB **v1.4.2** Windows amd64 CLI ZIP from `https://github.com/duckdb/duckdb/releases/download/v1.4.2/duckdb_cli-windows-amd64.zip` into `tools/` and extract `duckdb.exe` there. The ZIP used for this run had SHA-256 `2A31D67CF54AEC3494FB331147EDDDFEE1CD7F3FADCB5B84056F9BC28CF76576`.
3. From this directory run `node run.js`, then `pwsh -File measure.ps1` for a sampled process memory/termination observation.
4. Inspect `results.json` and `../../spec/DUCKDB_FEASIBILITY_REPORT.md`.

The script uses DuckDB's `json_serialize_sql` parser output for a conservative AST allowlist. It rejects unknown functions, table sources, statements, and unregistered relations. It launches a separate CLI process per query with `-readonly`, disabled external access and extension auto-loading, a locked configuration, a 128 MB DuckDB memory setting, a 32 MB temporary storage setting, two threads, a 100-row output cap, a 64 KiB result-byte cap, and a process timeout. These are **experiment settings**, not proposed production defaults. A process timeout terminates the CLI; it does not prove DuckDB's in-process interrupt behavior or OS memory isolation.

`results.json` records outcomes and bounded error codes/messages, not result rows. The CLI ZIP, executable, generated database, and fixtures are experiment artifacts; they are not production dependencies.
