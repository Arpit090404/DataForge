# Analytics engine

**Status:** Draft baseline.

## Implemented Rust-hosted CSV slice

The desktop host now uses embedded DuckDB 1.4.5 for structured row filtering/sorting and grouping/aggregation. Rust alone opens `analytics.duckdb` and appends data from a registered CSV; no Python worker, SQL text endpoint, or caller-supplied file path is involved. Materialization is lazy and uses generated physical column/table names. The host verifies the registered source fingerprint, checks it again after materialization, and records source fingerprint, DuckDB version, materializer version (`csv-text-v1`), inferred schema, and representation ID. A different engine version causes a new representation. Original CSV bytes are not changed.

This slice caps source input at 64 MiB and 250,000 rows, an operation at 30 seconds on a best-effort interrupt basis, one concurrent operation, 200 result rows and 1 MiB of result values per page, 256 MiB of DuckDB memory and temporary storage, and 200 visible history records. The input cap is not a proven hard cap on the persistent DuckDB file. CSV inference uses the full accepted source; values are stored as text with empty fields mapped to null and numeric operations use validated casts. The existing bounded preview/profile remains a separate Rust CSV path, so its types may differ if a large file is only partly scanned. A result page is transient; only execution metadata persists. The host marks a recorded running execution interrupted when its project is reopened. Cross-store orphan reconciliation and stronger recovery remain unimplemented.

Notebook result blocks replay a successful execution's stored structured parameters against its pinned representation on demand using a read-only DuckDB connection and the same query bounds and concurrency control. Replay creates no execution or saved result snapshot. A missing or damaged representation, incompatible engine version, or invalid recorded operation produces an unavailable state; the original source need not remain available. Results may differ when the recorded operation did not specify a deterministic order.

## Responsibilities
File inspection/ingestion, schema inference, profiling, bounded DuckDB queries, trusted statistical routines, bounded result serialization, host-private artifact staging, execution telemetry, cancellation. Under proposed ADR 0009, the host owns DuckDB and artifact writes; the Python worker receives brokered input and returns bounded data. Arbitrary Python is deferred by proposed ADR 0008.

## Initial inputs
CSV, XLSX, Parquet, and JSON/JSONL where practical. Report format limitations, inference decisions, encoding issues, and parse errors. Do not silently coerce ambiguous data. Remote connectors are separate adapters; select one based on user value and security feasibility.

## Data access
Use DuckDB behind application-defined analytical operations and bounded query templates in Milestone 1. Use Pandas/Polars where justified. Never send unbounded data to frontend. Return bounded previews, aggregates, schema, and paginated results. Benchmark memory/latency before eager loading large data. General submitted SQL remains a future capability requiring separate validation.

## Candidate application tools
`list_project_datasets`, `inspect_dataset`, `profile_dataset`, `preview_dataset`, `run_analytical_operation`, `get_execution_status`, `cancel_execution`, `create_chart`, `get_artifact_metadata`, `save_finding`. Names/schemas remain provisional until defined in versioned contracts. `run_analytical_operation` selects only application-defined, versioned templates; it does not accept SQL text. Do not expose `execute_sql` or `execute_python` in Milestone 1.

## Execution lifecycle
`queued -> awaiting_approval (when needed) -> running -> succeeded|failed|cancelled|interrupted`.

Record execution/correlation IDs, scope, inputs, language/engine, code/query reference and hash, timing, status, exit/error, outputs, and resource metadata. Use idempotency keys for retryable operations.

Each analytical execution pins representation IDs plus DuckDB and materializer versions, schema version/fingerprint, source fingerprint, and canonical transformation configuration/hash. Persist these before treating results as reproducible; an upgrade cannot silently rewrite the recorded inputs. Do not persist machine-specific paths or hardware details as analytical provenance.

## Python
Trusted, application-owned worker operations use host-brokered inputs, timeout/resource/output limits, bounded diagnostics, and cancellation. CSV/XLSX/Parquet/JSON files and their metadata remain untrusted input to parsers and native libraries; malformed input can crash or exhaust the worker, and a parser compromise would inherit the worker's OS rights unless the proposed Windows boundary is demonstrated. The host, not the worker, writes DuckDB representations and committed artifacts. The worker never evaluates agent/user Python. Arbitrary generated code requires a separate approved isolation design and is out of the initial release. See EXECUTION_SECURITY, STORAGE_OWNERSHIP_DESIGN, and ADR 0008.

## SQL
Milestone 1 does not accept user- or agent-supplied SQL. The host selects application-defined structured operations and resolves only registered representations. Validate typed parameters and bind values; callers cannot supply SQL fragments, relation names, functions, or paths. The current slice materializes CSV directly in Rust with an input cap; the proposed later worker design would broker validated worker output and enforce a proved space quota. Apply explicit row, byte, wall-time, memory/concurrency, and temporary-storage limits. The current implementation records operation schema version, parameters, source fingerprint, representation ID, engine/materializer versions, status, and timing; separate output hashes and full recovery provenance remain planned. Original files are never modified. The tested host-owned embedded DuckDB build is not a sandbox. General SQL is gated by a separate future proof under ADR 0005.

## Result contract
Return execution ID, status, column names/types, row count/estimate, bounded preview, truncation flag, artifact refs, warnings, and errors—not arbitrary huge JSON arrays.

## Visualization and statistical integrity
Use validated versioned chart specs; render with app-owned components, never agent-supplied executable HTML/JS. Distinguish observation, interpretation, hypothesis, and causal conclusion. Correlation is not causation. Report assumptions, sample size, missing-data treatment, uncertainty, and limitations.

## Performance and tests
Benchmark representative data sizes on 16 GB Windows hardware. Test nulls, duplicates, mixed types, empty files, skew, parsing errors, numerical correctness, cancellation, and provenance.
