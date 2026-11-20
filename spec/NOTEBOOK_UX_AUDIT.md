# Notebook UX and design audit

**Date:** 2026-11-19

**Scope:** Project Notebook Home and Editor, including their immediate shell relationship. Review only.

**Method:** Repository and specification inspection plus independent Impeccable design and detector assessments. No application build, full test suite, or new native interaction test was run for this audit. Findings marked **Confirmed** follow directly from the current source; **Verify** items need a live Windows WebView check.

**Follow-up (2026-11-19):** The cell-affordance finding below records the original audit state and recommendation. The editor now shows a contextual Edit action for a selected preview Code or Text cell. A trial that kept adjacent Code/Text insertion controls visible on selection was reverted after preview review; insertion controls now reveal on hover or keyboard focus only. The remaining audit text is historical and should not be read as a current implementation map.

**Current-state note (2026-11-20):** The Home initial loading, failure/retry, empty-project and search-empty states, compact two-line narrow rows, and shared row-menu trigger have since been implemented. The Home heading now uses a small New Notebook action aligned with the title; 28 px search and sort controls sit together without a visible “Sort by” prefix. The shared Chat sidebar now collapses Threads when entering Notebook so Sources fills its height, and restores Threads on return. The findings below remain the original audit evidence, including recommendations that were superseded; use `spec/NOTEBOOK_REDESIGN_SPEC.md` and current source for the active contract. Native WebView2 verification is still outstanding.

The Impeccable detector command, `.agents/skills/impeccable/scripts/impeccable.cmd detect --json apps/desktop/src/Notebook.tsx`, returned `[]` (zero source-scan findings). No current native app or CDP listener was available; existing executables predate the Notebook source. No rendered screenshots, overlay, or live contrast results were obtained. A clean source scan does not clear the interaction findings below.

## Executive assessment

The Notebook is a real project-backed authoring surface, not an execution environment. Its strongest choices are the dedicated document workspace, compact Home list, explicit save state, restrained continuous cells, and honest runtime messaging. The main UX risk is a mismatch between visible affordances and actual behavior: the shortcut help promises an action that does nothing; the first Home render can claim there are no notebooks while the list is still loading; and result selection and provenance expose technical identifiers where an analyst needs source context. Editing and insertion work, but much of their interaction model must be discovered through hover, double-click, or the Shortcuts popover.

The design direction is broadly compatible with DataForge's quiet, dense workbench and uses the shared token foundation. The improvement opportunity is to reduce repeated cell chrome and make state, editability, and result provenance easier to read without adding a runtime or an IDE-style toolbar. Databricks is useful here as a reference for fast cell authoring and clear output provenance, not for its full execution toolbar.

Impeccable's source-based design assessment scored the ten usability heuristics **24/40**. The largest gaps were system status, recognition of available actions, consistency, and error recovery. This is a source-based judgment, not a measured user test or a rendered contrast assessment.

## Verified implementation map

### Ownership and data flow

- [`App.tsx`](../apps/desktop/src/App.tsx) owns project, mode, selected source, sidebar state, and the Notebook dirty flag. The Notebook component remains mounted while hidden during mode/source changes, and remounts for a new project session. Project switching and window unload consult its dirty flag. Selecting a source leaves Notebook for the source workspace. Notebook mode removes Threads, inspector, and composer while retaining the collapsible Sources sidebar and global mode switch.
- [`Notebook.tsx`](../apps/desktop/src/Notebook.tsx) owns Home list/search/sort/rename state; open notebook, title, cell draft and language maps; selected/editing cell; saved-execution list and chosen execution; operation busy/error state. Tauri `invoke` calls load and mutate project data. Save, insert, delete, and move reload the notebook from the host. A failed Back save leaves the editor open. Project switching with dirty drafts opens a shell-owned discard prompt.
- [`notebook.rs`](../apps/desktop/src-tauri/src/notebook.rs) stores notebooks and ordered Markdown, Code, and Result blocks in project SQLite. It validates title length, block kind and language, and successful same-project execution references. Code cells persist Python/SQL *metadata and source only*. Result blocks store an execution ID. They do not store output snapshots.
- [`notebookKeys.ts`](../apps/desktop/src/notebookKeys.ts), [`notebookHome.ts`](../apps/desktop/src/notebookHome.ts), and [`Markdown.tsx`](../apps/desktop/src/Markdown.tsx) provide keyboard decisions, client-side title search/sorting, and restricted Markdown rendering. The current Markdown renderer supports headings, paragraphs, emphasis, lists, links, inline code, and fenced code; it leaves unsupported syntax as text and does not execute raw HTML.

### Notebook Home

With a project open, Home offers a project heading, New Notebook, title search, last-modified/name sorting, title/modified/cell-count rows, row menus for rename and confirmed delete, and separate empty-project and no-search-match messages. Creating opens an untitled notebook immediately. Home rename drafts are included in the dirty flag and saved before navigation to another notebook. Listing is asynchronous; there is no distinct initial loading state. A load failure appears as an alert above the same list/empty-state layout. [Source](../apps/desktop/src/Notebook.tsx#L54-L101), [Home render](../apps/desktop/src/Notebook.tsx#L178-L191).

### Editor

The editor has Back, inline title, save status, No runtime, a + Cell menu, Save, and Shortcuts. It supports Code and Text insertion at every boundary and from cell menus, selected/edited cell states, menu-based movement and deletion, keyboard command/edit modes, Markdown preview, a plain textarea for code source with Python/SQL selector, and an explicitly unavailable output area. There is no Python/SQL execution handler or Run control. Successful application-defined executions can be added as Result blocks; their bounded table is replayed only after Load result and can fail if the pinned representation is unavailable. The replay is not an immutable snapshot and unsorted row order is not guaranteed. [Editor render](../apps/desktop/src/Notebook.tsx#L193-L219), [result behavior](../apps/desktop/src/Notebook.tsx#L33-L51), [interaction rules](../spec/UX_SPEC.md#L24-L28).

## Prioritized UX and visual findings

| Severity | Status | Screen / component | Type | Finding and recommended improvement |
| --- | --- | --- | --- | --- |
| **High** | **Confirmed** | Editor Shortcuts and command mode | Interaction, trust | The Shortcuts popover advertises `M Markdown`, and the key resolver returns `markdown`, but the handler immediately returns without an action. A user following the help gets no response. Remove the advertised shortcut until a meaningful, specified action exists, or define and implement its actual effect. Keep the help text derived from supported behavior. [Key resolver](../apps/desktop/src/notebookKeys.ts#L15), [handler](../apps/desktop/src/Notebook.tsx#L170), [help](../apps/desktop/src/Notebook.tsx#L193). |
| **High** | **Confirmed** | Home initial and failed-load states | Interaction, visual | The list starts as `[]`, renders “Your notebooks start here,” and fetches asynchronously with no loading flag. On failure, the alert appears above that same false empty-project CTA. This can suggest the project has lost notebooks or invite duplicate creation. Reserve the empty-project message for a successful zero-item response; show a distinct loading state and a recoverable list-error state. [State/load](../apps/desktop/src/Notebook.tsx#L55-L101), [empty render](../apps/desktop/src/Notebook.tsx#L191). |
| **High** | **Confirmed** | Editor saved-execution picker and Result block | Interaction, visual, data trust | The picker identifies executions by timestamp, operation type, and eight ID characters; loaded result metadata shows a raw dataset ID. A researcher cannot reliably choose or interpret evidence by source and analytical inputs, especially with several similar runs. Show a human-readable source name and concise operation/parameter summary in the selection and result header, while retaining exact ID, fingerprint, and parameters in details. Keep the on-demand replay limitation explicit. [Picker](../apps/desktop/src/Notebook.tsx#L218), [result metadata](../apps/desktop/src/Notebook.tsx#L45-L50). |
| **Medium** | **Confirmed** | Editor insertion and cell preview | Interaction, accessibility | Boundary actions are visually hidden until hover/focus, and Code/Text preview editing relies on double-click or command-mode Enter. The menu exposes Edit, but the content itself gives no single-click edit affordance. First-time and pointer-only users must discover a hidden gesture; keyboard users need to learn a mode switch. Give the selected cell a visible, low-noise Edit action or contextual hint and preserve the menu/keyboard paths; make the boundary insertion target perceptible when a cell is selected as well as on hover. [Render](../apps/desktop/src/Notebook.tsx#L197-L215), [insertion CSS](../apps/desktop/src/styles.css#L191-L196). |
| **Medium** | **Confirmed** | Editor cell toolbar, code surface, output area | Visual, interaction | Each Code cell repeats a toolbar, language control, framed source, `[ ]` prompt, and a “No output · execution unavailable” strip even though no runtime can produce output. In a long source-heavy notebook, this consumes document height and lets inactive output compete with the actual work. Preserve the clear no-runtime disclosure in the toolbar and code identity, but compress or conditionally disclose the repeated empty output area. Do not replace it with a Run button or fabricated output. [Render](../apps/desktop/src/Notebook.tsx#L197-L215), [CSS](../apps/desktop/src/styles.css#L183-L213). |
| **Medium** | **Confirmed** | Editor cell actions and Shortcuts | Interaction, visual | The per-cell menu lists four insertion directions before movement, Edit/Preview, and Delete, while Shortcuts is one ungrouped line of commands. The repeated choices obscure the everyday actions and make keyboard modes harder to learn. Group insertion by position/type in the menu without changing available actions, and present shortcuts as a compact command/edit reference with labels that distinguish save from execution. [Menu/help](../apps/desktop/src/Notebook.tsx#L193-L210). |
| **Medium** | **Verify** | Home row grid and Editor toolbar at narrow widths | Visual, responsive | Source CSS reduces Home's four grid tracks to `minmax(130px,1fr) 95px 30px 25px` and wraps the Editor title beneath the actions at 1050 px; the optional Sources track can still take 210–340 px. The effective center width may crowd dates, counts, titles, and title/save status at the 900 px window minimum. Inspect at minimum width with sidebar open and closed, long notebook titles, and high display scaling; then allow metadata to stack or de-emphasize before truncating the primary title. [Home breakpoints](../apps/desktop/src/styles.css#L219-L220), [container rule](../apps/desktop/src/styles.css#L264-L271). |
| **Low** | **Confirmed** | Home empty, Editor empty, insertion slot | Visual | A new empty notebook presents + Cell in the toolbar, a boundary insertion slot, and two more Code/Text buttons in its central empty hint. Home's icon-heavy heading and empty-state illustration also add chrome around a compact list. Keep the direct empty-notebook Code/Text actions, then reduce duplicate visible creation affordances while empty; keep Home's list and title as the main visual anchors. [Home/Editor](../apps/desktop/src/Notebook.tsx#L181-L191), [empty editor](../apps/desktop/src/Notebook.tsx#L193-L215). |

## Strengths worth preserving

- Home is project-scoped and supports the full basic management loop, including a sensible list, title search, sorting, inline rename, and confirmed deletion. A first notebook opens directly after creation.
- The dedicated Notebook layout gives authoring space without Chat's composer or inspector. Cells read as one document with restrained selected/editing cues, matching the existing workbench direction and design tokens.
- The interface does not claim a code runtime. Save shortcuts save source rather than execute it; result blocks replay existing bounded analytical operations on demand and expose technical provenance. Draft protection covers mode and project transitions.

## Recommended redesign principles

1. **Make each state literal.** Loading, empty, save failure, unavailable replay, and “source not run” need distinct language and feedback. A status must never imply an operation completed before it did.
2. **Put analytical identity before internal IDs.** Use source name, operation, relevant inputs, and time for recognition. Keep exact identifiers and fingerprints available for auditability.
3. **Keep the document primary.** Let source, Markdown, and loaded results dominate. Repeated unavailable-output chrome and duplicate creation controls should recede.
4. **Make the interaction model legible.** Selection, editing, insertion, and command mode should reveal the next available action without requiring memorized gestures. Preserve efficient keyboard paths.
5. **Use the existing shell and tokens.** Keep Notebook's dedicated center workspace and the approved shared primitives; adjust Notebook-specific composition within `spec/DESIGN_SYSTEM.md` rather than introducing a second visual language.

## Proposed implementation sequence

These are independent review recommendations, not work started by this audit. Each should include a focused regression check and native normal/narrow-window review when implemented.

1. Correct the Shortcuts copy/handler mismatch and make shortcut descriptions accurately distinguish source saving from execution.
2. Add separate initial loading, successful empty, and list-error presentation to Home, with a recovery action for list failure.
3. Improve saved-execution labels and Result headers with readable source and operation context; preserve exact provenance and replay limitations in details.
4. Refine cell selection/edit and boundary insertion cues without replacing the existing menu and keyboard alternatives.
5. Reduce repeated inactive code-output chrome and duplicate empty-notebook creation controls, keeping the No runtime message visible.
6. Restructure the cell actions and Shortcuts disclosure for scanning while retaining all current operations.
7. Tune the Home grid and Editor toolbar at the minimum supported window width and high display scaling after a native visual check.

## Manual verification still needed

- In the current Windows WebView2 build, inspect Home after a slow list response and a list failure; confirm the perceived transition and error recovery. The source establishes the state path, not its actual duration.
- At 1440 × 900 and 900 × 600, with Sources open/closed and long notebook names, inspect Home row overflow, toolbar wrapping, result-table horizontal scrolling, and whether selected/edited cues remain clear.
- Walk the full keyboard path with a screen reader: Home row actions; insertion slots; command/edit mode; cell menu; Shortcuts popover; delete confirmation; focus after insert, move, delete, save, and Back. Verify focus visibility and announcements rather than inferring them from ARIA attributes.
- Test pointer hover and touch-like input for boundary insertion, double-click editing, and menu collision near viewport edges.
- Test result replay with a successful execution, an unavailable pinned representation, empty output, and many columns; verify that provenance and “loaded from pinned representation” are understood as replay rather than a frozen snapshot.
- Recheck draft preservation on a failed save, mode round trip, Back, project switch, and window close in the native executable. Earlier `progress.md` records partial native checks but does not establish every path on this source revision.

## Five highest-impact improvements

1. Remove or fulfill the no-op `M Markdown` shortcut promise.
2. Separate Home loading and load-error states from a genuinely empty project.
3. Identify saved results by readable source and analysis context instead of IDs.
4. Reveal editing and insertion affordances for the selected cell.
5. Reduce repeated unavailable-output chrome inside Code cells.
