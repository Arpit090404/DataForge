# ADR 0005: Registered data and SQL boundary

- Status: Proposed for architecture approval; enforcement unverified.
- Date: 2026-11-12

## Phased recommendation after the DuckDB CLI spike

Milestone 1 does not accept user- or agent-supplied SQL. It exposes bounded previews and application-defined analytical operations/query templates only. The host selects a fixed, versioned template and registered analytical representation IDs; callers provide typed values, never SQL fragments, identifiers, file paths, or function names. Validate parameters against the template schema and bind values through DuckDB parameters. Resolve representation IDs through the host catalog and apply row, byte, time, memory/concurrency, and temporary-storage limits. Record the template/version, parameter values or protected references, representation/source fingerprints, engine/materializer versions, result limits, timing, status, and output hashes. Original sources remain immutable. This is a scope adjustment: DuckDB still performs local analytical queries, but the exposed language is the application's bounded operation set.

General read-only SQL is a future capability, not a Milestone 1 fallback. Revisit it only after testing the actual embedded Python DuckDB runtime and enforcement architecture, including parser coverage, external access, resource controls, cancellation, and crash recovery. The CLI v1.4.2 spike in `../DUCKDB_FEASIBILITY_REPORT.md` is supporting evidence, not proof for the embedded runtime.

## Decision

Rust owns a catalog of dataset IDs and immutable registrations. External references remain at their original location; optional managed imports are project-owned immutable copies. Neither mode automatically creates a DuckDB copy. Trusted ingestion materializes a versioned DuckDB analytical representation on demand for an application-defined operation, subject to space limits, and reuses it for the same verified source version. If materialization is impractical, bounded inspection remains available and representation-backed operations are unavailable for that dataset. Templates use app-created relations in a pinned representation; future general SQL would use the same catalog boundary. Source changes mark external registrations stale or missing; refresh is explicit and never rewrites evidence from prior executions. See DATA_REGISTRATION for identity, fingerprint, refresh, and retention semantics.

Representation provenance includes the source fingerprint, representation ID/hash, DuckDB version, materializer implementation version, output schema version/fingerprint, and effective parsing/transformation configuration. Upgrades create a new representation if these inputs change; prior executions retain their original version references.

For a future general-SQL capability, the proposed policy is one parsed, read-only query statement (`SELECT`, including CTEs and read-only set operations). Reject all other statement classes, multiple statements, table functions that access external resources, and references outside the registered catalog. Use DuckDB's parser/binder or an AST-aware equivalent plus an allowlist of resolved relations/functions; string matching is insufficient. Query connections open the analytical database read-only, disable external access, extension auto-install/auto-load and community extensions, and lock configuration after setup where supported. The exact settings and their interactions must be verified against the pinned embedded DuckDB version. No `INSTALL`, `LOAD`, `ATTACH`, `COPY`, `CREATE`, `UPDATE`, `DELETE`, `PRAGMA`, `SET`, or filesystem/URL-reading functions are user SQL capabilities.

The host applies wall-time, memory, thread, concurrency, row, byte, and spill limits. Fetch results incrementally and stop at the configured cap; a textual `LIMIT` is not a resource control. Cancellation first requests query interruption, then terminates/restarts the worker if it does not stop by a deadline. A timed-out query is marked uncertain until worker termination is confirmed. Generated artifacts use separate trusted operations.

## Proof gates

For Milestone 1, prove that callers cannot submit SQL or inject identifiers/fragments through template parameters; only registered representations are bound; output and execution limits hold; and original source hashes are unchanged. For a later general-SQL gate, test ordinary joins/aggregates and adversarial SQL: multiple statements, DDL/DML, `COPY`, `ATTACH`, `INSTALL`/`LOAD`, external scans, path traversal, URLs, setting changes, oversized results, expensive queries, cancellation, and source file hash before/after. Include attempts through views, CTEs, and table functions. Verify external access and extension settings on the exact embedded DuckDB build. Do not expose general SQL if the policy cannot be enforced.

## Rationale and limits

Read-only database opening does not alone prevent reading unrelated host files. DuckDB configuration is defense in depth, not an OS sandbox. Source parsing itself remains trusted code handling untrusted files and needs resource limits.

## Sources

- https://duckdb.org/docs/stable/configuration/overview
- https://duckdb.org/docs/current/operations_manual/securing_duckdb/securing_extensions
