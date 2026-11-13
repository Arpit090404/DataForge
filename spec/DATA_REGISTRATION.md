# Data registration and catalog

**Status:** Proposed contract for architecture review; no implementation exists.

## Registration

Rust registers a user-selected local file as an external reference by default. A project-managed immutable import is a separate, explicit choice when the user needs portability or independence from the original. Supported initial types are CSV, XLSX, Parquet, and JSON/JSONL subject to format-specific proof. A registration records opaque ID, display name, source mode, canonical source identity, file identity, size, modification time, content fingerprint when computed, format, schema inference/version, analytical representation ID/status, and authorization scope. File identity, size, and modification time are cheap change indicators; a content hash is the stronger fingerprint and must be verified before an execution claims reproducible inputs. Paths are stored locally but never sent to the agent by default.

Resolve paths and reparse points at registration and again at access. A lexical containment check is insufficient. Open the selected file with least necessary access; where feasible validate file identity after opening to reduce swap races. Never write to the original. A managed import is written once to staging, hashed, verified, and atomically promoted on the same volume; it is a project-owned copy, distinct from the original. Deleting a registration removes catalog references and eligible derived representations only after explicit review, never the user's original file.

## Analytical representations and refresh

Registration does not eagerly copy or materialize a dataset. Bounded inspection can read the registered file through a trusted operation. Application-defined analytical templates use a DuckDB representation created on demand from a specific verified source version. Reuse it for later operations against that version; retain its ID/fingerprint in each execution. Estimate space and enforce a quota before materialization. If a large dataset cannot be materialized within the quota, explain that representation-backed operations are unavailable for it and retain bounded inspection; do not silently duplicate it. For a managed import, reuse the imported file as the source of this on-demand representation rather than making another source copy. Old representations are retained while referenced by executions and otherwise become eligible for explicit cleanup.

For each representation, persist its stable ID, source registration/version and verified content fingerprint, DuckDB engine version, ingestion/materialization implementation version, output schema version and schema fingerprint, and the effective transformation configuration (for example format, parser options, encoding, type overrides, timezone and null handling when applicable). Record a hash of this canonical configuration and the representation's content or manifest. An application upgrade must not silently reinterpret an existing representation: keep it version-pinned or explicitly rebuild a new representation. Avoid machine-specific paths, usernames, or hardware details in reproducibility metadata.

An external reference is checked when opened and before new inspection/materialization. If missing, mark it `missing`; if identity or fingerprint differs, mark it `stale`. Do not silently refresh or bind a new execution to the old version. Existing executions remain tied to their recorded representation; their results stay inspectable if that representation/artifacts still exist. Refresh is an explicit operation that verifies the current file and creates a new version without overwriting prior evidence. A managed import remains usable if the original disappears; changes to the original do not change the import. Re-import is explicit. If a referenced source changes during materialization, reject the new representation unless stable identity/content can be demonstrated; test the exact Windows file-open semantics.

## Catalog binding

Rust maps IDs to authorized source registrations and versioned analytical representations. The host opens and verifies a source, brokers bounded content to trusted parsing/ingestion code, and creates any DuckDB representation itself only when needed for an application-defined analytical operation. The worker receives no writable project path or DuckDB handle. App-created table/view names are generated from IDs, not user labels. Template execution receives representation/catalog IDs, never source paths or caller-supplied SQL. Binding is restricted to authorized representation relations; a caller cannot register new files, refer to filesystem paths, or attach databases through a template. Refresh does not silently change the inputs of a recorded execution. See `STORAGE_OWNERSHIP_DESIGN.md` for the unproved Windows access boundary.

## Limits and disclosure

Inspection and preview are bounded by rows, bytes, time, and memory; report encoding and inference ambiguity. The UI shows whether a dataset is referenced or copied, stale, or unavailable. Agent context uses opaque IDs and approved metadata; row values and sensitive columns follow ADR 0007. Remote connections are outside initial registration scope and require a separate connector/security decision.

## Proof

Test missing and changed references, stable managed imports after original deletion, symlink/junction/reparse-point swaps, file identity races, large files and quota refusal, source hash before/after, lazy materialization/reuse, version-pinned executions, refresh, cleanup eligibility, and crash during promotion.
