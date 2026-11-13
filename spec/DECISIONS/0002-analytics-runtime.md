# ADR 0002: Local Python analytics runtime

- Status: Accepted direction; isolation design not approved.
- Date: 2026-11-12

## Context
Need a mature data-science ecosystem and local analytical query engine.

## Decision
Use a supervised Python worker and DuckDB, with Pandas, Polars, NumPy, SciPy, Statsmodels, and Scikit-learn where justified.

## Alternatives
Rust-only analytics (less Python ecosystem); execution inside agent environment (weak application control); remote service (conflicts with local-first goals).

## Consequences
Python packaging and lifecycle become product concerns. IPC must be versioned. A subprocess is not a sandbox. Pin dependencies and benchmark on reference Windows hardware.

The worker executes trusted application code but parses untrusted datasets. A malformed file or vulnerable parser can crash or compromise that process. Timeouts and Job Objects address lifecycle/resources, not filesystem or network isolation. ADR 0008 proposes deferring arbitrary generated Python; any additional Windows containment for the trusted worker remains unverified until demonstrated.
