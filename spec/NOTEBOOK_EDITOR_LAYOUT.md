# Notebook Editor workspace layout

**Status:** Implementation specification, 2026-11-20. Source-based design only; no rendered Editor validation or application change. `spec/DESIGN_SYSTEM.md`, `spec/NOTEBOOK_VISUAL_SYSTEM.md`, and the current Notebook implementation remain the controls and behavior authorities.

## 1. Goal and selected direction

Make the Editor read as one project notebook used for investigation: the document title leads, saving is legible, commands are compact, and the cells carry the main visual weight. The Databricks reference contributes a named analytical document and restrained command hierarchy, not compute controls. This is an **Operate** surface: stable alignment and access to evidence matter more than decorative framing. Keep the shell's native title bar, global toolbar and optional shared Sources sidebar. The now-implemented Chat-to-Notebook transition collapses Threads and raises Sources within that same sidebar; the Editor layout adds no second navigation surface. The global toolbar already supplies project context; do not repeat a long project path inside the Editor.

All recommendations below are **presentation-only** unless explicitly called an interaction refinement. No backend, persistence, shortcut, or cell operation changes are proposed. Code remains inert; Result cells replay saved application-defined executions on demand and retain their provenance and unavailable states.

## 2. Header and toolbar blueprint

One sticky Editor header belongs to the central workspace, below the unchanged global toolbar. Its content follows this DOM and keyboard order:

```text
1440 × 900, central track wider than 900 px
┌──────────────────────────────────────────────────────────────────────────────┐
│ [← Notebooks]  [Notebook title________________] [Saved/Unsaved/Saving]       │
│                  (identity group grows)             [+ Cell ▾] [Save]        │
│                                                   [Shortcuts]  No runtime    │
└──────────────────────────────────────────────────────────────────────────────┘
                        document canvas begins below

900 × 600, or any central track at most 900 px
┌────────────────────────────────────────────────────┐
│ [← Notebooks] [Notebook title____________________] │
│               Saved/Unsaved/Saving                 │
│ [+ Cell ▾] [Save] [Shortcuts]          No runtime   │
└────────────────────────────────────────────────────┘
                document canvas begins below
```

The drawing wraps the wide command group to show its order; at a wide center track it is **one flex row**, with `No runtime` last. At the narrow breakpoint the command group is a second row, in the same DOM order. The title Input is the largest flexible element; Back and commands retain their control widths. Keep the header's bottom 1 px token border and surface background so it stays distinct while cells scroll underneath. No second toolbar, notebook tabs, breadcrumb bar, or inspector is needed. **Affected:** `Notebook.tsx` `.notebook-editor-toolbar` and `styles.css`; shared `Button`, `Input`, `DropdownMenu`, `Popover`. **Class:** presentation-only.

### Identity group

`← Notebooks` remains a visible text Back action, shared `Button variant="ghost" size="small"`, first in reading order. It keeps the existing save-before-return path and stays disabled while busy. The editable title remains the current shared `Input` with the existing 120-character limit, dirty draft, and accessible label. Give it the section type role (`--font-size-section`, 20 px, semibold) within a 36 px field-height composition; when its ordinary field border is suppressed, the enclosing title surface must show the shared focus treatment. At wide widths the actual Saved / Unsaved changes / Saving status sits immediately after the title, in secondary type, never beside `No runtime`. At narrow widths it sits directly below the title within the identity group so a long name retains a useful editing width. Title text may scroll inside the Input as edited; the header and page must not widen. **Affected:** `.notebook-title`, `.notebook-save-status`, existing `Input`; **class:** presentation-only.

Use the current title and status strings. Do not add a fabricated last-edited label, notebook-wide language, owner, version indicator, or project breadcrumb. The global project name and Back destination already provide location. **Affected:** `Notebook.tsx` header copy; **class:** presentation-only (no new content).

### Command group

Keep `+ Cell`, `Save`, and `Shortcuts` visible in both layouts. `+ Cell` is the shared `DropdownMenu` trigger, presented as `Button variant="secondary" size="default"`; its existing menu contains only Code and Text. `Save` is `Button variant="secondary" size="default"`, retaining its dirty/busy disable logic. `Shortcuts` is the existing shared `Popover` trigger, presented as `Button variant="ghost" size="small"`; keep the actual shortcut reference and its statement that saving does not run code. Use `--space-2` between commands; a 1 px token divider may separate `Shortcuts` from the two editing commands at wide width if it improves scanning, but do not add a standalone Separator component. **Affected:** `.notebook-toolbar-actions`, `.notebook-new-menu`, `.notebook-help-trigger`; shared `Button`, `DropdownMenu`, `Popover`. **Class:** presentation-only; trigger composition needs an **interaction refinement check** for opening, keyboard use, focus return and event propagation.

`No runtime` is plain secondary/meta status at the trailing edge, with the existing native `title` disclosure (“Code execution is not available”). It is not a Badge, a disabled Run control, or a clickable runtime picker. At narrow widths it can sit at the far end of the second row, wrapping under commands if text scaling requires it; commands never shrink into illegibility. No overflow menu is warranted: the only notebook-level actions are already visible, and the existing `+ Cell` menu owns the two insertion choices. Moving Shortcuts into a new menu would create an unnecessary second interaction path. **Affected:** `.notebook-runtime`, toolbar layout; **class:** presentation-only.

## 3. Document canvas and scrolling

Choose a **hybrid width**. Use one centered cell track, capped at 1120 px, with `--space-page` (32 px) margins when the center track is above 900 px and `--space-panel` (16 px) at or below 900 px. The cell sequence, selection edge, insertion boundaries, Code surfaces, and Result surfaces align to this track. Inside a Text cell, constrain rendered Markdown prose to roughly 720 px while keeping it aligned to the cell's left content inset; do not center a narrow text column independently. Code source and Result content may use the full cell width. This is a layout measure recommendation, not a redesign of Markdown typography or individual cell interiors. **Affected:** `.notebook-blocks`, `.notebook-preview`, `.notebook-markdown`, `.notebook-output` in `styles.css`; no new primitive. **Class:** presentation-only.

The hybrid track protects reading measure without giving up space for long code and analytical tables. Preserve the existing soft wrapping of Code source rather than making the whole document horizontally scroll. Result tables keep their current bounded `.table-scroll` horizontal and vertical overflow; exact provenance stays in each Result's details disclosure. A long unbroken string must be contained by its cell or local scroll region, never by page-wide horizontal overflow. **Affected:** Notebook layout overflow rules; shared Table remains inside ResultBlock. **Class:** presentation-only.

Keep a **single vertical workspace scroll** through the header, cells and saved-execution section, with the header sticky at the top of that scroll context. Do not add a nested Scroll Area around all cells or a separate result rail. Many cells continue below the viewport; the saved-execution picker remains after the final insertion boundary and empty hint, in document flow. It is a supporting add-to-document action, not a global toolbar command. Its existing `Select`, `Add result` Button and technical details disclosure remain together. **Affected:** `.notebook-workspace`, `.notebook-editor-toolbar`, `.notebook-blocks`, `.notebook-add`; shared `Select`/`Button`. **Class:** presentation-only.

## 4. Cell sequence composition

Cells form a flat, continuous document on the canvas. Give each cell the same left alignment, compact label/number strip, and one consistent inset; use 1 px token boundaries and `--space-cell` (12 px) for internal rhythm. Do not make every cell an individual rounded card or add a permanent gutter. Existing selected and editing states retain a quiet left edge and tonal background; editing gets a distinct focus cue. Hover does not move content. A selected preview Code or Text cell keeps its contextual Edit action. **Affected:** `.notebook-block`, `.notebook-block-toolbar`, `.notebook-blocks`; cell command behavior in `Notebook.tsx` stays intact. **Class:** presentation-only.

Keep one `InsertionSlot` at every boundary, including before the first and after the last cell. Its `+ Code` and `+ Text` actions reveal on boundary hover or keyboard focus, disappear at rest, and keep their existing before/after accessible names. Selection alone must **not** reveal them; the always-visible trial was deliberately reverted. The 26 px boundary band may remain in document flow to maintain a stable pointer and focus target, but its visual line/control must appear only on hover or focus. **Affected:** `InsertionSlot`, `.notebook-insertion`, `.notebook-insertion-actions`; no generic shared primitive. **Class:** presentation-only; verify existing focus and hit area as an interaction check.

Text, Code and Result retain distinct causal identities. A Result remains a standalone saved execution, never an implied output of the Code cell above it. Its provenance header and local table scroll stay inside the Result cell. The next task owns detailed cell internals; this document fixes only their alignment, order and available width. **Affected:** sequence and Result outer layout in `Notebook.tsx`/`styles.css`; shared Table within Result. **Class:** presentation-only.

## 5. Shared component mapping

The installed `components/ui/` layer is the shadcn-style foundation on Base UI where relevant; native Select, Textarea and Table remain deliberate parts of it. No shared extension is required by this layout. In particular, there is no standalone Separator, Tabs or Scroll Area export; no new one is justified here.

| Element | Existing component and composition | Visual change / affected area | Class |
| --- | --- | --- | --- |
| Back | `Button` ghost / small, visible text | Replace raw Back skin in header | Presentation-only; verify save-before-return path |
| Title | `Input` default, Notebook-owned borderless title frame | Section type role, flexible width, visible enclosing focus; `.notebook-title` | Presentation-only |
| Save state | Semantic `role="status"` text, no Badge | Adjacent to title, below it when narrow; `.notebook-save-status` | Presentation-only |
| + Cell | `DropdownMenu` with shared `Button` secondary / default trigger, existing items | Group with Save; `.notebook-new-menu` | Presentation-only; trigger interaction refinement check |
| Save | `Button` secondary / default | Keep next to + Cell, preserve dirty/busy state | Presentation-only |
| Shortcuts | `Popover` with shared `Button` ghost / small trigger | Last interactive command; `.notebook-help-trigger` | Presentation-only; trigger interaction refinement check |
| No runtime | Plain text plus current native title | Quiet trailing status; `.notebook-runtime` | Presentation-only |
| Canvas and cells | Notebook-owned layout, `InsertionSlot`, shared cell controls | Centered hybrid track and consistent boundaries | Presentation-only |
| Saved execution section | Shared `Select` default, `Button` secondary / default, native `<details>` | Remains after cells in document flow; `.notebook-add` | Presentation-only |
| Result table | Existing shared Table family in local `.table-scroll` | Keep wide data contained within Result cell | Presentation-only |

Cell menus and Code-language Select retain the mappings in `spec/NOTEBOOK_VISUAL_SYSTEM.md`; this task does not specify their internals. `Badge` remains reserved for source ready/changed/missing meanings. The mode selector is not Tabs. Menu-only separators use `DropdownMenuSeparator`; layout dividers use 1 px CSS token borders. Tooltips are for icon-only commands if one is introduced by a later task; the visible-text header commands need no Tooltip. **Class:** presentation-only; no new component.

## 6. Sizes, type and surface

Use the documented UI family and token roles: title Input 20 px section, command labels 12 px body, Back/Shortcuts 11 px secondary if the small Button supplies it, save and runtime status 10–11 px meta/secondary, cell identity 10 px meta. Use the existing 36 px default and 28 px small controls. Header side padding is `--space-page` wide and `--space-panel` narrow; command gaps use `--space-2`, identity-to-command separation uses `--space-4`, and the first cell begins `--space-section` below the header. The header uses `--color-surface`, canvas the existing neutral workspace, one `--color-border` divider, and no shadow. Shared controls own hover, disabled and 2 px focus-ring treatment. **Affected:** Editor selectors in `styles.css`; shared tokens only. **Class:** presentation-only.

## 7. Responsive specification

Base decisions on the **actual central track**, since Sources resizes from 210 to 340 px or collapses; do not use window width alone for header or document breakpoints.

| Window / center track | Header and canvas | Overflow and priority |
| --- | --- | --- |
| **1440 × 900**, Sources open at 248 px: center about 1192 px; at 340 px: about 1100 px. Closed: center about 1440 px. | One sticky header row at center widths above 900 px. Canvas cap 1120 px after 32 px side margins; Markdown measure about 720 px inside the cell track. | Title takes remaining width before Save status/commands. Code soft-wraps; Result table scrolls locally. Many cells scroll under header. |
| **900 × 600**, Sources open at 248 px: center about 652 px; at 340 px: about 560 px; at 210 px: about 690 px. Closed: center about 900 px. | Two-row sticky header at center widths at most 900 px. Back and title lead; status is under title. Commands follow on row two. Canvas uses 16 px side margins, leaving about 528–868 px across these sidebar states. | Title remains editable with internal text scrolling. `No runtime` yields width before title or commands; it can wrap, but must remain readable. Code stays within its cell; wide Result tables scroll locally. The document alone scrolls vertically. |

At zoom or long localized strings, let the second header row wrap without moving the title below the command group. Do not hide Back, Save, + Cell, or Shortcuts, and do not turn their labels into ambiguous icon-only buttons. The first cell should be visible below the compact header at 900 × 600 with a populated notebook; confirm that in a later rendered acceptance review. **Affected:** `@container` Editor rules in `styles.css`; **class:** presentation-only.

## 8. Accessibility and interaction invariants

- Preserve title Input label, live save status, disabled/busy states and visible keyboard focus. Tab order follows the DOM order in the blueprint at both sizes. **Affected:** header composition; **presentation-only**.
- Back still saves pending notebook edits before returning Home; failure keeps the notebook open. Save button and Ctrl+S retain current persistence semantics; Shift+Enter and Ctrl+Enter save source without running Code. **Affected:** existing `Notebook.tsx` handlers; **no behavior change**.
- Keep command-mode cell selection, Up/Down, Enter, A/B, D twice, Escape, menu movement, double-click editing, Code Tab indentation and Shift+Tab focus traversal. Cell focus and editing focus remain distinguishable. **Affected:** cell layout/focus styling; **presentation-only**.
- Menu and Popover composition must preserve accessible names, keyboard opening, Escape dismissal and focus return. Hover-only insertion still has its keyboard-focus path. **Affected:** shared triggers and `InsertionSlot`; **interaction refinement check, no intended behavior change**.
- Result replay may be unavailable; do not replace that state with a blank table or claim a saved snapshot. **Affected:** Result outer width only; **presentation-only**.

## 9. Current implementation gaps and small tasks

1. **Header grouping.** `.notebook-editor-toolbar` currently places Back, 17 px title, save status, runtime status, + Cell, Save and Shortcuts in one flex row; the `@media(max-width:1050px)` rule moves the title to the end by setting `order:3`. Replace that with the specified identity-first two-row container layout. Use shared ghost Back and section-sized shared Input. **Presentation-only; verify navigation after trigger substitution.**
2. **Shared trigger presentation.** `.notebook-new-menu` and `.notebook-help-trigger` have local control skins. Compose their existing shared Menu/Popover triggers with shared Button variants; verify pointer/keyboard open, focus return and no cell shortcut leakage. **Presentation-only with interaction refinement check.**
3. **Canvas measure.** `.notebook-blocks` already caps at 1120 px, but Markdown currently uses the full cell track. Add the inner readable measure while leaving Code and Result on the broad track; keep local table overflow. **Presentation-only.**
4. **Cell sequence rhythm.** Align the cell and saved-execution section to one track and token spacing, while preserving the 26 px hover/focus insertion band and selected Edit action. **Presentation-only.**
5. **Responsive acceptance.** Inspect current-source Editor at 1440 × 900 and 900 × 600 with Sources open at 210/248/340 px and closed. Use long titles, long Code lines, many cells, wide Results, zoom, menus and the Shortcuts popover. Verify scroll containment, title priority, keyboard order, focus and header height before adjusting optical details. **Verification only; no behavior change.**

No backend/schema, global token, Notebook Home or detailed cell-internal change follows from this Editor specification. The shared sidebar transition was implemented during the later Home refinement and is treated here as existing shell behavior. The Editor implementation tasks above remain future work.
