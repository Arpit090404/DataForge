# DataForge progress

**Updated:** 2026-11-14  
**Current state:** The local CSV desktop slice and Rust-hosted DuckDB analytics slice are implemented. Full Milestone 1 is not complete.

## Notebook implementation (2026-11-14)

The paused draft is now integrated. SQLite schema version 3 stores project notebooks and ordered Markdown/result blocks, with transactional migration from versions 1 and 2. The workspace supports notebook creation, renaming and deletion; Markdown editing, saving and preview; and adding, deleting and reordering blocks. Drafts stay in memory across mode and notebook switches, and project switching prompts before discarding them. Markdown renders a restricted subset as React elements; raw HTML and unsafe link schemes are not executed. Result blocks reference successful project executions and load a bounded replay on demand from the pinned representation, without creating a new execution. Replay can be unavailable, and unsorted results are not guaranteed to reproduce the same row order. Result pages remain transient.

**Checks:** `cargo test` in `apps/desktop/src-tauri` passed 20 tests; `node tests/markdown.cjs` in `apps/desktop` passed the supported-syntax and unsafe-input checks; `npm run build` and `npm run tauri:build -- --debug` in `apps/desktop` passed with Windows access. The first restricted frontend build failed to read Vite configuration. `npm run tauri:build` also produced the standalone release executable on 2026-11-14. The new executable was not launched; native Notebook interaction, window-close warnings, and the corrected sort layout have not been visually verified.

## Paused Notebook checkpoint (2026-11-13)

Paused at the user's request before Notebook integration or testing. A draft `apps/desktop/src-tauri/src/notebook.rs` is saved in the working tree but is not wired into the app and must not be treated as working functionality. No Notebook frontend changes or new dependencies were made. Resume by reviewing/completing the backend migration and commands, implementing the Notebook UI, then running the requested Rust, frontend, and Windows debug-build checks. Existing unrelated working-tree edits to the sort layout and this progress file remain intact.

## Native analytics verification (2026-11-13)

**Actual Windows desktop checks:** Launched the standalone release executable in a native window. Created a disposable project, registered a 250-row CSV through the native picker, and inspected its bounded preview and inferred schema. The fixture included numbers, text, booleans, dates, nulls, duplicates, and unusual column names; date values were classified as text. Ran a 50-row analytical page, which created `analytics.duckdb`. A nested `Category Name = A AND (Net $ >= 200 OR Net $ < 5)` filter returned the expected 28 rows. Exported that result through the native save dialog; the CSV had all seven headers, 28 rows, first order ID 2, last order ID 250, and a `Net $` sum of 5,856. The original fixture hash was unchanged before the deliberate source-change test. Closed the app normally, relaunched it, reopened the project through the native folder picker, and saw the registered source and two successful execution-history entries. The project DuckDB file persisted. After appending one row to the disposable source, the native UI marked it **Changed**, paused its preview, and did not offer analytics for that source. After renaming the disposable source, the UI marked it **Missing**.

**Cancellation:** A 42.8 MiB, 240,000-row disposable CSV was registered and materialized in the native app. The operation completed successfully before a cancellation request could be made, so native cancellation, post-cancel database usability, and recovery after cancellation were **not verified**. The existing automated cancellation-flag test passed, but it does not establish reliable native interruption.

**Automated checks:** `cargo test --offline --manifest-path apps/desktop/src-tauri/Cargo.toml` passed 17/17. `npm run build` passed after the small sort-control layout fix. `npm run tauri:build -- --debug` passed before that CSS fix; a repeat build after the fix was stopped when the user ended testing. The first non-elevated Vite build failed with Windows access denied while reading its config; the same build passed with the needed access.

**Bug fixed:** In the native window, adding a sort made the column and direction selectors collapse to tiny controls because the third selector took nearly all row width. The shared builder-row CSS now allocates width across its selectors. The frontend build passed; the corrected layout was not visually rechecked in a rebuilt native window.

**Not independently verified in this run:** Grouped aggregation, multiple sort results, page navigation, execution-detail values, native cancellation outcome, UI console diagnostics, and the corrected sort layout in a rebuilt native executable. The user indicated they had checked the remaining UI flows, but no results were supplied to record. No general SQL, Python, or agent functionality was tested.

## Standalone launch correction (2026-11-13)

The prior `npm run tauri:build -- --debug` executable opened a WebView that tried to reach the development server at port 1420. Launching it without Vite produced a “Can't reach this page” screen. A process-stays-running smoke check did not catch this; it was not proof that the UI loaded. The development URL now matches Vite's `127.0.0.1` listener. `npm run tauri:build` (without `--debug`) built `src-tauri/target/release/dataforge.exe`. Its visible native UI was subsequently verified in the disposable workflow recorded above.

## Rust-hosted analytics slice (2026-11-13)

- Embedded DuckDB 1.4.5 is integrated into the Rust host for on-demand registered-CSV representations, structured filtering/sorting/grouping, bounded pages, execution history, cancellation, and current-page CSV export. The UI is integrated into the existing dataset workspace. The Windows compatibility spike ran a real embedded query after linking the Windows Restart Manager library.
- The final-source Rust suite passed **17/17 tests** with `cargo test --offline --manifest-path apps/desktop/src-tauri/Cargo.toml`. This includes SQLite v1-to-v2 migration, interruption marking, materialization, operation validation, null handling, pagination, source-change checks, export escaping, source integrity, engine-version replacement, and persisted execution history.
- `npm run build` and `npm run tauri:build -- --debug` passed after the production changes. The debug executable's process remained running briefly, but its WebView later showed an unreachable development URL without Vite. The standalone release build was used for the native verification above.

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
| Release executable launch | Launched without Vite; visible native UI and the disposable analytics workflow were inspected in the later verification above. |
| `npm run tauri:dev` | Started successfully; a triggered Rust rebuild completed and relaunched the app without Vite's earlier `EBUSY` DLL watcher error (2026-11-13). |

The build checks alone did not constitute a manual end-to-end test; the later native verification is recorded above. `cargo fmt --check` could not run because `rustfmt` is not installed in the local toolchain.

## First-slice verification (2026-11-13)

Disposable Rust fixtures under the system temporary directory exercised project creation and reopening, persisted dataset registration, a known CSV profile (names, types, nulls, distinct counts, min/max/mean), 2-row preview of a 3-row file, duplicate registration, changed and missing source detection, invalid and corrupted projects, unsupported files, malformed and empty CSVs, a 20,050-row CSV with the 20,000-row scan cap and 100-row preview, and an overlong cell. Fixture source bytes were checked after registration and inspection. All 8 backend tests passed.

Two reproducible bugs were fixed: boolean-only columns were classified as text; and a preview with a cell clipped at 4,096 characters was labeled complete. Regression tests now cover both. The TypeScript/Vite production build passed after the fixes.

`npm run tauri:dev` launched the Windows app process without a backend error before it was stopped. The frontend startup and create-project dialog rendered in a browser preview, with no console warnings or errors observed there. This browser preview did not exercise Tauri commands or the native file picker.

The original first-slice verification did not exercise native window controls; the later native analytics verification above covers project creation/reopening, picker registration, source selection, and changed/missing status. Invalid/unsupported-file messages and measured UI responsiveness remain unverified in the native window. Bounded registration and profiling only validate the scanned portion of a large CSV; later malformed rows can remain undetected.

## Still open

- Full Milestone 1 scope: additional file formats, worker/IPC integration, strict representation space quota, output hashes, and the stronger storage/recovery contract. The current Rust-hosted analytics slice was explicitly authorized before those larger proof gates were met.
- The proposed host-owned storage boundary in `spec/STORAGE_OWNERSHIP_DESIGN.md` has not been implemented or tested. The worker-fencing spike passed its direct Job Object cases but failed to prove the full old-worker guarantee; ADR 0009 remains proposed.
- General submitted SQL, generated Python, ACP/Codex integration, charts, reports, and database connectors are not implemented.
- No installer is produced. The app uses a pragmatic single-user local trust model and is not a filesystem or process sandbox. Profiling of large CSVs is partial, and fingerprinting reads the full source file. Analytics accepts CSVs up to 64 MiB/250,000 rows; persistent DuckDB file growth is not strictly capped. The 30-second interruption is best effort, not a process kill. Result pages are transient, and export refuses an existing destination. Cross-store orphan cleanup and concurrent-host exclusion remain unimplemented. Date inference and some native analytics flows remain unverified.

## Next verification

When testing resumes, verify the corrected sort layout in a rebuilt native executable and exercise grouped results, pagination, and cancellation with an operation long enough to expose the Cancel control. Check console diagnostics and native error states. Keep full Milestone 1 worker/recovery work behind the existing review and proof gates.

## Maintenance

Update this file after meaningful implementation or verification work. Record the date, what actually changed, exact checks and outcomes, current limitations, and the next concrete task. Do not turn planned work or experiment-only results into claims about the application.
