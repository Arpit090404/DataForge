# IPC and storage recovery proof plan

**Status:** Prepared test plan only, 2026-11-13. No harness, tests, or product code has been implemented or run. This plan evaluates proposed ADR 0009 and `IPC_PROTOCOL.md` before Milestone 1.

## Goal and harness

Build a disposable experiment under `experiments/ipc-storage-recovery/`, separate from production code and dependencies. Use a minimal Rust host test driver, a deterministic Python worker stub speaking the proposed length-prefixed JSON protocol, a temporary SQLite journal, a temporary DuckDB database, and synthetic artifacts. The worker stub must be able to stop, delay, duplicate, reorder, truncate, and corrupt responses. A separate trusted fixture writer may create DuckDB representations; no arbitrary generated Python or user files are involved. Pin tool/runtime versions in the eventual report. Each test starts with a fresh project directory and records a file/DB manifest before and after recovery.

Fault injection is by named barriers in the host and worker: after journal `prepared` commit; after worker receives request; before/after DuckDB representation commit; after worker success is sent; after host records `worker_result_observed`; before/after artifact staging, verification, and atomic promotion; before/after final SQLite transaction. At each barrier the driver can kill the worker or host process, close a pipe, return a duplicate/late response, or inject a deterministic I/O failure. Restart with a new worker generation and run reconciliation. Never simulate cross-store atomicity by keeping all stores in one transaction.

## IPC matrix

| Case | Injection/assertion |
|---|---|
| Framing | Split the 4-byte length and UTF-8 payload at every boundary; combine frames; truncate prefix/payload; reject malformed UTF-8/JSON and zero length without desynchronizing or hanging. |
| Version | Mismatched major version fails handshake before work; supported minor fields follow documented compatibility rules; unknown required fields fail closed. |
| Correlation | Out-of-order responses map to the exact request ID; unknown IDs cannot finish any operation. |
| Duplicate/late | Replay responses before and after terminal commit and from an old worker generation; state and artifact count remain unchanged. |
| Size | Send a frame just below, at, and above the configured maximum; oversized input is rejected before allocation or execution, with bounded diagnostics. |
| Crash | Kill worker during execution and after output creation; host marks work interrupted/uncertain, terminates descendants, and starts no new work until reconciliation. |
| Cancellation | Race cancel with normal completion, delayed acknowledgement, blocked worker, and worker exit; exactly one terminal state is published and no timeout is called success. |
| Restart | Verify generation increments, fresh handshake succeeds, old messages are fenced, and a subsequent safe operation works. |
| Concurrency | Submit two requests while one runs; initial contract serializes execution or returns an explicit busy/queued state. Test cancellation of the queued request and absence of response misassociation. |

## Storage and recovery matrix

For every case, assert that committed executions and their referenced artifacts survive; unpublished outputs are never visible; recovery is repeatable; and cleanup touches only experiment-owned paths.

| Case | Expected reconciliation |
|---|---|
| Journal creation fails | No worker dispatch or side effect; report an explicit failure. |
| DuckDB commit succeeds, SQLite final commit absent | Representation remains unpublished; identify by operation ID, verify unreferenced state, quarantine for later cleanup; execution remains interrupted/uncertain. |
| SQLite execution record exists, artifact promotion fails | No success state; staged file is inspected/quarantined, and execution is failed/interrupted with a diagnostic. |
| Artifact promoted, metadata reference absent | Detect by manifest and operation-scoped name; quarantine without deleting referenced evidence. |
| Host crashes after worker reports success | Journal and outputs are reconciled; do not infer success from response/file presence alone; preserve the interrupted attempt. |
| Crash at each durable barrier | Restart reaches one consistent visible state and produces no duplicate published representation/artifact. |
| Orphan cleanup twice | Second pass is a no-op; retention window and reference checks prevent premature deletion. |
| Disk full | Use a small, isolated quota-controlled volume or injected write failure; do not fill the host drive. Test journal, DuckDB, staging, promotion, and SQLite final-commit failures separately. |
| Retry | Retry only after prior effects are classified. A proven idempotent retry reuses the operation key without duplicate output; an uncertain non-idempotent operation requires a new attempt and user-visible state. |
| Completed evidence | Kill/restart during a later operation; earlier committed executions, hashes, and references remain valid. |

## Pass criteria and evidence

Record the exact versions, Windows build, fixture manifests, injected barrier, journal phase, worker generation, visible execution state, orphan disposition, hashes, elapsed time, and errors for every case. Compare SQLite references with DuckDB relation inventory and staged/promoted files after each restart. Run each crash barrier at least twice, including repeated reconciliation. A pass requires every assertion above to hold without manual repair; any skipped case is marked untested. Report which guarantees come from application code, SQLite/DuckDB behavior, filesystem semantics, or Windows process controls. Do not accept ADR 0009 or claim recovery works from this plan alone.
