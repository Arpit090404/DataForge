# ADR 0006: ACP and DataForge permission boundaries

- Status: Proposed for architecture approval; adapter behavior unverified.
- Date: 2026-11-12

## Decision

Codex remains the first ACP provider. Rust starts and supervises the selected, pinned adapter and provider with an explicit working directory, minimum environment, documented launch mode, and no inherited application credentials. It owns session IDs, capability negotiation, cancellation, exit handling, and diagnostics. Provider authentication stays provider-owned; DataForge does not manage subscriptions or billing.

Permission planes are distinct:

| Plane | Initial policy | Enforcement owner |
|---|---|---|
| ACP session/process | Explicit adapter path/version, lifecycle and capability checks | Rust; adapter reports capabilities |
| Codex shell | Disabled for ordinary investigations unless an approved adapter mode can enforce it | Adapter/provider plus OS process boundary |
| Codex file reads/writes | No general workspace access; only explicitly disclosed, staged context | Adapter/provider plus OS ACL/container boundary |
| DataForge MCP tools | Narrow versioned schemas; host validates project, investigation, object IDs and per-call permission | Rust host; never the prompt |
| Windows resources | Separate process identity/container and ACL/network controls where needed | OS; verified on supported Windows builds |
| Environment/secrets | Allowlisted variables only; no host token or secure-store values passed to agent/worker | Rust launcher |

An ACP permission request is an interaction event, not proof that an action is isolated. If the selected adapter cannot reliably disable or constrain shell and file operations, the agent must run under a tested OS boundary or agent integration remains a gated preview. The app never assumes that MCP validation constrains the agent's other tools. Host tool authorization is checked again at call time; session IDs and model claims are not authority.

Fail closed: if the adapter lacks the required restrictive mode, the Windows enforcement selected for that mode is unavailable, capability negotiation fails, or the adapter/Codex version is outside the tested compatibility range, do not start or continue an agent turn with project data or DataForge tools. Stop the affected session, show the specific diagnostic and required remedy, and retain local project/analytics use. Never fall back to an unrestricted mode or treat an ACP approval as a substitute for the missing boundary. Authentication remains provider-owned and is attempted only through a supported provider flow; DataForge does not copy credentials to work around a failed boundary.

At session start and after capability changes, DataForge supplies a versioned capability description: supported tools and limits, application-defined analytical templates, disclosure grants, and explicit absence of general SQL and arbitrary Python. The host also enforces this description. Unknown or unsupported tool names, including `execute_sql` and `execute_python`, return a structured `unsupported_capability` error with no execution or fallback side effect. Where useful, the response points to supported templates, bounded preview, profiling, or trusted statistics. A natural-language request for unsupported execution receives the same clear explanation in UI and agent context; it is never rerouted to Codex shell, file tools, or another runtime. Capability information is advisory; denial is enforced at every host tool boundary.

## Required proof

Pin and test adapter/Codex versions on Windows: startup, auth, capabilities, session resume, tool and permission events, shell/file denial, MCP allow/deny, unknown and Python tool denial, cancellation, child-process termination, environment redaction, reconnect, and ambiguous in-flight operations. Record which guarantees come from adapter configuration and which from Windows. No silent executable download.

## Source

- https://github.com/agentclientprotocol/codex-acp
