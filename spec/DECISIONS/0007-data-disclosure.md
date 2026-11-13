# ADR 0007: Agent data disclosure

- Status: Proposed for architecture approval; usability thresholds need review.
- Date: 2026-11-12

## Decision

The default agent context may contain investigation objective, user-authored messages, opaque dataset IDs, display names, format, column names/types, row-count estimate, and execution status. Paths, connection strings, credentials, row values, query-result cells, profiles containing examples, and artifact contents are excluded by default. Dataset names and column names can themselves be sensitive; users can hide them or disable agent access per dataset.

Sending row samples, result cells, or report excerpts to a configured provider requires a scoped user grant naming the dataset, fields, maximum rows/bytes, destination/provider, and duration. No blanket approval for an entire project. A grant is checked by Rust before tool output enters agent context. Sensitive columns marked by user or detected heuristically are excluded until explicitly included; heuristic classification is advisory and cannot guarantee discovery. Local no-agent workflows remain available. Show the provider disclosure in the UI before the first transmission and in each grant; never imply processing is entirely local when a remote model receives context.

Logs contain IDs, timing, status, sizes, policy decisions, and redacted error codes. They omit raw prompts, SQL/Python text, row values, credentials, paths outside diagnostic mode, and tool payloads by default. Diagnostic export requires preview/redaction. Revocation blocks future tool disclosures but cannot retract data already sent to a provider.

## Required proof

Test each tool response and event path for denied, granted, expired, and revoked disclosure; verify secret/PII fixtures do not enter logs or agent context without grant. Document provider retention as provider-specific information, not a DataForge guarantee.
