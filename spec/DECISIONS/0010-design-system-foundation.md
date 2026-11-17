# ADR 0010: Repository-owned design system foundation

- Status: Accepted, amended for an incremental shadcn/ui migration pilot
- Date: 2026-11-17
- Supersedes: The original all-at-once Tailwind CSS and customized shadcn/ui direction in ADR 0001. Its Tauri, React, TypeScript, and Rust direction remains accepted.

## Context

ADR 0001 proposed Tailwind CSS and customized shadcn/ui. The implemented desktop application instead uses plain CSS, React, Lucide icons, and a small repository-owned `components/ui` directory. It has no Tailwind configuration, `components.json`, Radix package, or shadcn-generated components. Replacing the styling architecture solely to claim shadcn adoption would add migration risk and leave the existing visual inconsistencies to solve.

## Original decision

Keep the current React and CSS architecture. Centralize semantic CSS tokens and standardize the existing repository-owned primitives; add shared primitives only where a currently repeated control needs one. Application screens compose those primitives without redefining standard control dimensions or states. Lucide remains the icon system. Radix primitives may be considered for a specific accessible interaction that native elements and the current foundation cannot provide cleanly, after checking bundle and migration cost. Do not add Tailwind or a second component library as part of the consistency work.

## Amendment: incremental migration pilot

Adopt Tailwind CSS v4 and official shadcn/ui project configuration incrementally, using shadcn's Base UI foundation and the existing Lucide icons. The semantic variables and component contracts in `spec/DESIGN_SYSTEM.md` remain authoritative. Keep application-specific layout CSS. The approved pilot covers the build/theme integration and migration of the existing shared Button and IconButton in place; Input, Select, Textarea, menus, dialogs, and other controls remain on their current implementation until separately migrated. Do not maintain parallel Button implementations.

Tailwind Preflight is omitted during this pilot to protect existing layout, Markdown, and editor behavior. Generated shadcn components must be adapted to DataForge tokens and APIs before use; default shadcn colors and sizes are not the product design. Later phases require a review of native rendering, interaction behavior, and bundle cost.

## Consequences

`spec/DESIGN_SYSTEM.md` remains the visual contract. New UI work uses its tokens, sizing, states, and shared controls. An exception or new recurring pattern requires a documented rule and a shared foundation change. Existing screens can migrate incrementally without replacing their behavior or persistence. Automated CSS/token checks and native visual review verify consistency. This amendment authorizes the pilot, not application-wide replacement.
