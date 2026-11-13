# Milestone 3 — Agentic analytics

## Goal
Supervise a multi-step investigation and inspect reproducible results across Chat, Notebook, and Dashboard.

## Scope
Objective/plan model; application-defined analytical operations and trusted profiling/statistics; execution history; notebook view; validated chart specs and Plotly rendering; evidence-linked findings; HTML reports; cancellation/time/resource limits; benchmark suite. General submitted SQL and arbitrary generated Python are deferred.

## Dependencies
Milestone 1 data foundation; Milestone 2 ACP/MCP; approved SQL, agent, disclosure, and worker boundaries. Arbitrary Python has a separate future isolation gate.

## Acceptance
1. User asks Codex to investigate registered data.
2. Agent inspects data and plans bounded steps.
3. Every execution records inputs, status, timing, outputs.
4. Notebook exposes application-defined analytical operations and trusted results; it does not offer general SQL or arbitrary Python execution.
5. Dashboard charts reference registered artifacts and validated fields.
6. Findings link to execution/artifact evidence.
7. Correlation is not presented as causal proof.
8. User can cancel and inspect failures.
9. Report uses verified investigation artifacts.
10. Benchmark questions meet documented correctness thresholds.

## Tests
Mock-agent end-to-end; numerical correctness; provenance; security boundaries; memory/responsiveness/cancellation benchmarks.

## Exclusions
General submitted SQL, arbitrary generated Python, cloud collaboration, multi-user permissions, unattended investigations, full enterprise BI.
