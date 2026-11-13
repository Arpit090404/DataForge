# ADR 0004: Separate metadata, analytical data, and artifacts

- Status: Accepted direction; physical layout pending.
- Date: 2026-11-12

## Context
Application metadata, analytical tables, and large output artifacts have different workloads.

## Decision
SQLite for metadata, DuckDB for analytical workloads, filesystem for large artifacts. Host coordinates writes and references.

## Alternatives
All SQLite (poor fit for analytical tables/files); all DuckDB (not ideal for app metadata relationships); remote DB (unnecessary for local-first initial release).

## Consequences
No transaction spans all stores. Use temporary artifact writes and atomic promotion where supported. Persist references only after artifact verification. Recovery must account for partial failures.
