# DataForge

Windows-first, local-first desktop workspace for agent-assisted data investigations.

**Initial agent:** Codex through ACP. **Working name:** DataForge.

The application owns projects, data references, executions, artifacts, findings, and reports. Agents are replaceable collaborators. Source data is immutable by default. Chat, Notebook, and Dashboard are views over one shared investigation.

## Repository map
- `AGENTS.md`: engineering rules.
- `.codex/`: Codex project configuration and subagents.
- `spec/`: product, UX, architecture, security, and testing specifications.
- `spec/DECISIONS/`: architecture decision records.
- `tasks/`: roadmap and milestone acceptance criteria.
- `apps/desktop/`: Tauri desktop app, created in Milestone 1.
- `services/analytics/`: Python worker, created in Milestone 1.
- `contracts/`: versioned cross-process and tool contracts.

## Current status
Foundation documentation only. No product functionality should be assumed to exist.

Start with `spec/PRODUCT.md`, `spec/UX_SPEC.md`, `spec/ARCHITECTURE.md`, and `tasks/ROADMAP.md`.
