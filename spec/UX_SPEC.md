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
**Notebook:** project notebooks contain ordered Markdown and result blocks. Users can create, rename and delete notebooks, edit and preview Markdown, and add, delete and reorder blocks. Result blocks reference existing successful application-defined executions and show their metadata and a bounded replay or an unavailable state. Markdown renders headings, paragraphs, emphasis, lists, links and inline code without executable HTML. General SQL and arbitrary Python cells are deferred.
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
