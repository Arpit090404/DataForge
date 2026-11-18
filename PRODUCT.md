# DataForge product context

<!-- impeccable:product-schema 1 -->

## Platform

web

DataForge is a Windows-first desktop application built with Tauri and a web-based interface.

## Users

Students, analysts, researchers, and others investigating datasets to answer substantive analytical questions.

## Product Purpose

DataForge is an agentic data analysis and deep-investigation platform. Its central workflow is collaboration with an AI agent that investigates complex data questions through multiple analytical steps: exploring data, testing hypotheses, discovering patterns, checking results, and developing evidence-backed conclusions. Users can direct, inspect, interrupt, and refine that work.

The long-term goal is a supervised analytical workspace that turns a complex data question into reproducible, evidence-backed conclusions. This is a product direction, not a claim that the current implementation can complete that workflow.

## Positioning

The agent's analytical work and its evidence live in one project context. Plans, permitted SQL and Python execution, intermediate results, sources, findings, notebooks, dashboards, and reports should remain inspectable and connected to the investigation, rather than becoming disconnected outputs. The agent is central to the intended experience; local exploration should remain useful when an agent is unavailable.

## Operating Context

Users bring datasets into a local project, pose questions, collaborate with the agent through multi-step analysis, examine its visible plans and actions, inspect methods and intermediate results, intervene where needed, and communicate supported conclusions. Chat, Notebook, Dashboard, data exploration, and reports serve that shared investigation.

## Capabilities and Constraints

- Local-first processing and strong user control over data access and analytical execution are durable requirements. Source datasets are immutable by default.
- Transparency means exposing available plans, tool actions, SQL/Python inputs and outputs, intermediate results, provenance, and limitations. Provider-private internal reasoning may be unavailable and must not be implied by the interface.
- Agent-generated code, SQL, files, and tool arguments are untrusted. Host-enforced permissions, bounded execution, cancellation, and explicit approval for destructive or out-of-scope actions are required.
- The currently implemented desktop slice supports local projects, CSV source registration and bounded inspection, application-defined DuckDB analysis, execution metadata, page export, and notebook authoring without code execution. Agent integration, general SQL/Python execution, dashboards, and evidence-linked reports remain planned; see [progress.md](progress.md) for current verification.
- The first planned provider is Codex through ACP. Provider capabilities and security guarantees require verification before the product presents them as available.

## Evidence on Hand

The existing product, UX, security, and architecture drafts live in `spec/`; `README.md` and `progress.md` distinguish implemented features from planned work. No customer testimonials, performance benchmarks, or production outcomes are established here.

## Product Principles

1. Agent-led investigation is the central workflow, with meaningful user supervision at each consequential step.
2. Claims trace to inspectable inputs, methods, executions, and intermediate evidence.
3. Preserve local control of data and explicit control of analytical execution.
4. Keep project state and artifacts connected across Chat, Notebook, Dashboard, and reports.
5. Present only capabilities and security properties that have been implemented and verified.

## Accessibility & Inclusion

The desktop interface must support keyboard access, visible focus, accessible control names, and status cues that do not rely on color alone, as specified in `spec/REQUIREMENTS.md` and `spec/UX_SPEC.md`.
