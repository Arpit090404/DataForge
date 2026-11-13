# ADR 0001: Windows desktop technology direction

- Status: Accepted direction; exact versions pending.
- Date: 2026-11-12

## Context
Windows-first desktop app with rich React UI, native process/filesystem integration, and Python analytics.

## Decision
Use Tauri 2, React, TypeScript, and Rust host. Use Tailwind CSS and customized shadcn/ui.

## Alternatives
Electron (mature, larger runtime); native WinUI 3 (strong Windows integration, different UI stack); browser-only (insufficient native process/local-file integration).

## Consequences
Rust owns process management, permissions, and host APIs. Test Windows packaging, signing, WebView2, and high-DPI behavior. Revisit if Tauri proves insufficient.
