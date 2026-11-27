---
name: DataForge
description: A quiet, compact, technical desktop workbench for data investigation.
colors:
  app-bg: "#242424"
  sidebar: "#292929"
  surface: "#303030"
  surface-secondary: "#343a3d"
  surface-elevated: "#393f42"
  hover: "#40494d"
  selected: "#3b474d"
  code-surface: "#22292d"
  text: "#e5e5e5"
  text-secondary: "#d0d0d0"
  text-muted: "#c0c8cc"
  text-subtle: "#b6b6b6"
  border: "#484f52"
  input-border: "#5a656b"
  focus-ring: "#c7d7e6"
  accent: "#a9cce5"
  action: "#dedede"
  action-hover: "#ffffff"
  action-text: "#242424"
  destructive: "#cf9a96"
  success: "#a8c9b0"
  warning: "#dfc091"
  error: "#e5bab4"
  error-surface: "#4b3433"
  warning-surface: "#423a2d"
  success-border: "#5b6f62"
  warning-border: "#806b4e"
  error-border: "#7f5353"
typography:
  title:
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif'
    fontSize: "30px"
    fontWeight: 650
  section:
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif'
    fontSize: "20px"
    fontWeight: 650
  component:
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif'
    fontSize: "13px"
    fontWeight: 550
  body:
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif'
    fontSize: "12px"
    fontWeight: 400
  secondary:
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif'
    fontSize: "11px"
    fontWeight: 400
  meta:
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif'
    fontSize: "10px"
    fontWeight: 550
  code:
    fontFamily: '"Cascadia Code", Consolas, monospace'
    fontSize: "12px"
    fontWeight: 400
rounded:
  small: "3px"
  default: "4px"
  large: "8px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "28px"
  "8": "32px"
  "9": "36px"
  "10": "40px"
  "11": "44px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.action-text}"
    typography: "{typography.body}"
    rounded: "{rounded.default}"
    height: "36px"
    padding: "0 12px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.default}"
    height: "36px"
    padding: "0 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.default}"
    height: "36px"
    padding: "0 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.default}"
    height: "36px"
    padding: "0 12px"
  badge:
    backgroundColor: "transparent"
    typography: "{typography.meta}"
    rounded: "{rounded.small}"
    padding: "3px 7px"
---

# Design System: DataForge

## Overview

**Creative North Star: "The Analytical Workbench"**

DataForge's current interface is quiet, compact, and technical. It uses a stable desktop shell, clear work areas, dense controls, and restrained status cues so datasets and analytical work carry the attention. Its visual language is tactile but quiet: a hover, selection, or focus cue clarifies an action without shifting the layout.

This file records the implemented visual system. [The repository design system](spec/DESIGN_SYSTEM.md) and its CSS/component sources remain the engineering authority if this portable record drifts. Product capabilities described elsewhere must not be inferred from a visible control or empty state.

**Key Characteristics:**

- Compact three-region desktop shell with a centered mode selector.
- Dark neutral surfaces separated by fine borders and modest tonal changes.
- Small, consistent controls with clear keyboard focus.
- Data tables and notebook content treated as working material, not decorative cards.

## Colors

The palette moves through charcoal and cool gray neutrals; pale steel blue is reserved for links and related cues. The frontmatter gives the exact implemented values.

### Primary

- **Light action:** `action` and `action-text` make the primary button stand apart from dark working surfaces; `action-hover` signals hover.
- **Pale steel blue:** `accent` marks links and native checkbox accents; `focus-ring` gives keyboard focus a distinct, lighter outline.

### Neutral

- **Charcoal work area:** `app-bg`, `sidebar`, and `surface` distinguish window frame, side regions, and main workspace.
- **Layered graphite:** `surface-secondary`, `surface-elevated`, `hover`, and `selected` separate controls, floating surfaces, pointer state, and selection.
- **Readable gray:** `text`, `text-secondary`, `text-muted`, and `text-subtle` establish information priority without changing font families.
- **Working edges:** `border` and `input-border` define regions and editable fields. `code-surface` holds code content.

### Status

- `success`, `warning`, `error`, and `destructive` appear with text or an icon. Their paired border and surface tokens support badges, warnings, and errors.

**The Semantic Color Rule.** Choose the existing role token for each new element; define a new role in `spec/DESIGN_SYSTEM.md` and the shared foundation before repeating it across screens.

## Typography

The interface uses Inter when available, then Segoe UI and Arial. Code and technical paths use Cascadia Code or Consolas. The frontmatter records the seven implemented size roles; no font asset is currently bundled.

- **Title** (30 px): page-level empty states and prominent workspace headings.
- **Section** (20 px): dialog and section headings.
- **Component** (13 px): compact headings and prominent control text.
- **Body** (12 px): working copy and standard controls.
- **Secondary** (11 px): supporting labels and table content.
- **Meta** (10 px): status, eyebrows, and dense metadata, sometimes with restrained tracking.
- **Code** (12 px): code source and technical values in the monospace stack.

**The Data First Rule.** Use the type roles to clarify data and actions; keep long technical values selectable and allow names to truncate only where the full value remains accessible.

## Layout

The native Windows title bar stays in place. Beneath it, a 44 px application toolbar holds identity and project context on the left, a centered Chat / Notebook / Dashboard selector, and project and contextual actions on the right. In Chat, the left sidebar holds Threads above Sources, the center holds the workspace and bottom composer, and a contextual 270 px inspector can occupy the right. Notebook keeps the same sidebar: Threads collapses during the mode switch and Sources rises to fill its space. The composer leaves the Notebook workspace; the right inspector becomes the Data Explorer at wide window sizes, with independent left and right toggle controls.

The left sidebar defaults to 248 px and resizes between 210 and 340 px. The application uses a 4 px spacing scale from 4 to 48 px, with 12 px horizontal control padding, 16 px panel insets, 24 px section spacing, and 32 px page margins. At narrower widths the inspector collapses first; workspace container rules adapt content to the available center track. The Tauri window minimum is 900 × 600 px.

**The Shared Workspace Rule.** Keep navigation, center work, contextual inspection, and the composer in their established relationships; give Notebook its dedicated document workspace.

## Elevation & Depth

The system has restrained floating surfaces. Panels, tables, and source rows are mostly flat, differentiated by neutral tone and 1 px borders. Shadows appear on dialogs, popovers, and tooltips to separate them from the work surface, not on ordinary content at rest.

- **Dialog:** `0 20px 60px var(--color-shadow)` over the backdrop.
- **Popover and tooltip:** `0 6px 18px var(--color-shadow)`.

**The Restrained Float Rule.** Reserve shadow for a surface that actually floats above the workspace.

## Shapes

Small 3 px corners belong to badges and menu items; 4 px corners belong to controls and fields; 8 px corners belong to dialogs and larger contained surfaces. Pills are limited to actual pill shapes. Fine 1 px edges define structure. Focus uses a 2 px outline with a 2 px offset where it is not clipped. Notebook cells form a continuous document, with selection indicated by a subtle left edge rather than a stack of rounded cards.

## Components

### Buttons

The shared Button and IconButton are compact and tactile but quiet. Primary, secondary, ghost, destructive, and icon variants use semantic colors. Heights are 28, 36, and 44 px; icon buttons are 28 px square. Hover changes color, active darkens, focus shows the shared outline, and disabled/loading states remain distinct. Icon-only controls have accessible names and a tooltip.

### Inputs and fields

Shared Input, Select, and Textarea use the same field colors, 4 px radius, hover border, visible focus, disabled state, and error border. Standard fields are 36 px high with 12 px horizontal padding. Native Select and Textarea preserve their platform and editing behavior; specialized notebook editors keep their contextual layout.

### Navigation

The mode selector is a compact, centered button group with a 28 px control height. Source rows use neutral hover and selected surfaces, with names and status readable without relying on color alone. The sidebar resize separator is keyboard accessible and retains its width as a shell preference.

### Badges, menus, and overlays

Source badges use ready, changed, and missing tones with text labels. Menus, popovers, and tooltips use elevated neutral surfaces, fine borders, small corners, and viewport-aware placement. Dialogs use an 8 px corner, 24 px padding, a bounded scroll area, explicit actions, and a backdrop; destructive confirmations state consequences and focus Cancel first.

### Tables and notebook

Shared native table primitives support CSV previews, analytical results, and notebook result replay. Headers stick within bounded scroll regions; wide data scrolls horizontally. Notebook Home uses a compact list, a small New Notebook action aligned to its title, and adjacent 28 px search/sort controls. Editor cells make a continuous, readable document. Selection uses a quiet left edge and exposes a contextual Edit action for preview Code and Text cells. Code/Text insertion controls at cell boundaries appear on hover or keyboard focus; selecting a cell alone does not keep them visible.

## Do's and Don'ts

### Do:

- **Do** reuse the shared components, semantic color roles, 4 px spacing scale, and documented control heights.
- **Do** keep keyboard focus visible and include text or an icon with status color.
- **Do** review both normal and narrow desktop layouts when changing a screen.

### Don't:

- **Don't** introduce gradients, glow, oversized cards, or a second icon language into this workbench.
- **Don't** create local near-match colors, ad hoc field heights, or parallel button and input systems.
- **Don't** use a control's appearance to imply an agent, execution runtime, or report capability that is not implemented.
