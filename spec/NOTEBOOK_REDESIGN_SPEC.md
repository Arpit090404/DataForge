# Notebook redesign: implementation specification

**Status:** Final visual specification, 2026-11-20. The specification phase is complete; implementation and rendered acceptance remain ahead. This consolidates `NOTEBOOK_REDESIGN_BASELINE.md`, `NOTEBOOK_REFERENCE_ANALYSIS.md`, `NOTEBOOK_VISUAL_SYSTEM.md`, `NOTEBOOK_HOME_REDESIGN.md`, `NOTEBOOK_EDITOR_LAYOUT.md`, and `NOTEBOOK_CELL_DESIGN.md`. It does not claim the proposed UI is implemented.

## 1. Vision and authority

Notebook is DataForge's project-scoped analytical document workspace. Home is a compact resource browser; Editor is one continuous document in which authored Text and Code and saved analytical Results remain distinguishable. Databricks informs the resource and document hierarchy, not its compute, collaboration, job, or Git features. Keep DataForge's quiet dark identity, balanced density, real project data, and truthful execution limits.

`spec/DESIGN_SYSTEM.md` and ADR 0010 govern tokens, sizing and the repository-owned shadcn-style layer. `spec/NOTEBOOK_VISUAL_SYSTEM.md` governs shared component choice. This document resolves Notebook-specific composition where the earlier screen documents differ; current source remains the behavior authority until implementation intentionally changes presentation. No new token, dependency, shell region, shared component or host contract is required.

### Resolved design decisions

| Topic | Final rule | Reason and source |
| --- | --- | --- |
| Type | Use existing UI roles: 30 px page/Markdown H1, 20 px Editor title/Markdown H2, 13 px resource title/Markdown prose/H3, 12 px controls and Code, 11 px supporting/table text, 10 px labels and dense state. Code uses the code family; everything else uses the UI family. | Resolves local 17/22/25 px Editor/Home and 24/19/15 px Markdown headings without new scale. `DESIGN_SYSTEM.md`, visual system and cell spec. |
| Space and controls | 4 px token steps; 32 px page/canvas margin when center track allows, 16 px at narrow tracks; 24 px between major groups, 16 px between controls/list, 8–12 px within groups. Default controls 36 px, small 28 px; icon Button is 28 px square by its variant. | One rhythm across Home and Editor. `DESIGN_SYSTEM.md`; shared `Button` implementation. |
| Surfaces | `--color-surface` is the central Notebook canvas and sticky Editor header. Home list has one `--color-sidebar` frame with a `--color-border` edge; rows have no individual cards. Hover uses `--color-surface-secondary`, selection uses `--color-selected`, Code source may use `--color-code-surface` after rendered check. Only menus/popovers/dialogs float. | Resolves the Editor source's current sidebar background against the visual-system target, while retaining one restrained list frame. |
| Editor header | One sticky header row when the **center track** is above 900 px; two rows at or below 900 px. DOM order is Back, title/status, + Cell, Save, Shortcuts, No runtime. | Resolves the earlier wide ASCII sketch, which visually wrapped a one-row header. `NOTEBOOK_EDITOR_LAYOUT.md`. |
| Content width | One centered cell track, maximum 1120 px after side margins. Rendered Markdown prose is left-aligned within it at about 720 px; Code and Result may use the broad track. | Hybrid width protects reading while retaining analytical room. Editor and cell specs. |
| Cell sequence | Flat cells with one left selection edge, common label/action strip, 26 px boundary insertion band, no per-cell shadow/card. Code/Text insertion appears on boundary hover or keyboard focus only. | Preserves the reverted always-visible insertion decision. Editor and cell specs. |
| Tables | Use the existing shared native Table family within the Result's bounded `.table-scroll` (maximum 360 px high), with sticky headers, local horizontal overflow and real row-scope text. | No parallel table system or new Scroll Area. Cell spec and design system. |
| Metadata | Home shows actual title, local `updated_at` and `block_count` only. Result leads with real operation/source, then input summary, then recorded count/time; exact IDs and parameters stay in native details. | Matches available summaries and provenance; does not invent activity. Home and cell specs. |
| Menus | Standard triggers should use shared Button presentation composed with shared Base UI-backed Menu/Popover exports after focus/propagation verification. A named trigger is required; Tooltip is optional if composition is sound. | Existing shared wrappers own standard control appearance. No new variant or raw Base UI import. |

## 2. Home: final blueprint

The existing native title bar, global 44 px toolbar and optional resizable Sources sidebar remain shell-owned. Home occupies the central scroll area; it does not add an inspector or composer. Global project context stays visible, and the Home eyebrow repeats the active project name (`Current project` fallback) above the heading. At a wide center track, content is left-aligned within a centered maximum 1120 px column with 32 px side margins; at center widths at most 700 px, side margins are 16 px.

```text
Global toolbar / Sources sidebar: unchanged
Central Home:
  project name eyebrow
  Notebooks                                      [New Notebook]
  Keep notes, code, and saved analytical results together.
  [actual later error, if present]
  [Search notebooks__________________]        Sort by [Last modified ▾]
  ┌─────────────────────────────────────────────────────────────┐
  │ NAME                       MODIFIED          CELLS   ACTIONS │
  │ [notebook icon] Name       local date/time   count    [⋯]   │
  │ ...                                                         │
  └─────────────────────────────────────────────────────────────┘
```

The 30 px heading leads; the description is factual 12 px copy; `New Notebook` is the sole primary/default 36 px Button and remains top-aligned with the heading group. Search uses the shared 36 px Input in its existing labeled icon container, flexible up to roughly 380 px. Sort uses the shared 36 px native Select with only the existing `Last modified` and `Name` choices. Both operate on the current project list; search matches titles case-insensitively. **Files:** `Notebook.tsx`, `notebookHome.ts`, Home rules in `styles.css`. **Change:** presentation-only; filtering/sorting/creation behavior unchanged.

Use the existing **custom grid list**, since its open target, metadata, inline rename and separate action menu do not form an analytical data table. At center widths above 700 px, columns are `minmax(0,1fr) / 185px / 65px / 28px`, with 12 px gaps, 16 px row insets, a 36 px quiet header and at least 52 px rows. The name button fills **only the name column**; date/count whitespace does not open a notebook. The 16 px Lucide notebook icon and 13 px medium title lead. Title truncation preserves full accessible text and a native hover title. Modified shows the real local `updated_at`; count shows real `block_count`, including zero, with tabular numerals. The 28 px menu trigger stays visible at rest, separate from the open button. Hover is tonal; menu-open/focus context may use the selected surface but is not persistent selection. **Files:** `Notebook.tsx` row, `.notebook-home-*`; shared `DropdownMenu` and icon Button. **Change:** presentation-only, with a trigger/click-boundary interaction check.

Rename stays inline: shared Input (36 px, existing 120-character limit), small secondary Save and small ghost Cancel replace the row's title/metadata while preserving its menu track. Preserve draft/discard protection and save-before-other-action. Delete remains the destructive menu item followed by shared `ConfirmationDialog`, which names the notebook and consequences and focuses Cancel first. No bulk management or folder model. **Files:** `Notebook.tsx` Home form/menu; shared Input/Button/Menu/Dialog. **Change:** presentation-only, with focus and existing behavior verified.

| Home state | Final list-region treatment |
| --- | --- |
| Initial loading | `Loading notebooks…` as a quiet status; no rows, header, skeleton or successful-empty claim. Create/search/sort disabled. |
| Successful empty project | No column header. `Your notebooks start here` and the existing factual explanation. Keep only the heading's primary New Notebook action. |
| Search has no matches | Keep query/sort controls; no column header. `No matching notebooks` and `Try a different search.` No false project-empty claim. |
| Successful nonempty | Aligned header and real sorted/filtered rows. |
| Initial failure | `Could not load notebooks`, actual error or fallback and a secondary Retry Button; no false zero list. |
| Retry in progress | Retain failure context; disabled/loading `Retrying…` Button and status. |
| Later refresh/management error | Retain last successfully loaded rows; put actual error before controls. The shared error field can also contain an execution-history read error, so do not relabel every alert as a list failure. |

These are visual placements of existing state branches, not new host states. **Files:** `Notebook.tsx` Home branches and `.notebook-home-empty`; shared Button. **Change:** presentation-only.

## 3. Editor: final blueprint

One sticky Editor header sits above one vertically scrolling document. The global toolbar already conveys project location; Editor shows Back to Notebooks instead of a second breadcrumb. Do not reserve an inspector, composer or second notebook toolbar.

```text
Wide center track (>900 px): one header row
[← Notebooks] [Notebook title____________________] [Saved/Unsaved/Saving]
                                                  [+ Cell ▾] [Save] [Shortcuts] No runtime
──────────────────────────────────────────────────────────────────────────────
centered document track (≤1120 px)
  insertion boundary
  Text / Code / Result cell
  insertion boundary ...
  saved-execution picker after final boundary (when real executions exist)

Narrow center track (≤900 px): two header rows, same DOM order
[← Notebooks] [Notebook title____________________]
               Saved/Unsaved/Saving
[+ Cell ▾] [Save] [Shortcuts]                 No runtime
───────────────────────────────────────────────────
document track with 16 px side margins
```

The drawing's line break in the wide header is for legibility; all its controls occupy **one physical row**. Back is shared Button ghost/small and retains save-before-return. Title is the existing labeled shared Input, 36 px field height with 20 px section typography and a visible enclosing focus cue when borderless; its 120-character draft and persistence behavior remain. Status sits by the title wide and directly below it narrow. The command group keeps + Cell (shared Menu trigger presented as secondary/default Button), Save (secondary/default Button), Shortcuts (shared Popover trigger presented as ghost/small Button), then plain `No runtime` text with its factual native title. The + Cell menu still contains only Code/Text. At narrow widths status and runtime yield space before title or command labels; the second row may wrap at zoom. No new overflow menu or icon-only relabeling is needed for three existing commands. **Files:** `Notebook.tsx` Editor header, `.notebook-editor-toolbar`, `.notebook-title`, `.notebook-toolbar-actions`; shared Button/Input/Menu/Popover. **Change:** presentation-only, with composed-trigger interaction checks.

The canvas uses `--color-surface`, 32 px side margins above 900 px center width or 16 px at/below it, a 1120 px maximum cell track and roughly 720 px Markdown prose measure inside that track. Code and Result may use the full track. Keep source soft wrapping and local table/fenced-code scrolling; the document itself never scrolls horizontally. The header sticks at the top of the existing workspace scroll. Long cell sequences continue under it. The saved-execution picker stays after the last insertion boundary in document flow, with its shared Select/Button and native details; it is not a global command. **Files:** `.notebook-editor`, `.notebook-blocks`, `.notebook-add`, `Notebook.tsx`; shared Select/Button. **Change:** presentation-only.

## 4. Cell blueprints and causal identity

All cells share a common label/position strip, left selection edge, 12 px internal rhythm, consistent content inset and trailing 28 px actions menu. Use a neutral hover, `--color-selected` selected background, a 2 px focus ring, and a distinct editing-frame focus cue. Actual Unsaved and D-twice prompts remain textual. Keep a stable 26 px boundary between cells; + Code/+ Text appear there **only on hover or keyboard focus**, including first/last boundaries. The selected preview Code/Text Edit Button remains contextual. **Files:** `Notebook.tsx` cell sequence/`InsertionSlot`, `.notebook-block*`; shared ghost/small Edit Button, icon Button/Menu for actions. **Change:** presentation-only; existing shortcuts and insertion behavior preserved.

```text
Code:   [Code 2] [actual Unsaved]      [Python ▾] [Edit Code if selected] [⋯]
        [ ]  authored source in restrained code frame (12 px code / 1.6)
             No output · execution unavailable

Text:   [Text 3] [actual Unsaved]       [Edit Text if selected] [⋯]
        Heading, paragraphs, lists, links and code as document prose
        (edit: shared Textarea in quiet focus frame; preview: no field chrome)

Result: [Result 4]                                            [⋯]
        real operation · registered source
        concise saved inputs
        recorded row count · actual execution time
        Load / Replaying / Retry state, then bounded shared Table
        actual shown-row scope and replay caveat
        ▸ Execution details (exact IDs, fingerprint, engine, parameters)
```

**Code.** The shared native Select holds only per-cell Python/SQL metadata in the compact 28 px contextual size. The prompt remains `[ ]`, never a run count. Shared Textarea keeps current cursor, Tab indentation, draft and save behavior; its preview and editor align source text identically. Use the documented code-surface token with a thin border only if rendered review confirms separation. Editing focus moves to the enclosing source frame using the 2 px focus-ring token; the current 1 px accent outline is insufficient. The existing unavailable-output text is a quiet footer, never a generated output panel. No Run/Run All, kernel or new editor dependency. **Files:** `Notebook.tsx` Code branch, `.notebook-code-*`; shared Select/Textarea/Edit Button. **Change:** presentation-only.

**Text/Markdown.** Preview is rendered document content, not a card. Use a left-aligned ~720 px measure, 13 px prose and lists with ~1.65 line height, H1/H2/H3 at 30/20/13 px with weight/space hierarchy, and restrained H4–H6 using existing roles. Use token rhythm before headings, 12 px code font for inline/fenced code and local horizontal scroll for fenced code. Safe HTTP(S)/mailto links retain accent plus visible focus/hover; raw HTML stays text. The shared Textarea owns editing within a visible focus frame. Current Markdown supports headings, paragraphs, flat ordered/unordered lists, emphasis, links, inline/fenced code. Indented list items are **flattened** by the current renderer: true nested lists, tables, images and task lists are outside this presentation scope and must not be claimed. **Files:** `Markdown.tsx` output styles in `styles.css`, `.notebook-text-frame`; shared Textarea/Edit Button. **Change:** presentation-only; true nesting would be separate behavioral work.

**Result.** A Result is a reference to a saved application-defined execution, **not Code output**. Its header uses `describeNotebookExecution` and `registeredSourceName`, with real operation/source first, concise input summary next, then recorded count/time. Keep source-unavailable and missing-history fallbacks. The shared Table family dominates only after successful replay: real column names with types in a second line, compact shared padding, known numeric types aligned right, null shown as `null`, sticky header, bounded 360 px local vertical scroll and local horizontal scroll for wide tables. Long values remain in the DOM; visual clipping must not alter data, and a native title can expose the full value on hover. Keep `TableEmpty` for zero rows and the actual `Showing N rows`, `has_more`, pinned-representation replay and unsorted-order caveats below. Native `<details>` holds full execution ID, dataset ID, fingerprint, status, engine and original parameters. Before load, while replaying, on error/retry, and for a missing execution reference, preserve truthful current messages and keep identity visible. **Files:** `Notebook.tsx` `ResultBlock`, `notebookProvenance.ts` (reuse, no helper change needed), `.notebook-output`, `.table-scroll`; shared Table family and secondary/small Load/Retry Button. **Change:** presentation-only, including type-based alignment condition.

## 5. Consolidated shared-component contract

`apps/desktop/src/components/ui/` is the sole standard-control foundation. Its Base UI-backed elements stay behind the exports; native Select/Textarea/Table remain deliberate shared choices. The compositional owner is `Notebook.tsx`/Notebook CSS, not a new control library.

| Notebook element | Existing shared control / variant and size | Notebook composition or extension |
| --- | --- | --- |
| Home New / Editor Save / + Cell | `Button` primary/default for New; secondary/default for Save and + Cell | + Cell's shared `DropdownMenuTrigger` composes Button; verify trigger semantics. No new variant. |
| Home search/title/rename | `Input` default 36 px | Search icon container, borderless title frame and inline rename placement are Notebook-specific. |
| Home sort / Code language / saved execution | Shared native `Select` default 36 px; Code's existing contextual compact 28 px | Preserve native change events and popup. No global compact variant justified by one role. |
| Home row and cell menus | Shared `DropdownMenu` Content/Item/Separator; `Button variant="icon"` 28 px for trigger | Custom row/cell target names and menu contents; test `render` composition, focus, propagation. `IconButton`/Tooltip only if trigger composition works. |
| Back / Shortcuts / Edit / Retry | `Button` ghost/small Back, Shortcuts, Edit; secondary/default Home Retry; secondary/small Result Load/Retry | Shortcuts uses shared `Popover`; visible-text commands need no Tooltip. |
| Delete | Shared `ConfirmationDialog`, destructive confirm | Keep consequence text and Cancel-first focus. |
| Code/Text source | Shared native `Textarea` | Code prompt/frame and Markdown edit/preview are domain surfaces, not new form primitives. |
| Result evidence | Shared native `Table`, Header/Body/Row/Head/Cell/Empty | Bounded local overflow and provenance are Result-specific. |
| Status/provenance | Text with existing roles; native `<details>` | `Badge` remains for ready/changed/missing sources. No runtime or Result badge. |
| Canvas/rows/insertion | No generic primitive | Home grid, document cells and `InsertionSlot` are justified Notebook compositions with semantic native actions. |

No shared Separator, Scroll Area, Tabs, Skeleton or Context Menu exists or is required. Use CSS token borders for layout separators, `DropdownMenuSeparator` inside menus and native overflow/details for scrolling and disclosure. No Radix, raw Base UI imports in Notebook, new icon library, editor package or global design-system extension.

## 6. Responsive and state contract

Breakpoints follow `.main-workspace` **container width**, including sidebar resizing from 210 to 340 px and collapse. Do not derive Home or Editor layout solely from window width.

| Target | Home | Editor and cells |
| --- | --- | --- |
| **1440 × 900**: Sources open at default 248 px → center ~1192 px; at 340 px → ~1100 px; closed → ~1440 px. | 32 px side margins and max 1120 px content. Heading and New share top group; search left, sort right; four-column list with local date, count and persistent action. Name truncates without page overflow. | One sticky header row because center >900 px. Cell track max 1120 px; Markdown measure ~720 px, Code/Result broad. Long Code soft-wraps; fenced Markdown and Result table scroll locally; cells scroll vertically under header. |
| **900 × 600**: Sources open at 248 px → center ~652 px; at 340 px → ~560 px; at 210 px → ~690 px; closed → ~900 px. | At center ≤700 px, 16 px margins; heading action may wrap below identity. Full-width search on first control line and labeled sort on second. Two-line rows: title/menu first, actual modified time and `N cells` beneath; no Modified/Cells header. Rename Input then actions may take two lines. | At center ≤900 px, two-row sticky header; title/status before commands. 16 px canvas margins, cells use available width. Source and prose wrap; fenced code/table scroll within their own region. Metadata wraps before menu or title collapses. |

Home empty/search-empty/error states replace the list header; an initial load never claims success. Menus/popovers remain portalled, collision-aware and reachable near viewport edges. Search and long titles truncate or scroll inside their controls; content never forces workspace-wide horizontal overflow. At zoom or localization lengths, controls wrap in DOM order, focus remains visible, and the first populated cell should appear below the compact header at the minimum window. Cell menu and hover/focus insertion remain keyboard reachable. **Files:** `styles.css` Notebook `@container` and workspace rules; `Notebook.tsx` composition. **Change:** presentation-only.

## 7. Preserved behavior and product truth

- Creating, opening, renaming and deleting notebooks remain project-scoped. Back saves pending edits before Home; failure keeps the Editor open. Dirty titles, cell drafts and Home rename retain current protection.
- Existing command/edit shortcuts remain: Up/Down, Enter, A/B, D twice, Escape, Code Tab/Shift+Tab, Ctrl+Enter, Shift+Enter and Ctrl+S. Saving never runs Code. Existing menu insertion/movement and double-click editing remain.
- Python/SQL is per-Code-cell source metadata only. There is no general notebook execution runtime, Run/Run All, fabricated progress, computed Code output or agent result.
- A Result loads a bounded replay from a pinned representation on demand, can be unavailable, and may show different row order without a saved sort. Recorded count and displayed page count keep different labels. Exact provenance remains inspectable.
- The global shell, Sources resizing, application toolbar, mode switch and navigation relationships remain as implemented. The design stays useful without an agent.

## 8. Current implementation gaps

1. Local/raw standard trigger and Back styles compete with shared Button presentation; verify Base UI Menu/Popover trigger composition before removing local skins.
2. Home uses a decorative heading icon, duplicate empty-state create Button and four compressed columns even at a ~560 px center track. It needs the specified two-line rows and truthful state hierarchy.
3. Editor's current `@media(max-width:1050px)` wraps the title after commands with `order:3`; the new center-container rule must keep identity first and preserve a usable title width.
4. The current cell track reaches 1120 px but Markdown uses nearly all of it; the inner prose measure is missing. Editor canvas currently uses the sidebar surface and Code focus uses a 1 px accent outline.
5. Code/Result source hierarchy and Result metadata are visually crowded. Result table values have no numeric-type alignment; long values need source-based visual containment without changing replayed data.
6. Markdown's current 24/19/15 px headings and local 9/18 px margins drift from documented roles. Indented list items remain flat; true nesting is outside this visual implementation.
7. Native WebView2 visual/interaction acceptance at both target sizes, sidebar states, long content, replay states, menus and focus remains unverified. Prior source detectors returning `[]` do not clear this gap.

## 9. Small implementation roadmap

All tasks below preserve host commands and schema. Complete and review each task before the next dependent one; stop at its stated boundary. Focused checks are examples of the minimum relevant verification, with `git diff --check` after each edit. No full build/test suite is required by this specification task; implementation may choose tests appropriate to code changed.

| Order / scope | Files and dependency | Non-goal | Acceptance and focused verification | Stop condition |
| --- | --- | --- | --- | --- |
| **1. Shared trigger composition**: prove shared Button presentation for Menu/Popover triggers; use existing variants. | `components/ui/button.tsx`, `dropdown-menu.tsx`, `popover.tsx` only if a real adapter is required; a small Notebook trigger usage. No prerequisite. | No new variant/library or broad control refactor. | Keyboard/pointer open, Escape, focus return, disabled state and event isolation work in Home and Editor; inspect shared APIs and run focused TypeScript/checks for touched controls. | Stop when a reusable existing composition works, or document the smallest required shared adapter before further UI work. |
| **2. Home composition**: heading, controls, row grid and states. | `Notebook.tsx` Home branch, Home CSS, `notebookHome.ts` only if existing helpers need no-change verification. Depends on 1 for menu trigger. | No Editor/cell or backend change. | Real list/empty/search-empty/loading/error/retry remain distinct; long names and 210/248/340 px sidebar widths fit; focused `node tests/notebook-home.cjs`, TypeScript and Home visual check. | Stop with Home matching its blueprint and no behavior regression. |
| **3. Editor header**: identity-first one/two-row layout and shared Back/+ Cell/Save/Shortcuts styling. | `Notebook.tsx` header, header CSS. Depends on 1. | No cell interiors or shell change. | Title/status priority, actual busy/dirty state, Back save protection, menus/popover focus and minimum-size header fit; focused keyboard/TypeScript plus rendered header check. | Stop when header works at both center-track regimes. |
| **4. Document canvas**: centered hybrid track, scroll and boundary alignment. | `.notebook-editor`, `.notebook-blocks`, `.notebook-add`, insertion/layout CSS; `Notebook.tsx` only for layout composition. Depends on 3. | No Code/Markdown/Result internal restyle. | One vertical document scroll, broad analytical track, first/last hover/focus insertion and saved-execution placement; inspect many cells and sidebar extremes. | Stop when document geometry holds before cell polishing. |
| **5. Code presentation**: prompt/source geometry, code surface, focus and truthful footer. | Code branch in `Notebook.tsx`, `.notebook-code-*`; depends on 4. | No execution, parser or editor dependency. | Preview/edit align, 12 px code type, long lines contained, 2 px focus cue, Python/SQL metadata and save shortcuts intact; focused `node tests/notebook-keys.cjs`, TypeScript and Code visual/focus check. | Stop when Code is distinct and inert. |
| **6. Markdown presentation**: prose measure, heading/list/code/link rhythm and Text editor focus. | Markdown/Text CSS; `Markdown.tsx` only if styling hooks are strictly needed. Depends on 4. | No nested-list parser or unsupported syntax. | H1–H6 roles, readable prose, safe links, local fenced scroll and preview/edit paths; focused `node tests/markdown.cjs`, TypeScript and long-document visual check. | Stop when supported syntax reads as document content. |
| **7. Result evidence**: provenance hierarchy, shared table density/alignment and states. | `ResultBlock` in `Notebook.tsx`, Result CSS; reuse `notebookProvenance.ts` and shared Table without changing their contracts. Depends on 4; may follow 5/6 for integrated rhythm. | No new query, snapshot, pagination or table library. | Real operation/source/count/time, exact details, before-load/replay/failure/zero-row states, numeric alignment and local wide-table scroll; focused `node tests/notebook-provenance.cjs`, TypeScript and Result visual review. | Stop when table is dominant and replay truth survives. |
| **8. Interaction-state polish**: selected/editing/hover/focus, error and overlay alignment across cells. | Notebook state CSS and narrow `Notebook.tsx` composition as needed. Depends on 2–7. | No new cell actions or shortcut mappings. | Pointer, keyboard, focus, dialog/menu return, dirty and unavailable states remain clear; focused Notebook key/Home tests and targeted native interaction review. | Stop when no state relies on color alone or hides an action from keyboard. |
| **9. Responsive integration and acceptance**: verify the whole Notebook in its shell. | Review Notebook CSS/markup only for observed defects; progress notes. Depends on 2–8. | No unrelated shell redesign or global token change. | Inspect 1440 × 900 and 900 × 600, Sources closed and at 210/248/340 px, long titles/code/prose, many cells, wide/empty Results, loading/error/retry, menus/popovers, zoom and high DPI; run relevant focused checks after fixes. | Stop when all acceptance criteria below have evidence, or record each unresolved defect explicitly. |

## 10. Complete-redesign acceptance criteria and design review

1. Home identifies the active project, exposes one primary create action and lets an analyst search, sort, open, rename and confirm deletion without misleading loading or empty states.
2. Editor title, save state and existing commands remain recognizable at both target windows and every supported Sources width. The document has one clear scroll path and no page-wide horizontal overflow.
3. Text reads as a document at a controlled measure; Code looks like inert authored source; Result looks like replayed analytical evidence with the table dominant and exact provenance inspectable. Adjacent Code and Result never imply an execution relationship.
4. Hover/focus insertion, selected Edit, menus, dialogs, shortcuts, draft persistence and save-before-navigation retain their existing interaction paths. Focus is visible and action names remain accessible.
5. Shared controls and token roles supply standard styling. Any contextual CSS expresses Notebook layout or analytical content; no second button/input/table system or unsupported functionality appears.
6. Native rendered review at 1440 × 900 and 900 × 600 confirms density, hierarchy, text wrapping, menu/popover placement, local table/fenced-code scroll and readable states. A source-only check cannot satisfy this criterion.

**Impeccable source-based final review.** Applied its Operate, cognitive-load, typography and polish criteria to the consolidated direction. This is a specification critique, not a scored live-product audit.

| Criterion | Decision and remaining check |
| --- | --- |
| Visual hierarchy | Home's name list leads below one creation action; Editor title/save leads above cells; loaded Result tables lead their technical details. Confirm by squint test on rendered states. |
| Consistency | One 4 px spacing scale, documented type roles, shared controls, neutral surfaces and common cell strip cover both screens. Check actual CSS cascade and focus treatments when implemented. |
| Density | Compact Home rows and continuous cells fit an Operate workspace; long metadata moves to a second line or details instead of taking width from the analytical content. Check first-cell visibility at 900 × 600. |
| Typography | Existing UI/code families and 30/20/13/12/11/10 px roles provide the hierarchy; ~720 px Markdown measure limits prose length. Check fallback font, zoom and long titles in WebView2. |
| Component composition | Existing shadcn-style Button/Input/Select/Menu/Popover/Dialog/Table cover standard controls. Only analytical canvas, source frame, renderer and Result composition stay custom. Verify Base UI trigger composition before removing local styles. |
| Analytical workflow clarity | Code is authored source with unavailable execution; Result is a separately identified replay of a saved operation with exact provenance. Confirm no adjacent Code/Result pairing appears causal in the rendered sequence. |

The main unresolved risk is visual: at 900 × 600, the two-row header and dense Result metadata may compete with the first cell. Adjust within established tokens after a rendered pass. No running application or new detector audit was used for this final specification; prior source detectors returned no findings but did not establish visual quality.
