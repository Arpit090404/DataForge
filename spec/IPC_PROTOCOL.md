# Rust–Python IPC protocol

**Status:** Proposed contract for architecture review; no implementation or conformance proof exists. Owner: Rust host. Peer: supervised trusted Python analytics worker. Arbitrary Python never runs through this worker.

## Transport and framing

One child process, stdin/stdout pipes, no listener. Each frame is a 4-byte unsigned big-endian byte length followed by that many UTF-8 JSON bytes. Reject zero length, malformed JSON/UTF-8, duplicate object keys, and frames above a configured hard cap (initial proof target: 1 MiB). Stderr carries bounded, redacted diagnostics only. The host limits buffered bytes and never waits synchronously on the UI thread.

On start, the worker sends `hello` with supported major/minor versions and capabilities. Host selects a compatible version or terminates it. Major mismatch fails closed; optional minor fields are ignored only when explicitly documented. Every envelope has `version`, `kind`, `request_id` (UUID for request/response/cancel), `worker_generation`, and `payload`; side-effecting requests also carry `operation_id` and `idempotency_key`. Responses carry `ok` or `error` with stable code, safe message, retryability, and optional diagnostic ID. No secrets or raw dataset rows in errors.

## Operations and authorization

Rust validates project/investigation/dataset IDs and permissions before dispatch. Worker validates message shapes and resolves only host-created catalog IDs. Initial operations: inspect schema, bounded preview, materialize or refresh an analytical representation on explicit request, and run an application-defined, versioned analytical template against a pinned representation using validated, bound values. Registration and source-version decisions remain host-owned. No caller-supplied SQL text, identifiers, path, or arbitrary Python operation. Unknown operations return `unsupported_capability` without side effects. Large results become staged artifacts with a relative path, size, hash, media type, and schema version; Rust verifies and promotes them before metadata commit.

## Lifecycle

Request IDs correlate out-of-order responses. Every side-effecting request carries a durable operation ID and idempotency key assigned by Rust before dispatch; the worker uses operation-scoped output names and must not publish metadata. Repeating an operation ID is permitted only when reconciliation has established that the operation is retryable and its prior effects are known; otherwise start a new attempt after user-visible interruption. `cancel` references the original request ID and receives an acknowledgement, but completion may race. Rust records the terminal result once. Each request has a deadline; on expiry, ask the worker to cancel, then terminate its process tree after a bounded grace period and mark the execution interrupted/uncertain. Do not equate a timeout or broken pipe with proof that no side effect occurred. On restart, fence the old worker, increment a worker generation, reconcile the SQLite journal with DuckDB and app-owned files, then handshake before accepting new work. A response from an old generation, unknown operation, or terminal request is ignored and cannot publish output. Limit concurrent work initially to one execution per worker until measured and tested.

## Conformance proof

Round-trip and fault tests: partial/truncated frames, oversized payload, duplicate/unknown IDs, out-of-order and late responses across generations, malformed fields, protocol mismatch, cancellation races, blocked worker, worker crash at every journal/output phase, disk full, and stderr flooding. Verify orphan quarantine/cleanup is repeatable and no duplicate artifact is published.
