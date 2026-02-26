# Sidebar Architecture Patterns - HyperCanvas Sidebar Sharing System

## Overview

The project implements a sophisticated platform abstraction layer that enables the **same React components** to work in:

1. **SaaS (browser)** - with code-server iframe
2. **VS Code Extension** - with native VS Code editor via webview

The key insight: **Don't duplicate sidebar components. Adapt communication paths.**

---

## Core Architecture Pattern

### 1. Platform Abstraction Layer (`client/lib/platform/`)

Located in: `client/lib/platform/`

#### Files

- **`PlatformContext.tsx`** - React provider that auto-detects platform
- **`BrowserAdapter.ts`** - Browser/SaaS implementation (postMessage to iframe, CustomEvent)
- **`VSCodeAdapter.ts`** - VS Code implementation (acquireVsCodeApi)
- **`types.ts`** - Message types (discriminated union of all platform messages)
- **`shared-editor-state.ts`** - Zustand store for cross-panel sync
- **`hooks/useElementStyleData.ts`** - Dual-mode hook (browser engine+DOM vs RPC)

#### How it Works

```tsx
// App root always wraps with this
<PlatformProvider>
  <App />
</PlatformProvider>

// Components use hooks:
const platform = usePlatform();           // Get all adapters
const editor = usePlatformEditor();       // Open file, go to code
const canvas = usePlatformCanvas();       // Send/receive messages
const theme = usePlatformTheme();         // Get theme
const api = usePlatformApi();             // Fetch with CORS proxy
const sse = usePlatformSSE();             // Subscribe with proxy
```

#### Platform Detection

```typescript
// In PlatformContext.tsx
function detectPlatform(): PlatformContextType {
  if (typeof window !== 'undefined' && 'acquireVsCodeApi' in window) {
    return 'vscode-webview';
  }
  return 'browser';
}
```

---

## Message-Bus Communication

### Unified Message Types (`types.ts`)

All platform messages are discriminated unions:

```typescript
type PlatformMessage =
  // Editor operations
  | { type: 'editor:openFile'; path: string; line?: number; column?: number }
  | { type: 'editor:activeFileChanged'; path: string | null }
  | { type: 'editor:goToCode'; path: string; line: number; column: number }
  
  // Canvas events
  | { type: 'canvas:componentLoaded'; data: unknown }
  | { type: 'canvas:selectionChanged'; elementIds: string[] }
  
  // Theme
  | { type: 'theme:changed'; theme: 'light' | 'dark' | 'system' }
  
  // AI Chat
  | { type: 'ai:openChat'; prompt?: string; forceNewChat?: boolean }
  
  // SSE & API (for VS Code proxy)
  | { type: 'sse:subscribe'; url: string; subscriptionId: string }
  | { type: 'api:fetch'; requestId: string; url: string; options?: RequestInit }
  
  // AST operations (visual editor ↔ extension host)
  | { type: 'ast:updateStyles'; requestId: string; ... }
  | { type: 'ast:insertElement'; requestId: string; ... }
  | { type: 'ast:deleteElements'; requestId: string; ... }
  | { type: 'ast:duplicateElement'; requestId: string; ... }
  | { type: 'ast:updateProps'; requestId: string; ... }
  | { type: 'ast:renameElement'; requestId: string; ... }
  | { type: 'ast:updateText'; requestId: string; ... }
  | { type: 'ast:response'; requestId: string; success: boolean; ... }
  
  // Style reading
  | { type: 'styles:readClassName'; requestId: string; elementId: string; componentPath: string }
  | { type: 'styles:response'; requestId: string; success: boolean; ... }
  
  // Component operations
  | { type: 'component:list'; requestId: string }
  | { type: 'component:listGroups'; requestId: string }
  | { type: 'component:response'; requestId: string; success: boolean; ... }
  
  // State sync (cross-panel)
  | { type: 'state:update'; patch: Partial<SharedEditorState> }
  | { type: 'state:init'; state: SharedEditorState }
  
  // Webview lifecycle
  | { type: 'webview:ready' }
```

### Adapter Interfaces

#### EditorAdapter

```typescript
interface EditorAdapter {
  openFile(path: string, line?: number, column?: number): Promise<void>
  getActiveFile(): Promise<string | null>
  onActiveFileChange(callback: (path: string | null) => void): () => void
  goToCode(path: string, line: number, column: number): Promise<void>
}
```

**Browser impl**: Finds `<iframe data-code-server>` and postMessages to it
**VS Code impl**: Uses `acquireVsCodeApi().postMessage()` to send to extension host

#### CanvasAdapter

```typescript
interface CanvasAdapter {
  sendEvent<T extends PlatformMessage>(message: T): void
  onEvent<K extends PlatformMessage['type']>(
    type: K,
    callback: (message: MessageOfType<K>) => void
  ): () => void
}
```

**Browser impl**: window.dispatchEvent(CustomEvent)
**VS Code impl**: acquireVsCodeApi().postMessage() + window.addEventListener('message')

#### ThemeAdapter, SSEAdapter, ApiAdapter

Similar pattern - browser uses native APIs, VS Code proxies through extension host

---

## VS Code Extension Multi-Panel Architecture

### esbuild.js Build Configuration

Located: `vscode-extension/hypercanvas-preview/esbuild.js`

Creates 6 separate webview bundles:

1. **`webview.js`** - Main logs + AI chat panel UI
2. **`webview-left.js`** - Explorer/Components panel (uses shared LeftSidebar)
3. **`webview-right.js`** - Inspector/Styles panel
4. **`webview-preview-panel.js`** - Preview iframe controller
5. **`webview-ai-chat.js`** - Secondary sidebar AI chat
6. **`extension.js`** - Node.js extension host

All webviews use shared alias plugins:

```javascript
// Resolve aliases for @/, @shared/, @lib/ imports
build.onResolve({ filter: /^@\// }, (args) => {
  // Resolve to root/client/
  return { path: resolveWithExtensions(path.join(rootDir, 'client', resolved)) };
});
```

#### Key Stubs for Shared Components

The esbuild config stubs out SaaS-only modules:

```javascript
// Stub out SaaS-only modules for shared LeftSidebar
build.onResolve({ filter: /contexts\/ComponentMetaContext/ }, () => {
  return { path: path.resolve(__dirname, 'src/stubs/saas-only.ts') };
});

build.onResolve({ filter: /stores\/gitStore/ }, () => {
  return { path: path.resolve(__dirname, 'src/stubs/saas-only.ts') };
});

build.onResolve({ filter: /components\/SidebarHeader/ }, () => {
  return { path: path.resolve(__dirname, 'src/stubs/SidebarHeader.tsx') };
});

build.onResolve({ filter: /components\/SourceControlSection/ }, () => {
  return { path: path.resolve(__dirname, 'src/stubs/SourceControlSection.tsx') };
});
```

**Stub files**:

- `src/stubs/saas-only.ts` - Returns empty hooks (useComponentMeta, useGitStore)
- `src/stubs/SidebarHeader.tsx` - Returns null (SaaS-only header component)
- `src/stubs/SourceControlSection.tsx` - Guarded by `{!isVSCode && ...}`
- `src/stubs/authFetch.ts` - Proxied API calls go through extension host instead

---

## Optional Hooks Pattern

**Critical Rule**: Shared components in webviews must use optional hooks.

Located: `client/components/`

### Why?

Webviews in VS Code only have `PlatformProvider` - they DON'T have:

- `CanvasEngineProvider` (no visual canvas in left/right panels)
- `ThemeProvider` (VS Code manages theme)
- `AuthProvider` (not applicable in extension context)

### Implementation

**Throwing hooks (SaaS only)**:

```tsx
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}

export function useCanvasEngine(): CanvasEngine {
  const context = useContext(CanvasEngineContext);
  if (!context) throw new Error('useCanvasEngine must be used within CanvasEngineProvider');
  return context;
}

export function useSelectedIds(): string[] {
  const context = useContext(CanvasEngineContext);
  if (!context) throw new Error('useSelectedIds must be used within CanvasEngineProvider');
  return context.useSelectedIds();
}
```

**Optional variants (used in shared components)**:

```tsx
export function useThemeOptional(): ThemeContextValue | null {
  try {
    return useContext(ThemeContext) ?? null;
  } catch {
    return null;
  }
}

export function useCanvasEngineOptional(): CanvasEngine | null {
  try {
    return useContext(CanvasEngineContext) ?? null;
  } catch {
    return null;
  }
}

export function useSelectedIdsOptional(): string[] {
  const engine = useCanvasEngineOptional();
  return engine?.useSelectedIds() ?? [];
}
```

### Usage Pattern

```tsx
// In shared LeftSidebar component
function LeftSidebar() {
  const engine = useCanvasEngineOptional();  // Returns null in VS Code
  
  if (engine) {
    // Browser mode: use engine
    return <BrowserLeftSidebar engine={engine} />;
  }
  
  // VS Code mode: use PlatformProvider adapters instead
  return <VSCodeLeftSidebar />;
}
```

---

## Cross-Panel State Sync in VS Code

### StateHub (Extension Host)

Located: `vscode-extension/hypercanvas-preview/src/StateHub.ts`

**Holds shared editor state as source of truth**:

```typescript
class StateHub {
  private _state: SharedEditorState = {
    selectedIds: [],
    hoveredId: null,
    currentComponent: null,
    astStructure: null,
    canvasMode: 'single',
    engineMode: 'design',
  };

  private _panels = new Map<string, vscode.Webview>();

  register(panelId: string, webview: vscode.Webview): void {
    this._panels.set(panelId, webview);
    // Send initial state
    webview.postMessage({ type: 'state:init', state: this._state });
  }

  applyUpdate(fromPanelId: string, patch: Partial<SharedEditorState>): void {
    // Merge into state
    Object.assign(this._state, patch);
    
    // Broadcast to ALL panels (including sender)
    // Preview needs state echo for overlay rendering
    const message = { type: 'state:update', patch };
    for (const [, webview] of this._panels) {
      webview.postMessage(message);
    }
  }
}
```

### Zustand Store (Each Webview)

Located: `client/lib/platform/shared-editor-state.ts`

**Each webview runs a local store synced via canvas**:

```typescript
export const useSharedEditorState = create<SharedEditorStore>((set) => ({
  selectedIds: [],
  hoveredId: null,
  currentComponent: null,
  astStructure: null,
  canvasMode: 'single',
  engineMode: 'design',

  applyPatch: (patch) => set((state) => ({ ...state, ...patch })),
  init: (newState) => set(newState),
}));

export function useSharedEditorStateSync(canvas: CanvasAdapter): void {
  useEffect(() => {
    const { applyPatch, init } = useSharedEditorState.getState();

    canvas.onEvent('state:update', (msg) => {
      applyPatch(msg.patch);
    });

    canvas.onEvent('state:init', (msg) => {
      init(msg.state);
    });

    // Signal ready for state:init
    canvas.sendEvent({ type: 'webview:ready' });
  }, [canvas]);
}
```

**Usage in components**:

```tsx
function LeftPanelApp() {
  return (
    <PlatformProvider>
      <LeftPanelContent />
    </PlatformProvider>
  );
}

function LeftPanelContent() {
  const canvas = usePlatformCanvas();
  useSharedEditorStateSync(canvas);  // Wire up sync

  const selectedIds = useSelectedIds();  // From zustand
  const hoveredId = useHoveredId();
  
  return <LeftSidebar />;
}
```

### PanelRouter (Extension Host)

Located: `vscode-extension/hypercanvas-preview/src/PanelRouter.ts`

**Routes all messages from all panels**:

```typescript
class PanelRouter {
  private _stateHub: StateHub;
  private _astBridge: AstBridge;
  private _componentService: ComponentService;
  private _styleReadService: StyleReadService;

  async routeMessage(panelId: string, message: unknown, webview: vscode.Webview): Promise<void> {
    // Route state updates through StateHub
    if (type === 'state:update') {
      this._stateHub.applyUpdate(panelId, message.patch);
      return;
    }

    // Route AST operations to AstBridge
    if (type.startsWith('ast:')) {
      await this._astBridge.handleMessage(message, webview);
      return;
    }

    // Route style reading to StyleReadService
    if (type === 'styles:readClassName') {
      const result = await this._styleReadService.readElementClassName(...);
      webview.postMessage({ type: 'styles:response', ...result });
      return;
    }

    // Route component operations to ComponentService
    if (type === 'component:listGroups' || type === 'component:parse' || ...) {
      const result = await this._componentService.scanComponentGroups();
      webview.postMessage({ type: 'component:response', success: true, data: result });
      return;
    }

    // Route AI chat open to AIChatPanelProvider
    if (type === 'ai:openChat') {
      if (this._onOpenAIChat) {
        this._onOpenAIChat(message.prompt);
      }
      return;
    }

    // Forward editor operations to EditorBridge
    if (type.startsWith('editor:')) {
      await handleEditorMessage(message, webview);
      return;
    }
  }
}
```

---

## API/SSE Proxying

**Browser mode**: Direct fetch/EventSource
**VS Code mode**: Proxied through extension host (CORS workaround)

### API Proxying Example

**Webview (VS Code)**:

```typescript
// createVSCodeApiAdapter()
async fetch(url: string, options?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();

    const handler = (message: PlatformMessage) => {
      if (message.type === 'api:response' && message.requestId === requestId) {
        // Reconstruct Response object
        const response = new Response(JSON.stringify(message.body), {
          status: message.status,
          statusText: message.statusText,
          headers: new Headers(message.headers),
        });
        resolve(response);
      }
    };

    // Register handler and send request to extension
    messageHandlers.add(handler);
    attachMessageListener();
    
    vscode.postMessage({
      type: 'api:fetch',
      requestId,
      url,
      options: { method, headers, body },
    });

    setTimeout(() => {
      messageHandlers.delete(handler);
      reject(new Error('API request timeout'));
    }, 30000);
  });
}
```

**Extension Host (PanelRouter)**:

```typescript
if (type === 'api:fetch') {
  try {
    const response = await fetch(message.url, message.options);
    const body = await response.text();
    
    webview.postMessage({
      type: 'api:response',
      requestId: message.requestId,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: body ? JSON.parse(body) : null,
    });
  } catch (e) {
    webview.postMessage({
      type: 'api:error',
      requestId: message.requestId,
      error: String(e),
    });
  }
}
```

---

## Shared Component Examples

### LeftSidebar

**File**: `client/components/LeftSidebar/LeftSidebar.tsx`

**Used in**:

- SaaS (`client/pages/...` wraps with CanvasEngineProvider)
- VS Code (`vscode-extension/hypercanvas-preview/src/webview-left/LeftPanelApp.tsx`)

**Code**:

```tsx
function LeftSidebar() {
  const engine = useCanvasEngineOptional();
  const platformCanvas = usePlatformCanvas();
  const selectedIds = useSelectedIds();
  
  if (engine) {
    // Browser mode: use engine
    return <BrowserLeftSidebar engine={engine} />;
  }
  
  // VS Code mode: use canvas platform messages
  return <VSCodeLeftSidebar platformCanvas={platformCanvas} selectedIds={selectedIds} />;
}
```

### RightSidebar

**File**: `client/components/RightSidebar/RightSidebar.tsx`

**Uses**:

- `useCanvasEngineOptional()` for browser mode
- `usePlatformCanvas()` for VS Code mode
- `useElementStyleData()` dual-mode hook for both

**useElementStyleData hook pattern**:

```tsx
export function useElementStyleData(options: UseElementStyleDataOptions): ElementStyleData {
  const { elementId, componentPath, canvas, engine, styleAdapter, ... } = options;

  if (engine && styleAdapter) {
    // Browser mode: synchronous engine + DOM
    const astNode = findNodeById(astStructure, elementId);
    const domElement = doc.querySelector(selector);
    const parsed = styleAdapter.read(astNode, domElement);
    
    return {
      parsedStyles: parsed,
      childrenType: astNode.childrenType,
      textContent: ...,
      tagType: astNode.type,
      loading: false,
    };
  }

  if (!canvas || !componentPath) {
    return EMPTY_DATA;
  }

  // VS Code mode: async RPC via canvas
  const requestId = crypto.randomUUID();
  setData((prev) => ({ ...prev, loading: true }));

  canvas.onEvent('styles:response', (msg) => {
    if (msg.requestId === requestId && msg.success) {
      const fullStyles = classNameToStyles(msg.className);
      setData({ parsedStyles: fullStyles, childrenType: msg.childrenType, ... });
    }
  });

  canvas.sendEvent({
    type: 'styles:readClassName',
    requestId,
    elementId,
    componentPath,
  });
}
```

### AIChat

**File**: `webview/AIChat.tsx`

**Uses**:

- Shared AI chat display types from `shared/ai-chat-display.ts`
- Chat history via `ChatHistoryService` (VS Code) or API (SaaS)
- Uses `usePlatformCanvas()` to open code locations

---

## Summary: Best Practices for Sidebar Sharing

### 1. **Use PlatformProvider at Root**

```tsx
<PlatformProvider>
  <MyPanel />
</PlatformProvider>
```

### 2. **Use Platform Hooks Instead of Context Hooks**

```tsx
// ❌ Wrong in shared components
const theme = useTheme();  // Throws in VS Code webview
const engine = useCanvasEngine();  // Throws in left/right panels

// ✅ Correct
const theme = useThemeOptional();  // Returns null if not available
const engine = useCanvasEngineOptional();  // Returns null if not available
```

### 3. **Dual-Mode Hooks**

For complex operations, implement hooks that work in both contexts:

```tsx
export function useFoo(options: Options): Result {
  const engine = useCanvasEngineOptional();
  const canvas = usePlatformCanvas();

  if (engine) {
    // Browser mode: use engine directly
    return { data: engine.query(...) };
  } else {
    // VS Code mode: use canvas RPC
    return useRPC(canvas, 'foo:request', 'foo:response');
  }
}
```

### 4. **Stub SaaS-Only Modules**

In esbuild.js, stub out SaaS-specific modules that shared components import:

```javascript
build.onResolve({ filter: /contexts\/ComponentMetaContext/ }, () => {
  return { path: path.resolve(__dirname, 'src/stubs/saas-only.ts') };
});
```

### 5. **Message-Bus for Cross-Panel Sync**

Use `canvas.sendEvent()` and `canvas.onEvent()` for coordination:

```tsx
// Left panel: notify other panels of selection
const dispatch = createSharedDispatch(canvas);
dispatch({ selectedIds: [...] });

// All panels: listen for selection changes
useSharedEditorStateSync(canvas);
```

### 6. **RPC Pattern for Extension Operations**

```tsx
// Send request
const requestId = crypto.randomUUID();
canvas.sendEvent({ type: 'ast:updateStyles', requestId, ... });

// Wait for response
canvas.onEvent('ast:response', (msg) => {
  if (msg.requestId === requestId && msg.success) {
    // Handle response
  }
});
```
