# Notebook visual system: shared shadcn controls, analytical document

**Status:** Notebook-only design contract, updated 2026-11-20. The Home controls and shared-sidebar mode transition are implemented; Editor and cell treatments remain future work. This document does not change global tokens or shared variants. Current behavior in `spec/UX_SPEC.md` and the final composition in `spec/NOTEBOOK_REDESIGN_SPEC.md` take precedence over source observations below.

## 1. Existing visual-system assessment

**Verified in source.** `apps/desktop/src/styles.css` owns the semantic variables and Notebook CSS. `apps/desktop/src/tailwind.css` maps those variables to Tailwind v4 roles without duplicating color values; Tailwind Preflight is intentionally omitted. `apps/desktop/components.json` selects shadcn `base-nova` with Lucide icons. The installed shared layer is `apps/desktop/src/components/ui/`: Base UI drives Button, Input, Menu, Dialog, Popover and Tooltip interactions; native elements remain behind Select, Textarea and Table. ADR 0010 approves this mixed implementation. Notebook imports shared controls rather than raw Base UI primitives.

The existing palette and type scale are appropriate for a quiet analytical workspace: `--color-app-bg`, `--color-surface`, `--color-surface-secondary`, `--color-surface-elevated`, `--color-code-surface`, `--color-selected`, `--color-border`, `--color-focus-ring`, text roles and status roles already cover the needed visual meanings. The 4 px spacing scale, 1 px structural edges, small/default/large radii, 28/36/44 px controls and 14/16/20/28 px icon sizes are sufficient. There is **no proposed new color, size, radius or global token**.

| Source-verified tension | Why it matters | Design direction for later implementation |
|---|---|---|
| `Notebook.tsx` uses shared Button for major actions, but Back is a raw button and + Cell, Shortcuts and menu triggers are locally styled Base UI trigger exports. Rules in `styles.css` include `.notebook-new-menu`, `.notebook-help-trigger` and `.notebook-cell-menu`. | Standard controls acquire separate hover, focus, padding and size language. | Compose shared Button/`IconButton` presentation with the existing shared Menu/Popover triggers, after checking trigger, focus and popup behavior. Keep one shared visual owner for a standard control. |
| Broad `.notebook-workspace select,.notebook-workspace textarea` rules restyle shared `Select`/`Textarea`; later `.ui-select` and cell rules override some values. | A cascade of generic and context rules makes a standard field's final appearance hard to predict. | Let shared field styles own standard selectors; keep only the genuinely contextual title, search-container, compact language and source-editor treatment in Notebook CSS. No new Select/Textarea component is needed. |
| Home heading now uses the documented title role, but Editor title and Markdown heading sizes retain older local values. `styles.css` also has local `5px`, `7px`, `9px` and `10px` gaps/padding in remaining Notebook regions. | The documented type and spacing roles still need alignment in Editor and cells. | Use existing title/section/component/body/meta and spacing tokens for like roles. Contextual Markdown hierarchy may use those same roles in a different order than the toolbar. Resolve optical detail in rendered review, without adding global values. |
| `.notebook-code-frame:focus-within` uses a 1 px accent outline while the inner editor focus outline is removed. | The active editor may not meet the documented 2 px focus-ring treatment or be distinct enough from selection. | Put the shared `--color-focus-ring` focus treatment on the enclosing Code editor frame when its Textarea is focused; verify it is visible and not clipped. |
| Code preview/frame currently use `--color-app-bg`, while `--color-code-surface` is already documented. | The dedicated code surface role has no clear owner in Notebook. | Use the existing code-surface role for Code source when rendered comparison confirms it gives sufficient separation; do not add a brighter card or new color. |
| Result metadata currently wraps in a single flex cluster and the table is framed inside it. | Source, operation, row count, time and technical details can appear at similar weight, especially at narrow width. | Give operation/source a readable first line, keep count/time secondary, and put exact IDs and parameters in the existing details disclosure. Keep the table as the evidence surface. |

The historical audit and CSS alone are not a pixel-quality verdict. Impeccable's focused source detector returned `[]`; that means no rules fired, not that visual hierarchy or cascade is verified. A later browser fixture showed Home at the two target viewports and exercised the sidebar transition with synthetic data. Native WebView2, Editor and cells remain unverified.

## 2. shadcn-first usage rules

1. A **standard application control** uses its existing export from `apps/desktop/src/components/ui/`. Its shared variant owns default, hover, active, focus, disabled and loading appearance. Notebook CSS may place it and size a domain container; it should not recreate the control skin.
2. A **Notebook composition** may combine shared controls with Notebook-specific labels, provenance and layout. Keep those compositions in `Notebook.tsx` or a future Notebook-owned module; avoid a second Button, Select, Menu or Dialog implementation.
3. A **domain surface** remains custom when a generic component would erase the source/document/result relationship: canvas, cell, Code editor frame, Markdown body, insertion boundary and Result shell. Its colors, type and focus still come from the shared token contract.
4. A shared extension is justified only by a recurring control role that cannot use the existing variants while preserving accessibility. First test the existing `Button` variants and Base UI Trigger `render` composition. Do not add a global variant to solve one Notebook alignment problem.
5. Use a real semantic control even when visual chrome is reduced. Do not replace labeled buttons with clickable spans, make an invisible control unreachable by keyboard, or use color alone for state.

## 3. Component-to-Notebook mapping

All paths in this table are relative to `apps/desktop/src/`. **Current** describes installed exports; **Target** is a future visual decision, not an implementation claim.

| Control | Current shared implementation | Target Notebook use, variant/size and custom boundary | New shared variant? |
|---|---|---|---|
| Button / IconButton | `components/ui/button.tsx`: Base UI Button; `primary`, `secondary`, `ghost` (`text` alias), `destructive`, `icon`; small/default/large, with 28 px icon. `IconButton` adds a Tooltip and accessible label. | Home New Notebook: implemented `primary` small on the title line. Editor Back: `ghost` small; + Cell and Save: `secondary` default, with Save state handled by current logic. Selected-cell Edit and Result Load/Retry: `ghost` or `secondary` small according to prominence. Row/cell menu: icon presentation with a name; use `IconButton` only if Tooltip/Trigger composition behaves correctly. Empty-editor choices retain current actions. `Notebook.tsx` owns placement, not button styling. | None confirmed. |
| Input | `components/ui/input.tsx`: Base UI Input with `field-styles.ts`, default 36 px. | Home search uses the shared Input in an implemented 28 px, at-most-280 px search container. Inline rename and editor title use the default size. Search icon/container and title's borderless inline composition remain Notebook-specific in `styles.css`; shared focus and invalid state must remain visible at the correct enclosing surface. | None. |
| Textarea | `components/ui/textarea.tsx`: native Textarea with shared field styles; no variants. | Text and Code editing in `Notebook.tsx`. Code uses monospace and a specialized frame; Text source uses the same draft and focus contract. Preserve selection/cursor APIs, auto height, no resize handle and current keyboard behavior. | None; editor framing is domain-specific. |
| Select | `components/ui/select.tsx`: native select with shared field styles, default 36 px. | Home sort: implemented 28 px contextual treatment, 120 px wide and adjacent to search, with a screen-reader-only label. Saved-execution choice: default. Code language: existing compact 28 px treatment in `.notebook-block-toolbar select.ui-select`. Keep native popup and change-event behavior. | No shared compact variant needed. |
| Dropdown Menu / Context Menu | `components/ui/dropdown-menu.tsx`: Base UI Root/Trigger export, portalled Content, Item and menu Separator; destructive item state. No Context Menu export exists. | Home row menu, editor + Cell, cell action menu. Use current grouping and shared items. Test a shared Button visual on each trigger without changing opening, event isolation, focus return or menu keyboard navigation. No right-click menu is needed. | None. Context Menu stays absent. |
| Dialog / Alert Dialog | `components/ui/dialog.tsx`: Base UI Dialog family and shared `ConfirmationDialog` using AlertDialog. | Existing notebook/cell delete confirmation remains `ConfirmationDialog`: Cancel first, explicit consequence, destructive confirm. Rename stays inline; no new modal. | None. |
| Tooltip / Popover | `components/ui/tooltip.tsx` and `popover.tsx`: Base UI overlays with token surfaces and viewport-aware positioning. | Tooltip for icon-only standard commands. Existing Shortcuts Popover keeps its grouped reference; trigger may use shared `Button` ghost/small after composition check. Keep technical provenance in native details, not a hover-only tooltip. | None. |
| Tabs | No `components/ui/tabs.tsx`; shell mode switch is deliberately a button group (ADR 0010). | No Notebook tabs or split-view switch. Home and Editor are navigation states, not tab panels. | None; do not add. |
| Table | `components/ui/table.tsx`: native Table/Header/Body/Footer/Row/Head/Cell/Empty with token classes and sticky headers. | Result rows/columns use the shared Table family in the existing bounded `.table-scroll` composition. Column names/types, readable nulls, horizontal overflow and scope footer stay Result-specific. Home remains its custom row grid. | None. |
| Badge | `components/ui/badge.tsx`: only `ready`, `changed`, `missing` source-status tones. | No generic Notebook badge. Save/dirty and “No runtime” use readable text; cell kind is a label. Do not relabel source-status tones as runtime or execution states. | None. |
| Separator | `DropdownMenuSeparator` exists in `dropdown-menu.tsx`; no standalone shared Separator. | Use it inside menus. Use 1 px token borders in Notebook layout only where they separate real regions or cells. | None. |
| Scroll Area | No shared component; CSS overflow containers are current practice. | Keep editor and Result scrolling in Notebook CSS with native scrolling, bounded table height and width. Avoid nested scroll regions unless content demands them. | None. |
| Skeleton | No shared component; Home has one-off loading state. | Keep the restrained textual loading status and retry busy state. Do not add large skeleton cards for a compact list. | None. |

## 4. Typography hierarchy

Use the roles already defined in `styles.css` and `spec/DESIGN_SYSTEM.md`: UI stack `--font-family-ui`; technical stack `--font-family-code`; title 30, section 20, component 13, body 12, secondary 11, meta 10 and code 12 px. The table below is the **target composition**. It does not create new font values.

| Content | Target role | Component/styles involved |
|---|---|---|
| Home “Notebooks” | Title, `--font-size-title` and semibold weight. Project eyebrow and descriptive line are meta/body. | `Notebook.tsx` `.notebook-heading`; `styles.css`. |
| Editor notebook title | Section, `--font-size-section`, with enough width to remain the toolbar anchor. Save state is secondary or meta text beside it, never equal weight. | Shared `Input` in `.notebook-title`; `styles.css`. |
| Markdown H1/H2/H3 | Title/section/component roles **inside the document**; use document spacing, weight and line height to distinguish them from cell metadata. H1 can be stronger than the editor toolbar title because it is authored content. | `Markdown.tsx` output and `.notebook-markdown` styles. |
| Markdown prose and cell action labels | Component or body as the existing reading density allows; normal controls use shared Button body type. The Text label/number stays meta. | `.notebook-markdown`, `.notebook-block-toolbar`; shared Button. |
| Code source and technical values | `--font-size-code`, `--font-family-code`. IDs and fingerprints stay selectable and wrap in the details region. | Shared Textarea, Code preview, `ResultBlock` details. |
| Result identity | Operation at component weight; registered source at body; input summary, count and timestamp at secondary/meta with a clear reading order. | `ResultBlock` `.notebook-result-meta`; `notebookProvenance.ts` supplies factual labels. |
| Table | Shared Table Head/Cell secondary text; data type meta, tabular numerals where appropriate. | `components/ui/table.tsx`, `.notebook-output .data-table`. |

The proposed role mapping replaces local 17/22/24/25/19/15 px type choices with existing roles; no new scale is needed. Verify real Markdown documents at normal and narrow widths before changing heading CSS, since hierarchy depends on line length as well as size.

## 5. Surfaces, borders, spacing and radius

**Workspace and content.** Keep the shared application shell in `App.tsx`. Chat shows Threads above Sources; Notebook collapses Threads with a reduced-motion-aware transition so Sources fills the same sidebar. Notebook Home and Editor occupy the central `--color-surface` workspace. The Editor uses one continuous scrolling document rather than a grid of cards. Use `--color-surface-secondary` for selected/editing cell emphasis and `--color-selected` only where the established selected treatment needs a firmer cue. Hover changes tone without moving the layout. `Notebook.tsx` and `styles.css` own the canvas composition.

**Code and Result.** Use the dedicated `--color-code-surface` for source framing if visual verification confirms separation from the canvas; its border is `--color-border` and radius is `--radius-default`. Result content is a domain region, not a decorative card: a quiet provenance header, a bounded Table, and a subdued footer/details. Table headers use the shared secondary surface. Technical disclosures use the same surface/text roles, not a new palette.

**Borders and elevation.** One-pixel `--color-border`/`--color-hover` separators distinguish Home columns/rows, editor toolbar, cell boundaries, Code frame and Result table. Selection uses a left edge and background, not a full-card outline. Ordinary cells and Home rows carry no shadow. The shared Menu, Popover, Tooltip and Dialog retain their existing elevated treatment and z-order; Notebook does not add a second overlay style.

**Spacing and shape.** Use `--space-1` through `--space-12`, especially `--space-2` for compact control gaps, `--space-3` for standard field padding, `--space-panel` for local panel insets, `--space-section` between major groups, and `--space-page` where the workspace can afford it. Existing `--space-cell` can govern cell internals. Let title and analytical content retain width before secondary metadata. At the 900 × 600 minimum, wrap or de-emphasize secondary toolbar metadata before constraining the title or widening the page. Controls use `--radius-default`; menu items/badges use `--radius-small`; dialogs and larger contained surfaces use `--radius-large`. These are recommendations for Notebook CSS, not new global values.

## 6. Standard controls and status treatment

Home gets one primary New Notebook action; editor Save and + Cell are secondary actions, Back and Shortcuts lower-noise ghost actions. Cell Edit is contextual and small, the cell menu is a named icon control, and destructive Delete stays inside the menu until `ConfirmationDialog`. This follows the Impeccable hierarchy guidance: one clear primary action per decision, related secondary actions grouped, technical choices progressively disclosed.

Search, sort, title and execution choice use the shared Input/Select components. Home search and sort are documented 28 px contextual exceptions: search is capped at 280 px, sort is 120 px wide, both share one row and height, and sort uses an accessible label without visible “Sort by” text. The search icon lives in the Notebook-owned container with one enclosing focus treatment. The compact Code-language select is another contextual exception; it must still show focus and disabled state. Menus and popovers use their shared elevated surfaces and keyboard behavior. Save state, loading, errors, “No runtime” and Result unavailability are text with semantic color as a supplement, never icon or color alone. `Badge` is reserved for its implemented source-status meanings.

## 7. Analytical surface treatments

| Specialized surface | Target visual relationship | Existing implementation to preserve |
|---|---|
| Code source | Header identifies Code, position and language; source surface is monospaced and visually separate from read-only Markdown. Prompt stays non-numeric and is not a run affordance. The unavailable-output line is visually subordinate. | `Notebook.tsx` Code preview/editor, shared `Textarea`, `.notebook-code-*` rules in `styles.css`. No Python/SQL runtime. |
| Markdown preview/edit | Rendered content belongs to the document, with heading/prose rhythm and no field chrome at rest. Selected preview exposes one contextual Edit. Editing shows the shared Textarea within a quiet Text frame and retains the current draft/focus paths. | `Markdown.tsx`, `Notebook.tsx` Text cell, `.notebook-markdown`, `.notebook-text-frame`. |
| Result identity and replay | Header first identifies source, operation and concise inputs; count/time are secondary. Load/Retry belongs to its own replay/unavailable state. The table is the evidence surface; exact IDs and parameters remain one disclosure away. | `ResultBlock` in `Notebook.tsx`, `notebookProvenance.ts`, shared Table/Button, native `<details>`. Results replay pinned representations and may fail. |
| Analytical table | Keep names/types and rows readable in a local horizontal scroll area with sticky headers and a bounded height. Scope text explains shown rows, more rows and unsorted-order variability. Avoid page-wide overflow and unsupported filter/sort controls. | Shared Table family in `components/ui/table.tsx`, `.table-scroll` and `.notebook-output` styles. |

A standalone Result block must not look like output generated by the Code cell immediately above it. Its provenance header is the visual separator and causal label. No saved snapshot, fake run timestamp for Code, fabricated agent work or immutable-result claim belongs in this system.

## 8. Interaction-state specification

| State | Target visual signal and responsible layer |
|---|---|
| Hover | Shared Button/Input/Menu hover styles for standard controls; Home row and cell surfaces use a restrained `--color-surface-secondary` or existing hover role without movement. Boundary + Code/+ Text appears on boundary hover **only** (and keyboard focus). `styles.css` owns domain hover. |
| Focus-visible | Shared controls retain the 2 px `--color-focus-ring` outline and offset. Cell section can use the documented inset form where clipping requires it. Code/Text editor frame must carry a visible equivalent when the inner Textarea outline is suppressed. Insertion buttons keep meaningful accessible names and visible focus. |
| Selected | Cell gets the quiet left edge/background and its contextual Edit when previewing Code/Text. Selection alone does **not** reveal insertion controls. Selection and focus are distinguishable. |
| Editing | Source editor/frame gains a focus cue; Edit action disappears; dirty text remains visible. The current draft, Escape, menu Preview and save semantics do not change. |
| Disabled | Shared component disabled styles, with explanatory nearby text where needed. The UI does not show a disabled Run button as a placeholder for a missing runtime. |
| Loading | Home list says Loading notebooks; Retry shows busy state on the shared Button; Result replay says it is replaying. No loaded-empty claim or fake progress. Use existing `role=status`/`aria-busy` patterns. |
| Error | Initial Home failure replaces the empty claim and offers Retry; refresh failure can retain known rows. Result replay error stays with that Result and offers Retry. Pair `--color-error`/`--color-error-surface` with explicit text, not just color. |
| Unavailable | “No runtime” and Result/source unavailability are distinct factual states. Source metadata may be missing; the UI says so. A missing pinned representation remains a visible replay failure, not a blank table. |
| Destructive confirmation | Shared destructive `DropdownMenuItem` leads to `ConfirmationDialog`; its confirm Button uses the destructive variant and Cancel receives initial focus. Current keyboard delete confirmation remains visible and separate. |

## 9. Shared extensions and component boundaries

**No shared extension is confirmed necessary now.** The potential visual mismatch is largely caused by local overrides and raw/styled triggers, not by missing token values. Before proposing a new variant, test `Button` `ghost`/small and `icon` compositions with `DropdownMenuTrigger` and `PopoverTrigger`. If Base UI's `render` contract cannot preserve ref, focus, click propagation and accessible names with the existing Button, a small shared trigger integration in `components/ui/dropdown-menu.tsx` or `popover.tsx` may be justified. Specify and verify that behavior in its implementation task; do not add a Notebook-only button clone.

The Code-language Select is a single contextual compact use. A shared compact Select variant would be justified only by another real caller and an update to `spec/DESIGN_SYSTEM.md`. Context Menu, Tabs, standalone Separator, Scroll Area and Skeleton are absent from the shared directory and are not required by the target experience. Do not install or add them merely to make an inventory look complete.

## 10. Notebook-specific components to keep custom

| Composition | Why custom; how it joins the shared system |
|---|---|
| `NotebookWorkspace` / future Home and Editor compositions in `Notebook.tsx` | Own project-backed state, navigation and document layout. Use shared controls for commands/forms; retain the shell in `App.tsx`. |
| Home row grid `.notebook-home-row` and full-row open button | Title, modified time, cell count and row menu are a project artifact, not a generic Table or Button. Use token hover/focus and shared menu/rename controls. |
| Document canvas `.notebook-blocks` and cell `.notebook-block` | Cell order, selection, command/edit states and continuous document rhythm are domain-specific. Use token background, edge, spacing and shared action controls. |
| `InsertionSlot` | Boundary position and hover/focus reveal are interaction semantics. Keep its compact custom buttons and accessible before/after names; no permanently visible rail. |
| Code editor and Markdown presentation | Textarea is shared, but prompt, language, source frame, Markdown rendering and safe preview are analytical/document surfaces. Keep contextual typography and focus in Notebook CSS. |
| `ResultBlock`, table scroll and provenance `<details>` | Replay, failure, row scope and technical origin cannot be represented by a generic Card or Badge. Compose shared Table/Button and native disclosure with token-aligned domain layout. |

## 11. Decisions to preserve

- Databricks inspires the analytical document structure, not its compute toolbar, palette or full product feature set.
- DataForge remains a quiet, compact workbench in its existing shell and semantic token palette.
- Home is project-scoped and distinguishes loading, loaded, successful-empty, failed load, retry and search-empty.
- Editor is a continuous document. Hover/focus Code/Text insertion stays hidden at rest; selected-cell Edit stays contextual.
- Code cells store Python/SQL metadata and source only. Save shortcuts save; no notebook runtime or fabricated Code output.
- Result blocks reference saved executions, replay a pinned representation on demand, may become unavailable, and cannot promise unsorted row order. Their exact identifiers remain inspectable.
- Standard controls come from the shared shadcn-style layer, with Base UI underneath where already used. No Radix, extra library, global token change, or shell redesign follows from this specification.

## 12. Implementation sequence for later tasks

1. **Control ownership:** Replace only raw/local standard trigger presentation in `Notebook.tsx`/`styles.css` with compatible shared Button/IconButton compositions. Verify menu/popover keyboard, focus and propagation before continuing.
2. **Home rhythm:** Align heading, search/sort, rows, row actions and truthful list states with the type/spacing roles in this document. Keep the custom grid and current workflows.
3. **Editor toolbar:** Give title/save state room at wide and narrow widths; bring Back, + Cell, Save and Shortcuts onto shared variants. Keep “No runtime” factual and quiet.
4. **Cell hierarchy:** Refine selected/editing/hover/focus treatments and Code/Text typography. Preserve insertion visibility and all current keyboard and persistence paths.
5. **Result evidence:** Set the provenance-to-table hierarchy, local scrolling, unavailable/replay state and details disclosure without changing replay semantics.
6. **Integrated visual verification:** Inspect current-source Home and Editor at normal and minimum supported desktop sizes, with Sources open/closed, long titles/content, wide Result tables, menus, popovers and loading/error states. Record concrete defects before adjusting any remaining contextual CSS.

This sequence is a specification for future reviewable tasks. No component, stylesheet, token or application behavior is changed here.
