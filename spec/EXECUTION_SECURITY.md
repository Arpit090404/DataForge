# Execution security

**Status:** Requirements only; this document does not assert controls are implemented.

Proposed ADRs 0005–0008 define the initial SQL, agent, disclosure, and Python boundaries. None is verified by implementation tests. Arbitrary generated Python is deferred from the initial release.

## Threat model
Treat generated Python/SQL, imported files, tool arguments, and artifact metadata as untrusted. Protect credentials and project boundaries. Assume accidental over-approval is possible.

## Trusted worker boundary
The analytics worker runs application-owned, reviewed Python code for ingestion, parsing, profiling, statistics, and DuckDB operations. It does not run agent/user Python. Input files remain untrusted; parsers and native libraries can crash, exhaust resources, or be vulnerable to compromise. The worker is supervised with bounded inputs, resource controls, and cancellation, but an ordinary subprocess or Job Object does not isolate its filesystem or network rights. Host-side path authorization and a minimal environment reduce exposure without containing a compromised parser. Proposed restricted tokens, AppContainer, ACLs, or network controls remain unverified until demonstrated on supported Windows configurations. Do not describe the trusted worker as sandboxed.

## Objectives
Preserve source data; restrict execution to approved resources; prevent secret leakage; make network access explicit; bound CPU, memory, time, output, and disk; require approval for destructive operations; enforce permissions in host/runtime.

## Permission categories
Reading registered datasets/artifacts; writing derived artifacts; SQL execution; future arbitrary Python execution; remote DB access; network access; modifying/deleting source data; exporting reports. Default to read-only source access and project-scoped derived output.

## Isolation
A process boundary is not a security sandbox. ADR 0008 compares Windows restricted tokens, AppContainer, Job Objects, and Windows Sandbox and proposes deferring arbitrary Python. Job Objects help manage lifetime/resources but do not alone isolate filesystem or network. Document actual guarantees before adding executable code support.

## Filesystem
Grant only approved project/input paths. Canonicalize paths and defend against traversal and reparse-point escapes. Do not trust agent path strings. Keep temporary directories separate. Do not expose home directories, browser profiles, SSH keys, or unrelated files. Prefer host-mediated artifact writes.

## Network
Default analytics operations must not use network features. Remote database access is explicit and separate. Without tested OS controls, this is application policy, not a guarantee that a compromised trusted worker cannot reach the network. Arbitrary generated Python remains deferred. Disclose when provider/remote connections require data to leave the device.

## Secrets
Use OS secure storage. Separate credential references from metadata. Redact secrets from logs, prompts, artifacts, and crash reports. Do not pass all host environment variables to generated code or put secrets in command-line arguments.

## Resource controls
Set configurable wall-time, memory/CPU/process, output, temporary disk, query-row, and concurrency limits. Cancellation must terminate or safely interrupt relevant child processes.

## Approval UX
Show action, files/datasets/connections, read/write effects, network use, output location, and reversibility. Avoid vague approval prompts.

## Release gate
Do not advertise Python execution as sandboxed until filesystem, network, process, and resource boundaries are tested on supported Windows versions.
