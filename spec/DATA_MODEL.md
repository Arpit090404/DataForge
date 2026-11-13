# Data model

**Status:** Logical model; physical schema and migrations are implementation deliverables.

The current CSV analytics and Notebook slice has SQLite schema version 3: `project`, `datasets`, `representations`, `executions`, `notebooks`, and ordered `notebook_blocks` tables. It migrates version 1 and 2 projects transactionally on open. Notebooks belong to the project; Markdown blocks store text and result blocks reference a successful execution in that project. The host creates `analytics.duckdb` on first analytical use. Current `executions` retain structured parameters, status, timing, source fingerprint, representation ID, and engine/schema version; result pages are not stored. This is a subset of the full journal/artifact/recovery model below.

ADR 0009 proposes the physical directory and ownership model; `DATA_REGISTRATION.md` defines source identity and on-demand analytical representation versions. Both require review and proof.

## Principles
Use UUIDs, UTC timestamps, schema versions, stable references, and provenance. Keep large data outside SQLite. Do not assume transactions span SQLite, DuckDB, and filesystem.

## Entities
- **Project:** id, name, root_path, timestamps, schema_version, settings.
- **Dataset:** id, project_id, name, source_mode (external reference or managed import), source identity/path, format, schema, row estimate, size, status, file identity, content fingerprint.
- **AnalyticalRepresentation:** id, dataset_id, verified source version/fingerprint, DuckDB relation reference, status, size, created_at, retention references, DuckDB version, materializer version, output schema version/fingerprint, canonical transformation configuration/hash, representation content/manifest hash.
- **Connection:** id, project_id, name, connector_type, non-secret config, secure credential reference, status.
- **Investigation:** id, project_id, title, objective, status, timestamps, active session reference.
- **AgentSession:** id, investigation_id, provider_id, provider session reference, capabilities, status, timestamps.
- **PlanStep:** id, investigation_id, sequence, title, description, status, dependencies.
- **Execution:** id, investigation_id, plan_step_id, kind, engine/language, status, input/output refs, code/query ref and hash, timestamps, duration, exit code, error, runtime metadata.
- **OperationJournal:** operation_id, request_id, idempotency_key, host_session_id, worker_generation, kind, input/version hashes, intended output IDs, phase, timestamps, reconciliation result. Host-owned candidate outputs remain unpublished until final metadata commit.
- **Artifact:** id, project_id, investigation_id, kind, relative path, MIME type, size, hash, schema version, provenance.
- **Finding:** id, investigation_id, title, statement, kind, importance, confidence label, status, timestamps.
- **Evidence:** id, finding_id, execution_id and/or artifact_id, role, description.
- **Report:** id, investigation_id, artifact_id, format, created_at, status, metadata.

Secrets must never be stored in plain metadata JSON. Confidence must be evidence/methodology based; do not let an LLM invent numeric confidence.

## Relationships
Project has datasets, connections, investigations. A dataset can have multiple immutable analytical representations. Investigation has plan steps, sessions, executions, findings, artifacts. Executions pin representation IDs and engine/configuration versions and may produce multiple artifacts. Findings cite evidence. Reports reference investigation artifacts. Agent sessions are replaceable links, not the source of investigation truth.

## Suggested statuses
Execution: queued, awaiting_approval, running, succeeded, failed, cancel_requested, cancelled, interrupted.  
Investigation: draft, active, awaiting_review, completed, failed, archived.

Define and test legal state transitions.

## Storage and recovery
The host is the sole writer of SQLite metadata/journal, DuckDB analytical tables/views, managed imports, and large artifacts. Worker scratch and IPC output are untrusted and have no authoritative identity. Write artifacts to host-private temporary paths, verify complete content, and promote without overwrite where the filesystem supports it; publish references and terminal execution state together in SQLite only after verification. A rename and SQLite/DuckDB commit are not one transaction. Reconcile orphaned host-owned DuckDB/file candidates and uncertain operations after acquiring exclusive project ownership and proving old workers cannot write authority; preserve committed evidence and quarantine unreferenced outputs before cleanup. If ownership or access exclusion is uncertain, block recovery. Use forward migrations and never silently discard user data. See ADR 0009 and `STORAGE_OWNERSHIP_DESIGN.md`.
