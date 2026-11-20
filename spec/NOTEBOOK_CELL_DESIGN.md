# Notebook cell visual design

**Status:** Cell implementation specification, 2026-11-20. Cell internals remain unimplemented by this design task; the later Home control and shared-sidebar refinement does not alter their blueprint. The Editor track and header are specified in `spec/NOTEBOOK_EDITOR_LAYOUT.md`; this document specifies the three cell interiors. At either target width, calculate cell room from the same resizable Chat/Notebook sidebar after Threads collapses and Sources fills it. `spec/DESIGN_SYSTEM.md` and `spec/NOTEBOOK_VISUAL_SYSTEM.md` remain the token and component contracts.

## 1. Shared cell grammar

Use one continuous analytical document. Every cell occupies the Editor's centered track, with the same left selection edge, label strip, content inset, trailing action position, and hover/focus insertion boundary. The strip identifies **Text**, **Code**, or **Result** plus its actual position. Cell type is conveyed by label and content, not a large icon or colored card. One quiet token divider or the existing 26 px insertion band separates neighbors. No cell shadow; only Code source and the Result table receive an inner working surface. **Visual change:** align the three interiors to one grid and remove competing frame weight. **Affected:** `Notebook.tsx` `.notebook-block`, `.notebook-block-toolbar`, `InsertionSlot`; `styles.css`. **Shared controls:** `Button`, `DropdownMenu`, `Select`, `Table` where used below. **Class:** presentation-only.

The shared strip order is label/position and any actual Unsaved or D-twice feedback at left; contextual control(s) at right; a named 28 px actions trigger last. Keep the current menu order and actions: Edit/Preview when applicable, insertion above/below, movement, and Delete with confirmation. Present the trigger through the shared icon `Button` composed with the shared `DropdownMenuTrigger`; its `aria-label` continues to name the cell. The shared menu supplies items and separators. Verify trigger composition, focus return, popup placement, and that pressing it does not activate a cell action. **Affected:** `.notebook-cell-menu`, `.notebook-block-toolbar`; shared `Button variant="icon"`, `DropdownMenu`, `DropdownMenuSeparator`, `ConfirmationDialog`. **Class:** presentation-only with an interaction refinement check; no action change.

```text
Insertion boundary (line and + Code / + Text reveal on hover or keyboard focus)
| Cell selection edge | [TYPE  3] [actual state]       [context control] [⋯] |
|                     | content, aligned to the common left inset       |
Insertion boundary
```

The insertion controls stay **hidden at rest** and visible on boundary hover or keyboard focus, including before the first and after the last cell. Selecting a cell alone does not reveal them. The existing contextual Edit control for a selected preview Code or Text cell remains visible. Keep keyboard selection, editing, movement, save, draft, and deletion behavior unchanged. **Affected:** `InsertionSlot`, selected-cell header and styles. **Shared controls:** selected Edit uses `Button ghost / small`; insertion is the existing Notebook-specific composition. **Class:** presentation-only.

## 2. Code cell

### Layout blueprint

```text
| Code  2   [Unsaved if changed]        [Python ▾] [Edit Code if selected] [⋯] |
| [ ]  source text in the code surface, soft wrapped at available cell width |
|      No output · execution unavailable (quiet source footer)               |
```

The strip identifies Code; the existing native shared `Select` holds the cell's stored Python/SQL language, near the right actions. It is a per-cell metadata control, not a notebook language or runtime selector. Keep its existing compact 28 px contextual treatment and accessible cell-specific name. Do not add a Run icon, execution number, kernel indicator, or syntax-highlighting dependency. **Visual change:** consistent strip alignment and quieter metadata selector. **Affected:** `Notebook.tsx` Code branch, `.notebook-block-toolbar select.ui-select`; shared `Select` with existing compact Notebook CSS. **Class:** presentation-only.

The source frame is a technical inset inside the flat cell, using the existing `--color-code-surface` role if rendered comparison confirms separation from the surrounding canvas, `--color-border`, and `--radius-default`. The prompt stays `[ ]`, small, nonnumeric and explicitly non-executing. Preview and editing use the same horizontal prompt/source alignment so the cell does not jump when Edit is chosen. Source uses `--font-family-code`, `--font-size-code` (12 px), line height 1.6, and the existing two-space Tab behavior. Keep soft wrapping of long source lines and local vertical overflow of a long editor; never widen the document. The shared `Textarea` keeps selection/cursor APIs, draft persistence, spellcheck-off for Code, and no resize handle. **Visual change:** one deliberate code frame and steady preview/edit geometry. **Affected:** `.notebook-code-frame`, `.notebook-code-preview`, `.notebook-code-source`, `.notebook-code-editor`; shared `Textarea`. **Class:** presentation-only.

On selection, the cell's left edge and neutral background identify command mode. In editing, the source frame takes a visible 2 px `--color-focus-ring` focus treatment when its Textarea has focus; do not leave the inner outline removed with only the current 1 px accent frame. Keep the selected-cell Edit action in preview, and retain double-click and Enter to edit. **Visual change:** distinguish selected from active text editing without a second card border. **Affected:** `.notebook-block.selected`, `.notebook-block.editing`, `.notebook-code-frame:focus-within`; shared `Button ghost / small` for Edit. **Class:** presentation-only; verify focus and editing paths.

Treat the existing `No output · execution unavailable` line as a small factual footer **inside Code**, below a fine divider. It is not a Result table, loading placeholder, or output generated by a Run action. Do not visually join a later Result block to this source frame: a Result can come from an unrelated saved operation. **Visual change:** de-emphasize the unavailable-output line while retaining the current text and truth. **Affected:** `.notebook-code-output`; no shared component needed. **Class:** presentation-only.

## 3. Text (Markdown) cell

### Layout blueprint

```text
| Text  3   [Unsaved if changed]            [Edit Text if selected] [⋯] |
| Heading / paragraphs / lists / links as document content              |
| inline code or locally scrolling fenced code where authored           |

Editing: same strip; shared Textarea occupies the reading measure with a
visible focus frame. Preview chrome disappears, so prose reads as document.
```

Preview uses the hybrid Editor strategy: a left-aligned prose measure of about 720 px within the common cell track, shrinking to the available cell width at narrow center tracks. No filled preview card or permanent Textarea border. `Markdown.tsx` remains the safe renderer; raw HTML and unsupported syntax stay text. Double-click or the selected-cell Edit action enters the existing editor. **Visual change:** prose, not widget, leads. **Affected:** `.notebook-preview`, `.notebook-markdown`, `Markdown.tsx` output styles; shared `Button ghost / small` for Edit. **Class:** presentation-only.

Use the documented UI family. H1 uses the title role (30 px), H2 the section role (20 px), H3 the component role (13 px) with weight/space to distinguish it from 13 px prose; H4–H6 retain semantic levels but use a restrained body/component role and progressively less emphasis rather than new sizes. Paragraphs and list items use the component 13 px role with roughly 1.65 line height and `--color-text`; maintain a 45–75 character reading measure when the track permits. Use `--space-4` to `--space-section` before headings and `--space-2` to `--space-3` between ordinary blocks; trim the first/last child margin so the cell boundary controls the outside rhythm. **Visual change:** a readable heading and paragraph hierarchy using existing roles. **Affected:** `.notebook-markdown` heading, paragraph and list selectors; no new shared component. **Class:** presentation-only.

The current renderer supports H1–H6, paragraphs, one-level ordered/unordered list grouping, emphasis, strong emphasis, inline code, fenced code, and HTTP(S)/mailto links. Style list markers and indentation with the same text role and a token inset. **Indented list items currently render in the same flat list**: do not imply that nested hierarchy works. True nested lists would require a `Markdown.tsx` parser and test change, so they are **behavioral work deferred outside this visual task**. The same applies to tables, images, task lists, syntax highlighting, and raw HTML. **Affected:** `Markdown.tsx`, `.notebook-markdown` list rules; no new shared component. **Class:** presentational styling for supported lists; deferred behavior for true nesting.

Inline code uses the code font/12 px role with the existing neutral code surface and small radius. Fenced code uses a flat bordered code surface with `white-space: pre` and **local horizontal scrolling**; preserve authored indentation and do not scroll the entire document. Links use `--color-accent` plus a visible hover/focus cue; keep the renderer's safe destination handling. Emphasis stays typographic, not a new color system. Empty Markdown keeps the current `Empty Markdown block` text, subdued within the document. **Visual change:** coherent technical text and safe local overflow. **Affected:** `.notebook-markdown code/pre/a`, empty renderer state; no new shared component. **Class:** presentation-only.

Editing uses the shared native `Textarea` within a quiet Text frame at the same reading measure. Use the UI text role for prose entry if it does not disturb the current cursor/selection behavior; preserve line breaks in the editor and the existing source/preview transition. The enclosing frame gets a visible 2 px focus cue. Do not render a fake Markdown toolbar or edit/preview tabs. **Visual change:** the editor is clearly editable but remains part of the document. **Affected:** `.notebook-text-frame`, shared `Textarea`; no renderer behavior change. **Class:** presentation-only; verify cursor/focus after styling.

## 4. Analytical Result cell

### Layout blueprint

```text
| Result  4                                         [⋯] |
| Group and summarize   · Registered source: Orders   |
| Filter … · Group by … · Measures …                    |
| 20 recorded rows · Nov 20, 2026, 10:30 AM          |
| [Load result] or Replaying… / failure + [Retry result] |
| ┌─ column name ── type ┬─ numeric column ─ type ─┐ |
| │ bounded rows from replay; table scrolls locally │ |
| └──────────────────────────────────────────────────┘ |
| Showing N rows · replay scope / unsorted-order note   |
| ▸ Execution details (exact IDs, engine, parameters)   |
```

The examples above illustrate hierarchy, **not sample data to render**. Use each real execution's operation label from `describeNotebookExecution`, registered source name from `registeredSourceName` (including its unavailable fallback), actual concise input summary, actual `started_at`, and recorded `result_row_count`. Operation and source form the first line; summary forms the second; timestamp and recorded row count are quieter third-line metadata. Do not replace the recorded count with the number of currently replayed rows. If history metadata is missing, retain `Saved execution` / `Source unavailable` and the exact execution ID in details; never infer a source from adjacent Code. **Visual change:** stable identity-to-evidence reading order. **Affected:** `ResultBlock` `.notebook-result-meta`; existing provenance helpers, no new component. **Class:** presentation-only.

The table becomes the dominant loaded content, spanning the broad cell track. Keep the existing shared `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, and `TableEmpty`; the Notebook owns only its framing and scroll container. Header names lead, with real data types in a smaller second line. Use the shared 8 px vertical/12 px horizontal padding and 11 px secondary table role. Right-align values and header labels only for **known numeric column types** from returned `data_type`; do not parse formatted cell strings to guess. Show null distinctly as the current literal `null`, not blank. **Visual change:** readable evidence grid with factual types and numeric comparison. **Affected:** `ResultBlock` column rendering, `.notebook-output .data-table`; shared Table family. **Class:** presentation-only, with a small type-based alignment condition in the renderer.

The existing `.table-scroll` remains at most 360 px high and scrolls horizontally inside the Result cell for wide tables. Keep sticky headers within that container. Ordinary cells stay compact; long text is visually clipped within the existing bounded column width rather than making rows or the page enormous. Keep the full value in the DOM and expose it via the existing simple native `title` pattern where useful; do not truncate stored or replayed data. The table's horizontal scroll is independent of the document's vertical scroll. No pagination, sorting, filtering or virtualization control is invented. **Visual change:** bounded evidence presentation and local overflow. **Affected:** `.notebook-output .table-scroll`, shared `TableHead`/`TableCell` composition; no new Scroll Area. **Class:** presentation-only.

Below the table, preserve the actual `Showing N rows` scope, `has_more` note, pinned-representation replay explanation, and unsorted-order caveat in secondary text. `Execution details` remains a native `<details>` disclosure after this scope line, containing full execution ID, dataset ID, source fingerprint, recorded status, engine and original parameters. Long IDs/parameters wrap or scroll locally and remain selectable. No Badge is appropriate: the shared Badge variants mean source ready/changed/missing, not execution state. **Visual change:** technical provenance is one disclosure away while the table retains priority. **Affected:** `ResultBlock` footer/details and `.notebook-output details`; shared Table, native `<details>`. **Class:** presentation-only.

### Result states

| Actual state | Visual treatment, affected area and shared control | Class |
| --- | --- | --- |
| Before replay | Keep identity/provenance header visible. A short factual sentence says loading replays the saved operation against its pinned representation; `Load result` is shared `Button secondary / small`. No empty table or snapshot claim. `ResultBlock` `.notebook-unavailable`. | Presentation-only |
| Replaying | Keep identity visible; `Replaying saved execution…` uses readable status text in the table region. Do not show fake percentage or rows. `ResultBlock` `.notebook-muted`. | Presentation-only |
| Successful rows | Show the shared Table, then actual page-scope text and details. A large original result set still shows only the bounded replay page and truthful `has_more` note. `.table-scroll`. | Presentation-only |
| Successful zero rows | Keep the table frame/headers and shared `TableEmpty` message `No rows matched this operation.`; metadata and provenance remain. `ResultBlock`, shared `TableEmpty`. | Presentation-only |
| Replay failure / unavailable pinned representation | Keep identity and exact details; show `Result unavailable: …` with the real error plus shared `Button secondary / small` `Retry result`. Do not erase the reference or present an empty successful result. `ResultBlock` `.notebook-unavailable`. | Presentation-only |
| Missing execution reference | Keep the existing `Execution reference unavailable.` text inside the Result cell, with its label and actions; no invented source or Retry action. `Notebook.tsx` Result branch. | Presentation-only |

## 5. State, focus and document continuity

Resting cells are transparent on the document canvas. Hover gives a slight token surface change without moving content. Selected cells use the established quiet left edge and selected neutral surface; keyboard focus receives the documented 2 px ring. Editing cells keep the selected edge but show their actual Textarea's enclosing focus treatment. Dirty text and D-twice deletion warnings remain visible as words, not color alone. The Code/Result distinction stays literal: Code has source plus unavailable-runtime footer; Result has saved-execution provenance plus replayed evidence. **Affected:** `.notebook-block`, `.notebook-block-toolbar`, Code/Text frames, Result header; shared focus styles. **Class:** presentation-only.

At 1440 × 900, the 1120 px cell track gives Code and Result room while Text prose stays near 720 px. At 900 × 600 with Sources open (center roughly 560–690 px), all interiors use the available track minus 16 px side margins; metadata lines wrap before shrinking controls, Code soft-wraps, fenced Markdown and wide Result tables scroll locally, and the cell menu remains reachable. A long sequence scrolls under the Editor's sticky header as specified in `spec/NOTEBOOK_EDITOR_LAYOUT.md`. **Affected:** Notebook cell/layout selectors and existing `@container` rules. **Shared controls:** unchanged. **Class:** presentation-only.

## 6. shadcn component decision table

No shared extension or dependency is needed for these cells. The shared layer already supplies the standard controls; the analytical surfaces remain Notebook-specific.

| Element | Reuse / size | Custom composition and reason | Class |
| --- | --- | --- | --- |
| Cell Edit | `Button ghost / small` | Contextual to selected preview Text/Code | Presentation-only |
| Cell actions | `DropdownMenu` family + `Button variant="icon"` (28 px), `DropdownMenuSeparator`; shared `ConfirmationDialog` for Delete | Cell-specific menu contents and target names stay in Notebook | Presentation-only; trigger interaction check |
| Code language | Shared native `Select`, existing compact 28 px contextual styling | Per-cell language metadata beside actions | Presentation-only |
| Code/Text editor | Shared native `Textarea` | Prompt/frame, Markdown source, cursor APIs and focus container are domain-specific | Presentation-only |
| Result Load/Retry | `Button secondary / small` | Replay state stays in ResultBlock | Presentation-only |
| Result evidence | Shared Table family, including `TableEmpty` | Provenance and bounded scroll are Result-specific | Presentation-only |
| Insertion | Existing `InsertionSlot` | Boundary position and hover/focus reveal are domain behavior | Presentation-only |
| Provenance | Native `<details>` | Exact technical values and current disclosure behavior | Presentation-only |

`Tooltip` is appropriate for an icon-only menu trigger only if its composition with Base UI Menu preserves the trigger contract; the accessible name is required regardless. No standalone Separator or Scroll Area export exists: use token borders and native local overflow. No Tabs, Popover, Badge, Card, or extra editor library is justified for a cell. Base UI remains underneath the repository's shared shadcn-style wrappers; do not import it directly into `Notebook.tsx` for these controls.

## 7. Current gaps and independently implementable tasks

1. **Shared strip and actions — presentation-only, with trigger check.** Align Text/Code/Result labels, states and right actions; compose the locally styled cell menu trigger with the shared icon Button. Preserve menu actions, confirmation, selection and insertion boundaries.
2. **Code frame and focus — presentation-only.** Reuse the code-surface token after rendered comparison, align prompt in preview/edit, reduce the output footer's weight, and replace the current 1 px accent focus cue with the documented 2 px focus-ring cue. Keep the source inert and drafts/keyboard paths intact.
3. **Markdown reading rhythm — presentation-only.** Apply documented type roles, a roughly 720 px prose measure, deliberate headings/list spacing, safe link focus, and local fenced-code overflow. Record nested lists as unsupported; a parser change is a separate behavioral task, not part of this redesign.
4. **Result hierarchy and table — presentation-only.** Reorder real operation/source/summary/count/time visually, retain all provenance, use shared Table types and type-based numeric alignment, and contain wide/long values in the existing table region.
5. **Result state polish — presentation-only.** Check before-load, replaying, rows, zero rows, unavailable/retry and missing-reference copy and placement without changing replay semantics.
6. **Rendered acceptance — verification only.** Inspect all three cells at 1440 × 900 and 900 × 600, Sources at 210/248/340 px and closed, long prose/code, fenced code, a wide table, zero rows, replay failure, keyboard focus, menu placement and hover/focus insertion. Record visual defects before any optical adjustment. No rendered claim is made here.

No cell implementation, parser change, global token, Editor shell or Notebook Home change was made for this specification.
