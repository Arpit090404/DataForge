# ADR 0003: ACP agent integration boundary

- Status: Accepted direction; adapter and compatibility matrix pending.
- Date: 2026-11-12

## Context
Delegate to an existing installed agent without managing subscription or billing. Codex is first.

## Decision
Use ACP as the provider boundary and Codex as initial integration. Use MCP for application-owned analytics tools only after verifying support in the selected ACP client/adapter.

## Alternatives
Direct Codex API (provider coupling); ad-hoc CLI commands (weak structured lifecycle); proprietary runtime (duplicates agent infrastructure).

## Consequences
Authentication remains provider-owned. ACP does not bypass account/usage restrictions. Adapter compatibility must be tested. Provider-neutral application state remains DataForge-owned.
