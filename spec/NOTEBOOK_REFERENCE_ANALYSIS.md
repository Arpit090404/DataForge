# Notebook reference analysis: Databricks patterns for DataForge

**Status:** Design direction, 2026-11-20. Research and specification only. The current DataForge behavior in `spec/UX_SPEC.md`, `spec/DESIGN_SYSTEM.md`, `spec/NOTEBOOK_REDESIGN_BASELINE.md`, and `apps/desktop/src/Notebook.tsx` is the implementation constraint. The older `spec/NOTEBOOK_UX_AUDIT.md` is historical evidence, not a request to restore superseded ideas.

## Reference scope and evidence

This analysis uses Databricks' official [basic notebook editing](https://docs.databricks.com/aws/en/notebooks/basic-editing), [editor navigation](https://docs.databricks.com/aws/en/notebooks/notebook-editor), [cell organization](https://docs.databricks.com/gcp/en/notebooks/notebook-cells), [outputs and results](https://docs.databricks.com/aws/en/notebooks/notebook-outputs), [notebook management](https://docs.databricks.com/aws/en/notebooks/notebooks-manage), and [appearance options](https://docs.databricks.com/aws/en/notebooks/notebook-ui). These pages document controls and show linked product images. The analysis below relies on the documented descriptions; the live Databricks product and image pixels were not independently inspected. **Observed** means described in those sources. **DataForge decision** is our interpretation, not a claim about Databricks.

The useful reference is an analytical document where the notebook identity, cell source, cell operations and results are easy to locate. Databricks also has compute, jobs, collaboration, Git, assistant, and rich result manipulation. Those capabilities do not transfer merely because their controls are recognizable.

## 1. Databricks observations and DataForge decisions

| Area | Observed Databricks pattern and purpose | Why it works; DataForge decision and adaptation |
|---|---|---|
| Header and title | The notebook name anchors the toolbar; it can be renamed inline. Default language and Git controls may appear beside it, with a last-edit entry for versions. [Editing](https://docs.databricks.com/aws/en/notebooks/basic-editing), [management](https://docs.databricks.com/aws/en/notebooks/notebooks-manage). | **Adapt.** A persistent, editable title establishes document identity. Keep DataForge's Back to Notebooks and truthful Saved/Unsaved/Saving state near the title. Keep language at the Code cell because DataForge stores language per cell; do not imply a notebook-wide runtime language or version history. |
| Notebook toolbar | Databricks groups notebook menus and right-side run/compute/job/permission actions above the document. [Editing](https://docs.databricks.com/aws/en/notebooks/basic-editing). | **Adapt the compact hierarchy; reject the actions.** DataForge toolbar should prioritize title, save state, + Cell, Save, and Shortcuts, with “No runtime” as plain status. No Run, compute, schedule, permissions or Git controls are justified by current behavior. |
| Main document workspace | Databricks offers standard, results-only and side-by-side cell display modes and a wider cell/focus option. Appearance settings can reduce cell margins. [Cell organization](https://docs.databricks.com/gcp/en/notebooks/notebook-cells), [appearance](https://docs.databricks.com/aws/en/notebooks/notebook-ui). | **Adopt the document-first emphasis, reject new view modes.** DataForge should keep one continuous scrolling canvas inside the existing shell, a readable text measure, and available width for wide results. No view-mode switch or extra panel is needed for the current model. |
| Cell structure and vertical composition | Databricks stacks code and Markdown cells, offers hover insertion at top/bottom boundaries, and places results immediately after a run cell in its standard view. [Editing](https://docs.databricks.com/aws/en/notebooks/basic-editing), [cell organization](https://docs.databricks.com/gcp/en/notebooks/notebook-cells). | **Adopt the continuous rhythm and contextual insertion; adapt output relationship.** DataForge keeps hover/focus + Code and + Text boundaries and a quiet selected edge. A Result is a separate saved-execution block, not the output of the adjacent Code cell. Visually associate its own provenance with its table, never with an unrelated Code cell above it. |
| Code and Markdown identity | Databricks distinguishes runnable Code cells from rendered Markdown used to document analysis; a cell can have a language choice. [Editing](https://docs.databricks.com/aws/en/notebooks/basic-editing). | **Adapt.** DataForge Code keeps visible Python/SQL metadata and a monospaced source surface; Text reads as rendered Markdown and reveals source editing when selected. Code must state that execution is unavailable. Do not borrow Databricks' runnable prompt or completed-run styling. |
| Cell actions | Databricks places language and action controls at a cell edge; its action menu includes organization operations, and Move up/down is available without dragging. Delete is hover-revealed. Edit and command modes use Enter and Escape. [Editing](https://docs.databricks.com/aws/en/notebooks/basic-editing), [editor navigation](https://docs.databricks.com/aws/en/notebooks/notebook-editor). | **Adapt.** Keep DataForge's contextual Edit, Code language selector, organized action menu, Move up/down, confirmed Delete and current command/edit shortcuts. Do not add drag, cut/copy/paste, multi-select or a permanent action rail as a visual mimic. |
| Output and analytical result | Databricks shows results under executed cells and supports stateful outputs and multiple output forms. It exposes run timing near the cell. [Editing](https://docs.databricks.com/aws/en/notebooks/basic-editing), [outputs](https://docs.databricks.com/aws/en/notebooks/notebook-outputs). | **Reject execution framing; adapt provenance placement.** DataForge Result blocks should lead with the registered source (or unavailable source), operation, concise inputs, recorded row count and execution time. Load/Retry explicitly replays the pinned representation; it is not a stored output snapshot. Exact identifiers stay in details. |
| Table and metadata | Databricks result tables identify columns and data types and allow searching, filtering, sorting, selection, column exploration and downloading; its documentation distinguishes visible/truncated result scope. [Outputs](https://docs.databricks.com/aws/en/notebooks/notebook-outputs). | **Adopt scanability, reject unimplemented controls.** DataForge should preserve column names/types, sticky headers, bounded scrolling and honest row-count/scope text using its shared Table. Do not add table search, sort, filtering, export, column management or visualization controls without actual operations behind them. |
| Navigation and contextual panels | Databricks opens notebooks from workspace search/browser and can show a schema browser to the left; separate right-side actions include comments/history/variable/environment panels. Tabs and split editing are optional. [Editing](https://docs.databricks.com/aws/en/notebooks/basic-editing), [management](https://docs.databricks.com/aws/en/notebooks/notebooks-manage), [editor navigation](https://docs.databricks.com/aws/en/notebooks/notebook-editor). | **Adapt source access; reject panel replication.** DataForge keeps its existing collapsible Sources sidebar and full-width Notebook center. Notebook provenance belongs in content/details, with no reserved inspector track. No new tabs, schema browser, comments, variable panel or split editor are justified. |
| Empty and first-use | Databricks documentation describes creating a blank notebook through New and then naming it; it does not establish a distinct dedicated Notebook Home empty-state layout. [Management](https://docs.databricks.com/aws/en/notebooks/notebooks-manage). | **Adapt only the clear first action.** DataForge retains its project-scoped Home, successful-zero-project message, explicit create action and empty-editor + Code/+ Text choices. Loading or failure must never look like a genuinely empty project. Do not claim Databricks has a matching Home state. |

## 2. Adopt / Adapt / Reject summary

**Adopt:** One continuous analytical document; clear notebook identity; contextual cell actions; hover/focus insertion between cells; Markdown as readable document content; bounded, readable result tables; keyboard command/edit distinction. These are directly useful and mostly already exist in DataForge.

**Adapt:** Keep toolbar economy while substituting save and availability status for Databricks' execution controls. Keep Code language per cell. Make a standalone Result block read as an analytical artifact with its own origin, rather than as adjacent Code output. Preserve the existing project Home instead of copying a workspace file browser. Use DataForge's Sources sidebar for source context without consuming an inspector column.

**Reject for this redesign:** Run/Run All, compute/cluster selector, job scheduling, execution minimap, output-status badges for Code, assistant generation, Git/permissions/version actions, tabs/split views, result-table transformations, cell titles/TOC, and new cell manipulation gestures. The reference documents these in Databricks, but DataForge's current product, data model or implementation does not support them. Their absence is not a visual defect.

## 3. Target Notebook Home experience

Home is the **project notebook browser**, not an execution dashboard. The heading identifies the current project and the primary New Notebook action. Directly below it, search and sort act on a compact list. Each row gives the title first, then last modification and cell count, with Rename/Delete in a shared action menu; Delete retains confirmation. Long titles receive the available reading width before metadata does. Creation opens the new notebook immediately, as it does today.

The same list region represents five truthful states: initial loading, loaded rows, successfully loaded zero notebooks, initial failure with Retry, and Retry in progress. Search with zero matches has its own message. A later refresh error may coexist with the previously loaded list. The target does not add draft folders, notebook tabs or a sidebar file tree because DataForge notebooks are project-scoped and the current workflow already provides direct search and open.

## 4. Target Notebook Editor experience

The existing application toolbar and optional Sources sidebar frame the editor. Inside the central workspace, one compact editor toolbar anchors Back, editable title and save status on the left or center of the available line; + Cell, Save and Shortcuts remain discoverable without crowding the title. “No runtime” is a text status, not a disabled Run control. At narrow width, secondary status yields space before title and document content. The document scrolls independently and does not reserve a right inspector.

Cells form a continuous vertical document with restrained selection, predictable spacing and no stack of heavy cards. A selected preview Code/Text cell exposes one contextual Edit action. The cell menu keeps Edit/Preview, insertion, movement and destructive Delete in their current groups. Boundary + Code/+ Text actions appear on hover or keyboard focus only, including the first and last boundaries; the empty notebook has explicit creation choices. No toolbar needs to be repeated permanently on every cell.

The document's source and result relationship must be literal: Code is authored source that has not run here. A Result is a reference to a past application-defined execution and may sit anywhere in the document. Its header names that execution's source and operation so proximity to a Code cell never implies causality.

## 5. Cell interaction patterns

### Code

Show Code identity, cell position and Python/SQL metadata in a compact cell header, then monospaced source in a distinct but quiet code surface. Preserve preview, contextual Edit, menu Edit, double-click and command-mode Enter. Editing uses the current Textarea, Tab indentation, dirty marker and save/cancel paths. A small non-numeric prompt and “execution unavailable” disclosure remain honest; avoid run icons, fake output boxes with activity, execution counts and success/failure badges. Ctrl+Enter and Shift+Enter **save source**, with the current selection behavior; they do not execute it.

### Text / Markdown

Rendered Markdown reads as part of the same document, so its headings and paragraphs have the strongest content hierarchy. The selected preview reveals Edit Text. Source editing uses the current Textarea, with a clear transition back to preview and the same draft protection. The Text label and cell number locate it for cell operations without making every paragraph look like a form or card. Preserve the existing keyboard and double-click paths and safe Markdown rendering.

### Result

Lead with readable analytical identity: registered source if available, operation, bounded input summary, recorded row count and execution time. Place Load result or Retry result beside the unavailable/replay state, not in an implied Code output gutter. After load, the table is the main content; column name/type and horizontal scrolling support inspection. The footer states shown rows, whether more rows exist, pinned-representation replay and possible unsorted order variation. A secondary Execution details disclosure retains exact execution ID, dataset ID, fingerprint, recorded status, engine and full parameters. A missing source name stays “Source unavailable”; replay failure stays visible and retryable. Do not label a Result as a snapshot or “last run of this cell.”

## 6. Recommended visual hierarchy

1. **Workspace identity:** Project and notebook title, then save state. These answer where the user is and whether edits are retained.
2. **Document content:** Rendered Markdown and Code source carry the most visual weight. Selection is a subtle edge; cell chrome should not compete with analytical content.
3. **Analytical evidence:** Result origin and table are visually connected to each other, with the table wider when needed. Recorded row count and replay scope are legible before technical IDs.
4. **Actions:** New Notebook on Home; + Cell and Save in the editor; contextual Edit and cell menu at the selected cell. Destructive actions remain in menus and confirmations.
5. **Technical detail:** IDs, fingerprints, full parameters and shortcut reference live in deliberate disclosures. They remain inspectable without filling the primary reading path.

Use DataForge's existing dark neutral surfaces, semantic color roles, spacing and compact control sizes. Databricks provides interaction reference, not a palette, shell or component skin to copy.

## 7. Shared shadcn component implications

The installed inventory is recorded in `spec/NOTEBOOK_REDESIGN_BASELINE.md`; `apps/desktop/src/components/ui/` is the source. Base UI remains the primitive layer. Use shared `Button`/`IconButton` for standard commands and menu/help triggers where its composition with Base UI Trigger preserves keyboard and focus behavior; `Input` for search/title/rename; native-backed shared `Select` for sort, cell language and saved execution; `DropdownMenu` items/separators for row and cell actions; `ConfirmationDialog` for deletion; `Popover` for Shortcuts; `Tooltip` for icon-only actions; `Textarea` for source editing; and the shared Table family for Result data.

Notebook Home rows, document canvas, cell headers, boundary insertion, Code/Text surfaces, Result provenance and table overflow are **domain compositions** around those controls. Keep their specific layout custom and token-aligned. The current shared Badge has only ready/changed/missing source-status tones; do not repurpose it as a generic cell or runtime label. There is no installed shared Tabs, Context Menu, standalone Separator, Scroll Area or Skeleton. Tabs are unnecessary for this target, menu separators already exist, and one-off Home loading should stay a contextual state. Do not install generic components simply to mirror Databricks.

## 8. DataForge constraints carried forward

- Preserve project-scoped Home, current creation/open/rename/delete behavior, search/sort, loading/error/retry distinctions, and project-switch draft protection.
- Preserve notebook save behavior, edit and command modes, shortcuts, contextual Edit, double-click editing, insertion order, keyboard focus, and hover/focus-only boundary controls.
- No general Python/SQL notebook execution runtime exists. Code language is metadata. No Run/Run All or visual execution state.
- Result blocks reference successful saved executions and load by replaying the pinned representation on demand. Pinned data can be unavailable; an unsorted result's row order is not guaranteed. Do not present a Result as an immutable snapshot or as output produced by a neighboring Code cell.
- Preserve exact provenance in secondary details and readable source/operation/input/time in the primary Result identity; do not infer missing names or parameters.
- Keep the existing shell, collapsible Sources navigation, central notebook workspace, tokens and shadcn/Base UI foundation. No new component library, schema change, dependency or global design-system edit follows from this reference.

## 9. Decisions for the next design task

1. Design **one** Home browser and **one** Editor canvas inside the existing shell; do not add tabs, split views or a Notebook inspector.
2. Use a compact editor toolbar with title/save prominence and no execution control. Resolve narrow-width title/action behavior before pixel polish.
3. Draw cells as a continuous document. Keep one contextual selected-cell Edit action and hover/focus insertion, with no permanent boundary controls.
4. Give Code, Text and Result distinct identities through content and restrained metadata. A Result's own provenance must prevent false association with adjacent Code.
5. Make table readability and replay trust part of the Result design, with exact technical values one disclosure away.
6. Build standard controls from the existing shared shadcn-style components; keep analytical surfaces custom. Validate trigger composition and focus before replacing locally styled controls.
7. The next task may create visual compositions, but should verify them in a current-source rendered preview or native WebView2. This reference analysis does not certify pixel layout or responsive behavior.
