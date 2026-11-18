# Product specification

**Status:** Draft baseline | **Name:** DataForge (working name) | **Platform:** Windows-first

## Vision
DataForge is an agentic data analysis and deep-investigation platform. Users bring files or connect databases, pose complex analytical questions, and supervise an agent through a reproducible, multi-step investigation. They can inspect visible plans, analytical actions, intermediate results, datasets, findings, and reports while preserving the relationship between them.

The agent's analytical work is the central workflow. Users collaborate with it to explore data, test hypotheses, discover patterns, validate results, and develop evidence-backed conclusions; notebooks, dashboards, and reports support that workflow.

## Problem
General-purpose agents can write SQL and Python, but their work is scattered across terminals, files, notebooks, and chat transcripts. Users struggle to verify inputs, methods, claims, and reproducibility. Traditional BI tools offer structured visualization but often require manual preparation.

## Audience
Students, analysts, researchers, and general users exploring structured data. The product should be approachable without hiding technical details needed for auditability.

## Positioning
A shared project space for supervised agent-led analysis, application-defined local analytics, inspectable plans and executions, an analytical notebook, dashboards, evidence-linked findings, and reproducible reports. General submitted SQL and arbitrary Python are possible later capabilities after security approval. Provider-private internal reasoning is not a capability the interface may promise.

## Principles
1. Investigation-first: chat is an interface; the investigation is the durable unit.
2. Evidence over eloquence: important findings link to calculations and inputs.
3. Human-supervised autonomy: inspect, approve, cancel, and correct work.
4. Local-first: processing is local by default; remote access is explicit.
5. Agent replaceability: Codex is the first provider, not the core architecture.
6. Application-owned state: DataForge owns data references, executions, artifacts, findings, and reports.
7. Useful without AI.
8. Honest capability and security claims.

## Initial release
Windows desktop shell; projects; CSV/XLSX/Parquet/JSON inspection; DuckDB-backed application-defined analytical operations and trusted profiling/statistics; Codex ACP; application-owned MCP analytics tools; charts; evidence-linked findings; HTML report export. General submitted SQL, arbitrary generated Python, and remote database connectors require later security/connector decisions.

## Non-goals
No model training, subscription/billing management, cloud sync, team collaboration, multi-agent orchestration, unattended background agents, unrestricted host execution, full enterprise semantic layer, or every connector at launch.

## Success criteria
A new user can create a project and inspect data; an investigation can complete multiple visible steps; metrics trace to executions and artifacts; cancellation and restart recovery work; source data remains unchanged; UI stays responsive; benchmark questions demonstrate analytical correctness.

## Open questions
Choose first remote connector for a later release; prioritize export formats beyond HTML; establish practical limits on 16 GB Windows hardware; define provider re-authentication UX; approve or revise ADRs 0005–0009.
