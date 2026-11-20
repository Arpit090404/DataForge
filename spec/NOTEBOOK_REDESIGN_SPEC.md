# Notebook redesign: implementation specification

**Status:** Final visual specification, reconciled 2026-11-20. Notebook Home, the shared-sidebar transition, Editor canvas, compact breadcrumb, idle saving and label-free cell chrome are implemented in source. Earlier Editor layouts were inspected in synthetic browser previews; the latest icon header, external Code prompt and floating cell actions have not been rendered or checked in native WebView2. Detailed analytical cell content treatments remain ahead. This consolidates `NOTEBOOK_REDESIGN_BASELINE.md`, `NOTEBOOK_REFERENCE_ANALYSIS.md`, `NOTEBOOK_VISUAL_SYSTEM.md`, `NOTEBOOK_HOME_REDESIGN.md`, `NOTEBOOK_EDITOR_LAYOUT.md`, and `NOTEBOOK_CELL_DESIGN.md`.

## 1. Vision and authority

Notebook is DataForge's project-scoped analytical document workspace. Home is a compact resource browser; Editor is one continuous document in which authored Text and Code and saved analytical Results remain distinguishable. Databricks informs the resource and document hierarchy, not its compute, collaboration, job, or Git features. Keep DataForge's quiet dark identity, balanced density, real project data, and truthful execution limits.

`spec/DESIGN_SYSTEM.md` and ADR 0010 govern tokens, sizing and the repository-owned shadcn-style layer. `spec/NOTEBOOK_VISUAL_SYSTEM.md` governs shared component choice. This document resolves Notebook-specific composition where the earlier screen documents differ; current source remains the behavior authority. The implemented Home refinement uses contextual sizes and a shared-sidebar transition without a new token, dependency, shell region, shared component or host contract.

### Resolved design decisions

| Topic | Final rule | Reason and source |
| --- | --- | --- |
| Type | Use existing UI roles: 30 px page/Markdown H1, 20 px Markdown H2, 13 px resource title/Markdown prose/H3, 12 px controls and Code, 11 px breadcrumb title/supporting/table text, 10 px labels and dense state. The editable breadcrumb title is bold. Code uses the code family; everything else uses the UI family. | The compact Editor path follows the latest reference-driven refinement without a new scale. `DESIGN_SYSTEM.md`, visual system and cell spec. |
| Space and controls | 4 px token steps; 32 px page/canvas margin when center track allows, 16 px at narrow tracks; 24 px between major groups, 16 px between controls/list, 8–12 px within groups. Default controls 36 px, small 28 px; icon Button is 28 px square by its variant. | One rhythm across Home and Editor. `DESIGN_SYSTEM.md`; shared `Button` implementation. |
| Surfaces | `--color-surface` is the central Notebook canvas and sticky Editor header. Home list has one `--color-sidebar` frame with a `--color-border` edge; rows have no individual cards. Selected cells use a neutral 1 px border without a fill. Code source may use `--color-code-surface` after rendered check. Only menus/popovers/dialogs float. | Keeps selection legible without recoloring the whole cell. |
| Editor header | One sticky header row when the **center track** is above 900 px; two rows at or below 900 px. DOM order is Notebooks Back, slash, compact bold editable title, icon-only Shortcuts, Save status icon, No runtime. No visible + Cell or Save control. | The Save icon is live status, not an action; idle saving replaces the visible Save action. `NOTEBOOK_EDITOR_LAYOUT.md`. |
| Content width | One centered cell track, maximum 1120 px after side margins. Rendered Markdown prose is left-aligned within it at about 720 px; Code and Result may use the broad track. | Hybrid width protects reading while retaining analytical room. Editor and cell specs. |
| Cell sequence | Flat cells with accessible type/position names but no visible Cell/Text/Code number strip. A floating action group appears on hover, selection, focus or while real feedback is present. Code selection border follows its source/output frame, with `[ ]` in the left gutter. Shared rectangular + Code/+ Text Buttons straddle the 12 px boundary on hover or keyboard focus only. | Follows the supplied Colab reference without adding execution or Markdown tools. Editor and cell specs. |
| Tables | Use the existing shared native Table family within the Result's bounded `.table-scroll` (maximum 360 px high), with sticky headers, local horizontal overflow and real row-scope text. | No parallel table system or new Scroll Area. Cell spec and design system. |
| Metadata | Home shows actual title, local `updated_at` and `block_count` only. Result leads with real operation/source, then input summary, then recorded count/time; exact IDs and parameters stay in native details. | Matches available summaries and provenance; does not invent activity. Home and cell specs. |
| Menus | Home row actions use the shared icon Button composed with the shared Dropdown Menu trigger. Editor keeps the shared Shortcuts Popover; cell menus retain their current actions. A named trigger is required. | Existing shared wrappers own standard control appearance. No new variant or raw Base UI import. |

## 2. Home: final blueprint

The native title bar, global 44 px toolbar and resizable shared Chat/Notebook sidebar remain shell-owned. Notebook mode collapses Threads with reduced-motion support so Sources rises to fill the sidebar; returning to Chat restores Threads. Home occupies the central scroll area. The Home eyebrow repeats the active project name with the existing Current project fallback. Wide content is capped at 1120 px with 32 px margins; center widths at most 700 px use 16 px margins.

```text
Global toolbar / shared sidebar: Threads collapses in Notebook mode
Central Home:
  project name eyebrow
  Notebooks                                      [New Notebook]
  Keep notes, code, and saved analytical results together.
  [actual later error, if present]
  [Search notebooks____] [Last modified v]
  ┌─────────────────────────────────────────────────────────────┐
  │ NAME                       MODIFIED          CELLS   ACTIONS │
  │ [notebook icon] Name       local date/time   count    [⋯]   │
  │ ...                                                         │
  └─────────────────────────────────────────────────────────────┘
```

The 30 px heading leads with factual 12 px description. New Notebook is the sole primary/small 28 px Button, aligned with the title line. Search uses the shared Input in a 28 px labeled icon container, flexible up to 280 px. Sort sits beside it as a 28 px, 120 px shared native Select with a screen-reader-only label and the existing Last modified and Name choices. Search, sort and creation behavior remain unchanged. **Files:** Notebook.tsx, notebookHome.ts, Home styles.css. **Change:** presentation-only.

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

One sticky Editor header sits above one vertically scrolling analytical document. The global toolbar retains project context; the Editor uses a compact breadcrumb path with an editable notebook name. No inspector, composer, second toolbar, execution controls or Markdown tools are added.

Wide center track (>900 px): [Notebooks] / [Regional sales review] ... [Keyboard icon] [Save status icon] No runtime, in one physical row.
Narrow center track (at most 900 px): row one [Notebooks] / [Regional sales review]; row two [Keyboard icon] [Save status icon] No runtime.
Below either header: centered document track (maximum 1120 px); hover/focus boundary with [+ Code] [+ Text]; label-free Text / Code / Result content with floating actions; Code `[ ]` outside its bordered source/output frame; saved-execution picker after the final boundary when real executions exist.

Notebooks is a shared ghost/small Back Button with the existing save-before-return path. The slash is decorative. The labeled shared title Input is bold and explicitly matches the Notebooks Button's 11 px size; it is 28 px high, at most 240 px wide, and internally scrolls for long names. A focus cue encloses it. Icon-only Shortcuts uses a named shared Button and the existing Popover. A Lucide Save icon immediately to its right exposes the live Saved / Unsaved changes / Saving state through hidden text and native title; it is not clickable. The visible + Cell and Save controls remain absent. Changes to title, content or language save after 1200 ms idle, while Ctrl+S, Ctrl+Enter, Shift+Enter and Back save-before-return retain their paths. No runtime remains factual plain text. **Files:** Notebook.tsx Editor header/save effect and Editor header CSS. **Change:** presentation plus existing idle-save behavior.

The canvas uses the central surface, 32 px side margins above 900 px center width or 16 px at/below it, a 1120 px maximum cell track and roughly 720 px Markdown prose measure. Code and Result may use the broad track. The existing workspace scroll is vertical, with the header sticky; source soft-wraps and tables/fenced code scroll locally. The saved-execution picker follows the final insertion boundary in document flow. **Files:** Editor layout CSS and Notebook.tsx. **Change:** presentation-only.
## 4. Cell blueprints and causal identity

Cells no longer show visible type/position labels. Their accessible section names retain type and position; real Unsaved and D-twice prompts remain textual. Actions float at the upper-right edge on hover, selection, focus or while those real warnings are present. A neutral 1 px border identifies selection without filling the cell; Code uses its actual source/output frame for that border, not a larger outer section. The inert `[ ]` prompt sits outside the frame at left. Shared secondary/small + Code/+ Text Buttons straddle the 12 px boundary **only on hover or keyboard focus**. **Files:** `Notebook.tsx` cell sequence/`InsertionSlot`, `.notebook-block*`, `.notebook-code-*`; shared Button for insertion and contextual Edit. **Change:** presentation-only; shortcuts and insertion behavior preserved.

```text
Code:   [ ] | authored source inside its actual bordered frame (12 px code / 1.6)
             No output · execution unavailable inside the same frame
             floating [actual Unsaved] [Python ▾] [Edit Code] [⋯] when relevant

Text:          [actual Unsaved] [Edit Text if selected] [⋯] floating when relevant
        Heading, paragraphs, lists, links and code as document prose
        (edit: shared Textarea in quiet focus frame; preview: no field chrome)

Result:                                                       [⋯] on hover/focus
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
| Home New / boundary insertion | Shared Button primary/small for New; secondary/small for + Code and + Text | Insertion remains a Notebook-specific hover/focus composition. No new variant. |
| Home search/title/rename | Shared Input default 36 px; Home search context 28 px | Search icon container, borderless title frame and inline rename placement are Notebook-specific. |
| Home sort / Code language / saved execution | Shared native Select default 36 px; Home sort and Code language contextually compact at 28 px | Preserve native change events and popup. No global compact variant. |
| Home row and cell menus | Shared `DropdownMenu` Content/Item/Separator; `Button variant="icon"` 28 px for trigger | Custom row/cell target names and menu contents; test `render` composition, focus, propagation. `IconButton`/Tooltip only if trigger composition works. |
| Back / Shortcuts / Edit / Retry | `Button` ghost/small Back and Edit; icon variant for Shortcuts; secondary/default Home Retry; secondary/small Result Load/Retry | Shortcuts uses shared `Popover` with accessible icon-only trigger. |
| Delete | Shared `ConfirmationDialog`, destructive confirm | Keep consequence text and Cancel-first focus. |
| Code/Text source | Shared native `Textarea` | Code prompt/frame and Markdown edit/preview are domain surfaces, not new form primitives. |
| Result evidence | Shared native `Table`, Header/Body/Row/Head/Cell/Empty | Bounded local overflow and provenance are Result-specific. |
| Status/provenance | Lucide Save icon with hidden live text; native `<details>` | Save status is immediately right of Shortcuts and is not a button. `Badge` remains for source states. |
| Canvas/rows/insertion | Shared Button inside Notebook-owned insertion layout | Home grid, document cells and `InsertionSlot` remain justified Notebook compositions. |

No shared Separator, Scroll Area, Tabs, Skeleton or Context Menu exists or is required. Use CSS token borders for layout separators, `DropdownMenuSeparator` inside menus and native overflow/details for scrolling and disclosure. No Radix, raw Base UI imports in Notebook, new icon library, editor package or global design-system extension.

## 6. Responsive and state contract

Breakpoints follow `.main-workspace` **container width**, including sidebar resizing from 210 to 340 px and collapse. Do not derive Home or Editor layout solely from window width.

| Target | Home | Editor and cells |
| --- | --- | --- |
| **1440 x 900**: Sources at 248 px -> center about 1192 px; at 340 px -> about 1100 px; closed -> about 1440 px. | 32 px margins and max 1120 px content. Small New Notebook aligns with title; 28 px search and sort sit adjacent; four-column list shows real date, count and menu. Sources fills the shared sidebar. | One sticky Editor header row above 900 px center width; cell track max 1120 px, Markdown measure about 720 px, Code/Result broad. |
| **900 x 600**: Sources at 248 px -> center about 652 px; at 340 px -> about 560 px; at 210 px -> about 690 px; closed -> about 900 px. | At center widths at most 700 px, 16 px margins. New Notebook stays on title line until zoom requires wrap. Search shrinks beside the 120 px sort Select. Two-line rows show title/menu then real modified time and N cells. | At center widths at most 900 px, two-row sticky Editor header; breadcrumb first, save status and Shortcuts/No runtime second. Source and prose wrap; fenced code and tables scroll locally. |

The shared sidebar transitions Threads out and Sources upward when entering Notebook mode; reduced-motion users get an immediate change. Home empty/search-empty/error states replace the list header; an initial load never claims success. Menus stay viewport-aware. At zoom or longer translations, controls may wrap in DOM order without hiding focus. **Files:** App.tsx sidebar, styles.css mode transition and Home container, Notebook.tsx composition. **Change:** presentation-only for Home; interaction refinement for mode transition.

## 7. Preserved behavior and product truth

- Creating, opening, renaming and deleting notebooks remain project-scoped. Back saves pending edits before Home; failure keeps the Editor open. Dirty titles, cell drafts and Home rename retain current protection.
- Existing command/edit shortcuts remain: Up/Down, Enter, A/B, D twice, Escape, Code Tab/Shift+Tab, Ctrl+Enter, Shift+Enter and Ctrl+S. Title, source and language drafts also save after 1200 ms idle; failure retains the draft and shows an error. Saving never runs Code. Existing menu insertion/movement and double-click editing remain.
- Python/SQL is per-Code-cell source metadata only. There is no general notebook execution runtime, Run/Run All, fabricated progress, computed Code output or agent result.
- A Result loads a bounded replay from a pinned representation on demand, can be unavailable, and may show different row order without a saved sort. Recorded count and displayed page count keep different labels. Exact provenance remains inspectable.
- The global shell, Sources resizing, application toolbar, mode switch and navigation relationships remain as implemented. The design stays useful without an agent.

## 8. Current implementation gaps

1. Home row-menu and Editor Shortcuts use shared trigger composition; Editor Back and boundary insertion now use shared Buttons. Cell-internal menu and control styling remains a separate cell-design task.
2. Home's decorative icon, duplicate create action, narrow four-column squeeze and misleading state hierarchy have been addressed in source. Native WebView2 and real-data interaction acceptance remain open.
3. Editor title order now follows the compact breadcrumb layout. Earlier browser checks covered the previous one/two-row header at target widths and Sources widths 210/248/340 px and closed; the latest breadcrumb, idle save and insertion changes need rendered/native verification.
4. Editor canvas now uses the central surface, a maximum 1120 px cell track and a 720 px Markdown measure. Code focus still uses a 1 px accent outline; that is part of the later cell-design task.
5. Code/Result source hierarchy and Result metadata are visually crowded. Result table values have no numeric-type alignment; long values need source-based visual containment without changing replayed data.
6. Markdown's current 24/19/15 px headings and local 9/18 px margins drift from documented roles. Indented list items remain flat; true nesting is outside this visual implementation.
7. Native WebView2 visual/interaction acceptance at both target sizes, sidebar states, long content, replay states, menus and focus remains unverified. Prior source detectors returning `[]` do not clear this gap.

## 9. Small implementation roadmap

All tasks below preserve host commands and schema. Tasks 1–4 are implemented in source, including the later compact Home controls and shared-sidebar transition. Browser fixtures inspected the Home and Editor layouts; native real-project acceptance remains open. Complete and review each remaining task before the next dependent one, with focused checks and `git diff --check` after each edit.

| Order / scope | Files and dependency | Non-goal | Acceptance and focused verification | Stop condition |
| --- | --- | --- | --- | --- |
| **1. Shared trigger composition (source done)**: use shared Button presentation for Home row Menu and Editor Menu/Popover triggers. | `Notebook.tsx`; existing shared components required no extension. | No new variant/library or broad control refactor. | Browser fixture confirmed Editor pointer opening, Escape and focus return; TypeScript and focused controls checks passed. Native interaction remains open. | Stop after native acceptance is recorded. |
| **2. Home composition (source done; native acceptance pending)**: heading, compact controls, row grid and states. | `Notebook.tsx` Home branch, Home CSS, `App.tsx` shared-sidebar transition; `notebookHome.ts` helpers unchanged. | No Editor/cell or backend change. | Browser fixture checked 900 × 600 and 1440 × 900 layout and mode transition. Complete native real-project checks for long names, sidebar widths, loading/error/retry, rename/delete and focus. | Stop when Home native acceptance evidence is recorded with any remaining defects. |
| **3. Editor header (source done; latest refinement unrendered)**: compact breadcrumb, live status, Shortcuts/No runtime and idle save. | `Notebook.tsx` header/save effect and header CSS. | No cell interiors, Markdown tools or shell change. | Focused TypeScript and keyboard checks pass; verify idle persistence/failure and header at both widths in a running app. | Stop after rendered/native acceptance is recorded. |
| **4. Document canvas (source done; boundary refinement unrendered)**: centered hybrid track, scroll, neutral selection border and 12 px insertion gap with overlapping shared Buttons. | `.notebook-editor`, `.notebook-blocks`, `.notebook-insertion`, `.notebook-add`, Markdown width CSS. | No Code/Markdown/Result internal restyle. | Earlier browser fixture confirmed scroll and width; verify the latest boundary hover/focus hit area and selection in a running app. | Stop after rendered/native acceptance is recorded. |
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
| Component composition | Existing shadcn-style Button/Input/Select/Menu/Popover/Dialog/Table cover standard controls. Only analytical canvas, source frame, renderer and Result composition stay custom. Editor trigger composition was checked in the browser fixture; cell-internal controls remain for later review. |
| Analytical workflow clarity | Code is authored source with unavailable execution; Result is a separately identified replay of a saved operation with exact provenance. Confirm no adjacent Code/Result pairing appears causal in the rendered sequence. |

At 900 × 600 the implemented two-row Editor header leaves the first cell visible in the browser fixture; dense Result metadata still needs its separate cell-design pass. Home and Editor browser fixtures use synthetic data and do not establish native WebView2 behavior, actual project persistence or Result replay. The original consolidated critique was source-based.
