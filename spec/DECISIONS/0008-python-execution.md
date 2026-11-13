# ADR 0008: Defer arbitrary generated Python

- Status: Proposed for architecture approval.
- Date: 2026-11-12

## Decision

Trusted ingestion, profiling, statistics, and DuckDB operations run in the supervised analytics worker. Arbitrary agent-generated or user-supplied Python is deferred from the initial release. The UI and MCP tool catalog must not advertise `execute_python` until an approved isolation design passes tests. The Notebook can show application-defined analytical executions and trusted operation results without Python execution.

"Trusted" describes the application-owned code path, not the input files or an OS sandbox. Parsers and native analytics libraries process untrusted files inside the worker; compromise would have the worker's effective OS access unless separate restrictions are proven. Job Objects and subprocess supervision alone do not restrict filesystem or network access.

If the agent asks for Python directly or calls an obsolete/unknown `execute_python` tool, DataForge returns an explicit unsupported-capability response and supported alternatives. It does not execute the code through the ACP shell or trusted worker. Record the rejected request as an agent event, not a successful execution.

## Windows options evaluated

| Option | Filesystem/network boundary | Process/resources | Product fit |
|---|---|---|---|
| Ordinary subprocess plus Job Object | Inherits user's filesystem/network rights; no isolation | Job Object can constrain/terminate process tree and some resources | Insufficient alone |
| Restricted token plus ACLs, optionally AppContainer/LPAC | Potentially enforceable file and network limits, but packaging, Python imports, temp paths, and capability grants require engineering and tests | Job Object still needed for resource/lifetime control | Candidate future design, unverified |
| Windows Sandbox | VM-backed boundary; networking can be disabled and host folders mapped read-only, but defaults must be overridden | Disposable; startup and automation cost; unavailable on Windows Home; single-instance limit | Poor default for broad Windows-first release |

The future proof must cover file reads/writes including reparse points, outbound network, child processes, environment/credential access, memory/CPU/disk limits, cancellation, cleanup, and supported Windows versions. Fail closed when isolation cannot start. Even a tested sandbox cannot make generated analysis correct; provenance and review still apply.

## Sources

- https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation
- https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file
- https://learn.microsoft.com/en-us/windows/security/threat-protection/windows-sandbox/windows-sandbox-overview
