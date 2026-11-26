# DataForge design system

**Status:** Active desktop UI contract. Semantic tokens and contextual screen styles live in `apps/desktop/src/styles.css`; Tailwind theme mappings live in `apps/desktop/src/tailwind.css`; React primitives live in `apps/desktop/src/components/ui/`. See ADR 0010.

## Principles and foundation

Use a quiet, compact dark desktop language: neutral surfaces, clear hierarchy, thin separators, predictable focus, and subtle hover changes. Avoid gradients, glow, oversized cards, and controls that imply unavailable functionality. Chat and Notebook keep their distinct layouts in `UX_SPEC.md` while sharing control rules.

The implemented stack is React, TypeScript, Tailwind CSS v4, custom CSS, shadcn/ui project configuration with Base UI, and Lucide. Existing CSS variables are the source of truth; Tailwind maps semantic roles to them without copying color values. The shared Button and IconButton use the Base UI Button primitive. Input uses the Base UI Input primitive. Textarea and Select retain native elements with shared token-driven Tailwind styling; all existing Select callers use simple option lists and native change events. Notebook action menus use the shared Base UI dropdown primitive. Project creation uses the shared Base UI dialog, and destructive or unsaved-change prompts use the shared Base UI alert dialog. Data tables use shared token-styled native elements and retain their bounded rendering and scroll containers. Source status pills use a shared Badge. Informational disclosures and application layouts retain their existing CSS and behavior. Tailwind Preflight is omitted to protect those screens. Add a new primitive only for repeated current behavior, and do not create parallel control systems.

Review shadcn CLI output before adding a component. Do not overwrite adapted shared controls with registry defaults; each new component must use this token contract and the selected Base UI foundation where an interaction primitive is needed.

## Semantic color tokens

Use these `:root` variables by role. Do not introduce a nearly matching local hex value.

| Role | Token | Dark value |
| --- | --- | --- |
| Application background | `--color-app-bg` | `#242424` |
| Sidebar background | `--color-sidebar` | `#292929` |
| Primary surface | `--color-surface` | `#303030` |
| Secondary surface | `--color-surface-secondary` | `#343a3d` |
| Elevated surface | `--color-surface-elevated` | `#393f42` |
| Hover surface | `--color-hover` | `#40494d` |
| Selected surface | `--color-selected` | `#3b474d` |
| Code surface | `--color-code-surface` | `#22292d` |
| Primary text | `--color-text` | `#e5e5e5` |
| Secondary text | `--color-text-secondary` | `#d0d0d0` |
| Muted metadata | `--color-text-muted` | `#c0c8cc` |
| Subtle/inactive text | `--color-text-subtle` | `#b6b6b6` |
| Divider/border | `--color-border` | `#484f52` |
| Input border | `--color-input-border` | `#5a656b` |
| Focus ring | `--color-focus-ring` | `#c7d7e6` |
| Primary action surface | `--color-action` | `#dedede` |
| Primary action hover | `--color-action-hover` | `#ffffff` |
| Primary action text | `--color-action-text` | `#242424` |
| Destructive action | `--color-destructive` | `#cf9a96` |
| Success | `--color-success` | `#a8c9b0` |
| Warning | `--color-warning` | `#dfc091` |
| Error | `--color-error` | `#e5bab4` |
| Error surface | `--color-error-surface` | `#4b3433` |
| Warning surface and border | `--color-warning-surface`, `--color-warning-border` | `#423a2d`, `#806b4e` |
| Success border | `--color-success-border` | `#5b6f62` |
| Error border | `--color-error-border` | `#7f5353` |
| Link/accent | `--color-accent` | `#a9cce5` |

Status includes text or an icon as well as color. Small text tokens maintain at least 4.5:1 contrast on the lightest shared hover surface. Use the same roles in Notebook, Chat, Sources, Inspector, dialogs, and analytical tables.

## Typography, spacing, and shape

`--font-family-ui` is Inter, Segoe UI, Arial, sans-serif; `--font-family-code` is Cascadia Code, Consolas, monospace. Use font roles, not one-off sizes. Normal text is weight 400, controls and labels 500–600, headings 600–650.

| Role | Token | Size |
| --- | --- | --- |
| Page title | `--font-size-title` | 30 px |
| Section heading | `--font-size-section` | 20 px |
| Component heading | `--font-size-component` | 13 px |
| Body/control text | `--font-size-body` | 12 px |
| Secondary text | `--font-size-secondary` | 11 px |
| Metadata/eyebrow | `--font-size-meta` | 10 px |
| Code text | `--font-size-code` | 12 px |

The base scale is `--space-1` through `--space-12` in 4 px steps (4–48 px). Prefer `--space-control-x` 12 px for control padding, `--space-panel` 16 px inside panels, `--space-section` 24 px between sections, `--space-cell` 12 px inside cells, and `--space-page` 32 px for page margins. Responsive layouts may reduce page margins with the same steps. Optical 1–2 px alignment and border widths are allowed where a full scale step misaligns content.

Use `--radius-small` 3 px for menus/badges, `--radius-default` 4 px for controls, `--radius-large` 8 px for dialogs, and `--radius-pill` 999 px only for pills. Borders are 1 px. Focus-visible uses a 2 px `--color-focus-ring` outline with 2 px offset; an inset outline is acceptable where a container clips it. Never remove focus without moving it to the containing interactive surface.

## Components, dimensions, and variants

`Button`, `Input`, `Select`, `Textarea`, and dialog primitives belong in `components/ui/`; use them for standard controls. Application layouts compose them. Keep native `details` and table semantics where they work; equivalent menus and tables share token-driven styles. Shared controls use semantic token styles; screen-specific editor and layout rules remain in CSS. Add a new primitive only for repeated current behavior, including future popovers, tooltips, tabs, checkboxes, or switches. Do not add unused wrappers.

| Control | Contract |
| --- | --- |
| Button | Small 28 px, default 36 px, large 44 px tall; content width and 12 px horizontal padding by default. Variants: primary, secondary, ghost/text, destructive, icon-only. Loading keeps size and announces progress. |
| Icon button | Square `--control-height-icon` 28 px, with visible focus and an accessible name. |
| Input and select | `--control-height-default` 36 px; same border, radius, 12 px horizontal padding, focus, disabled, and invalid rules. Width follows context. Select stays native for simple option lists and native keyboard/popup behavior. |
| Textarea | Same input border/radius and 12 px padding; height and resizing follow content or its editing context. Long content stays within the available width. |
| Menu and context menu | Elevated surface, border, small radius, 4 px popup padding, 28 px minimum item height, 8 px item horizontal padding; hover/keyboard highlight covers each item. Disabled items are muted; destructive items use the destructive text and error hover surface. Separators use the border token. Portalled popups align to their trigger, avoid viewport collisions, and clear clipped scroll containers. |
| Dialog | Elevated surface, large radius, 24 px padding, title hierarchy, labeled fields, explicit actions. Body and footer use 16 px and 24 px separation; footer actions align right and wrap in narrow windows. Portals center above workspace content with a backdrop, viewport padding, and bounded vertical scrolling. Project creation does not dismiss on backdrop press; Escape and explicit close work unless a create operation is busy. Alert dialogs use explicit Cancel and confirm buttons, focus Cancel first, and do not dismiss on outside press. Destructive consequences are stated in text. |
| Popover | Elevated, bordered, token-styled surface for short interactive disclosures. Portals to the body, aligns to its trigger, avoids viewport edges, dismisses on outside press or Escape, and remains below dialogs. Notebook Shortcuts uses this pattern. |
| Tooltip | Compact elevated, bordered hint for shared icon buttons. Opens on hover or keyboard focus after the Base UI default delay, dismisses on pointer exit, press, or Escape, and avoids viewport edges. A tooltip can appear above its own dialog control but never accepts pointer input. Disabled icon buttons use a non-button hover target; their nearby text must also convey unavailable functionality. |
| Table | Shared native Table, Header, Body, Footer, Row, Head, Cell, and Empty primitives. Sticky headers stay in the existing 360 px maximum-height scroll container; wide output scrolls horizontally. Head and cell padding is 8 px vertically and 12 px horizontally. CSV row numbers stay right-aligned and tabular. Pagination and result limits stay with callers. |
| Badge/status | Shared Badge uses ready, changed, and missing tones with a text label. Sidebar status dots remain contextual indicators with visible text for changed and missing sources. |

Use `--control-height-small/default/large/icon` for those heights. Lucide is the only icon set. Use `--icon-size-small` 14 px for dense metadata, `--icon-size-default` 16 px for controls, `--icon-size-large` 20 px for prominent icons, and `--icon-size-hero` 28 px for empty-state illustrations. Use `--icon-stroke` 1.75 where supported. Center icons and label icon-only controls with `aria-label`.

The Windows shell keeps its native title bar. A single 44 px application toolbar sits below it: identity and truncating project context on the left, the mode button group centered against the full window, and New Project, Open Project, then one contextual sidebar/inspector IconButton on the right. Use the existing spacing and color tokens, with one subtle separator before the contextual toggle. The central workspace starts directly below this toolbar.

## Interaction and usage rules

The left navigation sidebar is a shell-owned layout preference shared by Chat, Notebook, and Dashboard. Its default width is 248 px, bounded to 210–340 px; the CSS grid reads the same live `--sidebar-width` value. The inner edge has an 8 px full-height resize hit area with a 1 px divider, hover cue, and visible focus ring. Its vertical separator exposes current/min/max width. Arrow Left/Right adjust by 10 px, Shift+Arrow by 20 px, Home/End reach the bounds, and double-click restores 248 px. Persist the width in local browser storage, not project metadata; ignore invalid stored values and clamp valid values. Chat shows Threads above Sources. Notebook keeps that sidebar, collapses the Threads region with a short transition so Sources fills the available height, and makes collapsed Threads inert and hidden from accessibility. Reduced-motion preference removes the transition. Notebook sidebar collapse removes its grid track without changing the saved width.

Every interactive control needs default, hover, active, focus-visible, disabled, and, where relevant, selected, loading, and destructive states. Hover changes a surface, not layout. Focus works by keyboard. Disabled controls remain identifiable. Honor `prefers-reduced-motion`; transitions are short and purposeful.

Form controls retain native `required` and disabled semantics. Mark validation failures with `aria-invalid="true"` to use the error-border token, associate labels through `htmlFor`/`id` or an enclosing label, and connect field-level helper or error text with `aria-describedby` when present. A read-only field remains focusable and selectable unless a specific workflow requires otherwise.

The Notebook Home search field sits inside a separately bordered 28 px search container and uses the shared Input; its adjacent shared native sort Select is 28 px high and 120 px wide with a screen-reader-only label. The search container is at most 280 px wide and shrinks first when workspace width is limited. These are contextual sizes of existing controls, not new shared variants. The Notebook title, compact cell-language selector, and code/text editors retain contextual padding and focus treatments. A selected preview Code or Text cell shows a small contextual Edit action. Boundary Code/Text insertion controls reveal on hover or keyboard focus, not selection alone; their accessible names identify the insertion position. Standard project, analytics, rename, and execution controls use the shared 12 px horizontal padding.

Examples: `<Button variant="primary">Create project</Button>`, `<Button variant="ghost" size="small">Back</Button>`, `<Button variant="icon" aria-label="Hide sidebar">…</Button>`, and `<Input aria-label="Search notebooks" />`. Use the shared `Select` for standard choices. A notebook cell may have a specialized editor surface; its controls still use shared tokens and states.

The Notebook editor places its breadcrumb and editable title in the first row, with a thin execution and runtime row below. The breadcrumb is a ghost link at the title's component font size. Code cells reserve a fixed gutter slot for a square Run button and a status icon beneath it. The button becomes Stop while that cell runs; queued, running, completed, failed, and cancelled status icons have accessible names and tooltips. Status changes do not alter the gutter width or cell layout. Run All retains its Stop control in the execution row; individual Python interruption is available at the running cell. The execution row shows kernel status; automatic Python discovery and the manual environment override live in Notebook options. Plain-text output uses the same code font size and line height as the input editor, with the same output and error treatment in selected and unselected cells.

Code editors keep the existing textarea. Enter carries line indentation and adds one level after a Python colon or SQL opening expression. Tab and Shift+Tab indent or dedent selected lines with two-space levels; the selection and caret remain in the edited text. Notebook execution shortcuts retain priority over indentation.

For new or modified UI, first reuse a shared component and semantic token. If a role is genuinely new and recurring, add its rule here and implement it in the shared foundation before using it across screens. Avoid local hex colors, ad hoc control heights, one-off radii, duplicated buttons/inputs, and second icon libraries. Review the native Windows app at normal and narrow sizes; a build alone does not establish visual consistency.

CSV preview, analytical results, and Notebook result replay use the same table primitives. Notebook Home rows and the column profile stay custom grid layouts for their content and actions. Empty table and history messages use TableEmpty; other empty screens and the existing one-off loading messages keep their contextual layouts. There is no skeleton state or repeated loading pattern to share yet.
