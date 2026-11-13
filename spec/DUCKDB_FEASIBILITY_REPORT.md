# DuckDB read-only SQL feasibility report

**Status:** Experimental evidence, 2026-11-12. **Verdict:** Conditionally feasible for a narrow SQL subset; not yet a proven production security boundary. ADR 0005 remains proposed. No Milestone 1 implementation was started.

**Scope decision, 2026-11-13:** The CLI observations below remain unchanged. Milestone 1 will use bounded previews and application-defined query templates; it will not expose general user- or agent-supplied SQL. The parser and CLI behavior below were tested only through this experiment. Embedded Python DuckDB behavior, persistent-worker cancellation, and resource guarantees have not been tested. See ADR 0005 for the proposed phased policy.

## Environment and pinned build

- Windows registry reported `CoreSingleLanguage`, display version `26H2`, build `26300.9974`; its legacy `ProductName` value said Windows 10 Home Single Language. The build and edition should be verified on the intended support matrix before generalizing results.
- PowerShell 7.6.9; Node.js 24.16.0. The available machine reported 15.44 GiB physical memory, consistent with a 16 GB class device. No Python or DuckDB executable was initially available on PATH; Python was not used.
- Official DuckDB Windows amd64 CLI **v1.4.2 (Andium), 68d7555f68**; ZIP SHA-256 `2A31D67CF54AEC3494FB331147EDDDFEE1CD7F3FADCB5B84056F9BC28CF76576`. This pinned release was chosen for a reproducible native Windows CLI experiment; it is not a production version decision.
- No separate parser dependency. The harness uses DuckDB's [`json_serialize_sql`](https://duckdb.org/docs/current/data/json/sql_to_and_from_json) to inspect a parsed AST, then applies a conservative allowlist. AST format and completeness must be assessed again for any upgrade.

## Experimental execution boundary

The app-owned setup creates four registered relations from synthetic data. The single query entry point rejects SQL above 8 KiB, requires one `SELECT_NODE`, walks table references/functions, and allows only registered relations and named CTEs. It denies unknown table sources and functions. It then runs the accepted SQL in a separate DuckDB CLI process with `-readonly`, `enable_external_access=false`, extension auto-install/auto-load and community extensions disabled, and locked configuration. Results are wrapped with a 101-row fetch limit, then rejected above 100 rows or 64 KiB. The process has a 2.5-second wall timeout (1 second for the cross-join probe). Settings of 128 MB DuckDB memory, 32 MB temporary storage, and two threads are experimental values, not recommended production defaults.

This is a parser-based proof candidate, not a complete SQL verifier. In particular, the AST walker has not been fuzzed, DuckDB's AST schema is not treated as a stable security API, and process settings do not isolate a compromised native engine from the OS. The SQL wrapper limits returned rows, not intermediate computation. DuckDB documents that `memory_limit` applies to its buffer manager rather than all process allocations [DuckDB limits](https://duckdb.org/docs/current/operations_manual/limits).

## Observed results

The reproducible raw outcomes are in `../experiments/duckdb-sql-boundary/results.json` (generated locally by the harness; not committed).

| Category | Result |
|---|---|
| Ordinary SQL | **Passed:** 8 queries: registered SELECT, aggregation, filter/sort, join, CTE, subquery, window function, NULL and unusual column name. Execution times were about 55–70 ms per fresh CLI process on this machine. |
| Modification | **Passed for tested inputs:** INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, COPY, ATTACH, DETACH rejected by the parser policy. |
| External access | **Passed for tested inputs:** `read_csv`, `read_parquet`, `glob`, `read_text`, `read_blob`, unregistered relation, and HTTP-backed CSV denied before execution. A direct DuckDB probe with external access disabled also denied file reading. |
| Configuration/extensions | **Passed for tested inputs:** INSTALL, LOAD, SET, RESET, PRAGMA, environment-setting function, multiple statements, and unknown function denied. |
| Output limits | **Passed for tested inputs:** 200,000-row query hit row cap; 100 wide rows hit 64 KiB byte cap; a large sort hit row cap after computation. |
| Time/cancellation | **Partial:** 200,000 × 200,000 cross-join count was terminated by process timeout at 1,013 ms; expensive cross-join aggregation at 2,515 ms. A subsequent query succeeded in 67 ms. A separate PowerShell monitor terminated the same cross-join at 1,049 ms and sampled a 21,483,520-byte peak working set for that process. This tests process termination, not DuckDB in-process cancellation or reliable cleanup of a persistent worker. |
| Source/representation integrity | **Passed for tested run:** SHA-256 of synthetic source CSV and the DuckDB representation file were unchanged before/after submitted queries. No implicit refresh occurred. A direct `COPY` probe under disabled external access was denied. |
| Errors and malformed input | **Partial:** malformed SQL and oversized input were rejected; DuckDB permission errors were recorded without row values. Worker crash during a durable operation and disk-full behavior were not tested. |

Across 39 submitted cases: 8 succeeded, 26 were policy-rejected, 2 exceeded result limits, and 2 timed out. One additional case exceeded the byte limit. No successful external-access or modification bypass was observed in this matrix. This is not evidence that no bypass exists.

## Resource measurements and limits

Measured wall times and output-cap behavior appear above and in `results.json`. One cross-join process had a sampled peak working set of 21,483,520 bytes before termination on a 15.44 GiB machine. This is one observation, not a maximum over all query shapes. The configured DuckDB memory and temporary-storage limits were accepted, but actual peak memory for the full matrix, temporary disk use, and OS-enforced caps were **not measured**. Thus the run cannot justify production defaults even for 16 GB hardware. The output cap is application-enforced; the timeout is process termination through Node or PowerShell; `memory_limit`, `max_temp_directory_size`, and `threads` are DuckDB settings. No Windows Job Object or filesystem/network OS boundary was tested.

## Recommendation for ADR 0005 and Milestone 1

**Accept ADR 0005 only with specific amendments after further proof:** require a pinned, reviewed SQL AST policy and regression corpus; enforce the same catalog/function checks through nested queries; keep external access and extension loading disabled; and require a disposable or safely interruptible query execution context with measured OS resource limits. The present CLI harness demonstrates a plausible restricted subset but does not justify claiming secure general read-only SQL.

Proven for this build and harness: ordinary listed SQL constructs, tested statement/resource denials, external-read and `COPY` denials with external access disabled, and unchanged synthetic source/representation hashes. Partially proven: wall-time termination, one process-memory observation, and bounded result transfer. Blocked or unverified: exhaustive parser coverage, in-process cancellation, persistent-worker crash recovery, worst-case process memory/temporary disk bounds, disk-full handling, and Windows-level containment. The spike therefore does **not** meet every requested acceptance criterion yet. The bounded-preview and application-defined-template option identified by the experiment is now the Milestone 1 scope; general SQL remains a separate future gate.
