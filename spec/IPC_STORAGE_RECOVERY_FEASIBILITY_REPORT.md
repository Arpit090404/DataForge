# IPC and storage recovery feasibility report

**Status:** Experimental evidence, 2026-11-13. **Verdict:** Conditionally feasible. The isolated harness passed its assertions, but it does not establish production recovery guarantees or satisfy every proposed ADR 0009 proof gate. ADR 0009 remains proposed; Milestone 1 has not begun.

## Environment and versions

The Windows registry reported `CoreSingleLanguage`, display version `26H2`, build `26300.9974`; its legacy product-name value reported Windows 10 Home Single Language, so the supported edition should be verified separately. Rust `rustc` and Cargo were 1.97.1. The isolated Python runtime was 3.12.12. The Rust driver used `rusqlite 0.37.0` with bundled SQLite 3.50.2; Python's inspection runtime reported SQLite 3.50.4. The Python worker used embedded `duckdb 1.4.2`. Rust crates are pinned by the experiment's `Cargo.lock`; the Python dependency is pinned in `requirements.txt`. These are spike versions, not production selections.

## Harness and method

The isolated [harness](../experiments/ipc-storage-recovery/README.md) uses Rust as the host and Python as the worker. Rust owns a SQLite operation journal, execution/metadata records, and length-prefixed UTF-8 JSON over child stdio. Python writes synthetic, operation-named tables to a disposable DuckDB file. Rust stages and promotes a synthetic artifact, then publishes its reference and terminal execution state in one SQLite transaction. A journal entry commits before dispatch. No user files or generated Python are involved.

The Rust driver exits with code 77 at named durable barriers, skipping destructors and graceful worker shutdown. It also induces a Python worker exit, SQLite trigger failures, and controlled filesystem errors before staging/promotion calls. On restart, Rust scans the journal, DuckDB relation inventory, and app-owned files; it marks incomplete executions interrupted, renames unreferenced representations and files into quarantine, and leaves committed evidence available. The runner repeats each storage scenario twice from fresh disposable projects, runs reconciliation twice, retries with a new operation, and verifies a duplicate retry key is rejected. Raw per-test initial, fault, observed, expected, timing, and manifest data are in ignored `results.json` after reproduction.

## IPC results

**15/15 harness assertions passed:** major-version handshake rejection; two correlated requests; unknown message type; duplicate response detection; per-message version rejection; split length/payload reads; duplicate request detection by the Rust test driver; deliberately out-of-order responses; malformed JSON; oversized frame rejection; worker restart/generation; cancellation acknowledgement while work is pending; a late response after a timeout-marked cancel state being ignored by host state; forced process termination; and invalid journal phase rejection. The tested frame cap was 1 MiB. The cancellation test used a cooperative Python event; the forced-stop test killed the worker process. Neither proves cancellation of a DuckDB query in the eventual persistent worker. Duplicate request suppression was exercised at the driver boundary for an echo request, not yet against a side-effecting DuckDB request.

## Storage and recovery results

**22/22 repeated storage scenarios passed the harness assertions** (11 fault points, twice each). Each run began with a committed `opdone`, injected a fault into `opbad`, reconciled twice, then committed `opretry`. Completed artifact hashes and DuckDB relation references were preserved; the duplicate `opretry` was rejected by SQLite uniqueness. First reconciliation took 328–485 ms, mean 412 ms, on this small fixture. Those timings include starting a fresh Python worker and are not a scale benchmark.

| Fault point | Observed after first restart |
|---|---|
| Journal `prepared`, before dispatch | `opbad` interrupted; no orphan. |
| DuckDB commit, before host observation | `opbad` interrupted; representation quarantined. |
| Worker success observed, before later host commit | `opbad` interrupted; representation quarantined. |
| Artifact staged and `outputs_verified` | `opbad` interrupted; representation and staged file quarantined. |
| Artifact promoted, no metadata reference | `opbad` interrupted; representation and promoted file quarantined. |
| SQLite final metadata transaction fails | Transaction rolled back; `opbad` interrupted; representation and promoted file quarantined. |
| Worker exits mid-operation | `opbad` interrupted; no completed output inferred. |
| Injected staging/promotion I/O failure | `opbad` interrupted; existing unreferenced outputs quarantined. |
| Host exits after final SQLite commit | `opbad` remains succeeded with referenced evidence; no orphan. |
| Journal insert fails | No `opbad` dispatch or execution record. |

Second reconciliation found no new orphans and left the state and file hashes unchanged. This supports the proposed rule that worker success and file presence alone do not publish an execution. The SQLite execution record created at `prepared` was present when promotion failed, but the artifact reference was deliberately absent until promotion and final commit, consistent with ADR 0009. No cross-store transaction was claimed or simulated.

## Limits, ambiguous states, and risks

- The filesystem failures were injected before write/rename. No real quota-controlled volume, actual disk-full error, partial write, antivirus interference, or power-loss durability test was performed. The SQLite failure was a trigger rejection inside the final transaction, not an `fsync`/commit failure.
- Abrupt host exit was tested at barriers, but host/worker simultaneous races and Windows process-tree fencing were not. An old worker could still be mutating DuckDB when a new host starts reconciliation unless the future supervisor proves termination or exclusion. This is the largest unresolved integrity risk.
- The worker's synthetic DuckDB operation is simple and idempotent. Multi-step ingestion, partially written representations, checkpoint/WAL behavior, source changes, and large artifacts were not tested. An interrupted attempt remains visibly uncertain; the harness does not infer a durable success from a completed DuckDB table.
- Reconciliation quarantined orphaned tables by renaming them within DuckDB and moved unreferenced files to an app-owned directory. Retention, later deletion, table-name collisions, concurrent project opens, and crash during quarantine were not tested.
- The test driver handles a delayed success using an in-memory cancel state and detects duplicate IDs, but no production request registry or persistent cancellation state exists. The current proof does not establish exactly-once delivery. Repeated side-effecting request IDs and late responses crossing a real host restart remain partially tested.
- Resource measurements cover small-fixture elapsed time only. Peak memory, disk amplification, file handles, sustained concurrency, and Windows OS limits were not measured.

## ADR 0009 recommendation and Milestone 1 implication

**Accept with specific amendments after further proof.** Keep the durable SQLite journal and publish references/terminal state only in the final SQLite transaction. Explicitly define a `reconciled` journal phase, because the harness needed it to make repeated recovery stable; define legal transitions and persist the reason for uncertainty. Require verified old-worker fencing before reconciliation; ensure quarantine actions themselves are restart-safe and recorded; and test actual disk-full/commit failures and side-effecting duplicate requests. The harness supports the design direction but does not justify accepting ADR 0009 as written today.

For Milestone 1, the 1 MiB framing, handshake, basic correlation, malformed/oversized rejection, synthetic recovery paths, and preservation of completed evidence are **proven only in this harness**. Cancellation, duplicate/late-message safety, and retry are **partially proven**. No harness assertion failed in the final run. Side-effecting duplicate request delivery, actual disk-full and SQLite commit durability, old-worker fencing, concurrent project access, large-data recovery, and production Windows resource behavior are **untested**. The architecture can continue toward those proofs and review, but the recovery gate for beginning Milestone 1 is not yet met.
