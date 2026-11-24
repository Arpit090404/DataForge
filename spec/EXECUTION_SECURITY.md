# Execution security

**Status:** Requirements baseline. Typed analytics and explicit trusted-user Notebook SQL are implemented; autonomous SQL, Python and OS-confined execution remain unavailable.

## Trusted Notebook SQL boundary

The explicit Notebook Run action accepts saved SQL Code cells and executes their query in a short-lived child of the desktop executable. The Rust host owns registered-source resolution, materialization, SQLite execution history, and acceptance of bounded output. The query child opens the analytical DuckDB database read-only with external access and extension autoload disabled. It has the same Windows user privileges as the host. Direct-child termination handles cancellation, deadline and native crash without treating a subprocess as a sandbox. It does not confine filesystem/network access or descendants, and does not impose hard CPU, memory or scratch quotas. Only user-initiated trusted SQL uses this path; agent SQL and Python remain disabled.

## Current local analytics boundary

The typed analytics command accepts structured operations against a registered CSV ID, validates columns/operators, binds filter values, and constructs SQL only from application-owned expressions and generated physical names. DuckDB external access and extension autoload are disabled for these connections. The host limits source input to 64 MiB/250,000 rows, result pages to 200 rows/1 MiB, and one operation at a time, with best-effort 30-second interruption and user cancellation. These are application and DuckDB controls within the user's process identity, not filesystem/network isolation or a hard process resource boundary. The persistent DuckDB database is not subject to a proved disk quota; concurrent-host ownership and cross-store orphan recovery are not yet implemented. No Python worker or generated code runs in this slice.

Proposed ADRs 0005â€“0008 define the initial SQL, agent, disclosure, and Python boundaries. None is verified by implementation tests. Arbitrary generated Python is deferred from the initial release.

## Threat model
Treat generated Python/SQL, imported files, tool arguments, and artifact metadata as untrusted. Protect credentials and project boundaries. Assume accidental over-approval is possible.

## Trusted worker boundary
The analytics worker runs application-owned, reviewed Python code for parsing, profiling, statistics, and result shaping. It does not run agent/user Python or own authoritative DuckDB/SQLite/artifact writes under the proposed ADR 0009 amendment. Input files remain untrusted; parsers and native libraries can crash, exhaust resources, or be vulnerable to compromise. The host brokers approved input and owns project mutations. A process with the same unrestricted user identity can still open project files by path, so IPC discipline, a minimal environment, and a Job Object do not enforce this boundary. AppContainer or restricted-token/ACL enforcement, including out-of-job descendants and inherited handles, remains unverified until the [storage-ownership spike](STORAGE_OWNERSHIP_SPIKE_PLAN.md) passes on supported configurations. Do not describe the worker as sandboxed.

## Objectives
Preserve source data; restrict execution to approved resources; prevent secret leakage; make network access explicit; bound CPU, memory, time, output, and disk; require approval for destructive operations; enforce permissions in host/runtime.

## Permission categories
Reading registered datasets/artifacts; writing derived artifacts; SQL execution; future arbitrary Python execution; remote DB access; network access; modifying/deleting source data; exporting reports. Default to read-only source access and project-scoped derived output.

## Isolation
A process boundary is not a security sandbox. ADR 0008 compares Windows restricted tokens, AppContainer, Job Objects, and Windows Sandbox and proposes deferring arbitrary Python. Job Objects help manage lifetime/resources but do not alone isolate filesystem or network. Document actual guarantees before adding executable code support.

## Filesystem
The host alone opens approved source/project paths and writes authoritative storage; broker input bytes to the worker and receive bounded output through IPC. Canonicalize paths and defend against traversal, reparse points, hard links, and swapped directory/file identities. Do not trust agent or worker path strings. Keep worker scratch outside the project authority tree; never promote a worker-writable file by rename. Do not expose home directories, browser profiles, SSH keys, or unrelated files. The OS must deny the worker and any escaped process project write access and writable-handle inheritance; this is a release gate, not an implemented guarantee.

## Network
Default analytics operations must not use network features. Remote database access is explicit and separate. Without tested OS controls, this is application policy, not a guarantee that a compromised trusted worker cannot reach the network or unrelated user files. The proposed AppContainer worker would receive no network capability, but actual Python/broker behavior must be tested. Arbitrary generated Python remains deferred. Disclose when provider/remote connections require data to leave the device.

## Secrets
Use OS secure storage. Separate credential references from metadata. Redact secrets from logs, prompts, artifacts, and crash reports. Do not pass all host environment variables to generated code or put secrets in command-line arguments.

## Resource controls
Set configurable wall-time, memory/CPU/process, output, temporary disk, query-row, and concurrency limits. Cancellation must terminate or safely interrupt relevant child processes.

## Approval UX
Show action, files/datasets/connections, read/write effects, network use, output location, and reversibility. Avoid vague approval prompts.

## Release gate
Do not advertise Python execution as sandboxed until filesystem, network, process, and resource boundaries are tested on supported Windows versions. Do not start storage reconciliation if exclusive host ownership or the worker's lack of authoritative write rights is unproved or fails; Job membership alone does not satisfy this condition.
