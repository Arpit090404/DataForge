# ADR 0010: Repository-owned design system foundation

- Status: Accepted, incremental shadcn/ui migration through Phase 5
- Date: 2026-11-17
- Supersedes: The original all-at-once Tailwind CSS and customized shadcn/ui direction in ADR 0001. Its Tauri, React, TypeScript, and Rust direction remains accepted.

## Context

ADR 0001 proposed Tailwind CSS and customized shadcn/ui. The implemented desktop application instead uses plain CSS, React, Lucide icons, and a small repository-owned `components/ui` directory. It has no Tailwind configuration, `components.json`, Radix package, or shadcn-generated components. Replacing the styling architecture solely to claim shadcn adoption would add migration risk and leave the existing visual inconsistencies to solve.

## Original decision

Keep the current React and CSS architecture. Centralize semantic CSS tokens and standardize the existing repository-owned primitives; add shared primitives only where a currently repeated control needs one. Application screens compose those primitives without redefining standard control dimensions or states. Lucide remains the icon system. Radix primitives may be considered for a specific accessible interaction that native elements and the current foundation cannot provide cleanly, after checking bundle and migration cost. Do not add Tailwind or a second component library as part of the consistency work.

## Amendment: incremental migration pilot

Adopt Tailwind CSS v4 and official shadcn/ui project configuration incrementally, using shadcn's Base UI foundation and the existing Lucide icons. The semantic variables and component contracts in `spec/DESIGN_SYSTEM.md` remain authoritative. Keep application-specific layout CSS. The approved pilot covers the build/theme integration and migration of the existing shared Button and IconButton in place; Input, Select, Textarea, menus, dialogs, and other controls remain on their current implementation until separately migrated. Do not maintain parallel Button implementations.

Tailwind Preflight is omitted during this pilot to protect existing layout, Markdown, and editor behavior. Generated shadcn components must be adapted to DataForge tokens and APIs before use; default shadcn colors and sizes are not the product design. Later phases require a review of native rendering, interaction behavior, and bundle cost.

## Phase 3 outcome: form controls

The shared Input, Textarea, and Select now use the same token-driven Tailwind form styles. Input uses the shadcn Base UI Input primitive. Textarea remains a native textarea because Notebook editing depends on its selection and cursor APIs. Select remains a native select because every current caller uses simple options and the native `onChange(event.target.value)` contract; its OS popup avoids custom portal and clipping behavior in WebView2. This is one shared component foundation with different native/primitive choices for concrete interaction needs. No new dependency or caller API change was needed. Menus and dialogs remain outside this phase.

## Phase 4 outcome: action menus

Notebook Home actions, the editor's + Cell menu, and cell actions now use one repository-owned dropdown component composed from Base UI Menu primitives. Items and separators share semantic tokens, and destructive and disabled states are explicit. The popup is portalled to the document body, fixed-positioned, right-aligned to its trigger, and uses Base UI collision and dismissal behavior. Notebook keyboard and click handlers do not receive popup events. The Shortcuts and Execution details disclosures remain native `details` elements because they are informational. No right-click context menu, checkbox/radio item, or submenu currently exists to migrate. No dependency or backend change was needed. Native WebView2 interaction remains a verification step unless separately recorded in `progress.md`.

## Phase 5 outcome: dialogs and confirmations

Project creation now uses a repository-owned Base UI Dialog composition with the existing form and busy behavior. Project-switching and Notebook menu deletions use a shared Base UI AlertDialog confirmation with explicit Cancel and confirm actions and initial focus on Cancel. Dialog styles use DataForge tokens, a body portal, bounded scrolling, and a responsive action footer. Project creation retains its no-backdrop-dismiss behavior. Native Tauri file and folder pickers remain native; the Notebook D-D keyboard confirmation remains inline. No settings or source-deletion dialog exists yet. No dependency or backend change was needed. Native WebView2 interaction remains a verification step unless separately recorded in `progress.md`.

## Consequences

`spec/DESIGN_SYSTEM.md` remains the visual contract. New UI work uses its tokens, sizing, states, and shared controls. An exception or new recurring pattern requires a documented rule and a shared foundation change. Existing screens can migrate incrementally without replacing their behavior or persistence. Automated CSS/token checks and native visual review verify consistency. This amendment authorizes the pilot, not application-wide replacement.
