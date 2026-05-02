# Shared Error Overlays — Design Spec

## Problem

Error and status overlays are duplicated between SaaS (`client/pages/Editor/`) and VS Code extension
(`vscode-extension/.../PreviewPanelApp.tsx`). Each side has its own set of components with different
styling approaches (Tailwind vs inline + VS Code CSS vars), inconsistent behavior, and missing features:

1. **Extension blank canvas** — when a component errors and ErrorBoundary renders `null`, the extension
   shows a blank canvas with no overlay. SaaS shows inline error UI.
2. **No recovery signal** — ErrorBoundary posts `componentError` on failure but never posts
   `componentOk` on recovery. After file fix + HMR reload, the overlay stays.
3. **Missing "No component selected"** — extension has `NoComponentHint`, SaaS has
   `NoComponentsOverlay` — different names, different styles, not shared.
4. **Deleted sample → blank canvas** — when a sample is deleted, `__canvas_preview__` regenerates
   without it. If the component has no props (e.g. `TrendingSidebar`), it renders fine but the
   webview still holds stale `componentError` state. If it does need props, ErrorBoundary fires
   but the overlay may not show because `componentError` was already set from the previous error.
5. **PreviewSetupOverlay** — SaaS-only but extension has the same `unsupported framework` scenario
   handled by a separate `UnsupportedProjectScreen` with different UI.
6. **Theme inconsistency** — extension uses `var(--vscode-*)`, SaaS uses Tailwind semantic tokens.
   Light theme untested in extension overlays.

## Goals

- Single set of overlay components in `shared/` consumed by both SaaS and extension
- Consistent dark/light theme support across both platforms
- Error recovery: overlays appear on error, disappear on fix
- Platform-specific actions via optional callbacks (Create Sample, Auto Fix, Configure AI)

## Non-Goals

- Moving `IframeFailed` (Docker API calls) or `ProjectStartOverlay` (pod polling) to shared —
  these are SaaS infrastructure-specific
- Changing LogsPanel internal architecture — only moving it to shared with abstracted deps
- Redesigning the overlay visual language — keep current design, just unify

## Architecture

### Shared overlay components (`shared/components/overlays/`)

All components use **inline styles** with CSS custom properties. This is the only approach that works
in both contexts: extension webviews don't have Tailwind, and SaaS doesn't have VS Code vars.

#### Theme variables

Define a shared set of CSS custom properties with platform-specific fallbacks:

```css
/* Injected via a <style> block or defined in shared/components/overlays/theme.ts */
--overlay-bg:          var(--vscode-editor-background, hsl(var(--background)));
--overlay-fg:          var(--vscode-editor-foreground, hsl(var(--foreground)));
--overlay-muted:       var(--vscode-descriptionForeground, hsl(var(--muted-foreground)));
--overlay-border:      var(--vscode-widget-border, hsl(var(--border)));
--overlay-accent:      var(--vscode-button-background, hsl(var(--primary)));
--overlay-accent-fg:   var(--vscode-button-foreground, hsl(var(--primary-foreground)));
--overlay-destructive: var(--vscode-errorForeground, hsl(var(--destructive)));
--overlay-link:        var(--vscode-textLink-foreground, hsl(var(--primary)));
--overlay-input-bg:    var(--vscode-input-background, hsl(var(--input)));
--overlay-input-fg:    var(--vscode-input-foreground, hsl(var(--foreground)));
--overlay-input-border:var(--vscode-input-border, hsl(var(--border)));
--overlay-warning:     var(--vscode-editorWarning-foreground, hsl(var(--chart-4)));
--overlay-font:        var(--vscode-font-family, system-ui, -apple-system, sans-serif);
--overlay-font-mono:   var(--vscode-editor-font-family, ui-monospace, monospace);
```

Export as a `React.CSSProperties` object from `shared/components/overlays/theme.ts` that can be
spread onto a root wrapper, or as a `<style>` string injected into webview HTML.

In VS Code extension: `--vscode-*` vars are set by VS Code → those win.
In SaaS: `--vscode-*` vars are undefined → CSS fallback uses `hsl(var(--*))` Tailwind tokens.

#### Component list

##### 1. `OverlayShell`

Generic full-area overlay container. All specific overlays compose this.

```tsx
interface OverlayShellProps {
  children: React.ReactNode;
  /** 'backdrop' = semi-transparent dark bg, 'solid' = solid bg color */
  variant?: 'backdrop' | 'solid';
  /** data-testid for the root element */
  testId?: string;
}
```

Renders: `position: absolute; inset: 0` container with flex centering.

##### 2. `ComponentErrorOverlay`

Shown when ErrorBoundary catches a render error. **Extracted from `PreviewPanelApp.tsx`.**

```tsx
interface ComponentErrorOverlayProps {
  componentName: string;
  error: string;
  propsSchema?: SimplePropInfo[] | null;
  // Extension-only
  onCreateSample?: (sampleName: string, propValues?: Record<string, unknown>) => void;
  onConfigureAI?: () => void;
  // SaaS-only
  onAutoFix?: (prompt: string) => void;
  // Common
  onClose?: () => void;
}
```

Behavior:
- Shows component name, error message
- If `propsSchema` or extracted props available → shows `PropsForm`
- If `onCreateSample` provided → shows "Create Sample" / "Create Empty Sample" buttons
- If `onConfigureAI` provided → shows "Configure AI Key" button
- If `onAutoFix` provided → shows "Auto Fix" button
- If `onClose` provided → shows close button (X)
- Listens for `errorOverlay:sampleDeleted` postMessage to reset sample state

Includes `extractPropsFromError()` utility (already exists, move to shared).

##### 3. `NoComponentOverlay`

Shown when no component is selected or no components exist.

```tsx
interface NoComponentOverlayProps {
  variant: 'no-selection' | 'no-components';
}
```

- `no-selection`: "No component selected" + "Open a .tsx or .jsx file to preview it"
- `no-components`: "No components found" + "Add .tsx components to your project"

##### 4. `ConnectionErrorOverlay`

Shown when iframe fails to load or dev server disconnects.

```tsx
interface ConnectionErrorOverlayProps {
  message: string;
  retryCount?: number;
  maxRetries?: number;
}
```

##### 5. `ParseErrorOverlay`

Shown when component file fails to parse.

```tsx
interface ParseErrorOverlayProps {
  error: string;
  onRetry?: () => void;
  onAutoFix?: (prompt: string) => void;
}
```

##### 6. `PreviewSetupOverlay`

Shown when framework needs router patching or is unsupported. **Merges SaaS
`PreviewSetupOverlay` + extension `UnsupportedProjectScreen`.**

```tsx
interface PreviewSetupOverlayProps {
  status: 'needs-patch' | 'unsupported';
  frameworkSupport?: Array<{ name: string; level: 'supported' | 'planned' | 'not-planned' }>;
  onDismiss?: () => void;
  onAutoFix?: (prompt: string) => void;
  onManualFix?: () => void;
}
```

- In extension: `onManualFix` triggers `command:fixUnsupportedProject`
- In SaaS: `onAutoFix` opens AI chat with the patch prompt

##### 7. `LoadingOverlay`

Simple spinner + message.

```tsx
interface LoadingOverlayProps {
  message?: string; // default: "Loading component..."
}
```

##### 8. `RuntimeErrorOverlay`

Shown when Vite/Next.js/Bun build error detected in iframe.

```tsx
interface RuntimeErrorOverlayProps {
  error: RuntimeError;
  onDismiss?: () => void;
  onAutoFix?: (prompt: string) => void;
}
```

Shows: framework badge, error type, message, file:line, codeframe (if available).

#### Shared utilities

- `extractPropsFromError(errorMsg: string): string[]` — move from `PreviewPanelApp.tsx`
- `propsCache` — `Map<string, Record<string, unknown>>` for cross-overlay prop value persistence

#### `PropsForm` → shared

`PropsForm` already uses inline styles and `SimplePropInfo` from `@shared/types/props`.
Move from `vscode-extension/.../PropsForm.tsx` to `shared/components/overlays/PropsForm.tsx`.
No API changes needed — it's already platform-agnostic.

### Error Recovery Flow

#### Problem

`ComponentErrorBoundary` (generated in `__canvas_preview__.tsx`) posts `hypercanvas:componentError`
on render failure but has no mechanism to signal recovery.

#### Solution

Add `componentDidUpdate` logic to ErrorBoundary:

```tsx
// In generator.ts buildErrorBoundary():
componentDidUpdate(prevProps: { componentPath: string }) {
  // Reset error state when switching to a different component
  if (prevProps.componentPath !== this.props.componentPath && this.state.error) {
    this.setState({ error: null });
  }
  // If we HAD an error and now children rendered successfully,
  // the error was cleared by React re-render (HMR). Notify parent.
  // (getDerivedStateFromError sets error; successful render resets it via key change)
}

// Actually: ErrorBoundary can't detect "children rendered OK" in componentDidUpdate
// because if error is set, children don't render.
// Better approach: use a wrapper that detects successful mount.
```

**Revised approach — success beacon:**

Add a tiny component inside the ErrorBoundary children that fires on mount:

```tsx
// Generated inside __canvas_preview__.tsx
function RenderSuccessBeacon({ componentPath }: { componentPath: string }) {
  React.useEffect(() => {
    window.parent.postMessage({
      type: 'hypercanvas:componentOk',
      componentPath,
    }, '*');
  }, [componentPath]);
  return null;
}

// Usage in generated preview:
<ComponentErrorBoundary componentPath={componentPath}>
  <RenderSuccessBeacon componentPath={componentPath} />
  <div style={{ padding: 20 }}>
    {SampleDefault ? <SampleDefault /> : <Component />}
  </div>
</ComponentErrorBoundary>
```

When HMR reloads the component and it renders without error:
1. ErrorBoundary doesn't catch → children render
2. `RenderSuccessBeacon` mounts → posts `hypercanvas:componentOk`
3. `usePreviewBridge` receives message → clears `componentError` state
4. Overlay disappears

#### Extension webview handling (`usePreviewBridge.ts`)

Add handler for `hypercanvas:componentOk`:

```tsx
if (msg.type === 'hypercanvas:componentOk') {
  setComponentError((prev) =>
    prev && prev.componentPath === msg.componentPath ? null : prev
  );
}
```

### Migration Plan

#### Phase 1: Create shared overlays

1. Create `shared/components/overlays/` directory
2. Create `theme.ts` with CSS custom property definitions
3. Create `OverlayShell.tsx`
4. Move `PropsForm` from extension to shared (update import paths)
5. Move `extractPropsFromError` to shared utility
6. Create each overlay component (ComponentError, NoComponent, ConnectionError,
   ParseError, PreviewSetup, Loading, RuntimeError)
7. Add tests for each component

#### Phase 2: Wire up extension

1. Replace inline `ComponentErrorOverlay` in `PreviewPanelApp.tsx` with shared import
2. Replace `NoComponentHint` with shared `NoComponentOverlay`
3. Replace `UnsupportedProjectScreen` with shared `PreviewSetupOverlay`
4. Replace `StartDevServerScreen` — keep extension-only (dev server is ext concept)
5. Replace `ReconnectingBanner` with shared `ConnectionErrorOverlay`

#### Phase 3: Wire up SaaS

1. Replace `NoComponentsOverlay` with shared `NoComponentOverlay`
2. Replace `ConfigErrorOverlay` — keep SaaS-only (uses `useOpenAIChat` deeply)
3. Replace inline iframe error (lines 1176-1190) with shared `ConnectionErrorOverlay`
4. Replace inline parse error (lines 1200-1210) with shared `ParseErrorOverlay`
5. Replace inline loading (lines 1212-1217) with shared `LoadingOverlay`
6. Replace `PreviewSetupOverlay` with shared version
7. Evaluate LogsPanel migration (may stay SaaS-only depending on complexity)

#### Phase 4: Error recovery

1. Add `RenderSuccessBeacon` to `generator.ts` ErrorBoundary output
2. Add `hypercanvas:componentOk` handler to `usePreviewBridge.ts`
3. Add `hypercanvas:componentOk` handler to SaaS `IframeCanvas` (if component errors
   are surfaced there in future)
4. Test recovery: break component → see overlay → fix component → overlay auto-dismisses

### Files Changed

**New files:**
- `shared/components/overlays/theme.ts`
- `shared/components/overlays/OverlayShell.tsx`
- `shared/components/overlays/ComponentErrorOverlay.tsx`
- `shared/components/overlays/NoComponentOverlay.tsx`
- `shared/components/overlays/ConnectionErrorOverlay.tsx`
- `shared/components/overlays/ParseErrorOverlay.tsx`
- `shared/components/overlays/PreviewSetupOverlay.tsx`
- `shared/components/overlays/LoadingOverlay.tsx`
- `shared/components/overlays/RuntimeErrorOverlay.tsx`
- `shared/components/overlays/index.ts`
- `shared/components/overlays/extract-props-from-error.ts`
- `shared/components/overlays/__tests__/` (tests for each)

**Moved files:**
- `vscode-extension/.../PropsForm.tsx` → `shared/components/overlays/PropsForm.tsx`

**Modified files:**
- `vscode-extension/.../PreviewPanelApp.tsx` — replace inline overlays with shared imports
- `client/pages/Editor/CanvasEditor.tsx` — replace inline overlays with shared imports
- `client/pages/Editor/components/NoComponentsOverlay.tsx` — delete (replaced)
- `client/pages/Editor/components/PreviewSetupOverlay.tsx` — delete (replaced)
- `lib/preview-generator/generator.ts` — add `RenderSuccessBeacon` to generated code
- `vscode-extension/.../usePreviewBridge.ts` — add `componentOk` handler
- Extension esbuild config — may need alias update for `@shared/` in webview builds

### Open Questions

1. **LogsPanel migration** — the panel uses `diagnosticStore`, `useDiagnosticSync`,
   `DiagnosticLogsViewer`. These are already shared-ish but tightly wired to SaaS project
   lifecycle. Extension has its own logs display. Migrate or keep separate? **Recommendation:**
   keep separate for now, revisit when extension needs full diagnostic logging.

2. **ConfigErrorOverlay** — deeply coupled to `useOpenAIChat` and project settings flow.
   Worth extracting or keep SaaS-only? **Recommendation:** keep SaaS-only, it's small and specific.

3. **`StartDevServerScreen`** — extension-only concept (SaaS starts containers differently).
   **Recommendation:** keep in extension, not shared.
