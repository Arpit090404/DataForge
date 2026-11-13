# Requirements

**Status:** Draft. P0 = initial-release scope across planned Milestones 1–3, not a requirement for Milestone 1. P1 = follow-up after that release. Each milestone defines when its P0 features enter scope.

## Projects
- FR-001 (P0): Create, open, rename, and close local projects.
- FR-002 (P0): Persist project metadata across restarts.
- FR-003 (P0): Track project sources and artifacts.
- FR-004 (P1): Archive/delete projects with explicit confirmation.

## Data sources
- FR-010 (P0): Register supported local files.
- FR-011 (P0): Inspect schema, bounded preview, and profiling.
- FR-012 (P0): Preserve original source files by default.
- FR-013 (P1): Register a supported remote database.
- FR-014 (P1): Store credentials in an OS-appropriate secure store, not plain metadata.
- FR-015 (P0): Removing a registration does not silently delete the original file.

## Investigations
- FR-020 (P0): Create, rename, and reopen investigations.
- FR-021 (P0): Persist objective, plan, status, executions, findings, and artifacts.
- FR-022 (P0): Chat, Notebook, and Dashboard share investigation state.
- FR-023 (P0): Surface agent activity and execution status.
- FR-024 (P0): Cancel active agent turns and analytics executions.
- FR-025 (P0): Recover completed state and clearly mark interrupted or uncertain work after restart; do not silently retry non-idempotent work.

## Agent
- FR-030 (P0): Integrate Codex through a documented ACP-compatible adapter.
- FR-031 (P0): Diagnose missing/incompatible agent components.
- FR-032 (P0): Delegate authentication to provider-supported flow.
- FR-033 (P0): Surface ACP events and permission requests.
- FR-034 (P0): Isolate provider-specific behavior.
- FR-036 (P0, Milestone 2): Block Codex agent turns with project access when the tested adapter version, required shell/file boundary, Windows enforcement, or capability negotiation is unavailable; never downgrade to unrestricted execution. Local-only work remains available.
- FR-035 (P1): Allow additional ACP providers without changing domain model.

## Analytics
- FR-040 (P0): Preview data without loading all rows into frontend.
- FR-041 (P0): Run bounded, application-defined analytical operations/query templates against registered, version-pinned representations with validated, parameterized values. General submitted SQL is deferred pending separate security validation.
- FR-042 (Deferred): Execute arbitrary user/agent Python only after a separately approved and tested Windows isolation design. Trusted built-in analytics operations remain in scope.
- FR-043 (P0): Record execution inputs, outputs, status, timing, and errors.
- FR-044 (P0): Enforce timeouts and cancellation.
- FR-045 (P0): Return bounded structured results.
- FR-046 (P0): Register generated outputs as artifacts.
- FR-047 (P0, staged): Provide bounded profiling and selected trusted statistical tools needed by the initial investigation workflow; additional routines are P1.

## Visualization and findings
- FR-050 (P0): Render validated chart specifications.
- FR-051 (P0): Inspect chart data and source artifact.
- FR-052 (P0): Link findings to execution/artifact evidence.
- FR-053 (P1): Edit supported chart configuration.
- FR-054 (P0, Milestone 3): Export an HTML investigation report using verified artifacts and evidence links.

## Non-functional
- NFR-001: Long-running work never blocks UI thread.
- NFR-002: Worker/agent failures are visible and do not corrupt metadata.
- NFR-003: Original data is read-only by default.
- NFR-004: Permissions enforced by host/runtime, not prompts alone.
- NFR-005: No remote transmission unless explicitly required by chosen provider/connection.
- NFR-006: Previews and chart rendering are bounded.
- NFR-007: Record sufficient provenance to reproduce/understand outputs.
- NFR-008: Version and test cross-process contracts.
- NFR-009: Keyboard access, focus visibility, and accessible labels.
- NFR-010: Avoid machine-specific paths and assumptions.
- NFR-011: Agent data disclosure is scoped, visible, revocable for future calls, and host-enforced; row values are excluded by default.

Acceptance requires implementation and tests where feasible, not merely a visible UI control.
