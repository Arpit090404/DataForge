# DataForge

Windows-first, local-first desktop workspace for agent-assisted data investigations.

**Initial agent:** Codex through ACP. **Working name:** DataForge.

The application owns projects, data references, executions, artifacts, findings, and reports. Agents are replaceable collaborators. Source data is immutable by default. Chat, Notebook, and Dashboard are views over one shared investigation.

## Repository map
- `AGENTS.md`: engineering rules.
- `.codex/`: Codex project configuration and subagents.
- `spec/`: product, UX, architecture, security, and testing specifications.
- `spec/DECISIONS/`: architecture decision records.
- `tasks/`: roadmap and milestone acceptance criteria.
- `progress.md`: current implementation status, verification, and next work.
- `apps/desktop/`: Tauri desktop app with local project, CSV inspection, and Rust-hosted DuckDB analytics.
- `services/analytics/`: planned Python worker; not part of the current slice.
- `contracts/`: versioned cross-process and tool contracts.

## Current status
The local desktop app creates and reopens SQLite-backed projects, registers CSV source references, displays bounded previews and column profiles, and runs structured filtering, sorting, and grouping through Rust-hosted DuckDB. It saves execution metadata and exports the current bounded result page to CSV. Chat, Notebook, Dashboard, agent integration, and the Python worker are not functional yet. The full Milestone 1 architecture and recovery gates remain open; this implementation uses a single-user local trust model.

## Run on Windows
Install Node.js, Rust with the MSVC toolchain, and the Windows prerequisites for Tauri 2 (including WebView2). From the repository root:

```powershell
cd apps/desktop
npm install
npm run tauri:dev
```

In the app, create a project by choosing its name and a parent folder, or open an existing DataForge project folder. Add a CSV from Sources, select it, and use Explore this dataset for bounded analytical operations. The original CSV is referenced and read, never rewritten. Previews show at most 100 rows by default; profiling scans at most 20,000 rows or 32 MiB and labels incomplete counts. Analytics materializes a registered CSV on first use, up to 64 MiB or 250,000 rows, and returns at most 200 rows per page and 1 MiB of values. A project stores `project.sqlite` and, after the first analytical operation, `analytics.duckdb`. Execution history persists, while result pages are transient. CSV export writes only the displayed page to a new file. Use `npm run build` for the frontend and `cargo test --manifest-path src-tauri/Cargo.toml` for Rust tests.

To build a standalone Windows executable from `apps/desktop`, run `npm run tauri:build`, then launch `src-tauri/target/release/dataforge.exe`. The `--debug` build loads the Vite development URL and needs `npm run dev` running; it is not standalone. Bundling is currently disabled, so neither command produces an installer.

Start with `spec/PRODUCT.md`, `spec/UX_SPEC.md`, `spec/ARCHITECTURE.md`, and `tasks/ROADMAP.md` for the planned product beyond this slice.
