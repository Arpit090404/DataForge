# Milestone 1 — Desktop foundation

## Goal
A Windows desktop shell where users create projects, register local files, inspect datasets, and use bounded application-defined analytical operations without an agent.

## Scope
Initialize Tauri 2/React/TypeScript; implement approved layout and design tokens; project persistence; register CSV/XLSX/Parquet/JSON; bounded inspection and application-defined DuckDB query templates; explicit empty/loading/error states; logging/diagnostics. No SQL text entry point.

## Dependencies
Architecture approval of ADRs 0005–0009; template boundary, worker/IPC lifecycle, and storage/recovery proofs; supported Windows compatibility decision; selected local toolchain/dependency versions; project storage layout and initial migration. General-SQL and ACP proofs are later gates, not Milestone 1 dependencies.

## Acceptance
1. App launches on supported Windows dev environment.
2. User creates and reopens project after restart.
3. User registers supported file without modifying original.
4. User inspects schema and bounded preview.
5. User selects a supported application-defined analytical operation over a registered, version-pinned representation and inspects bounded results. Typed template parameters are validated and bound as values; SQL text, identifiers, functions, and paths cannot be supplied by the caller. Tests show attempts to inject SQL or access an unregistered representation are denied. Materialization obeys a space quota; datasets exceeding it retain bounded inspection.
6. UI remains responsive during data work.
7. Chat/Notebook/Dashboard share one investigation state model, even if views are initially empty.
8. Inspector collapses and panels resize where supported.
9. Errors are actionable.
10. Restart preserves completed state, marks uncertain work interrupted, and never silently retries it.
11. IPC framing, oversized input, cancellation, worker crash, and recovery pass Windows integration tests.
12. Every analytical operation records its template/version, validated parameter values or protected references, representation/source fingerprint, engine/materializer versions, limits, status, timing, and output hashes. Row, byte, and execution limits are tested, and source hashes remain unchanged.

## Tests
Frontend navigation/components; Rust persistence/path validation; file parsing and DuckDB fixtures; Windows smoke test; basic memory/latency benchmark with hardware and dataset documented.

## Exclusions
General user- or agent-supplied SQL, ACP, agent-generated Python, remote DB connectors, multi-agent orchestration, final report generation.
