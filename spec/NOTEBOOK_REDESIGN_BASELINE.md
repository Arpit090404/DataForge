# Notebook redesign baseline: shared shadcn component foundation

**Status:** Investigation and specification only, 2026-11-19. Current source and current design contracts take precedence over the historical findings in `spec/NOTEBOOK_UX_AUDIT.md`.

## Assessment

DataForge's installed shadcn-style foundation is a small, repository-owned layer in `apps/desktop/src/components/ui/`. It uses Base UI for interaction primitives, Tailwind classes and the semantic tokens specified in `spec/DESIGN_SYSTEM.md` for presentation. `apps/desktop/components.json` identifies the `base-nova` style. The redesign should make this shared layer the default for standard controls while retaining a custom, continuous analytical document canvas. A swap to Radix or a second library is unnecessary.

Notebook already imports shared Button, Input, Select, Textarea, DropdownMenu, Popover, ConfirmationDialog and Table components. The meaningful opportunity is to remove local visual implementations of standard control roles, especially menu and help triggers, while keeping domain-specific interaction and density. There is no direct `@base-ui/react` import in `Notebook.tsx`.

**Review method and limit:** Source and current design contracts were inspected. A current-source Vite web preview mounted the actual `NotebookWorkspace` with in-memory sample data for Home and Editor structure; it did not exercise the Tauri backend. Screenshot capture failed twice with “The browser is not producing screenshot frames. For a desktop tab, show or restore the T3 Code window and try again.” The alternate browser inventory contained no tabs. Thus hierarchy, density and surface judgments below are source and rendered-DOM assessments, not a verified pixel critique. The Impeccable source detector on `apps/desktop/src/Notebook.tsx` returned `[]`; it does not prove visual quality. Native WebView2 and high-DPI appearance were not checked.

## 1. Notebook Home implementation map

| Area | Actual implementation | Shared foundation and behavior |
|---|---|---|
| Shell and workspace | `apps/desktop/src/App.tsx` mounts `NotebookWorkspace` inside the existing central workspace; `apps/desktop/src/styles.css` owns shell and Notebook layout rules. | Project, mode, sidebar and inspector remain shell-owned. Notebook should not rebuild them. |
| State and data | `NotebookWorkspace` in `apps/desktop/src/Notebook.tsx` owns list, load status, search, sort, rename, selection, editor state and Tauri `invoke` calls. `apps/desktop/src/notebookHome.ts` supplies filter/sort helpers. | Initial loading, retrying, ready, and initial error are distinct. A later refresh error keeps previously loaded rows. |
| Heading and create | `notebook-heading`, project eyebrow, title, description, New Notebook. | Shared `Button` for create; layout is custom. |
| Search and sort | `notebook-home-controls`, search label/icon, `Input`, native-backed shared `Select`. | Standard fields already use shared components; the search container has intentional contextual styling. |
| List and management | Custom grid header/rows; raw `notebook-home-open` button; shared `DropdownMenu` with Rename and destructive Delete; rename form uses `Input` and `Button`. | Custom rows are specified by `spec/DESIGN_SYSTEM.md`. Delete uses shared `ConfirmationDialog` via `pendingDelete`. |
| Loading, empty, error | `notebook-home-list` branches on `listStatus`; contextual `notebook-home-empty` layout and shared Retry/Create `Button`. | No shared Skeleton exists or is needed for this one-off compact state. Search-empty differs from project-empty. |

## 2. Notebook Editor implementation map

| Area | Actual implementation | Shared foundation and behavior |
|---|---|---|
| Editor toolbar | `notebook-editor-toolbar`: raw Back button, shared title `Input`, save status, explicit “No runtime”, shared `DropdownMenu` for + Cell, shared Save `Button`, shared `Popover` for Shortcuts. | `DropdownMenuTrigger` and `PopoverTrigger` are shared-module exports but their visual styles are local Notebook CSS. Saving source does not execute code. |
| Document and selection | `notebook-blocks` and `notebook-block` sections in `Notebook.tsx`; keyboard decisions in `apps/desktop/src/notebookKeys.ts`. | Custom canvas, selection, command/edit state and draft protection are domain behavior. |
| Insertion | `InsertionSlot` in `Notebook.tsx`; two native buttons per boundary, CSS hover/focus reveal; + Cell menu and explicit empty-notebook buttons. | Boundary targets and insertion order are domain-specific. Hover/focus presentation is an established decision; do not make buttons permanently visible. |
| Cell header/actions | `notebook-block-toolbar`: kind/position/dirty feedback, shared `Select` for Python/SQL metadata, contextual shared Edit `Button`, shared `DropdownMenu` for Edit/Preview, four insertion directions, Move and destructive Delete. | Menu items/separators are shared. The `⋯` trigger's appearance is bespoke CSS. Delete uses `ConfirmationDialog`. |
| Markdown/Text cell | `Markdown` renderer in `apps/desktop/src/Markdown.tsx`, shared `Textarea` while editing, custom preview and frame. | Markdown preview and source editing need a custom cell composition, not a generic Card. |
| Code cell | Shared `Textarea` with code-specific class, prompt, source preview and honest “No output · execution unavailable” message. | Python/SQL are metadata; no runtime or execution action exists. Code editor surface remains specialized. |
| Result cell | `ResultBlock` in `Notebook.tsx`, provenance helpers in `apps/desktop/src/notebookProvenance.ts`; shared `Button` for Load/Retry and shared Table family in a scrolling container; native execution-details disclosure. | Loading replays an execution against its pinned representation. It is not an immutable snapshot; unavailable replay has an explicit error/retry. |
| Saved execution attachment | Shared `Select` and `Button`, native details for exact ID/fingerprint/parameters. | Picker label comes from existing execution/source data; no fabricated source or operation metadata. |
| Shortcut help | Shared `Popover` with locally structured sections and a locally styled trigger. | Reference reflects current `notebookKeys.ts`; no `M Markdown` action. |

## 3. Installed shared shadcn component inventory

Every path below is under `apps/desktop/src/components/ui/`. The implementation was inspected; absence means there is no shared component file today.

| Component and path | Primitive, variants and styling | Suitable Notebook role |
|---|---|---|
| `Button`, `IconButton` — `button.tsx` | Base UI Button; `primary`, `secondary`, `ghost`/`text`, `destructive`, `icon`; small/default/large (icon is square 28 px); cva, semantic token classes. `IconButton` composes shared Tooltip and supplies an accessible label. | Standard toolbar, create/save/retry/edit actions; icon-only menu trigger if Base UI trigger composition remains correct. |
| `Input` — `input.tsx`; `fieldStyles` — `field-styles.ts` | Base UI Input; shared token border, focus, disabled/invalid and 36 px default control treatment. No local variants. | Search, title, rename. Keep contextual search/title container rules. |
| `Textarea` — `textarea.tsx` | Native textarea with `fieldStyles`; no variants. | Text and Code source editing, with cell-specific typography/sizing. |
| `Select` — `select.tsx` | Native select with `fieldStyles`; no variants. | Sort, code language, saved execution choice. Native popup and keyboard behavior are intentional. |
| `DropdownMenu` family — `dropdown-menu.tsx` | Base UI Menu Root/Trigger are re-exported; shared portalled fixed-position Content, Item (`destructive` state) and Separator; token surface, highlight and focus behavior. | Notebook row actions, cell actions, + Cell. Trigger visual treatment needs a deliberate shared-Button composition check. |
| `Dialog`, `AlertDialog`, `ConfirmationDialog` — `dialog.tsx` | Base UI Dialog/AlertDialog with shared content/header/body/footer; confirmation composes shared Buttons and focuses Cancel initially. | Notebook/cell deletion. No new confirmation component. |
| `Popover` family — `popover.tsx` | Base UI Popover Root/Trigger/Title re-exported; shared portalled fixed-position Content with `ui-popover-popup` styling. | Shortcuts help. Its trigger can use a shared Button presentation if composition works. |
| `Tooltip` family — `tooltip.tsx` | Base UI Tooltip; shared token-styled content and trigger export. | Icon-only standard actions through `IconButton`; not needed for every labeled cell action. |
| `Table` family — `table.tsx` | Native table elements: Table, Header, Body, Footer, Row, Head, Cell, Empty; Tailwind semantic token styles. | Result rows/columns in the existing horizontal/vertical overflow wrapper. |
| `Badge` — `badge.tsx` | Native span, `ready`, `changed`, `missing` status tones only. | Existing source status use; **not** a generic Notebook kind or runtime badge without a justified new semantic variant. |

**Not installed:** shared Context Menu, Tabs, standalone Separator, Scroll Area or Skeleton. A menu separator exists only inside `dropdown-menu.tsx`. Notebook currently does not need a new dependency or generic component merely to fill this list. Notebook Home rows are a custom grid by current design-system rule, not a Table replacement candidate.

## 4. Underuse, bespoke controls and Base UI boundary

| Finding | Classification | Recommendation |
|---|---|---|
| Raw Back button and locally styled `+ Cell`, `Shortcuts` and `⋯` triggers in `Notebook.tsx`/`styles.css` duplicate standard Button visual roles. | **Reuse** | Use shared `Button`/`IconButton` variants for standard controls where Base UI Menu/Popover `render` composition preserves trigger semantics, focus and keyboard behavior. Test the rendered trigger before removing CSS. A shared Button `ghost`/small or icon style should be tried before adding a variant. |
| Home row open control is a full-width, content-rich grid action, not an ordinary command button. | **Custom** | Keep its semantic native button and row-specific layout; align hover/focus, icon and text colors with shared token rules. Do not squeeze the entire row into a small shared Button. |
| Boundary `+ Code`/`+ Text` buttons are custom insertion targets whose discoverability depends on hover/focus and position labels. | **Custom** | Keep `InsertionSlot` as a Notebook component. Reuse semantic tokens and focus states; preserve hidden-until-hover/focus presentation. Avoid forcing two standard 36 px Buttons into every boundary. |
| Home heading/search/list and editor toolbar/cell header mix domain layout with standard controls in one large `NotebookWorkspace`. | **Compose** | In future implementation tasks, extract only coherent Notebook-specific compositions around existing shared controls. Keep state ownership and `invoke` flow unchanged unless a concrete need appears. |
| Result metadata, technical disclosure and wide Table are specialized analytical output. | **Compose / Custom** | Compose shared Table and Button with a custom Result shell, provenance and replay/error states. Keep exact IDs and parameters in disclosure, and constrain table overflow locally. |
| Code language selector uses the default shared `Select` inside a dense cell header. | **Reuse first; Extend only if proven** | Try contextual width/padding with existing tokens. Add a compact shared Select variant only if rendered checks show a recurring control need across screens; specify it in `spec/DESIGN_SYSTEM.md` before implementation. |
| Current `DropdownMenuTrigger` and `PopoverTrigger` are direct Base UI aliases exported by shared files and styled in Notebook. | **Shared-layer gap, not direct bypass** | Notebook imports no raw Base UI. Review whether shared trigger wrappers or documented `render={<Button …/>}` composition are the simplest way to centralize presentation. Do not import Base UI into Notebook or replace it with Radix. |

The current one-off CSS is not uniformly wrong: `notebook-code-frame`, `notebook-preview`, `notebook-output`, `notebook-home-row` and `notebook-insertion` express domain layout. The redesign should target local *standard control* styling first, not remove the custom Notebook surface.

## 5. Recommended component architecture

**Home:** Keep `NotebookWorkspace` as the project-backed state owner initially. A Home composition should contain heading/create, labeled search and sort, custom row grid, shared row menu, rename form and shared confirmation. Render loading, retry/error, project-empty and search-empty through the existing contextual layout with shared action Buttons. There is no evidence for Tabs, a generic Card grid or Skeleton.

**Editor:** Keep the shell in `App.tsx`. Build an editor toolbar from shared Button, Input, DropdownMenu and Popover controls around Notebook-specific save/runtime status. Keep one continuous custom document canvas. Cell compositions own their label, selection, menu and specialized content while using shared Button/Select/Textarea controls. `InsertionSlot` remains custom. `ResultBlock` remains domain-specific and uses the shared Table, disclosure and replay action. The code surface should distinguish source from unavailable output without suggesting execution.

**Visual contract:** Use the existing quiet dark semantic palette, type scale, control heights, radii, spacing and focus states in `DESIGN.md` and `spec/DESIGN_SYSTEM.md`. Shared controls should supply their standard interaction states; custom cell and row surfaces should align to those tokens without looking like repeated cards or permanent per-cell toolbars. Preserve the compact Home and document-oriented Editor. Do not alter the global tokens to solve Notebook-only density.

## 6. Constraints and dependencies for implementation

- Preserve Tauri `invoke` contracts, notebook model, draft protection, insertion order, keyboard modes, creation/rename/delete flows, project switching and navigation.
- Preserve hover/focus-only insertion controls and the contextual Edit action. Do not restore always-visible boundary buttons.
- Python/SQL cells remain editable source with language metadata. No run button, fabricated activity or claimed runtime.
- Result loading remains replay against the pinned representation; disclose possible unavailability and unsorted row-order variation. Preserve exact provenance details.
- Trigger composition needs a focused keyboard, focus and menu/popover positioning check before replacing local trigger markup. A change in component ownership must not silently change Base UI dismissal or event propagation.
- Use existing shared components first. A new variant requires a demonstrated recurring role and an updated design-system contract; a new generic component or dependency requires separate justification.
- Visual decisions still require current-source rendered inspection at normal and narrow sizes in a working web preview or WebView2. This baseline cannot certify pixel hierarchy or responsive quality because screenshot capture was unavailable.

## 7. Prioritized small redesign tasks

1. **Standard control triggers:** Audit and replace the raw Back and locally styled + Cell, Shortcuts and `⋯` trigger presentations with compatible shared Button/IconButton compositions. Verify keyboard opening, focus return, positioning and accessible names.
2. **Home control rhythm:** Align the Home heading action, search/sort fields, row menu trigger and rename form using existing shared variants/tokens. Retain the custom row grid and distinct loading/empty/error states.
3. **Editor toolbar:** Normalize Back, title, save status, runtime note, + Cell, Save and Shortcuts hierarchy using shared controls. Keep analytical content width and narrow-window behavior as acceptance criteria.
4. **Cell header and insertion:** Compose label/language/Edit/menu controls around the custom cell canvas. Verify selected/editing states, menu grouping, hover/focus insertion and no permanent per-cell chrome.
5. **Code/Text surfaces:** Refine custom preview/editor treatment with shared Textarea and token typography. Keep source, preview, save and no-runtime semantics intact.
6. **Result presentation:** Refine the custom provenance, replay/error disclosure and scroll container around the existing shared Table and Button; test long parameters and wide columns.
7. **Integrated rendered review:** Check Home and Editor at normal and minimum supported sizes, with long titles, many rows, editing cells, menus/popovers and wide Results. Record confirmed issues before any broader style change.

Each task is independently reviewable and should avoid a full Notebook rewrite. This document specifies direction; it makes no application change.
