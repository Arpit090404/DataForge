# Milestone 2 — Codex integration

## Goal
Connect an existing Codex installation through ACP and let users observe/control its work.

## Scope
Discovery/diagnostics; adapter lifecycle; initialization/capabilities; delegated authentication; session create/resume where supported; streaming; permission mediation; cancellation/disconnect; minimal versioned MCP analytics tools.

## Dependencies
Milestone 1; tested Codex/ACP adapter compatibility; demonstrated shell/file capability enforcement; provider disclosure and MCP authorization proof; versioned IPC/tool contracts; approved ACP, OS, and disclosure policies in ADRs 0006–0007.

## Acceptance
1. Missing/incompatible installation is diagnosed.
2. Compatible installation initializes through ACP.
3. Authentication uses provider-supported flow.
4. Events stream without blocking UI.
5. Minimal analytics tool validates project scope.
6. Permission requests are visible and host-enforced.
7. Cancellation/process exit do not corrupt state.
8. Provider specifics remain isolated.
9. Shell/file capabilities are denied or constrained by demonstrated adapter and OS controls; MCP authorization is separately host-enforced.
10. Dataset rows/results reach provider context only under a scoped disclosure grant; logs omit raw values and secrets.
11. Unsupported and obsolete agent operations receive explicit errors and supported alternatives; Python requests never execute through shell or the trusted worker.
12. Investigation state and completed evidence remain available when the ACP session is lost; resumption is offered only when verified.
13. Missing restrictive adapter mode, unavailable Windows enforcement, failed capability negotiation, or incompatible version blocks the affected agent session with a specific diagnostic; no unrestricted fallback occurs and local-only work remains usable.

## Tests
Mock ACP server; supported real Codex/adapter compatibility; auth states; tool schema/permission; cancellation/disconnect/recovery.

## Exclusions
Other providers, multi-agent orchestration, unattended background work.
