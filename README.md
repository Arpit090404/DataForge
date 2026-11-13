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
- `apps/desktop/`: Tauri desktop app with local project and CSV inspection.
- `services/analytics/`: planned Python worker; not part of the current slice.
- `contracts/`: versioned cross-process and tool contracts.

## Current status
The first local desktop slice creates and reopens SQLite-backed projects, registers CSV source references, and displays bounded previews and column profiles. Chat, Notebook, Dashboard, agent integration, DuckDB, and the Python worker are not functional yet. The full Milestone 1 architecture and recovery gates remain open; this limited CSV slice uses a single-user local trust model.

## Run on Windows
Install Node.js, Rust with the MSVC toolchain, and the Windows prerequisites for Tauri 2 (including WebView2). From the repository root:

```powershell
cd apps/desktop
npm install
npm run tauri:dev
```

In the app, create a project by choosing its name and a parent folder, or open an existing DataForge project folder. Add a CSV from Sources. The original CSV is referenced and read, never copied or rewritten. Previews show at most 100 rows by default; profiling scans at most 20,000 rows or 32 MiB and labels incomplete counts. The project folder stores `project.sqlite`. Use `npm run build` for the frontend and `cargo test --manifest-path src-tauri/Cargo.toml` for Rust tests.

To build a Windows executable from `apps/desktop`, run `npm run tauri:build -- --debug`. The current build produces `src-tauri/target/debug/dataforge.exe`; it does not produce an installer.

Start with `spec/PRODUCT.md`, `spec/UX_SPEC.md`, `spec/ARCHITECTURE.md`, and `tasks/ROADMAP.md` for the planned product beyond this slice.
