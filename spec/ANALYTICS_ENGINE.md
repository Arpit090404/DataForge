# Analytics engine

**Status:** Draft baseline.

## Implemented Rust-hosted CSV slice

The desktop host now uses embedded DuckDB 1.4.5 for structured row filtering/sorting and grouping/aggregation. Rust alone opens `analytics.duckdb` and appends data from a registered CSV; no Python worker or caller-supplied file path is involved in the typed path. Materialization is lazy and uses generated physical column/table names. The host verifies the registered source fingerprint, checks it again after materialization, and records source fingerprint, DuckDB version, materializer version (`csv-text-v1`), inferred schema, and representation ID. A different engine version causes a new representation. Original CSV bytes are not changed.

This slice caps source input at 64 MiB and 250,000 rows, an operation at 30 seconds on a best-effort interrupt basis, one concurrent operation, 200 result rows and 1 MiB of result values per page, 256 MiB of DuckDB memory and temporary storage, and 200 visible history records. The input cap is not a proven hard cap on the persistent DuckDB file. CSV inference uses the full accepted source; values are stored as text with empty fields mapped to null and numeric operations use validated casts. The existing bounded preview/profile remains a separate Rust CSV path, so its types may differ if a large file is only partly scanned. A result page is transient; only execution metadata persists. The host marks a recorded running execution interrupted when its project is reopened. Cross-store orphan reconciliation and stronger recovery remain unimplemented.

Notebook result blocks replay a successful execution's stored structured parameters against its pinned representation on demand using a read-only DuckDB connection and the same query bounds and concurrency control. Replay creates no execution or saved result snapshot. A missing or damaged representation, incompatible engine version, or invalid recorded operation produces an unavailable state; the original source need not remain available. Results may differ when the recorded operation did not specify a deterministic order.

The Notebook can submit the existing typed row and group request kinds through the same backend command, including nested AND/OR filter groups and bounded page controls. The form loads saved nested groups without flattening them. A successful rerun may update an existing Result block's execution reference in a project-scoped transaction after verifying the new execution succeeded; it preserves the block ID and order. Execution records remain append-only. A failed or cancelled run does not retarget the block.

`get_execution_result` accepts an optional `{ offset, limit }` page override for both row and grouped operations. The host validates `offset <= 100000` and `1 <= limit <= 200`, then applies the override only to the in-memory replay request. Omitting it replays the originally recorded page. Page changes return the original execution metadata and do not change stored parameters or execution history. The existing per-page byte, time, memory, concurrency, and cancellation limits still apply.

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
The explicit local-user Notebook Python path uses an existing `ipykernel` through a Jupyter client bridge. One kernel remains active per notebook while it is open. The Rust host validates the saved cell, records each execution in project history and accepts bounded output; restart resets kernel state. The bridge preserves IOPub order and accepts stdout, stderr, exceptions, plain-text results, Pandas-style DataFrame tables extracted as cell strings, and validated PNG/JPEG images. It never sends raw HTML or JavaScript to the WebView. The environment is user selected and has normal local privileges. Bounded output is saved with each execution and restored when the notebook reopens; kernel state is not restored. Python cannot be invoked by an autonomous agent. This is separate from the proposed restricted application-owned worker below.

Trusted, application-owned worker operations use host-brokered inputs, timeout/resource/output limits, bounded diagnostics, and cancellation. CSV/XLSX/Parquet/JSON files and their metadata remain untrusted input to parsers and native libraries; malformed input can crash or exhaust the worker, and a parser compromise would inherit the worker's OS rights unless the proposed Windows boundary is demonstrated. The host, not the worker, writes DuckDB representations and committed artifacts. The worker never evaluates agent/user Python. Arbitrary generated code requires a separate approved isolation design and is out of the initial release. See EXECUTION_SECURITY, STORAGE_OWNERSHIP_DESIGN, and ADR 0008.

## SQL

The explicit Notebook SQL Run action is a trusted local-user path. It saves the Code cell, records an execution with exact SQL and selected source context, materializes the registered CSV in the host, then runs a single `SELECT`-leading query in a disposable child using a read-only DuckDB connection. The child exposes the selected representation as `source`. A bounded response appears under the Code cell and persists with its execution for restoration without rerunning SQL. Cancel and the 30-second deadline terminate the direct child; native crashes become failed executions. The child retains the user's local privileges and DuckDB settings are not an OS sandbox. Other analytical tables in the same database may be addressable; the selected source is context rather than complete lineage. Python and autonomous agent SQL remain unavailable. The typed path and Result replay contract remain separate.

Milestone 1 agent tools do not accept SQL text. The host selects application-defined structured operations, validates typed parameters and binds values. A restricted autonomous SQL capability remains behind the separate ADR 0005/Notebook SQL execution gate.

## Result contract
Return execution ID, status, column names/types, row count/estimate, bounded preview, truncation flag, artifact refs, warnings, and errorsâ€”not arbitrary huge JSON arrays.

## Visualization and statistical integrity
Use validated versioned chart specs; render with app-owned components, never agent-supplied executable HTML/JS. Distinguish observation, interpretation, hypothesis, and causal conclusion. Correlation is not causation. Report assumptions, sample size, missing-data treatment, uncertainty, and limitations.

## Performance and tests
Benchmark representative data sizes on 16 GB Windows hardware. Test nulls, duplicates, mixed types, empty files, skew, parsing errors, numerical correctness, cancellation, and provenance.
