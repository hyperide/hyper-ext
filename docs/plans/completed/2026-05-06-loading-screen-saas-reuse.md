# Loading screen — reuse SaaS preview, no infinite "Loading…", show errors

## Context

User reports the VS Code Hyper Canvas tab is stuck on a plain "Loading…" screen
forever after selecting a component. No spinner, no error, no retry — dead
state. User explicitly says: "сделал новый плохо чтобы переиспользовать то что
уже было в saas как я просил" — there is an existing SaaS-side loading /
preview UI that should be reused instead of the bare-bones text.

## Symptoms

1. Selecting a component → preview iframe shows "Loading…" indefinitely
2. Even when the underlying load fails, no error UI appears
3. The text is plain `<div>Loading...</div>` with no spinner, no styling

## Current state to investigate

- `client/__canvas_preview__.tsx` line 70 — has `Loading...` placeholder
  (this is the SSR fallback before `isMounted`)
- `vscode-extension/hypercanvas-preview/src/webview-preview-panel/PreviewPanelApp.tsx`
  — orchestrates preview shell screens (`StartDevServerScreen`,
  `DisconnectedPreviewScreen`, etc.)
- `vscode-extension/hypercanvas-preview/src/extension.ts:532` — comment about
  "leave the preview stuck on Loading… indefinitely" — there is a known
  retry-budget concern
- SaaS path: `client/pages/Editor/CanvasEditor.tsx`,
  `client/pages/Projects.tsx` — these are the components that already have
  proper loading + error states

## Goal

1. Identify the SaaS loading component already used elsewhere (e.g.
   `client/components/LoadingSpinner.tsx`, or whatever the SaaS preview uses)
   and reuse it for the VS Code preview shell when the iframe is loading
2. After N seconds (e.g. 10s) if the iframe never reports loaded, show an
   error UI with a "Retry" + "Open output panel" buttons
3. If `componentError` is set, ensure it is visible immediately (do not let
   the loading screen swallow it)

## Files

- `vscode-extension/hypercanvas-preview/src/webview-preview-panel/PreviewPanelApp.tsx`
- `vscode-extension/hypercanvas-preview/src/webview-preview-panel/screens/`
  (existing screens: StartDevServerScreen, DisconnectedPreviewScreen,
  UnsupportedProjectScreen, NoComponentHint)
- `client/__canvas_preview__.tsx` — the SSR preview shim
- Wherever the SaaS spinner / loader lives (search for `Loading` / `Spinner`
  in `client/components/`)

## Acceptance Criteria

- [ ] No bare "Loading…" string anywhere in VS Code preview path — replaced
      with the same loading UI the SaaS uses
- [ ] After 10s of no iframe load → error screen with retry + "show details"
- [ ] If iframe `onError` fires → error visible immediately
- [ ] `componentError` stays visible regardless of loading shell

## Tasks

### Task 1: Inventory existing SaaS loading components

- [ ] Find all `client/components/**/Loading*` and `client/components/**/Spinner*`
- [ ] Pick the canonical one (the one used in `CanvasEditor` or other main
      pages) — its UI is what should appear in VS Code too
- [ ] Document the chosen component path

### Task 2: Replace bare "Loading…" with shared component

- [x] In `PreviewPanelApp.tsx`, find where the `Loading…` text appears (or
      where the iframe is shown without a loading placeholder during initial
      load) and render the SaaS spinner instead. PreviewPanelApp.tsx had no
      bare "Loading…" string — the user-perceived hang came from the iframe
      showing whatever the dev server returns until first paint. Added a
      `LoadingSpinner` overlay (`hyper-preview-loading-overlay` testid) that
      covers the iframe while `iframeSrc` is set but `onLoad` has not fired,
      and is hidden as soon as `componentError` shows so the error overlay
      replaces it instead of stacking. State resets on every `iframeSrc`
      change, so postMessage component switches (no src change) do not flip
      the spinner back on.
- [x] In `client/__canvas_preview__.tsx`, replaced the SSR
      `<div>Loading...</div>` with `<LoadingSpinner label="Loading preview..." />`
      using the new shared component. Both callsites now share the same
      visual treatment as `CanvasEditor`, `ProjectStartOverlay`, etc.

      Implementation notes:
      - New component: `client/components/LoadingSpinner.tsx` with `label`,
        `size` (sm/md/lg), `fill`, `className`, and `data-testid` props.
        Default `size: 'lg'` matches the canonical `h-12 w-12` documented in
        Task 1; `mb-4` is conditional on `label` so the spinner-only variant
        renders centred without extra space.
      - Tailwind config update: added the new file path to the
        `vscode-extension/hypercanvas-preview/tailwind.config.ts` content
        glob so the spinner classes are picked up in the webview build.
      - New testid: `TID.preview.loadingOverlay = 'hyper-preview-loading-overlay'`
        for E2E assertions in Task 5.
      - Tests: `client/components/__tests__/LoadingSpinner.test.tsx` covers
        canonical classes, label rendering, size variants, default and
        custom test ids, and the dark-mode background classes (8 cases).

### Task 3: Add timeout-based error fallback

- [x] After 10 seconds of preview being on the loading screen (no iframe
      `onLoad` event), transition to an error screen with:
      - "Component didn't load" heading + recovery copy
      - "Retry" button
      - "Open output panel" link to surface dev server logs

      Implementation: `PreviewPanelApp.tsx` adds `iframeLoadTimedOut` state
      and a watchdog `setTimeout` (10s, configurable via
      `PREVIEW_LOAD_TIMEOUT_MS`). The timer starts whenever the loading
      overlay is up, clears when the iframe fires `load`, when a
      component error overrides the loading shell, or when src/retry
      already reset state. The overlay itself lives in a sibling file —
      `PreviewLoadTimeoutOverlay.tsx` — so the unit test can render it
      without dragging in the preview-bridge / PlatformProvider tree.

      "Open output panel" is wired through the existing
      `command:execute` PanelRouter path: the webview posts
      `{type:'command:execute', command:'hypercanvas.showDevServerOutput'}`
      and the extension calls `vscode.commands.executeCommand` on it,
      which is the same command registered in `extension.ts` for the
      "Show dev server output" path (already calls
      `devServerManager.showOutput()`).
- [x] Wire the retry to re-trigger the iframe load (cycle `previewUrl` with
      a cache-buster, or unmount/remount). Implementation uses iframe
      remount via a `key={`${iframeSrc}-${retryNonce}`}` prop —
      `setRetryNonce(n => n + 1)` recreates the element, which guarantees
      a fresh fetch without mutating the URL or touching
      `iframe.contentWindow` (which may not exist before first load).
      The reset effect (deps `[iframeSrc, retryNonce]`) flips both
      `iframeLoaded` and `iframeLoadTimedOut` back to false, so the
      spinner reappears while the new iframe loads, and the watchdog
      restarts.

      Tests: `vscode-extension/hypercanvas-preview/src/webview-preview-panel/__tests__/PreviewLoadTimeoutOverlay.test.tsx`
      covers all three button labels + their callbacks (5 cases). The
      test walks the DOM manually rather than using
      `@testing-library`'s `getByTestId` because happy-dom's selector
      parser is corrupted by a sibling test in the full bun:test suite —
      the parser eagerly does `new this.window.SyntaxError(...)` and
      that constructor is undefined on the rendered container's window
      by then. Manual `Element.children` walk avoids the selector parser
      entirely. Comment in the test file documents the workaround.

      New testids: `TID.preview.loadingTimeout`,
      `TID.preview.loadingTimeoutRetry`,
      `TID.preview.loadingTimeoutOpenOutput` for E2E in Task 5.

### Task 4: Verify error path is visible

- [x] `componentError` already wins over the loading shell — verified by code
      inspection of `PreviewPanelApp.tsx`:
      - The loading-spinner overlay is gated `!componentError`
      - The timeout overlay is gated `!componentError`
      - The new iframe-error overlay (added below) is gated `!componentError`
      - `ComponentErrorOverlay` itself uses `zIndex: 100` (vs spinner/timeout/error
        at `zIndex: 15`), so even if the gating regressed, layering would still
        put the render-error UI on top.

      The `componentError` overlay appears immediately on
      `hypercanvas:componentError` postMessage from the iframe ErrorBoundary
      (`usePreviewBridge.ts:115-130`) regardless of iframe load state. No
      change needed here, only documentation in the codebase via comments
      next to the new gating clause.
- [x] `iframe.onError` now propagates to a visible recovery UI. Previously
      `handleIframeError` only sent a `previewError` canvas event that the
      extension host logged via `console.error` (see
      `vscode-extension/hypercanvas-preview/src/PreviewPanel.ts:357-360`) —
      the user never saw it.

      Implementation:
      - New state `iframeError: string | null` in `PreviewPanelApp`. Set on
        `onError`, cleared by the existing reset effect on `iframeSrc` /
        `retryNonce` change, and by `handleIframeLoad` (so a transient error
        followed by a successful load doesn't leave the overlay stuck).
      - Watchdog gate updated to also short-circuit on `iframeError` so we
        don't fight the error overlay with a 10s timeout flip.
      - New sibling component `PreviewLoadErrorOverlay.tsx` mirroring the
        timeout overlay's shape (retry + open output panel) but with a
        distinct heading ("Preview failed to load"), a red `editorError`
        icon, and the actual error message rendered in a monospace block.
        Empty/null messages are suppressed (some browsers don't populate
        `ErrorEvent.message`).
      - New testids: `TID.preview.loadingError`, `loadingErrorRetry`,
        `loadingErrorOpenOutput`, `loadingErrorMessage` for E2E in Task 5.

      Tests: `PreviewLoadErrorOverlay.test.tsx` covers heading, button labels,
      callback wiring, and message-line suppression when error is empty/null
      (8 cases). Uses the same DOM-walk helper as the timeout overlay test
      to avoid the happy-dom selector-parser leak across the bun:test suite.

### Task 5: Manual verification + screenshots

- [ ] Build extension via `npm run package`, install via `code --install-extension`,
      reload window
- [ ] Open a working component → see SaaS spinner briefly → see component
- [ ] Force a failure (e.g. wrong component path) → see error screen with retry
- [ ] Send before/after screenshots to Telegram via send-tg-photo.sh
