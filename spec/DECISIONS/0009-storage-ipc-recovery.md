# ADR 0009: Project storage, IPC, and recovery

- Status: Proposed for architecture approval; physical contract requires proof.
- Date: 2026-11-12

## Decision

One project is one directory with `project.sqlite`, `analytics.duckdb`, `sources/` for optional managed imports, `artifacts/`, `staging/`, and `backups/`. Rust alone writes SQLite metadata and performs schema migrations. Python alone owns DuckDB and writes staged analytical outputs; Rust validates and promotes artifacts, then commits references. SQLite is authoritative for project, dataset registration, investigation, plan, execution, artifact, finding, evidence, and report identities/status. DuckDB holds on-demand, versioned analytical representations and is never the sole copy of user source data. The ACP conversation is supplementary history, not the analytical record.

Rust–Python uses one supervised worker and length-prefixed UTF-8 JSON messages over stdio with protocol/version handshake, request IDs, bounded envelopes, structured errors, cancellation messages, and stderr reserved for bounded diagnostics. No localhost listener. Responses may be out of order and must match an outstanding ID. Large tables/files travel by verified staged artifact reference, not IPC payload. See IPC_PROTOCOL for the proposed wire contract.

## Cross-store operation journal

Rust keeps a durable SQLite operation journal, committed before dispatch, with operation ID, request ID, idempotency key, kind, input/version hashes, intended DuckDB representation and artifact IDs, phase, and timestamps. Worker outputs use deterministic operation-scoped names and carry the operation ID. The host records `prepared`, then `worker_result_observed`, then `outputs_verified`; it promotes files and commits final object references plus terminal execution status in one SQLite transaction. Journal phases are evidence of host progress, not a transaction across stores. Only Rust can publish a representation or artifact as available.

On startup, stop or fence the old worker, advance a worker generation, and reconcile before dispatching new work. A DuckDB representation with no committed SQLite reference is an orphan: never expose it, verify it is unreferenced, then quarantine or remove it after a retention window. An execution record whose artifact promotion failed remains failed/interrupted, never succeeded; discard its staged file after inspection. A promoted artifact without a metadata reference is likewise an orphan and is quarantined before safe cleanup. If the worker reported success but Rust crashed before terminal commit, the operation is uncertain; inspect journal and outputs, but do not infer successful execution merely from a worker response or file presence. A retry creates a new attempt unless the operation is proven idempotent and the prior effects have been reconciled. Keep evidence referenced by any committed execution; cleanup is never based on filename alone.

Reconciliation checks IDs, source/representation hashes, file hashes, and committed references; records a diagnostic reason for each interrupted or orphaned item. Cleanup is limited to app-owned paths and must tolerate repeated runs. Late or duplicate responses from an old worker generation, completed request, or unknown operation are ignored and logged as bounded diagnostics; they cannot change terminal state. No cross-store atomicity is claimed.

Each migration is forward-only, transactional within SQLite, versioned, and backed up before upgrade. Recovery scans incomplete executions, staged files, and missing/hash-mismatched artifacts; marks uncertain work interrupted and offers safe retry. If an ACP session is unavailable, the host reopens the investigation from SQLite, shows completed executions/artifacts/findings, marks pending agent work disconnected or interrupted, and permits local work. Reconnect/resume is offered only when the adapter proves support; a new session cannot silently continue an uncertain turn. No automatic retry of a non-idempotent operation. Backup uses a consistent SQLite snapshot plus quiesced/checkpointed DuckDB, managed imports, and verified artifact manifest; external references require separate user backup and are flagged as such. Copying open database files is not a supported backup. Restore is staged and validated before replacing a project.

## Required proof

Test crash at every journal, DuckDB commit, file promotion, and SQLite commit boundary; disk-full behavior; duplicate/late IPC responses across worker generations; orphan detection and repeated safe cleanup; timeout then worker exit; migration from prior schema; backup/restore; and source missing/changed states. Do not claim cross-store atomic transactions.
