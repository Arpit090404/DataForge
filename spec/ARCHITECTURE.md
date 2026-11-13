# System architecture

**Status:** Draft baseline. ADRs 0005–0009 and the IPC/data-registration contracts are proposed and require architecture approval before implementation.

## Goals
Separate desktop shell, agent provider, analytics runtime, and persistence. Keep application state independent of Codex. Use typed/versioned communication. Support cancellation, recovery, and observable failure. Avoid unnecessary local network listeners.

## Components
- **React/TypeScript frontend:** rendering, navigation, transient interaction state, accessibility. No arbitrary filesystem access or authoritative persistence.
- **Tauri/Rust host:** lifecycle, exclusive project ownership, authoritative SQLite/DuckDB/artifact writes, IPC routing, process supervision, permissions, secure credential integration, metadata persistence. Host-side DuckDB integration is proposed, not selected or proved.
- **Agent adapter:** ACP/provider communication, capability negotiation, session lifecycle, event translation, cancellation.
- **Python worker:** trusted application-owned parsing, profiling, statistics, and result shaping on brokered inputs. It returns bounded data through IPC and has no direct authoritative project write access. The host executes fixed DuckDB templates and commits representations/artifacts. General submitted SQL and arbitrary generated Python are deferred.
- **Persistence:** SQLite metadata; DuckDB analytical data; filesystem for large artifacts.

## Process topology
Initially one desktop process, one supervised Python worker, and the ACP adapter/provider process as required. Do not assume one worker per investigation. Establish concurrency after profiling.

## Communication
Frontend to Rust through Tauri commands/events. Proposed Rust-to-Python framing and lifecycle are in `IPC_PROTOCOL.md`; conformance remains unverified. Agent communication uses ACP. Application tools may use MCP only after verifying actual client/adapter support. Agent shell/file capabilities require their own restriction beyond MCP validation (ADR 0006).

Every contract defines version, correlation ID, error shape, cancellation, maximum payload, and compatibility behavior.

## State ownership
DataForge's Rust host owns all authoritative project mutations; SQLite owns the authoritative identities and journal, and a host-owned DuckDB connection owns versioned analytical representations created on demand. Original external files remain in the user filesystem; optional managed imports belong to the project. The worker receives brokered input and cannot publish or directly write project storage. This separation requires a tested Windows token/ACL boundary, not merely IPC validation; see `STORAGE_OWNERSHIP_DESIGN.md`. ACP conversation history belongs to the provider and is supplementary; it cannot replace the application's analytical record. View state is transient frontend state.

## Event flow
User objective -> host validation and disclosure policy -> ACP session -> agent proposes/invokes tool -> host permission/scope validation -> brokered trusted-worker computation and/or host-owned DuckDB template -> host validates and commits execution/artifacts -> return bounded result -> UI; only separately authorized content enters agent context.

## Failure handling
Agent exit: reopen the investigation from app-owned records, preserve completed evidence, mark pending agent work disconnected/interrupted, and offer reconnect only if supported. Local inspection remains usable. Worker or app crash: first acquire exclusive project ownership and verify that old worker identities cannot write authoritative storage; then reconcile the durable SQLite operation journal against host-owned DuckDB representations and private staged/promoted files before new work. If ownership/access exclusion cannot be established, block recovery. Unpublished outputs remain unavailable and uncertain work is not silently marked successful. IPC timeout: use correlation/idempotency and do not assume no execution occurred. Disk full: fail artifact write safely. Invalid chart payload: reject; never execute arbitrary agent HTML/JS. Unsupported capabilities are explicitly denied without alternate execution. See ADR 0009 for orphan and late-response rules.

## Dependency direction
Frontend -> host contracts. Host -> domain services, authoritative persistence, ACP adapter, analytics worker. Analytics worker -> parsing/statistical libraries and bounded IPC only; no authoritative SQLite, DuckDB, artifact, or managed-source write API. The Windows access boundary remains unproved.

## Constraints
No unrestricted localhost server by default. No direct frontend arbitrary filesystem access. No provider-specific fields in generic domain objects except scoped metadata. No arbitrary executable frontend payloads. No sandbox claims without tested OS controls.
