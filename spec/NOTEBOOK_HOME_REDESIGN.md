# Notebook Home redesign: project resource browser

**Status:** Home composition and the later compact-control/sidebar refinements are implemented in source. Browser preview checks used an in-memory fixture; native Windows WebView2 acceptance remains open.

**Status:** Implementation specification, 2026-11-20. This is a source-based design decision, not a rendered validation or an implemented screen. The active contracts in `spec/DESIGN_SYSTEM.md`, `spec/UX_SPEC.md`, and `spec/NOTEBOOK_VISUAL_SYSTEM.md` govern implementation.

## 1. Objective and visual direction

Notebook Home is a compact browser for the active project's analytical documents. Its visual anchor is a scannable, flat resource list: notebook names lead, modification and cell count help identify a document, and management stays in a row menu. Borrow the clarity and density of a Databricks workspace browser, while retaining DataForge's quiet dark workbench, project scope, and actual capabilities. There are no notebook cards, activity dashboard, fabricated notebooks, folders, or execution statistics.

The operating path is **project context → Notebooks → search or scan → open**, with **New Notebook** visible in the heading. This is an Operate surface in Impeccable terms: predictable alignment, stable controls, readable hierarchy, and responsive information priority matter more than decoration. The existing 30/13/12/11/10 px type roles and 4 px spacing scale supply the needed contrast. The source-based Impeccable layout and type detector returned `[]` for `Notebook.tsx` and `styles.css`; that is only a mechanical result, not proof of visual quality.

## 2. Final page composition and textual blueprint

The native title bar, 44 px global toolbar, and resizable shared Chat/Notebook sidebar remain shell-owned. In Notebook mode, Threads collapses and Sources rises to fill the available sidebar space; returning to Chat restores Threads. Home scrolls inside the central workspace. The Home eyebrow repeats the active project name with the existing Current project fallback. **[Presentation-only for Home; interaction refinement for mode transition]**

Within the central track, use one left-aligned content column with `--space-page` (32 px) side margins when room permits and a maximum content width of 1120 px. Reduce margins to `--space-panel` (16 px) when the center track is at most 700 px wide. The content order and alignment are:

```text
Global toolbar (unchanged)
Sources sidebar (optional) │ Central Notebook Home scroll area
                           │ [project name eyebrow]
                           │ Notebooks                  [New Notebook]
                           │ Keep notes, code, and saved analytical results together.
                           │
                           ? [Search notebooks____] [Last modified v]
                           │
                           │ ┌──────────────────────────────────────────────────────┐
                           │ │ NAME                 MODIFIED       CELLS   ACTIONS │
                           │ │ notebook icon  Title  local date       count    ⋯   │
                           │ │ …                                                    │
                           │ └──────────────────────────────────────────────────────┘
```

Project eyebrow, heading, and description form a tight left stack. Align the small primary `New Notebook` Button with the Notebooks title line. Use `--space-section` (24 px) between heading and controls, `--space-4` (16 px) between controls and list, and `--space-2`/`--space-1` within the text stack. The description is one factual line. The list's small notebook icon provides resource identity. **[Presentation-only]**

The global error area, when populated by a later refresh or management failure, appears immediately below the heading and before the controls. It displays the existing error message and leaves previously loaded rows visible. No error is styled as a successful zero-notebook result. This relocates existing feedback without changing its state logic. **[Presentation-only]**

## 3. Notebook resource list

Keep the existing **composed grid list**, not the shared Table. The list contains an open button filling the name column, a separate menu trigger, and an inline rename form; it is a resource browser rather than tabular analytical data. A native Table would complicate row navigation and interactive-cell semantics, while `spec/DESIGN_SYSTEM.md` explicitly reserves its shared Table family for data/results and keeps Home rows custom. The grid must align its header and rows with the same column definition. **[Presentation-only]**

At a center track wider than 700 px, use four columns: `minmax(0, 1fr)` name, 185 px modified, 65 px cells, and 28 px actions; use `--space-3` gaps and `--space-panel` horizontal row inset. Name gets all remaining width and truncates after it, never forcing the page to scroll horizontally. The header is a 36 px, low-contrast strip with `Name`, `Modified`, `Cells`, and a screen-reader-only `Actions` label. Row height is at least 52 px with a 1 px divider. Modified and cell values align with their headers; numeric count uses tabular numerals. A count of zero is `0`, not an empty cell. **[Presentation-only]**

The first column is a semantic button containing a 16 px Lucide notebook icon and title. Use `--font-size-component` (13 px), medium weight, and `--color-text` for the title; the icon uses `--color-accent` without becoming an oversized tile. A long title has one line with ellipsis; the button's full text remains available to assistive technology, and a native `title` exposes it on hover. Modified time is the actual local display of `updated_at`, in secondary 11 px muted text; the cell count is the persisted `block_count`, also secondary. Do not add owner, folder, source, status, or last-run metadata that the summary does not provide. **[Presentation-only]**

Only the title/open button navigates. Clicking date/count whitespace does nothing; clicking the menu trigger opens actions and must not open the notebook. Enter/Space on the open button opens it; menu keyboard behavior comes from the shared DropdownMenu. Keep the current save-pending-rename-before-open path and busy disabling. **[Interaction refinement]** The refinement is a clearer hit area and event boundary; it does not change the data operation.

Resting rows use the list surface and a fine separator, with no individual card border or shadow. Hover uses `--color-surface-secondary`; focus-visible stays a 2 px `--color-focus-ring` outline on the actual open button/menu trigger. When a row menu is open or focus remains inside that row, a quiet `--color-selected` row background can locate the action. This is **transient action context**, not persistent notebook selection: Home has no selection model, and opening a notebook leaves Home. No new selected notebook state is proposed. **[Presentation-only]**

## 4. Search, sort, creation, and management

`New Notebook` is the sole primary Button, small 28 px, with a 16 px Plus icon and visible label. It creates the existing untitled notebook and opens Editor immediately. Disable it during initial loading, initial error/retry, or an in-flight mutation as current code does. **[Presentation-only]**

Search is a labeled shared Input in a 28 px Notebook-owned container with a 16 px Search icon and one enclosing focus treatment. It searches titles only, case-insensitively, using the current `filterNotebooks` behavior. Give search flexible width up to 280 px; the accessible label is “Search notebooks.” The shared native Select sits immediately beside it at 28 px high and 120 px wide, with a screen-reader-only “Sort notebooks” label and the existing `Last modified` (newest first) and `Name` (A–Z) choices. Both fields are disabled until the initial list is ready; they remain usable with a successfully loaded empty project. **[Presentation-only]**

The row's 28 px `⋯` action is a shared `DropdownMenuTrigger` composed with the shared `Button variant="icon"` presentation (the Button maps this variant to its 28 px icon size). Give it an accessible name including the notebook title and a shared Tooltip labeled “Notebook actions”; verify that the Base UI trigger and Tooltip composition preserves opening, focus return, and event isolation. Keep the trigger visibly present at rest, including at narrow widths, so actions do not depend on hover. The shared `DropdownMenuContent`, `DropdownMenuItem`, and separator supply `Rename` and destructive `Delete`; there is no right-click-only action. **[Presentation-only; interaction refinement for trigger composition verification]**

Rename remains **inline in that row**. Replace the title/open button and metadata area with the shared 36 px Input (`Notebook title`, 120 character limit), followed by shared `Button size="small"` Save and ghost Cancel; leave the row menu column in place. Focus the Input, preserve the current dirty/discard protection and save-before-other-action behavior, and keep validation/error feedback visible without losing the draft. At narrow widths, the input occupies a full first line and Save/Cancel sit on a second line; do not squeeze all three into the title column. **[Presentation-only]**

Delete remains inside the menu and opens the existing shared `ConfirmationDialog`. The text names the notebook, says all its cells will be deleted, and says the action cannot be undone; Cancel receives initial focus, and the destructive Delete Button confirms. Do not add swipe deletion or direct row trash icons. **[Presentation-only]**

## 5. Home states

All state content uses the same list region, with the heading still visible. Keep the shared control enabled/disabled and `aria-busy` behavior. State text is readable without relying on color.

| State | Visible list-region treatment | Classification |
| --- | --- | --- |
| Initial loading | Quiet, left-aligned `Loading notebooks…` status in the list frame; no header row, fake skeleton rows, or empty-project claim. New/Search/Sort remain disabled. | Presentation-only |
| Successful empty project | Omit the column header. Show a calm centered `Your notebooks start here` heading and the existing factual explanation that notebooks can hold text, code and saved analytical results. The heading's `New Notebook` remains the single primary creation control; an inline text cue can point to it. Remove the duplicate primary Create Notebook button inside the empty panel. | Presentation-only |
| Search with no matches | Omit the column header but keep the search text and sort choice visible; show `No matching notebooks` and `Try a different search.` inside the list frame. Do not suggest the project is empty or show a second creation action. | Presentation-only |
| Successful non-empty list | Show the aligned header and all filtered/sorted rows. Metadata comes only from each real summary. | Presentation-only |
| Initial loading failure | In the list frame show `Could not load notebooks`, the actual error text (or existing fallback), and a shared secondary Retry Button. Do not show cached or zero rows as if they were a successful load. | Presentation-only |
| Retry in progress | Keep the failure context; Button says `Retrying…`, has shared loading/busy treatment, and cannot be activated again until the request settles. Success transitions to rows/empty; failure returns to Retry. | Presentation-only |
| Later refresh or mutation error | Keep the last successfully loaded list and show an alert before controls. Do not clear rows or infer a current zero count from the failure. | Presentation-only |
| Rename / delete | Inline rename and shared destructive confirmation appear over the loaded list. During mutation, disable conflicting actions; preserve title draft and current error handling. | Presentation-only |

Changing the successful empty state to one visible create button removes duplicate presentation; it does not remove creation behavior. No new state transition, persistence rule, or host command is required by this specification.

## 6. Responsive layout and overflow

Use the **central workspace container width** for the breakpoint. The 900 px window can leave about 560 px for the center with Sources at 340 px; default 248 px leaves about 652 px. Keep 210?340 px resizing and optional collapse. The mode transition collapses Threads with reduced-motion support and lets Sources fill the sidebar. **[Presentation-only for Home; interaction refinement for mode transition]**

| Window and actual center | Composition | Visible resource information |
| --- | --- | --- |
| **1440 x 900**, Sources at default 248 px: center about 1192 px; content capped at 1120 px. At 340 px: center about 1100 px. | Small New Notebook aligns with title. Search up to 280 px and sort at 120 px sit together in one 28 px row. Four-column list begins below. Sources fills the sidebar. | Real modified display, numeric cell count, persistent row menu; long titles truncate without page overflow. |
| **900 x 600**, Sources at default 248 px: center about 652 px; at 340 px: about 560 px; at 210 px: about 690 px. | Two-line resource rows at center widths at most 700 px. Keep New Notebook beside title until zoom requires wrap. Search and sort remain adjacent; search shrinks first. Focus order: create, search, sort, list. | Title and menu first; real modified display and N cells beneath. Metadata may wrap. Header reduces to Name with screen-reader Actions. |

At narrow center widths, use minmax(0, 1fr) plus a 28 px action track, 8 px gap and 16 px inset. Give title first claim on width. The two-line row may grow beyond 52 px. Menus stay viewport-aware. Long names truncate visually but retain accessible text. Search shrinks before the 120 px sort Select; both stay visible on one row at target sizes. At greater zoom or longer translations, controls may wrap in DOM order. **[Presentation-only]**

The Home scroll area takes the remaining height beneath the global toolbar. At 900 × 600, the heading/control stack should stay compact enough to expose the start of the list without scrolling when rows exist; the list itself may continue below the viewport through the existing workspace scroll. This is an implementation acceptance check, not a rendered claim.

## 7. Shared shadcn component mapping

No missing shared primitive is required. Keep the installed Base UI implementation for Button, Input, Menu, Tooltip, and Dialog; native Select remains the shared Select. No Radix, Card, Tabs, Skeleton, Context Menu, or new dependency.

| Home element | Component, variant / size, and composition | Change class |
| --- | --- | --- |
| Project eyebrow, heading, description | Semantic text in Notebook-owned heading layout; existing type/color tokens, no new component | Presentation-only |
| New Notebook | Shared Button primary / small, Plus icon | Presentation-only |
| Search | Shared Input in a labeled 28 px search container; Search icon and focus treatment | Presentation-only |
| Sort | Shared native Select, 28 px high and 120 px wide, with screen-reader-only label | Presentation-only |
| Resource list/header/open area | Notebook-owned semantic grid and native open button; shared token states; shared `Table` deliberately not used | Presentation-only; interaction refinement for click boundary |
| Row menu | `DropdownMenu` family with shared `Button variant="icon"` trigger (28 px by variant) and shared `Tooltip` if composition permits; destructive item | Presentation-only; interaction refinement for trigger verification |
| Inline rename | `Input` default; `Button` secondary / small Save and ghost / small Cancel | Presentation-only |
| Delete | Existing `ConfirmationDialog` with destructive confirm and Cancel first | Presentation-only |
| Loading / retry / empty | Contextual list-region text; `Button` secondary / default Retry; heading primary remains creation action | Presentation-only |
| Error feedback | Existing alert text/status semantics in a Notebook-owned placement | Presentation-only |

## 8. Typography, spacing, and surface rules

Use `--font-family-ui` throughout. Project eyebrow and list labels use meta 10 px; `Notebooks` uses title 30 px/semibold; supporting description and state copy use body 12 px; resource title uses component 13 px/medium; modified/count use secondary 11 px. Keep the existing local date format and numeric count rather than inventing a relative-time scale. The narrow metadata line can use secondary text, not a new micro size. **[Presentation-only]**

Home background is `--color-surface`; list frame is the existing neutral sidebar/secondary surface with one 1 px border and `--radius-large` outer corners. Header is `--color-surface` with a bottom border. Rows have a 1 px divider, no shadow, and token hover/selected context only. Shared fields, menu, Tooltip and Dialog own their own surfaces and focus styles. Use 32/24/16/12/8/4 px roles from the existing spacing tokens, 36 px normal controls, 28 px icon/small controls, and 16 px list/control icons. Do not introduce a new global token, radius, or color. **[Presentation-only]**

## 9. Current implementation status

The Home source now uses the approved heading/list composition, compact adjacent controls, four-column wide rows and two-line narrow rows. Creation, opening, title search, sorting, inline rename, confirmed deletion, initial loading, error/retry, empty project, no-match and later-error states retain their existing behavior. The row menu uses the shared icon Button and Dropdown Menu. The shared shell collapses Threads when entering Notebook and lets Sources fill the sidebar; returning to Chat restores Threads. No backend, schema, token or shared-component variant changed.

The earlier gaps concerning the decorative heading icon, duplicate empty-state create action, narrow four-column squeeze, local row-menu trigger, title hierarchy and later-error placement were addressed in the Home implementation. Persistent selection, bulk actions, folders, richer metadata and date preferences remain outside scope because they require new behavior or contracts.

## 10. Remaining acceptance work

1. Inspect the native Windows WebView2 Home at 1440 x 900 and 900 x 600 with Sources at 210, 248 and 340 px and collapsed. Verify the sidebar transition, reduced-motion behavior and keyboard focus.
2. Exercise real project data for long titles, many rows, delayed/failed initial load, retry, rename, delete confirmation, search-empty and later refresh errors. Check menu focus return, zoom and horizontal overflow.
3. Keep the browser fixture explicitly labeled synthetic. Its current 900 x 600 and 1440 x 900 checks support layout review but do not clear native or persistence acceptance.
