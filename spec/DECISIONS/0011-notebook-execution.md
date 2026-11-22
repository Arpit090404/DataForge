# ADR 0011: Notebook execution through the Rust host

- Status: Proposed for review.
- Date: 2026-11-23

## Context

Notebook Code cells store Python or SQL source. Result cells reference completed application-defined executions and can replay them against pinned representations. The current Rust host runs typed filters, sorts and aggregations through embedded DuckDB with bounded results and best-effort interruption. It has no general SQL endpoint or Python runtime. [ADR 0005](0005-dataset-sql-boundary.md), [ADR 0008](0008-python-execution.md) and [ADR 0009](0009-storage-ipc-recovery.md) remain proposed. The [worker fencing spike](../WORKER_FENCING_FEASIBILITY_REPORT.md) verified direct job members on one Windows build and did not establish containment of all descendants.

## Options

| Option | State, limits and integration | Assessment |
| --- | --- | --- |
| Jupyter-compatible Python kernel | Mature interactive state and rich output protocol. Requires connection and kernel lifecycle management, output validation, environment tracking and the same Windows isolation and kill fallback as any Python worker. Interrupt requests and heartbeat describe responsiveness, not confirmed termination. Hidden in-memory state makes reruns order-dependent. | Revisit when compatibility is a product requirement. [Jupyter messaging](https://jupyter-client.readthedocs.io/en/stable/messaging.html) |
| Custom isolated Python worker | Fresh process per execution gives explicit inputs and predictable reset semantics. Reuse the proposed bounded stdio protocol and host-controlled data broker. DataForge owns process supervision, packaging, output validation and Windows proofs. | Preferred Python candidate after proof. Defer persistent sessions. [ADR 0008](0008-python-execution.md) |
| Existing Rust/DuckDB | Reuses registered representations, typed operations, cancellation, and execution history with the least integration cost. Current query interruption is best effort, and engine settings do not enforce an OS boundary or hard process limits. | Ship typed operations first. Require separate process isolation and the ADR 0005 gate before arbitrary SQL. [DuckDB security](https://www.duckdb.org/security) |

## Proposed decision

Keep execution policy in the Rust host. Expose a small Notebook interface for submitting an approved operation, observing its status and outputs, and cancelling by execution ID. The host resolves registered representation IDs and owns authorization, quotas, execution records and artifact publication. Use existing analytics directly for the first slice. Add a worker seam when Python has a proven implementation.

A **cell** is editable authored content. An **execution** refers to an immutable submission, including the saved cell revision or exact submitted source, operation/template version and parameters, pinned input representations and fingerprints, runtime and environment versions, limits, times and terminal status. Record bounded output references and hashes when committed. A **result** references that execution. Label replay separately from stored output. Rerunning creates a new execution. Editing a cell or refreshing a source leaves prior evidence intact. Pinning inputs and environments supports replay without promising deterministic output. If persistent sessions are later justified, make restart and state loss visible, record session generation and execution order, and require a clean ordered rerun for reproducibility. Hard cancellation discards the session.

## Implementation sequence and gates

1. **Typed Notebook operations.** Reuse Rust/DuckDB and the Result flow. Let users run existing operations against registered data and insert the resulting execution reference. Show run status and cancellation only where supported. Keep Code as editable source. Verify bounded output, original source immutability, cancellation/status races and provenance across edits and restarts.
2. **Windows isolation proof.** Prototype AppContainer or an equivalent enforceable boundary with explicit ACLs, no network capabilities, a minimal environment and handle allowlist. Broker read-only pinned data and give the worker only quota-bounded scratch space. Keep project stores and publication host-owned. Attach before resume to a non-breakaway Job Object with kill-on-close and CPU, memory and process limits. Enforce wall time, disk, output bytes/rows and concurrency separately. Prove access denial and cleanup across supported Windows builds, including reparse points, credentials, network, child/brokered process paths, stale responses, host crash and restart. Fail closed if setup fails. [AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation) · [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
3. **Fresh Python runs after review and proof.** Start one isolated worker per run, use bounded versioned messages and a pinned environment, and validate outputs before publication. Request cooperative cancellation, escalate at a deadline to terminating the job, and record cancellation only after execution has stopped. Reject late output. Reconcile incomplete work under ADR 0009 before dispatch. Add persistent sessions or Jupyter compatibility only after demonstrated need. General SQL is a separate extension gated by parser/binder policy, exact engine configuration, OS isolation and cancellation tests under ADR 0005.
