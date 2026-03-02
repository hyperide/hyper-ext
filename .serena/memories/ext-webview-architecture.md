# Extension Webview Architecture & Message Flow

## Overview

The VS Code extension uses 5 independent webview panels that communicate through the extension host via message routing:

1. **Preview Panel** (main editor tab) - canvas preview
2. **Left Panel** (Activity Bar explorer) - components list + elements tree
3. **Right Panel** (Secondary Side Bar inspector) - style editor
4. **Logs Panel** (bottom panel) - dev server logs (legacy DevServerLogsViewer)
5. **AI Chat Panel** (secondary sidebar) - chat interface

All webviews are wrapped with `PlatformProvider` which detects platform and creates appropriate adapters (VS Code vs Browser).

## Platform Detection & Adapters

**File**: `/Users/ultra/work/hyper-canvas-draft/client/lib/platform/PlatformContext.tsx`

- `detectPlatform()` checks if `acquireVsCodeApi` is available in window
- If YES → create `VSCodeAdapters` (webview mode)
- If NO → create `BrowserAdapters` (SaaS mode)

**Key adapters**:

- **EditorAdapter**: openFile, goToCode, getActiveFile, onActiveFileChange
- **CanvasAdapter**: sendEvent, onEvent (platform message bus)
- **ThemeAdapter**: getTheme, onThemeChange
- **SSEAdapter**: subscribe to SSE streams (proxied through extension)
- **ApiAdapter**: fetch (proxied through extension)

## Message Flow Architecture

### 1. Webview → Extension Host

All webviews use `canvas.sendEvent(message)` from VSCodeAdapter:

```typescript
// VSCodeAdapter.createVSCodeCanvasAdapter()
sendEvent<T extends PlatformMessage>(message: T): void {
  vscode.postMessage(message);  // Send to extension
  window.dispatchEvent(new CustomEvent('platform:message', { detail: message }));  // Local dispatch
}
```

### 2. Extension Host Processing

**File**: `/Users/ultra/work/hyper-canvas-draft/vscode-extension/hypercanvas-preview/src/extension.ts`

Key initialization (lines 42-106):

1. Create `StateHub` - cross-panel state sync
2. Create `PanelRouter` - central message router
3. Create `DiagnosticHub` - aggregate diagnostic data
4. Register all panel providers with webview views
5. Wire callbacks between panels

### 3. Message Routing - PanelRouter

**File**: `/Users/ultra/work/hyper-canvas-draft/vscode-extension/hypercanvas-preview/src/PanelRouter.ts`

Routes messages by type prefix:

- `state:*` → StateHub.applyUpdate
- `editor:*` → EditorBridge.handleMessage
- `ast:*` → AstBridge.handleMessage (RPC style, response routed back to requesting webview)
- `ai:openChat` → callback to AIChatPanelProvider
- `component:*` → ComponentService
- `file:*` → File operations
- `styles:*` → StyleReadService

**Currently MISSING**: `diagnostic:*` messages are NOT routed in PanelRouter!

### 4. Panel Provider Pattern

All panel providers (`LeftPanelProvider`, `RightPanelProvider`, `LogsPanelProvider`) follow this pattern:

```typescript
resolveWebviewView(webviewView, context, token) {
  // Setup webview
  webviewView.webview.html = this._getHtml(webviewView.webview);
  
  // Register with cross-panel services
  this._stateHub.register(viewType, webviewView.webview);
  
  // Handle incoming messages
  webviewView.webview.onDidReceiveMessage(async (message) => {
    if (message.type === 'webview:ready') {
      this._stateHub.sendInit(viewType);
      return;
    }
    await this._panelRouter.routeMessage(viewType, message, webviewView.webview);
  });
  
  // Cleanup
  webviewView.onDidDispose(() => {
    this._stateHub.unregister(viewType);
  });
}
```

### 5. DiagnosticHub Pattern

**File**: `/Users/ultra/work/hyper-canvas-draft/vscode-extension/hypercanvas-preview/src/DiagnosticHub.ts`

Mirrors StateHub but for diagnostics:

- Maintains `_panels: Map<string, vscode.Webview>`
- Receives updates from various sources (DevServerManager, PreviewPanel)
- Broadcasts diagnostic messages to all registered panels
- **Currently NOT connected to PanelRouter!** → panels don't register, no incoming requests handled

**Current flow**:

```
DevServerManager → extension.ts → DiagnosticHub._broadcast()
PreviewPanel (runtime errors) → extension.ts → DiagnosticHub.setRuntimeError()
```

**Missing piece**: No handler for `diagnostic:requestState` messages from webviews.

## How Sidebar Webviews Set Up PlatformProvider

**LeftPanelApp.tsx** (Left sidebar):

```tsx
export function LeftPanelApp() {
  return (
    <PlatformProvider>  // Auto-detects platform
      <LeftPanelContent />
    </PlatformProvider>
  );
}

function LeftPanelContent() {
  const canvas = usePlatformCanvas();
  useSharedEditorStateSync(canvas);  // Sync state across panels
  return <LeftSidebar />;  // Shared component
}
```

**RightPanelApp.tsx** (Right sidebar): Same pattern.

Both sidebars:

1. Wrap with `PlatformProvider` at root
2. Get `canvas` adapter via `usePlatformCanvas()`
3. Call `useSharedEditorStateSync(canvas)` to subscribe to state:* messages
4. Render shared UI components

**Note**: Dev server logs panel (`App.tsx`) does NOT use PlatformProvider because it only needs `devserver:*` messages (panel-specific).

## Entry Points (Webview HTML)

Panel providers define HTML templates that load bundled scripts:

- Left panel: `/out/webview-left.js` (entry: `webview-left/index.tsx`)
- Right panel: `/out/webview-right.js` (entry: `webview-right/index.tsx`)
- Logs panel: `/out/webview.js` (entry: `webview/index.tsx`)
- AI Chat: `/out/webview-ai-chat.js` (entry: `webview-ai-chat/index.tsx`)

Each entry file:

```tsx
import { createRoot } from 'react-dom/client';
import { SomePanelApp } from './SomePanelApp';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<SomePanelApp />);
}
```

## VSCodeAdapter Message Listeners

**VSCodeAdapter.ts** creates a global message listener (lines 52-65):

```typescript
function attachMessageListener() {
  if (isMessageListenerAttached) return;
  isMessageListenerAttached = true;
  
  window.addEventListener('message', (event) => {
    const message = event.data as PlatformMessage;
    if (message?.type) {
      for (const handler of messageHandlers) {
        handler(message);
      }
    }
  });
}
```

All adapters register handlers via this single global listener:

- CanvasAdapter (lines 159-184): routes `onEvent` subscriptions
- EditorAdapter (lines 89-114): handles `editor:activeFileChanged`
- SSEAdapter (lines 237-245): handles `sse:*` messages
- ApiAdapter (lines 281-301): handles `api:response` and `api:error`

## Current Diagnostic Messages (types.ts)

**File**: `/Users/ultra/work/hyper-canvas-draft/client/lib/platform/types.ts` (lines 188-195)

```typescript
// Diagnostics (cross-webview sync in ext, local in SaaS)
| { type: 'diagnostic:log'; entries: DiagnosticLogEntry[] }
| { type: 'diagnostic:runtimeError'; error: RuntimeError | null }
| { type: 'diagnostic:buildStatus'; status: DiagnosticState['buildStatus'] }
| { type: 'diagnostic:clear' }
| { type: 'diagnostic:state'; state: DiagnosticState }
| { type: 'diagnostic:requestState' }
| { type: 'diagnostic:console'; level: ConsoleLevel; args: string[] }
```

## Key Integration Points

### StateHub (cross-panel state sync)

- Maintains `SharedEditorState` (selected IDs, hovered ID, current component, etc.)
- All panels register via `stateHub.register(viewType, webview)`
- Broadcast via `stateHub.applyUpdate(panelId, patch)`
- StateHub routes `state:update` messages via PanelRouter

### DiagnosticHub (aggregate diagnostics)

- **PARALLEL to StateHub** - NOT wired through PanelRouter
- Panels should register but currently don't
- No handler for `diagnostic:requestState` from webviews
- Only broadcasts, doesn't receive from webviews

## What's Missing for Logs Panel Integration

1. **PanelRouter doesn't handle `diagnostic:*` messages** - no routing logic
2. **DiagnosticHub doesn't register webviews** - even though it has the infrastructure
3. **LogsPanelProvider hasn't registered with DiagnosticHub** - no two-way messaging
4. **New diagnostic panel needs setup**:
   - Create entry point (webview-diagnostics/index.tsx)
   - Create app component (webview-diagnostics/DiagnosticsApp.tsx)
   - Create provider (DiagnosticsPanelProvider.ts)
   - Register in extension.ts alongside other panels
   - Add routing + registration to PanelRouter & DiagnosticHub

## Pattern to Follow

For any new panel that needs PlatformProvider:

1. Create `src/webview-{name}/{name}App.tsx` with PlatformProvider wrap
2. Create `src/webview-{name}/index.tsx` entry point
3. Create `src/{Name}PanelProvider.ts` webview provider class
4. Register in extension.ts: `vscode.window.registerWebviewViewProvider()`
5. Wire any needed callbacks (state, diagnostics, etc.)
6. Add message routing in PanelRouter if needed

For panel providers that just need specific messages (like logs):

- Don't need PlatformProvider (no state sync, canvas operations)
- Wire callbacks directly for single-direction updates
- Example: LogsPanelProvider gets devserver:* messages from DevServerManager callback
