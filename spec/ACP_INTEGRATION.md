# ACP and Codex integration

**Status:** Draft. Verify the exact adapter, Codex versions, and supported capabilities before implementation.

ADR 0006 proposes separate ACP, shell/file, MCP, Windows, and environment permission planes. An ACP permission approval is not an isolation guarantee. ADR 0007 controls what dataset content may enter provider context.

## Goal
Use ACP as the initial agent boundary, with Codex first. DataForge does not manage subscriptions, billing, or provider credentials.

## Boundaries
Generic domain objects remain provider-neutral. Codex executable discovery, adapter version, authentication, and provider-specific capabilities live in the Codex integration module. Host owns process lifecycle and permission mediation. Agent does not own application metadata or analytics storage.

The host exposes a versioned DataForge capability description to the agent and UI, including unavailable operations such as arbitrary Python. It returns structured `unsupported_capability` errors for unknown or obsolete tool calls, with supported SQL/preview/profile alternatives where applicable. No request may fall back to shell execution or another runtime. Capability text does not substitute for host enforcement.

## Discovery and startup
Detect supported installations through documented mechanisms. Allow a local user override for executable/adapter path, not committed project config. Verify versions. Launch a maintained adapter with documented arguments. Initialize ACP and negotiate capabilities. Report missing executable, incompatible version, authentication, and startup errors distinctly. Never silently download/replace executables.

Before a turn can access project context or tools, verify the tested adapter/Codex version range, required restrictive shell/file mode, available Windows enforcement, and negotiated capabilities. If any check fails, block that agent session and give a specific diagnostic; local-only investigation functions remain available. A running session that loses a required boundary is stopped before further tool calls. Do not silently downgrade to unrestricted execution or ask the user to approve away a missing OS boundary. See ADR 0006.

## Authentication
Delegate to Codex-supported flow. Do not scrape, copy, or independently manage subscription credentials. Redact tokens and credential-bearing environment variables. Explain when authentication must be completed outside DataForge. ACP does not bypass provider plan or usage limits.

## Sessions and events
Handle creation/resumption where supported, streaming, tool calls/results, permission requests, turn completion/failure, cancellation, disconnect, and restart. Do not assume all providers expose identical events or capabilities.

## Permissions
Show requested action, resources, scope, and consequences. Host enforces decisions. Distinguish provider permission, DataForge execution approval, and OS security restrictions.

## MCP tools
Expose narrow, validated, versioned application tools. Validate project/investigation/dataset/artifact scope on every call. Verify that the chosen ACP client supports the required MCP server configuration; do not assume it.

## Recovery and compatibility
Preserve completed DataForge records on disconnect. Reopen investigations from app-owned state, mark uncertain in-flight agent work, and keep local analysis available. ACP history may help display conversation but is not authoritative evidence. Resume only if the selected adapter supports it; otherwise start a clearly new session after user action. Test supported Codex/adapter versions, Windows architecture, authentication states, sessions, tool events, permissions, cancellation, and process exit. Pin/constrain compatible release versions and provide diagnostics.
