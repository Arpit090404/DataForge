# DataForge engineering constitution

## Ownership
Act as a senior engineer and technical owner. Inspect the repository before changing it. Challenge technically unsound requirements respectfully. Implement only the requested scope. The primary Codex session owns decomposition, delegation, integration, final review, and verification.

## Instruction hierarchy
Follow platform/security requirements, this file and applicable nested `AGENTS.md`, accepted ADRs in `spec/DECISIONS/`, relevant specifications, then task scope. If instructions conflict, report the conflict. Do not silently override an accepted decision.

Before implementation, read relevant specs and inspect existing code. Planned features are not implemented features.

## Engineering standards
- Prefer the simplest design satisfying a demonstrated requirement.
- Avoid speculative abstractions and unnecessary dependencies.
- Preserve existing behavior unless intentionally changed.
- Use typed, versioned contracts at process boundaries.
- Validate untrusted inputs; handle errors explicitly.
- Keep long-running work off the UI thread.
- Do not create fake functionality or claim untested behavior works.
- Do not commit credentials, machine-specific paths, or user data.

## Product constraints
- DataForge is an investigation workspace, not just a chatbot or chart generator.
- Chat, Notebook, and Dashboard share investigation state and artifacts.
- Preserve the approved left navigation/sources, central workspace, contextual right inspector, and bottom composer layout.
- Customize shadcn/ui; do not use its defaults without design review.
- Keep the application useful without an agent.
- Do not imply provider capabilities that have not been verified.

## Security and data integrity
- Treat agent-generated code, SQL, files, and tool arguments as untrusted.
- Original source datasets are immutable by default.
- Enforce permissions in host/runtime code, not only prompts or UI.
- Never expose unrestricted filesystem/network access to analytics execution.
- Keep secrets out of logs, prompts, reports, and artifacts.
- A subprocess is not automatically a sandbox. Do not claim isolation guarantees without tested OS controls.
- Require explicit approval for destructive actions and access outside approved project scope.
- Apply resource limits and cancellation.

## Testing
For meaningful changes, add/update tests, run relevant tests/type checks/linting, and report exact commands and outcomes. Add regression tests for bugs. Clearly state what could not be tested.

## Documentation
Update specs/ADRs when contracts, behavior, security boundaries, setup, or architecture change. Keep this file focused on durable rules.
Update `progress.md` after meaningful implementation or verification work; distinguish working features, experimental evidence, and untested plans.

## Subagents
Delegate bounded independent tasks. Avoid concurrent edits to the same files. Treat subagent findings as unverified until checked. Architect and reviewer agents should review, not implement.

## Completion report
Report changes, decisions, tests actually run, limitations, and required follow-up.
