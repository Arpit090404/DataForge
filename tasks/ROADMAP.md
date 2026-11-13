# DataForge roadmap

**Status:** Proposed sequence; no arbitrary dates.

## Milestone 0 — Repository foundation
Instructions, specifications, ADRs, and Codex subagents. No product functionality.

## Architecture approval and proof gates

P0 means initial-release scope across Milestones 1–3, not Milestone 1 scope. Milestone 1 is local-only and has no ACP dependency.

Before the **full** Milestone 1 analytics/worker scope: review proposed ADRs 0005–0009 and the IPC/data-registration contracts; prove that application-defined templates reject injected SQL/identifiers and enforce registered representations and limits; prove worker/IPC lifecycle and host-owned storage/recovery behavior, including a surviving out-of-job process denied authoritative writes and concurrent-host exclusion; decide supported Windows/filesystem versions and required local worker controls. The worker-fencing spike did not satisfy this gate; complete the prepared `STORAGE_OWNERSHIP_SPIKE_PLAN.md` and approve the resulting design first. General submitted SQL is deferred. A user-authorized local CSV-only vertical slice may proceed without the worker, ACP, or DuckDB; it does not satisfy those remaining gates.

A later user-directed Rust-hosted CSV/DuckDB analytics slice is implemented under the same local-only trust model. It does not satisfy the full worker, storage-ownership, and recovery gates. The repository's canonical Milestone 2 remains Codex integration; the analytics slice does not start it.

Before Milestone 2 begins: prove actual Codex/ACP adapter compatibility, shell/file capability enforcement including required Windows controls, provider disclosure, and MCP authorization. Failed proof blocks agent integration, not local-only Milestone 1 functionality.

## Milestone 1 — Desktop foundation
Tauri/React shell, visual system, project persistence, source registration, bounded file inspection, and application-defined analytical operations backed by DuckDB. No general submitted SQL.

## Milestone 2 — Agent integration
Codex ACP lifecycle, diagnostics, sessions, streaming, MCP analytics tools, and permission mediation.

## Milestone 3 — Agentic analytics
Investigation planning, application-defined analytical operations and trusted analytics, notebook inspection, visualization, evidence-linked findings, and HTML reports. General submitted SQL and arbitrary Python remain deferred pending separate security approval.

Advance only when acceptance criteria and tests pass. Security claims require demonstrated controls.
