# Notebook Editor workspace layout

**Status:** Editor header, canvas and compact cell chrome are implemented in source, updated 2026-11-22. The header now exposes existing append-cell and save handlers through shared controls. A browser fixture showed the prior breadcrumb and boundary layout; the latest toolbar and cell refinements have not been rendered or checked in native WebView2. `spec/DESIGN_SYSTEM.md`, `spec/NOTEBOOK_VISUAL_SYSTEM.md`, and current source remain the controls and behavior authorities.

## 1. Goal and selected direction

Make the Editor read as one project notebook used for investigation: the document title leads, saving is legible, commands are compact, and the cells carry the main visual weight. The Databricks reference contributes a named analytical document and restrained command hierarchy, not compute controls. This is an **Operate** surface: stable alignment and access to evidence matter more than decorative framing. Keep the shell's native title bar, global toolbar and optional shared Sources sidebar. The now-implemented Chat-to-Notebook transition collapses Threads and raises Sources within that same sidebar; the Editor layout adds no second navigation surface. The global toolbar already supplies project context; do not repeat a long project path inside the Editor.

The header and cell-boundary changes are presentational; idle saving after 1200 ms is the one persistence-timing change. No backend, shortcut, or cell operation contract changes are proposed. Code remains inert; Result cells replay saved application-defined executions on demand and retain their provenance and unavailable states.

## 2. Header and toolbar blueprint

The sticky Notebook toolbar groups the Notebooks breadcrumb and editable title on the left, with live save status, Save, Add cell, and More notebook options on the right. Add cell appends Code or Text. Save uses the existing save handler and is disabled while busy or clean. More notebook options opens the shortcut reference and execution availability note.

The centered toolbar aligns with the cell track. Small controls sit in a 45 px row when space permits. The action group wraps below the breadcrumb when the available center width requires it. The labeled title Input uses component type and is capped at 240 px. Existing keyboard shortcuts, idle save, and save-before-Back remain available.

## 3. Document canvas and scrolling

Choose a **hybrid width**. Use one centered cell track, capped at 1120 px, with `--space-page` (32 px) margins when the center track is above 900 px and `--space-panel` (16 px) at or below 900 px. The cell sequence, selection edge, insertion boundaries, Code surfaces, and Result surfaces align to this track. Inside a Text cell, constrain rendered Markdown prose to roughly 720 px while keeping it aligned to the cell's left content inset; do not center a narrow text column independently. Code source and Result content may use the full cell width. This is a layout measure recommendation, not a redesign of Markdown typography or individual cell interiors. **Affected:** `.notebook-blocks`, `.notebook-preview`, `.notebook-markdown`, `.notebook-output` in `styles.css`; no new primitive. **Class:** presentation-only.

The hybrid track protects reading measure without giving up space for long code and analytical tables. Preserve the existing soft wrapping of Code source rather than making the whole document horizontally scroll. Result tables keep their current bounded `.table-scroll` horizontal and vertical overflow; exact provenance stays in each Result's details disclosure. A long unbroken string must be contained by its cell or local scroll region, never by page-wide horizontal overflow. **Affected:** Notebook layout overflow rules; shared Table remains inside ResultBlock. **Class:** presentation-only.

Keep a **single vertical workspace scroll** through the header, cells and saved-execution section, with the header sticky at the top of that scroll context. Do not add a nested Scroll Area around all cells or a separate result rail. Many cells continue below the viewport; the saved-execution picker remains after the final insertion boundary and empty hint, in document flow. It is a supporting add-to-document action, not a global toolbar command. Its existing `Select`, `Add result` Button and technical details disclosure remain together. **Affected:** `.notebook-workspace`, `.notebook-editor-toolbar`, `.notebook-blocks`, `.notebook-add`; shared `Select`/`Button`. **Class:** presentation-only.

## 4. Cell sequence composition

Cells form a flat, continuous document on the canvas. Remove visible Text/Code/Result number labels while retaining each section's accessible name. The toolbar floats at the upper-right boundary on hover, selection, keyboard focus or while real Unsaved/delete feedback must remain visible. Selection adds a 1 px neutral border without filling the cell; for Code, that border follows the source/output frame rather than a larger outer section. The inert `[ ]` prompt sits in the left gutter outside that frame. A selected preview Code or Text cell keeps its contextual Edit action. **Affected:** `.notebook-block`, `.notebook-block-toolbar`, `.notebook-code-*`; cell command behavior stays intact. **Class:** presentation-only.

Keep one `InsertionSlot` at every boundary, including before the first and after the last cell. Its shared secondary/small rectangular `+ Code` and `+ Text` Buttons reveal on boundary hover or keyboard focus, disappear at rest, and keep their existing before/after accessible names. Selection alone must **not** reveal them. The boundary occupies 12 px in document flow; the 28 px Buttons straddle the gap and may overlap both neighboring cell borders without obscuring content. **Affected:** `InsertionSlot`, `.notebook-insertion`, `.notebook-insertion-actions`; shared `Button`. **Class:** presentation-only; verify focus and hit area as an interaction check.

Text, Code and Result retain distinct causal identities. A Result remains a standalone saved execution, never an implied output of the Code cell above it. Its provenance header and local table scroll stay inside the Result cell. The next task owns detailed cell internals; this document fixes only their alignment, order and available width. **Affected:** sequence and Result outer layout in `Notebook.tsx`/`styles.css`; shared Table within Result. **Class:** presentation-only.

## 5. Shared component mapping

The installed `components/ui/` layer is the shadcn-style foundation on Base UI where relevant; native Select, Textarea and Table remain deliberate parts of it. No shared extension is required by this layout. In particular, there is no standalone Separator, Tabs or Scroll Area export; no new one is justified here.

| Element | Existing component and composition | Visual change / affected area | Class |
| --- | --- | --- | --- |
| Back | `Button` ghost / small, visible text | Replace raw Back skin in header | Presentation-only; verify save-before-return path |
| Title | Shared labeled Input | 13 px role, 28 px high, maximum 240 px wide | Presentation-only |
| Add cell | Shared `Button secondary / small` in `DropdownMenuTrigger`; Code/Text `DropdownMenuItem`s | Append through existing `insert` handler; `.notebook-toolbar-actions` | Existing action exposed in header |
| Save | Shared `Button ghost / small` | Existing `saveNotebook` handler; disabled when clean or busy | Existing action exposed in header |
| Save state | Visible text in a live status region | Beside Save | Presentation-only |
| Idle save | Existing notebook and block persistence handlers | Schedule after 1200 ms idle; keep draft/error on failure | Behavioral change |
| More notebook options | Shared icon Button and Popover | Shortcut reference and execution availability | Presentation-only |
| Canvas and cells | Notebook-owned layout, `InsertionSlot`, shared secondary/small insertion Buttons | Centered hybrid track and 12 px boundary | Presentation-only |
| Saved execution section | Shared `Select` default, `Button` secondary / default, native `<details>` | Remains after cells in document flow; `.notebook-add` | Presentation-only |
| Result table | Existing shared Table family in local `.table-scroll` | Keep wide data contained within Result cell | Presentation-only |

Cell menus and Code-language Select retain their actions. `Badge` remains reserved for source ready/changed/missing meanings. The mode selector is not Tabs. Menu-only separators use `DropdownMenuSeparator`; layout dividers use 1 px CSS token borders.

## 6. Sizes, type and surface

The toolbar uses the central surface and a thin divider. Its horizontal insets match the document track, with 32 px wide margins and 16 px narrow margins. Controls use shared 28 px sizes. The title uses 13 px component type and save status uses 11 px secondary type.

## 7. Responsive specification

Base decisions on the **actual central track**, since Sources resizes from 210 to 340 px or collapses; do not use window width alone for header or document breakpoints.

| Window / center track | Header and canvas | Overflow and priority |
| --- | --- | --- |
| **1440 × 900**, Sources open at 248 px: center about 1192 px; at 340 px: about 1100 px. Closed: center about 1440 px. | One sticky header row. Canvas cap 1120 px after 32 px side margins; Markdown measure about 720 px inside the cell track. | The breadcrumb title caps at 240 px; save status and commands form the right group. Code soft-wraps; Result table scrolls locally. |
| **900 × 600**, Sources open at 248 px: center about 652 px; at 340 px: about 560 px; at 210 px: about 690 px. Closed: center about 900 px. | One sticky row at typical Sources widths. The action group wraps when space runs out. Canvas uses 16 px side margins, leaving about 528–868 px across sidebar states. | Title remains editable with internal text scrolling. Code stays within its cell; wide Result tables scroll locally. The document alone scrolls vertically. |

At zoom or long localized strings, keep the breadcrumb path before Shortcuts in DOM order; the title scrolls inside its capped Input. The first cell should remain visible below the compact header at 900 × 600 with a populated notebook. **Affected:** `@container` Editor rules in `styles.css`; **class:** presentation-only.

## 8. Accessibility and interaction invariants

- Preserve title Input label, live save status, disabled/busy states and visible keyboard focus. Tab order follows the DOM order in the blueprint at both sizes. **Affected:** header composition; **presentation-only**.
- Back still saves pending notebook edits before returning Home; failure keeps the notebook open. Idle saving persists title and source drafts after 1200 ms without input; Ctrl+S remains an explicit save path. Shift+Enter and Ctrl+Enter save source without running Code. **Affected:** `Notebook.tsx`; **behavioral change for idle save only**.
- Keep command-mode cell selection, Up/Down, Enter, A/B, D twice, Escape, menu movement, double-click editing, Code Tab indentation and Shift+Tab focus traversal. Cell focus and editing focus remain distinguishable. **Affected:** cell layout/focus styling; **presentation-only**.
- Menu and Popover composition must preserve accessible names, keyboard opening, Escape dismissal and focus return. Hover-only insertion still has its keyboard-focus path. **Affected:** shared triggers and `InsertionSlot`; **interaction refinement check, no intended behavior change**.
- Result replay may be unavailable; do not replace that state with a blank table or claim a saved snapshot. **Affected:** Result outer width only; **presentation-only**.

## 9. Implementation status and remaining checks

1. **Implemented header refinement.** The sticky toolbar groups the notebook path and document controls. Verify keyboard focus, saving, insertion and fit at the target window sizes.
2. **Implemented canvas.** The Editor uses the central surface, a centered 1120 px maximum cell track, 32 px wide or 16 px narrow margins, and a 720 px maximum Markdown measure. The sticky header and one vertical document scroll were checked with ten synthetic blocks. **Presentation-only.**
3. **Remaining acceptance.** Inspect the native WebView2 Editor with a real project at both target sizes and Sources widths 210/248/340 px and closed. Include busy/error/save-before-navigation, long Code lines, wide Results, zoom, hover/focus insertion and saved-execution placement. The browser fixture does not exercise native persistence or replay. **Verification only; no behavior change.**
4. **Separate cell task.** Code, Markdown and Result internals, cell focus styling and detailed evidence hierarchy remain under `NOTEBOOK_CELL_DESIGN.md`. **Outside this Editor workspace task.**

No backend/schema, global token, Notebook Home or detailed cell-internal change followed from this Editor implementation. The shared sidebar transition was implemented during the later Home refinement and remains existing shell behavior.
