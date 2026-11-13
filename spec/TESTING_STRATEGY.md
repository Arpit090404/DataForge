# Testing strategy

**Status:** Draft baseline.

## Goals
Test user-visible behavior, domain invariants, process contracts, analytical correctness, and security claims. Unit tests alone do not prove desktop reliability.

## Frontend
Component and navigation tests; shared Chat/Notebook/Dashboard state; keyboard/accessibility checks; loading/empty/error/disconnected/approval states; end-to-end smoke tests.

## Rust host
Unit tests for state transitions, permissions, path validation, persistence; integration tests for process launch/shutdown/crash/timeout/cancel; SQLite migration tests; event ordering and duplicate/late message tests.

## Python worker
Tests for imports, schema inference, profiling, SQL, statistics, IPC envelopes, malformed/oversized inputs, timeout/cancel/crash, numerical correctness, source immutability, and artifact provenance. Adversarial SQL tests must exercise actual DuckDB settings and catalog binding on the pinned build. No arbitrary Python execution claim is made for the initial release.

## ACP
Mock ACP server for deterministic initialization, capability, session, stream, permission, cancellation, disconnect, and recovery tests. Smaller compatibility suite against supported real Codex/adapter versions. Ordinary unit tests must not require a live subscription.

## Security
Test path traversal, project boundary escapes, secret redaction, SQL write restrictions, network policy, process termination, resource limits, and permission enforcement on supported Windows configurations.

## Analytics evaluation
Maintain synthetic fixtures for nulls, duplicates, mixed types, dates, skew, imbalance, known relationships, anomalies, and counterexamples. Benchmark questions have expected calculations and evidence requirements. Score numerical correctness separately from narrative quality.

## Performance and reporting
Benchmark startup, project open, file registration, preview/query latency, memory, chart rendering, worker startup, and cancellation. Record hardware/dataset details. Report commands, results, skipped tests, environment, and untested areas.
