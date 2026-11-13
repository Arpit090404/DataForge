# System architecture

**Status:** Draft baseline. ADRs 0005–0009 and the IPC/data-registration contracts remain proposed. A user-directed Rust-hosted CSV/DuckDB slice is implemented; it does not satisfy the full worker/recovery proof gates.

## Goals
Separate desktop shell, agent provider, analytics runtime, and persistence. Keep application state independent of Codex. Use typed/versioned communication. Support cancellation, recovery, and observable failure. Avoid unnecessary local network listeners.

## Components
- **React/TypeScript frontend:** rendering, navigation, transient interaction state, accessibility. No arbitrary filesystem access or authoritative persistence.
- **Tauri/Rust host:** lifecycle, SQLite metadata, registered CSV inspection, and embedded DuckDB 1.4.5 analytical representations and structured operations in the current slice. Exclusive project ownership, artifact recovery, IPC routing, process supervision, permissions, and credential integration remain planned.
- **Agent adapter:** ACP/provider communication, capability negotiation, session lifecycle, event translation, cancellation.
- **Python worker:** trusted application-owned parsing, profiling, statistics, and result shaping on brokered inputs. It returns bounded data through IPC and has no direct authoritative project write access. The host executes fixed DuckDB templates and commits representations/artifacts. General submitted SQL and arbitrary generated Python are deferred.
- **Persistence:** SQLite metadata; DuckDB analytical data; filesystem for large artifacts.

## Process topology
The implemented local analytics path uses one desktop process and no Python worker or ACP adapter. The proposed later topology adds a supervised Python worker and the ACP adapter/provider process as required. Do not assume one worker per investigation. Establish concurrency after profiling.

## Communication
Frontend to Rust through Tauri commands/events. Proposed Rust-to-Python framing and lifecycle are in `IPC_PROTOCOL.md`; conformance remains unverified. Agent communication uses ACP. Application tools may use MCP only after verifying actual client/adapter support. Agent shell/file capabilities require their own restriction beyond MCP validation (ADR 0006).

Every contract defines version, correlation ID, error shape, cancellation, maximum payload, and compatibility behavior.

## State ownership
In the current local slice, the Rust host owns SQLite metadata, including notebooks and their blocks, and DuckDB representation writes; original external CSV files remain in the user filesystem. Notebook result replay reads the recorded representation without creating another execution. There is no worker or ACP process. The proposed full architecture adds an authoritative journal, managed imports, and a worker that receives brokered input without project write access. That separation requires a tested Windows token/ACL boundary, not merely IPC validation; see `STORAGE_OWNERSHIP_DESIGN.md`. ACP conversation history would be supplementary, not the application's analytical record. View state is transient frontend state.

## Event flow
User objective -> host validation and disclosure policy -> ACP session -> agent proposes/invokes tool -> host permission/scope validation -> brokered trusted-worker computation and/or host-owned DuckDB template -> host validates and commits execution/artifacts -> return bounded result -> UI; only separately authorized content enters agent context.

## Failure handling
Current local recovery marks SQLite executions left `running` as `interrupted` when a project opens; it does not reconcile orphaned DuckDB tables or provide exclusive concurrent-host ownership. The proposed full architecture handles agent exit by reopening app-owned investigation records, and handles worker/app crashes by proving storage access exclusion before journal reconciliation. If ownership/access exclusion cannot be established, recovery must block. IPC timeout, disk-full artifact handling, invalid charts, and unsupported agent capabilities remain specified in ADR 0009 and related contracts, not implemented by this slice.

## Dependency direction
Frontend -> host contracts. Host -> domain services, authoritative persistence, ACP adapter, analytics worker. Analytics worker -> parsing/statistical libraries and bounded IPC only; no authoritative SQLite, DuckDB, artifact, or managed-source write API. The Windows access boundary remains unproved.

## Constraints
No unrestricted localhost server by default. No direct frontend arbitrary filesystem access. No provider-specific fields in generic domain objects except scoped metadata. No arbitrary executable frontend payloads. No sandbox claims without tested OS controls.
