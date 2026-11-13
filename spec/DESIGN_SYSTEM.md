# Design system

**Status:** Initial direction; tune against the supplied mockup.

## Principles
Dark charcoal, restrained borders, compact controls, minimal iconography, square/lightly rounded geometry, subtle purposeful motion. Avoid gratuitous gradients, glow, shadows, and oversized cards.

## Starting tokens
| Token | Value | Purpose |
|---|---|---|
| background | `#242424` | App background |
| sidebar | `#292929` | Left panels |
| workspace | `#303030` | Center |
| surface | `#383838` | Elevated/selected |
| border | `#484848` | Separators |
| text | `#E5E5E5` | Primary |
| muted | `#A3A3A3` | Secondary |
| subtle | `#777777` | Tertiary |
| accent | `#D0D0D0` | Neutral emphasis |

These are starting values, not immutable brand colors. Status colors must be restrained and never be the only status cue.

## Typography
Readable UI sans-serif for general text; monospace for code, SQL, IDs, and technical metadata. Verify Windows rendering.

## Geometry
Compact spacing, thin panel borders, consistent small radii, avoid nested cards when dividers suffice. Define panel minimum sizes and resize constraints.

## Components
Resizable panel layout; sidebar/source tree; segmented switcher; composer/attachments; execution/cell viewer; data table; chart container; inspector; approval dialog; inline errors/status. Customize shadcn/ui rather than accepting its default appearance. Use Lucide consistently and label icon-only controls.

## Motion and accessibility
Short transitions; no fake progress animation; respect reduced motion. Maintain contrast, keyboard navigation, visible focus, semantic controls, and accessible chart summaries/data alternatives. Keep raw colors in design tokens rather than scattered component styles.
