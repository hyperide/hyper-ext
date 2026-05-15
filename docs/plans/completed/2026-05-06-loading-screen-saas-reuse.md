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

- [ ] In `PreviewPanelApp.tsx`, find where the `Loading…` text appears (or
      where the iframe is shown without a loading placeholder during initial
      load) and render the SaaS spinner instead
- [ ] In `client/__canvas_preview__.tsx`, replace the SSR `<div>Loading...</div>`
      with the SaaS spinner component (or a CSS-only spinner that doesn't
      depend on hooks)

### Task 3: Add timeout-based error fallback

- [ ] After 10 seconds of preview being on the loading screen (no iframe
      `onLoad` event), transition to an error screen with:
      - "Component didn't load. Retry?" button
      - "Open output panel" link to surface dev server logs
- [ ] Wire the retry to re-trigger the iframe load (cycle `previewUrl` with
      a cache-buster, or unmount/remount)

### Task 4: Verify error path is visible

- [ ] When `componentError` from `useComponentErrorState` is non-null, the
      ComponentErrorOverlay must render even if the iframe is also still in
      its loading shell
- [ ] When `iframe.onError` fires, propagate to a visible error UI (currently
      `handleIframeError` only sends a `previewError` event — verify whether
      the error reaches the user)

### Task 5: Manual verification + screenshots

- [ ] Build extension via `npm run package`, install via `code --install-extension`,
      reload window
- [ ] Open a working component → see SaaS spinner briefly → see component
- [ ] Force a failure (e.g. wrong component path) → see error screen with retry
- [ ] Send before/after screenshots to Telegram via send-tg-photo.sh
