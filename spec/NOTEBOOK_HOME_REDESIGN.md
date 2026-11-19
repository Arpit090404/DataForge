# Notebook Home redesign: project resource browser

**Status:** Implementation specification, 2026-11-20. This is a source-based design decision, not a rendered validation or an implemented screen. The active contracts in `spec/DESIGN_SYSTEM.md`, `spec/UX_SPEC.md`, and `spec/NOTEBOOK_VISUAL_SYSTEM.md` govern implementation.

## 1. Objective and visual direction

Notebook Home is a compact browser for the active project's analytical documents. Its visual anchor is a scannable, flat resource list: notebook names lead, modification and cell count help identify a document, and management stays in a row menu. Borrow the clarity and density of a Databricks workspace browser, while retaining DataForge's quiet dark workbench, project scope, and actual capabilities. There are no notebook cards, activity dashboard, fabricated notebooks, folders, or execution statistics.

The operating path is **project context → Notebooks → search or scan → open**, with **New Notebook** visible in the heading. This is an Operate surface in Impeccable terms: predictable alignment, stable controls, readable hierarchy, and responsive information priority matter more than decoration. The existing 30/13/12/11/10 px type roles and 4 px spacing scale supply the needed contrast. The source-based Impeccable layout and type detector returned `[]` for `Notebook.tsx` and `styles.css`; that is only a mechanical result, not proof of visual quality.

## 2. Final page composition and textual blueprint

The native title bar, 44 px global toolbar, optional resizable Sources sidebar, and central workspace remain shell-owned. Home scrolls inside the central workspace; it does not create an inspector, composer, or another navigation rail. The top toolbar already identifies the project, and the Home eyebrow repeats its name to make the list's scope unambiguous. If the name is unavailable, retain the existing “Current project” fallback; never imply a cross-project list. **[Presentation-only]**

Within the central track, use one left-aligned content column with `--space-page` (32 px) side margins when room permits and a maximum content width of 1120 px. Reduce margins to `--space-panel` (16 px) when the center track is at most 700 px wide. The content order and alignment are:

```text
Global toolbar (unchanged)
Sources sidebar (optional) │ Central Notebook Home scroll area
                           │ [project name eyebrow]
                           │ Notebooks                  [New Notebook]
                           │ Keep notes, code, and saved analytical results together.
                           │
                           │ [Search notebooks____________]  Sort by [Last modified v]
                           │
                           │ ┌──────────────────────────────────────────────────────┐
                           │ │ NAME                 MODIFIED       CELLS   ACTIONS │
                           │ │ notebook icon  Title  local date       count    ⋯   │
                           │ │ …                                                    │
                           │ └──────────────────────────────────────────────────────┘
```

Project eyebrow, heading, and description form a tight left stack. The primary `New Notebook` Button aligns with the heading block's upper half at wide widths, never with the list header. Use `--space-section` (24 px) between heading and controls, `--space-4` (16 px) between controls and list, and `--space-2`/`--space-1` within the text stack. The description is one factual line, not a second feature pitch. Remove the large decorative notebook icon from the heading; the list's small notebook icon is enough identity. **[Presentation-only]**

The global error area, when populated by a later refresh or management failure, appears immediately below the heading and before the controls. It displays the existing error message and leaves previously loaded rows visible. No error is styled as a successful zero-notebook result. This relocates existing feedback without changing its state logic. **[Presentation-only]**

## 3. Notebook resource list

Keep the existing **composed grid list**, not the shared Table. The list contains a full-width open button, a separate menu trigger, and an inline rename form; it is a resource browser rather than tabular analytical data. A native Table would complicate row navigation and interactive-cell semantics, while `spec/DESIGN_SYSTEM.md` explicitly reserves its shared Table family for data/results and keeps Home rows custom. The grid must align its header and rows with the same column definition. **[Presentation-only]**

At a center track wider than 700 px, use four columns: `minmax(0, 1fr)` name, 185 px modified, 65 px cells, and 28 px actions; use `--space-3` gaps and `--space-panel` horizontal row inset. Name gets all remaining width and truncates after it, never forcing the page to scroll horizontally. The header is a 36 px, low-contrast strip with `Name`, `Modified`, `Cells`, and a screen-reader-only `Actions` label. Row height is at least 52 px with a 1 px divider. Modified and cell values align with their headers; numeric count uses tabular numerals. A count of zero is `0`, not an empty cell. **[Presentation-only]**

The first column is a semantic button containing a 16 px Lucide notebook icon and title. Use `--font-size-component` (13 px), medium weight, and `--color-text` for the title; the icon uses `--color-accent` without becoming an oversized tile. A long title has one line with ellipsis; the button's full text remains available to assistive technology, and a native `title` exposes it on hover. Modified time is the actual local display of `updated_at`, in secondary 11 px muted text; the cell count is the persisted `block_count`, also secondary. Do not add owner, folder, source, status, or last-run metadata that the summary does not provide. **[Presentation-only]**

Only the title/open button navigates. Clicking date/count whitespace does nothing; clicking the menu trigger opens actions and must not open the notebook. Enter/Space on the open button opens it; menu keyboard behavior comes from the shared DropdownMenu. Keep the current save-pending-rename-before-open path and busy disabling. **[Interaction refinement]** The refinement is a clearer hit area and event boundary; it does not change the data operation.

Resting rows use the list surface and a fine separator, with no individual card border or shadow. Hover uses `--color-surface-secondary`; focus-visible stays a 2 px `--color-focus-ring` outline on the actual open button/menu trigger. When a row menu is open or focus remains inside that row, a quiet `--color-selected` row background can locate the action. This is **transient action context**, not persistent notebook selection: Home has no selection model, and opening a notebook leaves Home. No new selected notebook state is proposed. **[Presentation-only]**

## 4. Search, sort, creation, and management

`New Notebook` is the sole primary Button, default 36 px, with a 16 px Plus icon and visible label. It creates the existing untitled notebook and opens Editor immediately. Disable it during initial loading, initial error/retry, or an in-flight mutation as current code does. **[Presentation-only]**

Search is a labeled shared Input, default 36 px, with a 16 px Search icon in a Notebook-owned container; keep one visible enclosing focus treatment. It searches titles only, case-insensitively, using the current `filterNotebooks` behavior. Give search the flexible width, capped near the current 380 px; the accessible label is “Search notebooks.” Sorting is the shared native Select, default 36 px, visually paired with the visible `Sort by` label and only the existing `Last modified` (newest first) and `Name` (A–Z) choices. Both fields are disabled until the initial list is ready; they remain usable with a successfully loaded empty project. **[Presentation-only]**

The row's 28 px icon-sized `⋯` action is a shared `DropdownMenuTrigger` composed with a shared `Button variant="icon"` presentation. Give it an accessible name including the notebook title and a shared Tooltip with the visible label “Notebook actions”; verify that the Base UI trigger and Tooltip composition preserves opening, focus return, and event isolation. Keep the trigger visibly present at rest, including at narrow widths, so actions do not depend on hover. The shared `DropdownMenuContent`, `DropdownMenuItem`, and separator supply `Rename` and destructive `Delete`; there is no right-click-only action. **[Presentation-only; interaction refinement for trigger composition verification]**

Rename remains **inline in that row**. Replace the title/open button and metadata area with the shared 36 px Input (`Notebook title`, 120 character limit), followed by shared `Button size="small"` Save and ghost Cancel; leave the row menu column in place. Focus the Input, preserve the current dirty/discard protection and save-before-other-action behavior, and keep validation/error feedback visible without losing the draft. At narrow widths, the input occupies a full first line and Save/Cancel sit on a second line; do not squeeze all three into the title column. **[Presentation-only]**

Delete remains inside the menu and opens the existing shared `ConfirmationDialog`. The text names the notebook, says all its cells will be deleted, and says the action cannot be undone; Cancel receives initial focus, and the destructive Delete Button confirms. Do not add swipe deletion or direct row trash icons. **[Presentation-only]**

## 5. Home states

All state content uses the same list region, with the heading still visible. Keep the shared control enabled/disabled and `aria-busy` behavior. State text is readable without relying on color.

| State | Visible list-region treatment | Classification |
| --- | --- | --- |
| Initial loading | Quiet, left-aligned `Loading notebooks…` status in the list frame; no header row, fake skeleton rows, or empty-project claim. New/Search/Sort remain disabled. | Presentation-only |
| Successful empty project | Calm centered `Your notebooks start here` heading and the existing factual explanation that notebooks can hold text, code and saved analytical results. The heading's `New Notebook` remains the single primary creation control; an inline text cue can point to it. Remove the duplicate primary Create Notebook button inside the empty panel. | Presentation-only |
| Search with no matches | Keep the search text and sort choice visible; show `No matching notebooks` and `Try a different search.` inside the list frame. Do not suggest the project is empty or show a second creation action. | Presentation-only |
| Successful non-empty list | Show the aligned header and all filtered/sorted rows. Metadata comes only from each real summary. | Presentation-only |
| Initial loading failure | In the list frame show `Could not load notebooks`, the actual error text (or existing fallback), and a shared secondary Retry Button. Do not show cached or zero rows as if they were a successful load. | Presentation-only |
| Retry in progress | Keep the failure context; Button says `Retrying…`, has shared loading/busy treatment, and cannot be activated again until the request settles. Success transitions to rows/empty; failure returns to Retry. | Presentation-only |
| Later refresh or mutation error | Keep the last successfully loaded list and show an alert before controls. Do not clear rows or infer a current zero count from the failure. | Presentation-only |
| Rename / delete | Inline rename and shared destructive confirmation appear over the loaded list. During mutation, disable conflicting actions; preserve title draft and current error handling. | Presentation-only |

Changing the successful empty state to one visible create button removes duplicate presentation; it does not remove creation behavior. No new state transition, persistence rule, or host command is required by this specification.

## 6. Responsive layout and overflow

Use the **central workspace container width** for the breakpoint, as current CSS already does. The 900 px window can leave only about 560 px for the center when Sources is at its 340 px maximum; the default 248 px sidebar leaves about 652 px. A viewport-only 850 px rule misses this variation. The existing 210–340 px sidebar and collapse behavior stay untouched. **[Presentation-only]**

| Window and actual center | Composition | Visible resource information |
| --- | --- | --- |
| **1440 × 900**, Sources open at default 248 px: center about 1192 px; content capped at 1120 px. With Sources at 340 px: center about 1100 px. | Heading stack and New Notebook share the first group. Search stays left and sort right in one 36 px control row. Four-column list begins below. | Title, full local modified display, numeric cell count, and persistent menu trigger. Long titles truncate within name column; no horizontal page overflow. |
| **900 × 600**, Sources open at default 248 px: center about 652 px; at 340 px: about 560 px; at 210 px: about 690 px. Content width is roughly 528–658 px after 16 px side margins. | Use a two-line resource row at center widths ≤700 px. Heading keeps project, title, description and primary action above controls; action may wrap beneath the title stack if text or zoom requires. Search takes the available first line and sort wraps to the next line when needed. Keep DOM and focus order: heading action, search, sort, then list. | Name and persistent 28 px menu occupy the first line. Under the name, show the real modified display and `N cells` in secondary text; allow that metadata to wrap rather than clip. The header reduces to `Name` with screen-reader `Actions`; no empty Modified/Cells headers. |

At narrow center widths, use `minmax(0, 1fr)` plus a 28 px action track, `--space-2` gap, and `--space-panel` horizontal inset. Give the title first claim on width. The two-line row can grow beyond 52 px; never use a fixed height that clips text or the menu. The menu popup remains portalled and viewport-aware. The list frame must not create page-wide horizontal scrolling; very long unbroken names truncate visually but keep their full accessible text. Search may grow to full width, and the sort label/select remain visible rather than becoming icon-only. At zoom or localization lengths that make the heading row too tight, wrap New Notebook onto its own line. **[Presentation-only]**

The Home scroll area takes the remaining height beneath the global toolbar. At 900 × 600, the heading/control stack should stay compact enough to expose the start of the list without scrolling when rows exist; the list itself may continue below the viewport through the existing workspace scroll. This is an implementation acceptance check, not a rendered claim.

## 7. Shared shadcn component mapping

No missing shared primitive is required. Keep the installed Base UI implementation for Button, Input, Menu, Tooltip, and Dialog; native Select remains the shared Select. No Radix, Card, Tabs, Skeleton, Context Menu, or new dependency.

| Home element | Component, variant / size, and composition | Change class |
| --- | --- | --- |
| Project eyebrow, heading, description | Semantic text in Notebook-owned heading layout; existing type/color tokens, no new component | Presentation-only |
| New Notebook | `Button` primary / default, Plus icon | Presentation-only |
| Search | `Input` default in labeled search container; Search icon and enclosing focus treatment | Presentation-only |
| Sort | `Select` default, native options, visible label | Presentation-only |
| Resource list/header/open area | Notebook-owned semantic grid and native open button; shared token states; shared `Table` deliberately not used | Presentation-only; interaction refinement for click boundary |
| Row menu | `DropdownMenu` family with shared `Button` icon / icon-size trigger and `Tooltip` if composition permits; destructive item | Presentation-only; interaction refinement for trigger verification |
| Inline rename | `Input` default; `Button` secondary / small Save and ghost / small Cancel | Presentation-only |
| Delete | Existing `ConfirmationDialog` with destructive confirm and Cancel first | Presentation-only |
| Loading / retry / empty | Contextual list-region text; `Button` secondary / default Retry; heading primary remains creation action | Presentation-only |
| Error feedback | Existing alert text/status semantics in a Notebook-owned placement | Presentation-only |

## 8. Typography, spacing, and surface rules

Use `--font-family-ui` throughout. Project eyebrow and list labels use meta 10 px; `Notebooks` uses title 30 px/semibold; supporting description and state copy use body 12 px; resource title uses component 13 px/medium; modified/count use secondary 11 px. Keep the existing local date format and numeric count rather than inventing a relative-time scale. The narrow metadata line can use secondary text, not a new micro size. **[Presentation-only]**

Home background is `--color-surface`; list frame is the existing neutral sidebar/secondary surface with one 1 px border and `--radius-large` outer corners. Header is `--color-surface` with a bottom border. Rows have a 1 px divider, no shadow, and token hover/selected context only. Shared fields, menu, Tooltip and Dialog own their own surfaces and focus styles. Use 32/24/16/12/8/4 px roles from the existing spacing tokens, 36 px normal controls, 28 px icon/small controls, and 16 px list/control icons. Do not introduce a new global token, radius, or color. **[Presentation-only]**

## 9. Current implementation gaps

1. `Notebook.tsx` already has real search, sort, creation, inline rename, confirmed deletion, and distinct list statuses. Its empty-project branch duplicates the primary creation action. The current heading also spends space on a 38 px decorative icon. **[Presentation-only]**
2. `styles.css` uses four narrow columns down to a 560 px center track. That reserves only 95 px for a full local date and 30 px for a cell count, and it reduces row padding/spacing instead of changing the information layout. The breakpoint must follow the center container. **[Presentation-only]**
3. The row menu trigger has local `notebook-menu-trigger`/`notebook-cell-menu` styling. A shared Button visual can replace the ordinary control skin after its Base UI trigger composition is checked. **[Interaction refinement]**
4. The open button currently uses body 12 px title text; this gives the notebook name too little priority against a 30 px page heading and a table-like header. Use the existing 13 px component role. **[Presentation-only]**
5. The loaded-row error is rendered above the entire Notebook workspace. Position it with the Home heading and controls so recovery context stays attached to this list; keep the current error state and rows. **[Presentation-only]**
6. No persistent Home selection exists. Adding multi-select, bulk actions, folders, richer metadata, or a new date-format preference would require changes to existing behavior or data contracts and is outside this design. **[Requires changes to existing behavior — explicitly deferred]**

## 10. Small implementation tasks, in priority order

1. **Responsive list composition — presentation-only.** Convert the ≤700 px central-container rows to title + second-line modified/cell metadata + persistent action track. Align header variants and test long names and dates at sidebar widths 210, 248, and 340 px.
2. **Heading and controls — presentation-only.** Remove the decorative heading icon, apply documented type/spacing roles, keep one primary New Notebook action, and ensure search/sort wrap in DOM order.
3. **Row hierarchy and focus — presentation-only; interaction refinement.** Give title the component role, align the four wide columns, define hover/focus/menu-open context, and keep title/menu hit areas separate.
4. **Shared management controls — presentation-only; interaction refinement.** Compose the row menu trigger with shared Button styling; verify pointer and keyboard opening, focus return, popup placement, and no accidental row open. Lay out rename at both widths; retain current draft/error and delete-confirmation paths.
5. **Truthful state polish — presentation-only.** Place loading, initial error/retry, project-empty, search-empty and later refresh feedback in the specified hierarchy. Keep rows on refresh failure and remove the duplicate empty-state CTA.
6. **Rendered acceptance review — verification, no behavior change.** Inspect actual Home at 1440 × 900 and 900 × 600 with Sources open/closed and resizable, including long titles, many rows, empty/search-empty, delayed/failing load, retry, rename, and delete. Check focus, tooltip/menu placement, zoom, and no horizontal overflow. No rendered claim is made by this document.

No implementation task here requires a backend, schema, project-shell, global-token, or Editor change. The only changes to existing behavior mentioned above are expressly deferred.
