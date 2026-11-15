# UX specification

**Status:** Draft baseline. The user-supplied dark three-panel mockup is the primary reference.

## Intent
A quiet, compact, technical desktop workbench. Avoid generic chatbot layouts, conventional BI home pages, and overloaded IDE toolbars.

## Global layout
- Left panel with two vertically resizable sections: Threads above, Sources below.
- Large central workspace.
- Contextual right inspector, collapsible.
- Bottom composer anchored in central workspace.
- Compact top-center segmented switcher: Chat / Notebook / Dashboard.
- Subtle separators; resizable panels where practical.

## Threads
List investigations in the active project. Support new, select, rename, archive, and delete. Show active state without excessive decoration. Provide a useful empty state.

## Sources
List local files and database connections. Add-source action; import/connection status; expandable datasets/tables. Removing a registration must be distinct from deleting an original file.

## Central workspace
**Chat:** conversation, plan, agent activity, tool/execution summaries, approval requests.  
**Notebook:** Notebook mode opens a project-scoped Home list. It shows notebook titles, modification times, cell counts, title search, a new-notebook action, and rename/delete actions with deletion confirmation. Creating a notebook opens its editor immediately. Returning Home saves current drafts and title first; a failed save keeps the editor open with its content intact. The editor has an inline title and a clear route back Home. There is no cross-project notebook list.

The Notebook editor uses one centered content column with continuous, lightly separated cells and restrained selection and edit cues. The cell types are Text (safe Markdown source and preview), Code (persisted Python or SQL source and language, with no execution), and analytical Result (reference to an existing successful application-defined execution). Result replay stays bounded and on demand, with an unavailable state; it does not create a snapshot or new execution. Markdown renders headings, paragraphs, emphasis, lists, links, inline code, and fenced code without executable HTML. Code cells must not imply that source has run. General SQL and arbitrary Python execution remain deferred.

Contextual insertion controls appear at cell boundaries, including above the first and below the last cell. They offer + Code and + Text without reserving a tall permanent gap. Their hover area is stable across pointer movement and their actions insert at the indicated position. The cell menu gives a keyboard-accessible insertion and movement alternative. In command mode, clicking selects a cell; Up/Down changes selection, Enter edits selected Text or Code, A/B insert Text above/below, and D twice within a short visible confirmation window deletes the selected cell. Escape returns to command mode. Editor typing, selection, indentation, and navigation stay in the editor. Shift+Enter saves the current source cell and selects the next without executing or replaying; Ctrl+Enter saves without moving; Ctrl+S saves title and source drafts. The header keeps save state, a new-cell action, and shortcut help compact. Drafts survive view switching; project switching retains its discard protection. Reopening restores persisted content and order from the existing project store and a sensible selection.

**Dashboard:** generated charts, tables, metrics, and findings.

These are views over one investigation model, not separate apps or duplicated state.

## Inspector
Contextual and collapsible. Chat: objective, plan, data context, agent status. Notebook: selected cell metadata and execution details. Dashboard: selected chart configuration, filters, and source artifact. Finding: explanation and evidence. It is not a second chat panel.

## Composer
Multiline input, send/stop states, dataset/artifact references, clear provider connectivity and approval state. Do not imply DataForge manages subscriptions or billing. Never silently upload local data.

## Interaction and states
Selecting an investigation loads shared state across modes. Artifacts selected anywhere open in inspector. Approval prompts identify action, scope, inputs, and consequences. Cancellation is available for active work. Each data-driven panel defines empty, loading, populated, error, stale/disconnected, and permission-required states.

## Window and accessibility
Windows-first; support resizing and high DPI. At narrow widths collapse inspector first. Keyboard focus remains visible. Icon-only controls have accessible names. Do not use color alone for status. Respect reduced motion. Charts provide accessible summaries or data alternatives.

## Visual direction
Charcoal/dark neutral palette, restrained borders, compact spacing, minimal icons, subtle motion, square/lightly rounded geometry. Avoid gratuitous gradients, shadows, and oversized cards.

## First visual milestone acceptance
Navigate modes, select thread/source, collapse inspector, resize panels, and use composer mockup without presenting fake backend behavior as real.
