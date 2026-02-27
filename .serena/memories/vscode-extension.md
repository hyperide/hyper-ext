# VS Code Extension Architecture

Two extensions: `hypercanvas-preview/` (standalone local editor) and
`hypercanvas-code-server/` (lightweight Docker IDE preview).
See `vscode-extension/README.md` for umbrella overview.

## Preview Extension

Location: `vscode-extension/hypercanvas-preview/`

## Build

- **ALWAYS use npm** (not bun) — vsce requires npm list
- Build: `npm run package`
- Install: `code --install-extension hypercanvas-preview-0.1.0.vsix --force`

## Multi-Webview Design

- Main webview — Component preview (canvas)
- Left panel — Components tree (shared LeftSidebar)
- Right panel — Style inspector (shared RightSidebar)
- Bottom panel — AI chat + dev server logs

## Entry Points

```text
src/extension.ts          — Extension lifecycle
src/StateHub.ts           — Central state management
src/EditorBridge.ts       — Editor ↔ webview communication
src/PreviewPanel.ts       — Canvas webview provider
src/LeftPanelProvider.ts  — Components tree
src/LogsPanelProvider.ts  — Bottom panel (dev server logs)
```

## Webview Apps

```text
webview-preview/ → PreviewPanelApp.tsx
webview-left/   → LeftPanelApp.tsx (thin wrapper ~25 lines)
webview-right/  → RightPanelApp.tsx
webview/        → App.tsx (chat + logs)
```

## SaaS Module Stubs (esbuild)

SaaS-only modules stubbed for extension build:

| Module | Stub |
| -------- | ------ |
| `utils/authFetch` | `stubs/authFetch.ts` — throws |
| `contexts/ComponentMetaContext` | `stubs/saas-only.ts` — `{ meta: null }` |
| `stores/gitStore` | `stubs/saas-only.ts` — `{ isPushPopoverOpen: false }` |
| `components/SidebarHeader` | `stubs/SidebarHeader.tsx` — null |
| `components/SourceControlSection` | `stubs/SourceControlSection.tsx` — null |

## Communication

Extension Host → Webview: `webview.postMessage({ type, ...data })`
Webview → Extension Host: `canvas.sendEvent({ type, ...data })` via platform layer

**IMPORTANT**: Never import `vscodeApi.ts` directly in webview components.
`PlatformProvider` → `VSCodeAdapter` already calls `acquireVsCodeApi()`.
Second call = crash. Use `usePlatformCanvas()` → `canvas.sendEvent()`.

### webview:ready handshake

Messages sent before React mounts are lost. Each provider should wait for
`webview:ready` message, then send initial data (state, component groups, etc.).

## Adding New Stubs

When shared components import new SaaS-only modules:

1. Create stub in `src/stubs/`
2. Add to `esbuild.js` → `createWebviewPlugins()`

## Code Server Extension

Location: `vscode-extension/hypercanvas-code-server/`

Lightweight iframe preview for code-server Docker IDE.
2 files: `extension.ts` + `PreviewViewProvider.ts`.
Build: `tsc` (no esbuild, no React, no stubs).

Env vars: IDE_PROJECT_ID, HYPERCANVAS_ORIGIN,
HYPERCANVAS_AUTH_TOKEN, HYPERCANVAS_REFRESH_TOKEN.

Features: SSE Go to Code, API Go to Visual, file-save tracking.
See `vscode-extension/hypercanvas-code-server/README.md` for details.
