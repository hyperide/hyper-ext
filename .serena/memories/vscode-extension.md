# VS Code Extension Architecture

Two extensions: `hypercanvas-preview/` (standalone local editor) and
`hypercanvas-code-server/` (lightweight Docker IDE preview).
See `vscode-extension/README.md` for umbrella overview.

## Preview Extension

Location: `vscode-extension/hypercanvas-preview/`

## Build & Publish

- **ALWAYS use npm** (not bun) — vsce requires npm list
- Build: `npm run package`
- Install: `code --install-extension hypercanvas-preview-0.1.1.vsix --force`
- Local build+install: `./build-and-install.sh [patch|minor|major]`
- **Publish**: CI-only via `.github/workflows/publish-extension.yml`
  - Trigger: push tag `ext-v*` or `workflow_dispatch` (dry_run option)
  - Secret: `VSCE_PAT` in GitHub
  - Publisher: `hyperide` on VS Code Marketplace
- Dev docs: `DEVELOPMENT.md` (not README — README is user-facing for marketplace)

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

## RightPanelApp — Component Insertion

`RightPanelApp.tsx` owns all insert-panel logic for the extension.
When `insertTargetId` is set in shared state (via diamond/+ overlay clicks),
it renders `ComponentNavigatorPanel` inline and hides `RightSidebar` with CSS.
On component pick: `astOps.insertElement()` → clears `insertTargetId`.

**Key principle**: shared components (`RightSidebar`, `FloatingPanels`) must not
contain ext-specific logic. All ext-only behavior lives in `vscode-extension/`.

## AST Operations Architecture

`AstService.ts` is a thin adapter (~444 lines) that delegates all AST algorithms
to reusable modules in `lib/ast/`:

| Module | Responsibility |
| ------ | -------------- |
| `element-builder.ts` | `buildJSXElement`, `calculateRealIndex`, `insertChildAtIndex` |
| `import-manager.ts` | `ensureImport`, `isImported`, `resolveImportPath`, `inferImportDir` |
| `operations.ts` | insert, duplicate, wrap, inject IDs, parse TSX, extract source, find parent/children |
| `traverser.ts` | `findElementWithUuidAtPosition` (fixes member expression bug) |

AstService methods follow the pattern: `_resolvePath → readAndParseFile → lib fn → writeAST → return`.

**Pitfall**: `duplicateElementInAST` only works when parent is `JSXElement`.
Elements inside `.map()` callbacks (parent = ArrowFunctionExpression) return `inserted: false`.
Wrapping in fragments breaks recast output (parentheses become JSXText) and loses React keys.

## Code Server Extension

Location: `vscode-extension/hypercanvas-code-server/`

Lightweight iframe preview for code-server Docker IDE.
2 files: `extension.ts` + `PreviewViewProvider.ts`.
Build: `tsc` (no esbuild, no React, no stubs).

Env vars: IDE_PROJECT_ID, HYPERCANVAS_ORIGIN,
HYPERCANVAS_AUTH_TOKEN, HYPERCANVAS_REFRESH_TOKEN.

Features: SSE Go to Code, API Go to Visual, file-save tracking.
See `vscode-extension/hypercanvas-code-server/README.md` for details.
