# DataForge design system

**Status:** Active desktop UI contract. Semantic tokens and unmigrated control styles live in `apps/desktop/src/styles.css`; Tailwind theme mappings live in `apps/desktop/src/tailwind.css`; React primitives live in `apps/desktop/src/components/ui/`. See ADR 0010.

## Principles and foundation

Use a quiet, compact dark desktop language: neutral surfaces, clear hierarchy, thin separators, predictable focus, and subtle hover changes. Avoid gradients, glow, oversized cards, and controls that imply unavailable functionality. Chat and Notebook keep their distinct layouts in `UX_SPEC.md` while sharing control rules.

The implemented stack is React, TypeScript, Tailwind CSS v4, custom CSS, shadcn/ui project configuration with Base UI, and Lucide. Existing CSS variables are the source of truth; Tailwind maps semantic roles to them without copying color values. The shared Button and IconButton use the Base UI Button primitive with DataForge variants and dimensions. Input, Select, Textarea, menus, dialogs, tables, and application layouts retain their existing CSS and behavior during this pilot. Tailwind Preflight is omitted to protect those screens. Add a new primitive only for repeated current behavior, and do not create a parallel Button system.

Review shadcn CLI output before adding a component. Do not overwrite the adapted shared Button with the registry default; each new component must use this token contract and the selected Base UI foundation.

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

`Button`, `Input`, `Select`, and `Textarea` belong in `components/ui/`; use them for standard controls. Application layouts compose them. Keep native `details`, `dialog`, and table semantics where they work; equivalent menus, dialogs, and tables share token-driven styles. Button variants use Tailwind classes and the existing semantic variables; other controls remain CSS-styled until their approved migration phase. Add a new primitive only for repeated current behavior, including future popovers, tooltips, tabs, checkboxes, or switches. Do not add unused wrappers.

| Control | Contract |
| --- | --- |
| Button | Small 28 px, default 36 px, large 44 px tall; content width and 12 px horizontal padding by default. Variants: primary, secondary, ghost/text, destructive, icon-only. Loading keeps size and announces progress. |
| Icon button | Square `--control-height-icon` 28 px, with visible focus and an accessible name. |
| Input and select | `--control-height-default` 36 px; same border, radius, padding, placeholder, focus, and disabled rules. Width follows context. |
| Textarea | Same input border/radius and 12 px padding; height follows content or its editing context. |
| Menu and context menu | Elevated surface, border, small radius, 8 px item rhythm; hover/focus covers each item. |
| Dialog | Elevated surface, large radius, 24 px padding, title hierarchy, labeled fields, explicit actions. Destructive consequences are stated in text. |
| Table | Shared header type, row padding, border, hover, numeric alignment, and keyboard-visible actions; wide analytical output scrolls. |
| Badge/status | Compact metadata; include a word or icon so meaning survives without color. |

Use `--control-height-small/default/large/icon` for those heights. Lucide is the only icon set. Use `--icon-size-small` 14 px for dense metadata, `--icon-size-default` 16 px for controls, `--icon-size-large` 20 px for prominent icons, and `--icon-size-hero` 28 px for empty-state illustrations. Use `--icon-stroke` 1.75 where supported. Center icons and label icon-only controls with `aria-label`.

## Interaction and usage rules

Every interactive control needs default, hover, active, focus-visible, disabled, and, where relevant, selected, loading, and destructive states. Hover changes a surface, not layout. Focus works by keyboard. Disabled controls remain identifiable. Honor `prefers-reduced-motion`; transitions are short and purposeful.

Examples: `<Button variant="primary">Create project</Button>`, `<Button variant="ghost" size="small">Back</Button>`, `<Button variant="icon" aria-label="Hide sidebar">…</Button>`, and `<Input aria-label="Search notebooks" />`. Use the shared `Select` for standard choices. A notebook cell may have a specialized editor surface; its controls still use shared tokens and states.

For new or modified UI, first reuse a shared component and semantic token. If a role is genuinely new and recurring, add its rule here and implement it in the shared foundation before using it across screens. Avoid local hex colors, ad hoc control heights, one-off radii, duplicated buttons/inputs, and second icon libraries. Review the native Windows app at normal and narrow sizes; a build alone does not establish visual consistency.
