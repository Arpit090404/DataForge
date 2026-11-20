# UX specification

**Status:** Draft baseline. The user-supplied dark three-panel mockup is the primary reference.

## Intent
A quiet, compact, technical desktop workbench. Avoid generic chatbot layouts, conventional BI home pages, and overloaded IDE toolbars.

## Global layout
- In Chat, a left panel with two vertically resizable sections: Threads above, Sources below.
- Large central workspace.
- In Chat, a contextual right inspector, collapsible, and a bottom composer anchored in the central workspace.
- Compact top-center segmented switcher: Chat / Notebook / Dashboard.
- Subtle separators; resizable panels where practical.
- Notebook takes the central workspace for both Home and Editor. It keeps the Chat sidebar shell: Threads collapses on entry and Sources moves up to fill its height; switching back restores Threads. The collapsed section is inert and hidden from accessibility, and reduced-motion preference makes the change immediate. The sidebar remains optionally collapsible and resizable. Inspector and chat composer do not occupy notebook space. The global title bar and project identity remain visible, with a clear way back to Chat.

## Threads
List investigations in the active project. Support new, select, rename, archive, and delete. Show active state without excessive decoration. Provide a useful empty state.

## Sources
List local files and database connections. Add-source action; import/connection status; expandable datasets/tables. Removing a registration must be distinct from deleting an original file.

## Central workspace
**Chat:** conversation, plan, agent activity, tool/execution summaries, approval requests.  
**Notebook:** Notebook mode opens a project-scoped Home browser with a Notebooks heading, project name, a small primary New Notebook action aligned with the title, adjacent 28 px title-search and sort controls, and a compact list with notebook title, modification time, cell count, and row actions. Search is at most 280 px wide; the 120 px sort Select has Last modified and Name choices, with an accessible label and no redundant visible prefix. Rename and confirmed deletion are available from each row. While the initial list loads, Home shows a loading status rather than an empty-project claim. A failed initial load shows an error with Retry; retry stays visibly busy and may be repeated after failure. A later refresh failure keeps an already loaded list visible with separate error feedback. An empty project explains that notebooks hold text, code, and analytical results and offers creation only after a successful zero-item response. Creating a notebook opens its editor immediately. Home rename drafts participate in project-switch discard protection and are saved before opening, creating, or deleting another notebook. Returning Home saves current editor drafts and title first; a failed save keeps the editor open with its content intact. There is no cross-project notebook list.

The Notebook editor fills the available workspace height and scrolls independently. A compact toolbar offers Back to Notebooks, an editable title, save state, cell creation, and shortcut help. Any runtime status says execution is unavailable; it must not imply an active kernel. Content is centered at a readable width, while wide results can use the available space. Cells form a continuous document with restrained selection and edit cues, not individual rounded cards. Text cells display safe Markdown as document content and transition into editing. Code cells show monospaced source, Python or SQL metadata, a non-numeric execution prompt, and a separate initially empty output area; code editing has sensible height and indentation without a resize handle. Analytical Result cells reference an existing successful application-defined execution and show its output with subdued provenance. Saved-execution choices and Result headers identify the current registered source, operation, concise saved inputs, and time; exact IDs, source fingerprint, and full parameters remain in details. A missing registration is labeled unavailable, rather than assigned an inferred name. Result replay stays bounded and on demand, with an unavailable state; it does not create a snapshot or new execution, and unsorted row order may vary. Markdown renders headings, paragraphs, emphasis, lists, links, inline code, and fenced code without executable HTML. Code cells must not imply that source has run. General SQL and arbitrary Python execution remain deferred.

Contextual insertion controls appear on hover or keyboard focus at cell boundaries, including above the first and below the last cell. They offer + Code and + Text without reserving a tall permanent gap. Their hover area is stable across pointer movement, does not cover content, and their actions persist a cell at the indicated position, select it, and focus its editor. A selected Text or Code cell in preview mode shows a contextual Edit action. The cell menu gives a keyboard-accessible editing, insertion, and movement alternative. In command mode, clicking selects a cell; Up/Down changes selection, Enter edits selected Text or Code, A/B insert Text above/below, and D twice within a short visible confirmation window deletes the selected cell. Escape returns to command mode. Normal editor typing, text selection, and cursor navigation stay in the editor; Tab inserts two spaces in a Code editor and Shift+Tab moves focus. Shift+Enter saves the current source cell and selects the next without executing or replaying; Ctrl+Enter saves without moving; Ctrl+S saves title and source drafts. Drafts survive view switching; project switching retains its discard protection. Reopening restores persisted content and order from the existing project store and a sensible selection.

The cell menu presents available Edit/Preview first, then Code/Text insertion above or below, movement, and destructive Delete. The Shortcuts popover groups command-mode, editing, and saving keys; save descriptions must not imply code execution.

**Dashboard:** generated charts, tables, metrics, and findings.

These are views over one investigation model, not separate apps or duplicated state.

## Inspector
Contextual and collapsible where shown. Chat: objective, plan, data context, agent status. Dashboard: selected chart configuration, filters, and source artifact. Finding: explanation and evidence. Notebook cell metadata and execution details belong in the notebook content or an explicitly opened view; Notebook does not reserve inspector width. It is not a second chat panel.

## Composer
Multiline input, send/stop states, dataset/artifact references, clear provider connectivity and approval state. Do not imply DataForge manages subscriptions or billing. Never silently upload local data.

## Interaction and states
Selecting an investigation loads shared state across modes. Artifacts selected anywhere open in inspector. Approval prompts identify action, scope, inputs, and consequences. Cancellation is available for active work. Each data-driven panel defines empty, loading, populated, error, stale/disconnected, and permission-required states.

With no project open, the central welcome state offers Create project and Open project using the existing project actions. In a project with no registered sources, the central workspace offers Add CSV source using the existing registration action and explains that the selected file opens a preview, column profile, and analysis controls. After a source is registered, the first-source prompt disappears and the selected source workspace takes its place. Toolbar and sidebar actions remain available.

An analytical result displays the exact operation configuration used for its successful execution. Editing query settings, starting another run, or failing validation/execution leaves the prior result visible but clearly stale. Export is unavailable until a successful result matches the current settings; pagination retains the original result configuration.

Execution history presents the saved operation, available filters, grouping, measures, sort, page settings, status, and elapsed time in readable text. Optional settings absent from an older record are omitted. Selecting an entry reveals its full summary and any recorded error; a native Technical details disclosure retains the exact saved parameter string and execution provenance. History does not store result pages.

The analysis builder presents operation choice and Run as the main path. Group by and aggregations appear when the grouping operation is selected. A native disclosure holds optional filters (including nested AND/OR groups), multi-column sorting, and page size. A short live summary beside Run states the current operation, filter and sort presence, grouping/measure counts when applicable, and rows per page. A validation failure opens the disclosure when its control is inside and displays the message beside that section. Results remain directly below the builder.

## Window and accessibility
Windows-first; support resizing and high DPI. At narrow widths collapse inspector first. Keyboard focus remains visible. Icon-only controls have accessible names. Do not use color alone for status. Respect reduced motion. Charts provide accessible summaries or data alternatives.

## Visual direction
Charcoal/dark neutral palette, restrained borders, compact spacing, minimal icons, subtle motion, square/lightly rounded geometry. Avoid gratuitous gradients, shadows, and oversized cards.

## First visual milestone acceptance
Navigate modes, select thread/source, collapse inspector, resize panels, and use composer mockup without presenting fake backend behavior as real.
