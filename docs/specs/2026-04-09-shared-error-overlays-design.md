<!-- markdownlint-disable MD013 MD060 -->

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
- Accessible overlays: `role="alert"` / `aria-live="polite"` for error states, keyboard
  navigation (Esc to close, Tab through buttons), focus management when overlay appears

## Non-Goals

- Moving `IframeFailed` (Docker API calls) or `ProjectStartOverlay` (pod polling) to shared —
  these are SaaS infrastructure-specific
- Changing LogsPanel internal architecture — only moving it to shared with abstracted deps
- Redesigning the overlay visual language — keep current design, just unify

## Overlay Precedence

When multiple overlay conditions are true simultaneously, show the highest-priority overlay.
Both platforms must follow this order:

| Priority | Overlay | Rationale |
|----------|---------|-----------|
| 1 | `ConnectionErrorOverlay` | If iframe doesn't load, nothing else matters |
| 2 | `PreviewSetupOverlay` | Framework unsupported / needs patching — must fix first |
| 3 | `RuntimeErrorOverlay` | Build-level error from bundler — component can't render |
| 4 | `ParseErrorOverlay` | File-level error — component can't be parsed |
| 5 | `ComponentErrorOverlay` | Render-level error — component parsed but throws |
| 6 | `LoadingOverlay` | Waiting for iframe / component to mount |
| 7 | `NoComponentOverlay` | No component selected — lowest priority informational state |

Extension-only precedence (inserted above the shared table):

| Priority | Overlay | Rationale |
|----------|---------|-----------|
| 0a | `PreviewSetupOverlay` (unsupported) | Must show fix CTA even when dev server is off |
| 0b | `StartDevServerScreen` | No server = no iframe, but only if project is supported |

If the project is unsupported (React Native / Tamagui), showing "Start Dev Server" is
misleading — the server won't help. `UnsupportedProjectScreen` must win.

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

**Fallback robustness:** the `hsl(var(--background))` fallback requires `--background` to be
defined as raw HSL components (e.g. `220 14% 96%` without the `hsl()` wrapper). This is how
Tailwind CSS v3 semantic tokens work, so it's correct for SaaS. In extension webviews, the
`--vscode-*` vars are always injected by VS Code, so the fallback never fires. If a future
context renders these overlays without either set of variables, `theme.ts` must provide
hardcoded defaults as a last resort (e.g. `var(--vscode-editor-background, hsl(220 14% 96%))`).

**Visual verification plan:** after implementation, test both platforms × both themes:

1. SaaS light + dark — open `local.hyperi.de`, toggle theme, screenshot all overlay states
2. Extension light + dark — open test project in VS Code, switch color theme
   (`Cmd+K Cmd+T` → light/dark), trigger each overlay, take screenshots
3. Compare overlay appearance — colors, contrast, readability must be consistent

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

**Variant usage:**

- `solid` — for states that replace the canvas entirely: `NoComponentOverlay`, `LoadingOverlay`,
  `PreviewSetupOverlay`, `ConnectionErrorOverlay`
- `backdrop` — for states that overlay on top of existing content: `ComponentErrorOverlay`,
  `ParseErrorOverlay`, `RuntimeErrorOverlay`

##### 2. `ComponentErrorOverlay`

Shown when ErrorBoundary catches a render error. **Extracted from `PreviewPanelApp.tsx`.**

```tsx
interface ComponentErrorOverlayProps {
  componentName: string;
  error: string;
  propsSchema?: PropInfo[] | null;
  // Extension-only
  onCreateSample?: (sampleName: string, propValues?: Record<string, unknown>) => void;
  onConfigureAI?: () => void;
  // SaaS-only
  onAutoFix?: (prompt: string) => void;
  // Common
  onClose?: () => void;
}
```

**Action callbacks are fire-and-forget (`void`)** because the underlying integrations
(`CanvasAdapter.sendEvent()`, `useOpenAIChat()`) have no request/response protocol — they
post a message and don't know when the work completes. Introducing `Promise<void>` would
require a bidirectional message contract (request ID → response) which is out of scope.
If response tracking is added later, callbacks can be upgraded to `Promise<void>` with
internal spinner/error state in the overlay.

Behavior:

- Shows component name, error message (scrollable container with `max-height: 200px`,
  monospace font, "Copy to clipboard" button for full text)
- Error text is rendered as `textContent` (React default) — no XSS risk, but long stack
  traces must not push action buttons off-screen
- If `propsSchema` or extracted props available → shows `PropsForm`
- If `onCreateSample` provided → shows "Create Sample" / "Create Empty Sample" buttons
- If `onConfigureAI` provided → shows "Configure AI Key" button
- If `onAutoFix` provided → shows "Auto Fix" button
- If `onClose` provided → shows close button (X), also dismissable via Escape key
- Listens for `errorOverlay:sampleDeleted` postMessage to reset sample state
- `role="alert"` on the error message container for screen reader announcement

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
- `propsCache` — `Map<componentPath, Record<propName, value>>` for cross-overlay prop value
  persistence. Scoped to webview lifetime (in-memory, not persisted to storage). Entries
  are keyed by `componentPath`. Cache survives overlay open/close cycles and error recovery
  within the same session. Cleared on full webview reload.

#### `PropsForm` → shared

`PropsForm` uses inline styles with `var(--vscode-*)` fallbacks — already platform-agnostic.

**Type consolidation required:** the extension defines a local `SimplePropInfo` interface
(`PropsForm.tsx:13-20`) with fields `name`, `type` (string), `required`, `defaultValue`,
`objectFields`. This is the same wire shape as `PropInfo` in `lib/types.ts` (used by
`ComponentService.getComponentDefinitions()`). `shared/types/props.ts → PropTypeInfo` is a
different, richer type used by the inspector/prop editor.

**Approach:** reuse `PropInfo` from `lib/types.ts` as the canonical type for overlay forms.
Remove the local `SimplePropInfo` duplicate and the `toPropTypeInfo()` converter from
PropsForm. PropsForm accepts `PropInfo[]` directly — same wire format, no conversion needed.
`PropTypeInfo` stays in `shared/types/props.ts` for the inspector's richer prop editing UI.

Move from `vscode-extension/.../PropsForm.tsx` to `shared/components/props-form/PropsForm.tsx`.
PropsForm is a form widget used by overlays, not an overlay itself — placing it under
`overlays/` would force non-overlay consumers to import from a misleading path.

### Error Recovery Flow

#### Current limitation

`ComponentErrorBoundary` (generated in `__canvas_preview__.tsx`) posts `hypercanvas:componentError`
on render failure but has no mechanism to signal recovery. After the user fixes the file and HMR
reloads the module, the error overlay stays because:

1. `getDerivedStateFromError` sets `error` in ErrorBoundary state
2. While `error` is set, `render()` returns error UI — **children never mount**
3. HMR replaces the module but doesn't reset ErrorBoundary state
4. `componentDidUpdate` only resets on `componentPath` change — HMR doesn't change path

This also blocks recovery for the "deleted sample → blank canvas" scenario (Problem #4):
`__canvas_preview__` regenerates without the sample, but ErrorBoundary still holds stale error
state from the previous render failure.

#### Solution — HMR version counter + success beacon

Two mechanisms work together:

**1. Retry signal forces ErrorBoundary to clear error and re-render children.**

The `import.meta.hot.accept()` self-accept approach does NOT work here: when the user
edits the component module (not `__canvas_preview__.tsx` itself), Vite's Fast Refresh
updates the dependency but doesn't fire the self-accept callback. Additionally, Next.js,
webpack, and parcel use different HMR APIs — `import.meta.hot` is not portable.

**Framework-neutral approach — listen for any re-render attempt:**

The generated `__canvas_preview__.tsx` wraps the error boundary with a `key` derived from
a retry counter. The retry counter increments on:

- `postMessage` from host: `hypercanvas:retryRender` (sent after HMR / file change)
- `componentPath` change (component switch)

```tsx
// Generated inside __canvas_preview__.tsx
// Host sends retryRender after detecting HMR update or file save
window.addEventListener('message', (e) => {
  if (e.data?.type === 'hypercanvas:retryRender') {
    setRetryCount((c) => c + 1);
  }
});

// Usage — key change forces ErrorBoundary remount, clearing error state:
<ComponentErrorBoundary key={`${componentPath}-${retryCount}`} componentPath={componentPath}>
  <RenderSuccessBeacon componentPath={componentPath} />
  <div style={{ padding: 20 }}>
    {SampleDefault ? <SampleDefault /> : <Component />}
  </div>
</ComponentErrorBoundary>
```

The **host** (extension's `usePreviewBridge` or SaaS `IframeCanvas`) sends
`hypercanvas:retryRender` to the iframe whenever it detects a relevant file change
(via `hypercanvas:hmr` message from Vite, or `__canvas_preview__` regeneration).
This is already framework-neutral — the host knows about HMR through existing
`hypercanvas:hmr` / file-watcher messages regardless of bundler.

Using `key` for remount is cleaner than `componentDidUpdate` — React unmounts the old
ErrorBoundary (clearing error state) and mounts a fresh one. No `componentDidUpdate`
modification needed.

**2. RenderSuccessBeacon confirms recovery to the parent frame.**

A tiny component inside ErrorBoundary children that fires on mount:

```tsx
function RenderSuccessBeacon({ componentPath }: { componentPath: string }) {
  React.useEffect(() => {
    window.parent.postMessage({
      type: 'hypercanvas:componentOk',
      componentPath,
    }, '*');
  }, [componentPath]);
  return null;
}
```

**Recovery sequence:**

1. Component errors → ErrorBoundary catches → posts `hypercanvas:componentError` → overlay shown
2. User fixes the file → HMR fires → host detects update → sends `hypercanvas:retryRender`
   to iframe
3. `retryCount` increments → `key` changes → React unmounts old ErrorBoundary, mounts fresh one
4. Fresh ErrorBoundary has no error → children render (including `RenderSuccessBeacon`)
5. If render succeeds: beacon posts `hypercanvas:componentOk` → overlay dismissed
6. If render fails again: new ErrorBoundary catches → overlay stays, host can retry on next HMR

This handles all recovery scenarios:

- **HMR fix:** host sends retryRender → key change → remount → beacon fires → overlay gone
- **Component switch:** `componentPath` changes key → remount → beacon fires
- **Deleted sample:** `__canvas_preview__` regeneration → host sends retryRender → remount

#### Extension webview handling (`usePreviewBridge.ts`)

Add handler for `hypercanvas:componentOk`:

```tsx
if (msg.type === 'hypercanvas:componentOk') {
  setComponentError((prev) =>
    prev && prev.componentPath === msg.componentPath ? null : prev
  );
}
```

**Note on `errorSeq`:** `usePreviewBridge.ts` currently increments an `errorSeq` counter on each
`componentError` message to force remount of the error overlay UI when the same component
errors with different details. The `componentOk` handler does not need to interact with
`errorSeq` — setting `componentError` to `null` is sufficient. `errorSeq` resets implicitly
when a new error sets a fresh state object.

### Migration Plan

#### Phase 1: Create shared overlays

1. Create `shared/components/overlays/` and `shared/components/props-form/` directories
2. Create `theme.ts` with CSS custom property definitions + tests
3. Create `OverlayShell.tsx` (TDD: write test → implement → verify green)
4. Move `PropsForm` to `shared/components/props-form/` (update import paths),
   replace local `SimplePropInfo` with `PropInfo` from `lib/types.ts`
5. Move `extractPropsFromError` to `shared/components/overlays/extract-props-from-error.ts`
6. For each overlay component (ComponentError, NoComponent, ConnectionError,
   ParseError, PreviewSetup, Loading, RuntimeError):
   - Write failing test that validates rendering + props behavior
   - Run test — confirm it fails for the right reason
   - Implement component
   - Run test — confirm green
   - Refactor while tests stay green

#### Phase 2: Wire up extension

1. Replace inline `ComponentErrorOverlay` in `PreviewPanelApp.tsx` with shared import
2. Replace `NoComponentHint` with shared `NoComponentOverlay`
3. Replace `UnsupportedProjectScreen` with shared `PreviewSetupOverlay`
4. Replace `ReconnectingBanner` with shared `ConnectionErrorOverlay`

**Not migrated (extension-only):**

- `StartDevServerScreen` — dev server lifecycle is extension-only concept, no SaaS equivalent

#### Phase 3: Wire up SaaS

1. Replace `NoComponentsOverlay` with shared `NoComponentOverlay`
2. Replace inline iframe error (condition: `iframeError.message` set) with shared `ConnectionErrorOverlay`
3. Replace inline parse error (condition: `parseError` set) with shared `ParseErrorOverlay`
4. Replace inline loading (condition: `!iframeReady`) with shared `LoadingOverlay`
5. Replace `PreviewSetupOverlay` with shared version
6. Evaluate LogsPanel migration (may stay SaaS-only depending on complexity)

**Not migrated (SaaS-only):**

- `ConfigErrorOverlay` — deeply coupled to `useOpenAIChat` and project settings flow
- `IframeFailed` — Docker API calls, SaaS infrastructure-specific
- `ProjectStartOverlay` — pod polling, SaaS infrastructure-specific

#### Phase 4: Error recovery

1. Add `hypercanvas:retryRender` listener + `retryCount` state to generated `__canvas_preview__.tsx`
2. Update ErrorBoundary `key` to include `retryCount` (remount on retry)
3. Add `RenderSuccessBeacon` component to `generator.ts` output
4. Add `hypercanvas:retryRender` sender to `usePreviewBridge.ts` (on HMR / file change)
5. Add `hypercanvas:componentOk` handler to `usePreviewBridge.ts`
6. Add `hypercanvas:componentOk` handler to SaaS `IframeCanvas` (if component errors
   are surfaced there in future)
7. Test recovery scenarios:
   - Break component → overlay → fix file → HMR → overlay auto-dismisses
   - Delete sample → overlay → remove required props → overlay auto-dismisses
   - Switch component while error shown → overlay clears for new component

### Import Constraints

Shared overlay components must only import from:

- `react` / `react-dom`
- `shared/` (types, utils, other shared modules)
- Relative imports within `shared/components/`

**Never import from `client/` or `vscode-extension/`** — these are platform-specific.
Platform behavior is injected via callback props, not direct imports. Violating this
constraint breaks the opposite platform's build.

Enforcement: add a test in `shared/components/overlays/__tests__/` that scans all overlay
source files for forbidden import paths (`client/`, `vscode-extension/`, `@/`).

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
- `shared/components/props-form/PropsForm.tsx`
- `shared/components/props-form/index.ts`

**Moved files:**

- `vscode-extension/.../PropsForm.tsx` → `shared/components/props-form/PropsForm.tsx`

**Modified files:**

- `vscode-extension/.../usePreviewBridge.ts` — add `retryRender` sender + `componentOk` handler
- `vscode-extension/.../PreviewPanelApp.tsx` — replace inline overlays with shared imports
- `client/pages/Editor/CanvasEditor.tsx` — replace inline overlays with shared imports
- `client/pages/Editor/components/NoComponentsOverlay.tsx` — delete (replaced)
- `client/pages/Editor/components/PreviewSetupOverlay.tsx` — delete (replaced)
- `lib/preview-generator/generator.ts` — add `retryRender` listener, `retryCount`, `RenderSuccessBeacon`

**No esbuild changes needed:** `@shared/` alias is already configured in
`vscode-extension/hypercanvas-preview/esbuild.js:32-56` for all webview build contexts
including `webviewPreviewPanelCtx`. No new stubs required unless an overlay accidentally
imports from `client/` (which the import constraint test prevents).

### Open Questions

1. **LogsPanel migration** — the panel uses `diagnosticStore`, `useDiagnosticSync`,
   `DiagnosticLogsViewer`. These are already shared-ish but tightly wired to SaaS project
   lifecycle. Extension has its own logs display. Migrate or keep separate? **Recommendation:**
   keep separate for now, revisit when extension needs full diagnostic logging.

2. **ConfigErrorOverlay** — deeply coupled to `useOpenAIChat` and project settings flow.
   Worth extracting or keep SaaS-only? **Recommendation:** keep SaaS-only, it's small and specific.

3. **`StartDevServerScreen`** — extension-only concept (SaaS starts containers differently).
   **Recommendation:** keep in extension, not shared.
