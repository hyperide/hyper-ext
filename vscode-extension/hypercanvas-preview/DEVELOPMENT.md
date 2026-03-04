# Hyper Preview — VS Code Extension

Standalone local visual editor for React projects.
Runs entirely on the developer's machine —
no SaaS dependency.

## Build and Install

```bash
cd vscode-extension/hypercanvas-preview
./build-and-install.sh          # build at current version
./build-and-install.sh patch    # bump patch, then build
```

> **Always use npm**, not bun —
> `@vscode/vsce` requires `npm list`.

## Architecture

### Panels

The extension creates 4 webview panels:

- **Preview** — `PreviewPanel` →
  `webview-preview/PreviewPanelApp.tsx` (Editor tab)
- **Explorer** — `LeftPanelProvider` →
  `webview-left/LeftPanelApp.tsx` (Activity Bar)
- **Inspector** — `RightPanelProvider` →
  `webview-right/RightPanelApp.tsx` (Activity Bar)
- **Logs and Chat** — `LogsAndChatPanelProvider` →
  `webview/App.tsx` (Bottom panel)

### Key Entry Points

```text
src/extension.ts               — Lifecycle
src/StateHub.ts                — State sync
src/EditorBridge.ts            — Editor ↔ webview
src/PanelRouter.ts             — Message routing
src/PreviewPanel.ts            — Canvas webview
src/LeftPanelProvider.ts       — Components tree
src/RightPanelProvider.ts      — Style inspector
src/LogsAndChatPanelProvider.ts — Bottom panel
```

### Commands

- `hypercanvas.openPreview` — Open preview panel
- `hypercanvas.refreshPreview` — Refresh iframe
- `hypercanvas.goToVisual` (`Cmd+Shift+V`) —
  Go to canvas from code (TSX/JSX)
- `hypercanvas.startDevServer` — Start dev server
- `hypercanvas.stopDevServer` — Stop dev server
- `hypercanvas.configureAIKey` — Set AI API key

## Communication

### StateHub

Central source of truth for `SharedEditorState`:

- `selectedIds[]` — selected element UUIDs
- `hoveredId` — hovered element UUID
- `currentComponent` — active component path
- `astStructure` — parsed component DOM tree
- `canvasMode` — `'single'` or `'multi'`
- `engineMode` — `'design'` or `'inspect'`

Protocol:

- `state:init` — panel registers, receives state
- `state:update` — broadcast patch to all panels

### PanelRouter

Routes messages from webview panels:

- `editor:*` → `EditorBridge`
- `ast:*` → `AstBridge` (response routed back)
- `component:*` → `ComponentService`
- `file:read` → VS Code filesystem
- `styles:readClassName` → `StyleReadService`
- `ai:openChat` → `LogsAndChatPanelProvider`
- `command:execute` → `vscode.commands`

## Services

- **AstService** — Babel AST manipulation
  (styles, props, elements)
- **ComponentService** — Scan workspace
  for React components, parse structure
- **CompositionStorage** — Local storage
  for test compositions
- **DevServerManager** — Spawn/manage dev server,
  detect project type, buffer logs
- **FileStructureStore** — Persist structure
  to `.hyperide/project-structure.json`
- **PreviewProxy** — HTTP/WS proxy
  with script injection for preview iframe
- **ProjectDetector** — Detect UI kit,
  package manager, dev commands
- **StyleReadService** — Read resolved
  Tailwind classes from component elements
- **SyncPositionService** — Auto-sync
  cursor position to canvas selection

## esbuild and Stubs

The extension uses esbuild with 7 build contexts:

- **Extension** — CJS (Node.js) → `out/extension.js`
- **Webview** — ESM → `out/webview.js`
- **Webview-left** — ESM → `out/webview-left.js`
- **Webview-right** — ESM → `out/webview-right.js`
- **Webview-preview-panel** — ESM →
  `out/webview-preview-panel.js`
- **Iframe-interaction** — IIFE →
  `out/iframe-interaction.js`
- **Iframe-error-detection** — IIFE →
  `out/iframe-error-detection.js`

### SaaS Module Stubs

Shared components import SaaS-only modules
that don't exist in the extension.
Replaced at build time via `createWebviewPlugins()`:

- `utils/authFetch` → `stubs/authFetch.ts`
  (throws on call)
- `contexts/ComponentMetaContext` →
  `stubs/saas-only.ts` (`{ meta: null }`)
- `stores/gitStore` →
  `stubs/saas-only.ts`
  (`{ isPushPopoverOpen: false }`)
- `components/SidebarHeader` →
  `stubs/SidebarHeader.tsx` (returns `null`)
- `components/SourceControlSection` →
  `stubs/SourceControlSection.tsx` (returns `null`)

To add a new stub:

1. Create stub file in `src/stubs/`
2. Add entry to `esbuild.js` →
   `createWebviewPlugins()`

## Development

```bash
npm run watch     # Watch mode (rebuilds on change)
```

Debug: press `F5` in VS Code →
"Extension Development Host" window opens.
After code changes, reload the dev host
window (`Cmd+R`).
