# DataForge progress

**Updated:** 2026-11-13  
**Current state:** The local CSV desktop slice and Rust-hosted DuckDB analytics slice are implemented. Full Milestone 1 is not complete.

## Standalone launch correction (2026-11-13)

The prior `npm run tauri:build -- --debug` executable opened a WebView that tried to reach the development server at port 1420. Launching it without Vite produced a “Can't reach this page” screen. A process-stays-running smoke check did not catch this; it was not proof that the UI loaded. The development URL now matches Vite's `127.0.0.1` listener. `npm run tauri:build` (without `--debug`) built `src-tauri/target/release/dataforge.exe`; it launched and remained running with no Vite server listening on port 1420. Native window content could not be inspected through the available UI automation, so visible rendering remains a user check.

## Rust-hosted analytics slice (2026-11-13)

- Embedded DuckDB 1.4.5 is integrated into the Rust host for on-demand registered-CSV representations, structured filtering/sorting/grouping, bounded pages, execution history, cancellation, and current-page CSV export. The UI is integrated into the existing dataset workspace. The Windows compatibility spike ran a real embedded query after linking the Windows Restart Manager library.
- The final-source Rust suite passed **17/17 tests** with `cargo test --offline --manifest-path apps/desktop/src-tauri/Cargo.toml`. This includes SQLite v1-to-v2 migration, interruption marking, materialization, operation validation, null handling, pagination, source-change checks, export escaping, source integrity, engine-version replacement, and persisted execution history.
- `npm run build` and `npm run tauri:build -- --debug` passed after the production changes. The debug executable's process remained running briefly, but its WebView later showed an unreachable development URL without Vite. The standalone release build is the required fix; the integrated native-window workflow remains manually unverified.

## Working now

- Tauri 2, React, and TypeScript desktop workbench with Sources, Threads, a central workspace, contextual inspector, bottom composer, and Chat / Notebook / Dashboard mode switcher. The agent modes show honest empty states.
- Create a named project in a chosen parent folder and reopen an existing project folder. Project and dataset metadata persist in `project.sqlite`.
- Register a local CSV through the native file picker without modifying the original. Duplicate registration, missing files, changed fingerprints, unsupported files, malformed rows, and invalid or damaged projects produce user-facing errors.
- Select a source to see a bounded preview, inferred column types, scanned row count, null counts, distinct values seen, and basic numeric statistics. The default preview is 100 rows; the backend accepts at most 200. Profiling scans at most 20,000 rows or 32 MiB and labels incomplete results.
- Run structured filters, multi-column sorts, grouping and aggregates in Rust-hosted DuckDB on registered CSVs. Results are paged and bounded; users can cancel, inspect persisted execution history and metadata, and export the current result page to a new CSV. The right inspector shows the selected execution. Median is included in the bounded numeric profile.
- Rust performs file work away from the UI thread. The frontend keeps only the bounded result in state.

## Last verified

| Check | Result |
| --- | --- |
| `cargo test --offline --manifest-path apps/desktop/src-tauri/Cargo.toml` | 17 passed, 0 failed (2026-11-13, final source). |
| `npm run build` in `apps/desktop` | TypeScript and Vite build passed (2026-11-13). |
| `npm run tauri:build -- --debug` in `apps/desktop` | Built `src-tauri/target/debug/dataforge.exe` with embedded DuckDB (2026-11-13). |
| Debug executable launch | Process remained running for a three-second smoke check, but the user then observed an unreachable-page screen without Vite. A restricted launch also failed with WebView2 resource-in-use error. |
| `npm run tauri:build` in `apps/desktop` | Standalone release executable built successfully (2026-11-13). |
| Release executable launch | Launched with no Vite server listening; process remained running after four seconds (2026-11-13). Native window content not independently inspected. |
| `npm run tauri:dev` | Started successfully; a triggered Rust rebuild completed and relaunched the app without Vite's earlier `EBUSY` DLL watcher error (2026-11-13). |

These checks do not constitute a manual end-to-end test of the native picker and complete create/register/inspect flow. `cargo fmt --check` could not run because `rustfmt` is not installed in the local toolchain.

## First-slice verification (2026-11-13)

Disposable Rust fixtures under the system temporary directory exercised project creation and reopening, persisted dataset registration, a known CSV profile (names, types, nulls, distinct counts, min/max/mean), 2-row preview of a 3-row file, duplicate registration, changed and missing source detection, invalid and corrupted projects, unsupported files, malformed and empty CSVs, a 20,050-row CSV with the 20,000-row scan cap and 100-row preview, and an overlong cell. Fixture source bytes were checked after registration and inspection. All 8 backend tests passed.

Two reproducible bugs were fixed: boolean-only columns were classified as text; and a preview with a cell clipped at 4,096 characters was labeled complete. Regression tests now cover both. The TypeScript/Vite production build passed after the fixes.

`npm run tauri:dev` launched the Windows app process without a backend error before it was stopped. The frontend startup and create-project dialog rendered in a browser preview, with no console warnings or errors observed there. This browser preview did not exercise Tauri commands or the native file picker.

**Manual native workflow still unverified:** creating and reopening a project through the desktop window, registering through the native picker, selecting a source and viewing its profile, changed/missing status in the window, invalid/unsupported-file messages in the window, and UI responsiveness during profiling. Native window controls were unavailable in this verification session, so these checks are not marked passed. Bounded registration and profiling only validate the scanned portion of a large CSV; later malformed rows can remain undetected.

## Still open

- Full Milestone 1 scope: additional file formats, worker/IPC integration, strict representation space quota, output hashes, and the stronger storage/recovery contract. The current Rust-hosted analytics slice was explicitly authorized before those larger proof gates were met.
- The proposed host-owned storage boundary in `spec/STORAGE_OWNERSHIP_DESIGN.md` has not been implemented or tested. The worker-fencing spike passed its direct Job Object cases but failed to prove the full old-worker guarantee; ADR 0009 remains proposed.
- General submitted SQL, generated Python, ACP/Codex integration, charts, reports, and database connectors are not implemented.
- No installer is produced. The app uses a pragmatic single-user local trust model and is not a filesystem or process sandbox. Profiling of large CSVs is partial, and fingerprinting reads the full source file. Analytics accepts CSVs up to 64 MiB/250,000 rows; persistent DuckDB file growth is not strictly capped. The 30-second interruption is best effort, not a process kill. Result pages are transient, and export refuses an existing destination. Cross-store orphan cleanup and concurrent-host exclusion remain unimplemented. Date inference and native-window operation flows have not been verified.

## Next verification

Run the remaining native-window workflow with a disposable CSV, including the file picker, close/reopen, changed/missing status, analytics builder, cancellation, result pagination, export, error messages, and responsiveness during a larger operation. Keep full Milestone 1 worker/recovery work behind the existing review and proof gates.

## Maintenance

Update this file after meaningful implementation or verification work. Record the date, what actually changed, exact checks and outcomes, current limitations, and the next concrete task. Do not turn planned work or experiment-only results into claims about the application.
