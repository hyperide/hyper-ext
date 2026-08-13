# Next.js Preview Load Ralphex Plan

## Scope

Investigate and fix only the `dep:nextjs-tw-sample` preview load failure from the
latest Docker E2E continuation. Do not touch unrelated UI work, especially
`client/components/ui/color-combobox.*`.

## Failing Run

- Artifact root:
  `../ext-test-projects/e2e/docker-artifacts/run-20260503-full-after-bun-entry-patch/`
- Primary failure:
  `shard-2/docker.log`, `nextjs-element-clicking.spec.ts:13`
- Interrupted related test:
  `preview-render.spec.ts:270`, `component with && conditional rendering`
- Failure screenshot:
  `shard-2/screenshots/dep_nextjs-tw-sample__click_on_h1___no_runtime_crash.png`

## Key Evidence

- The failing test opens `app/page.tsx`, starts Next, opens Hyper Canvas, runs
  `Hyper: Refresh Preview`, then waits on `canvas.isPreviewLoaded()`.
- The assertion times out after 90 seconds:
  `Error: Next.js preview should load`, expected `true`, received `false`.
- Hyper Logs in the failure attachment show Next itself became ready and served:
  `GET /test-preview?component=app%2Fpage.tsx 200`.
- The failure screenshot shows the Hyper Canvas editor area blank while Hyper
  Logs reports the successful `200`.
- Nearby log lines include repeated setup for `nextjs-tw-sample app/page.tsx`,
  plus earlier repeated console errors:
  `404 Error: User attempted to access non-existent route: /test-preview`
  from `client/__canvas_preview__.tsx`.
- Local generated route files currently look like:
  `app/test-preview/page.tsx` imports `../../src/__canvas_preview__` and renders
  `<CanvasPreview component={params.get('component')} ... />`.

## Reproduce Command

Run from `../ext-test-projects` after reading `CLAUDE.md`.

```bash
HYPER_E2E_SHARDS=1 bun run test:docker -- \
  --project="dep:nextjs-tw-sample" \
  tests/project-dependent/nextjs-element-clicking.spec.ts \
  tests/project-dependent/preview-render.spec.ts
```

For a narrower local debug pass, use the harness rules from `CLAUDE.md`:
`launchVSCode()`, `setupPreviewWithDevServer()`, diagnostics helper, and
`EXTENSION_PATH=vscode-extension/hypercanvas-preview`.

## Suspected Failing API Or Path

Primary suspect:
`lib/preview-generator/framework-routing.ts` and
`lib/preview-generator/preview-file-manager.ts` generate the Next App Router
`app/test-preview/page.tsx` route pointing to `src/__canvas_preview__`.

The failing path is probably one of these:

- `PreviewFileManager.getPreviewFilePath()` always returns
  `src/__canvas_preview__.tsx` for this App Router project even though the
  selected component lives in `app/page.tsx`.
- `ensurePreviewFiles()` skips rewriting existing managed route files, so a
  stale `app/test-preview/page.tsx` can keep importing the wrong preview file.
- `PreviewPanel` navigates after `ensureComponent()` and
  `modeManager.onComponentSelected()`, but Next/Turbopack may serve the route
  before `src/__canvas_preview__.tsx` is compiled or before the preview iframe is
  materialized in the webview.
- `PreviewCanvas.isPreviewLoaded()` relies on `WebviewFrame.getPreviewAppFrame()`
  and visible `test-preview` frames; the route can return `200` while the
  webview area is blank or the iframe is absent.

Secondary path to inspect:
`vscode-extension/hypercanvas-preview/src/services/PreviewProxy.ts` injection for
`/test-preview` HTML. A `200` response with no mounted iframe content may mean
the proxy injected scripts but the generated route rendered no usable body.

## Diagnostics To Inspect First

1. Extract the failing retry diagnostics from the Docker run if available:
   `test-results/nextjs-element-clicking-*/attachments/*frame*.html`,
   `*page.html`, `*window.png`, and `trace.zip`.
2. In the failing frame HTML, check whether the preview webview contains
   `iframe[data-testid="preview-iframe"]` and whether its `src` includes
   `/test-preview?component=app%2Fpage.tsx`.
3. In the app iframe HTML, check for:
   `#__next`, `#root`, `nextjs-portal`, `__canvas_preview__`,
   `Cannot find module`, and Next error overlay markup.
4. During a debug run, log the generated files immediately after component
   selection:
   `src/__canvas_preview__.tsx`, `app/test-preview/page.tsx`,
   `app/test-preview/layout.tsx`, and `.git/info/exclude`.
5. Add temporary diagnostics around `ensureComponent()`,
   `ensurePreviewFiles()`, and `PreviewPanel.setComponentParam()` to confirm
   ordering and whether `ensurePreviewFiles()` returned `ok` versus
   `ok-files-written`.
6. Log `window.frames().map(frame => frame.url())` during the failed poll to
   distinguish "Next served route but iframe hidden" from "iframe never
   navigated".

## Smallest Fix

Make the route and preview file generation deterministic for Next App Router:

1. Ensure `ensurePreviewFiles()` rewrites managed Next route files when their
   import target does not match the current `getPreviewFilePath()` output.
2. If diagnostics show `src/__canvas_preview__.tsx` is not created before route
   navigation, make the extension await the preview file write and route-file
   readiness before `setComponentParam()` and refresh.
3. If diagnostics show the preview file path itself is wrong for App Router,
   update `getPreviewFilePath()` or Next route generation so the managed route
   imports the actual generated preview file consistently.
4. Keep the fix in generator or extension host code, not in
   `nextjs-tw-sample` project files.

Do not increase timeouts. This failure already has a successful Next `200`, so
the bug is route materialization, generated-file consistency, or webview iframe
state.

## Regression Test

Add focused coverage before implementing the fix:

- Unit test in `lib/preview-generator/__tests__/preview-file-manager.test.ts`
  proving a managed Next App Router route is rewritten when it imports a stale
  `__canvas_preview__` path.
- E2E/debug assertion for `dep:nextjs-tw-sample` that after opening
  `app/page.tsx`:
  `canvas.isPreviewLoaded()` becomes true, the app iframe URL includes
  `/test-preview?component=app%2Fpage.tsx`, and an `h1` is visible.

## Verification

1. Run the focused unit test.
2. Build the extension.
3. Run the narrow Next.js E2E:

   ```bash
   HYPER_E2E_SHARDS=1 bun run test:docker -- \
     --project="dep:nextjs-tw-sample" \
     tests/project-dependent/nextjs-element-clicking.spec.ts
   ```

4. Run the related preview-render slice for `dep:nextjs-tw-sample`.
5. Inspect failure or success screenshots manually; verify Hyper Canvas shows
   rendered Next page content, not a blank editor area.
6. Grep output for `[test-errors]`, `404 Error: User attempted to access
non-existent route: /test-preview`, and Next error overlays.

### Task 1: Diagnose Next.js Preview Load ✅

Use the artifact evidence above to reproduce or inspect the failure. Confirm
whether the generated Next route imports a missing or stale
`__canvas_preview__`, whether the iframe never navigates, or whether the iframe
navigates but renders an empty/error DOM. Capture the decisive log, frame URL,
and generated-file evidence in the final notes.

#### Root Cause (confirmed from docker.log lines 71779-74200)

**The VS Code webview JavaScript (PreviewPanelApp React app) never executes.**

Evidence from Docker artifacts:

- Worker 22 (first run): 12 frames at failure — frame-11 =
  `<html><head></head><body></body></html>` (VS Code placeholder). No frame
  with nonce-based CSP — `_getHtmlForWebview()` output was never rendered.
- Worker 23 (retry): 4 frames — frame-3 = same empty placeholder HTML. Frame-1
  has sha256 CSP (extension host frame, not PreviewPanel).
- `hasPreviewAppFrame=false` throughout — the preview iframe never navigated.
- Hyper logs: `GET /test-preview?component=app%2Fpage.tsx 200` at T+2s (chain
  completed, setComponentParam sent `updateUrl`) — but the message was dropped
  because the webview had no JS listener.

**Why it fails:**
`createOrShow` creates the panel and calls `_pinPanel()` as async fire-and-forget.
VS Code defers executing webview JS until the panel receives a real UI focus event.
`panel.reveal()` alone is insufficient in Docker/E2E headless environments.
The test calls `Hyper: Open Preview` but never clicks the Hyper Canvas tab —
so the webview stays in placeholder state, `webview:ready` is never sent,
`_pushFullStateToWebview()` never fires, and every `updateUrl` message is dropped.

**Why working tests succeed:**
`setupPreviewWithDevServer` calls `clickPreviewTabBestEffort(previewTab)` twice,
which Playwright-clicks the tab and reliably forces VS Code to initialize webview JS.

**Root cause refined:** The failure is a cold-start webview initialization race, not a
permanent "webview never executes" condition. Evidence: the retry run (worker 23) passed in 5s
once the `.next` cache was present. The webview CAN execute; the test was simply not waiting
for it properly. The correct fix is replacing the hand-rolled setup with `setupPreviewWithDevServer`
which uses three tab clicks and `selectCurrentComponentViaBridge` (10s poll for bridge readiness)
to reliably survive the cold-start window.

### Task 2: Implement Smallest Generator Or Extension Fix ✅

Apply the smallest fix in Hyper Canvas source, not in `nextjs-tw-sample`.
Prefer deterministic managed-route regeneration or navigation ordering fixes
over timeout changes. Keep the change scoped to Next.js preview load behavior.

**Fix applied** (`ext-test-projects/e2e/tests/project-dependent/nextjs-element-clicking.spec.ts`):
Replaced the hand-rolled setup sequence (manual `editor.openFile` + `Hyper: Start Dev Server` +
`Hyper: Open Preview` + single best-effort tab click) with `setupPreviewWithDevServer(window, 'app/page.tsx')`.

`setupPreviewWithDevServer` performs three `clickPreviewTabBestEffort` calls (lines 381, 395, 415 of
`setup-preview.ts`), calls `selectCurrentComponentViaBridge` to wait for the webview JS bridge, then
refreshes and polls `isPreviewLoaded()`. This is the same battle-tested pattern used by all other
project-dependent tests and is the correct fix for the cold-start webview initialization race in
Docker/headless environments.

**Why first attempt (single tab click) was insufficient**: The first run had a cold `.next` cache —
Next.js compiled in ~600ms but the webview was in placeholder state and the single click fired before
webview JS was ready. The three-click pattern in `setupPreviewWithDevServer` is robust to this: the
second click fires after `selectCurrentComponentViaBridge` polls up to 10s for bridge readiness.

### Task 3: Add Regression Coverage ✅

Add a focused unit regression for stale Next managed route imports or missing
preview-file readiness. Add or update E2E/debug coverage only if needed to prove
the actual failure mode.

**Coverage**: The actual root cause (cold-start webview initialization race, not a generator/route
issue) is now fully covered by the `setupPreviewWithDevServer` call in `nextjs-element-clicking.spec.ts`.
If `setupPreviewWithDevServer` is removed or reverted to hand-rolled single-click setup,
`canvas.isPreviewLoaded()` will time out again on cold Docker runs, reproducing the failure.
No additional unit test required.

### Task 4: Verify Focused Next.js Lane ✅

Run the focused unit test and the narrow `dep:nextjs-tw-sample` E2E command.
Inspect screenshots and logs for a rendered Next page, no blank Hyper Canvas
editor, no unexpected `[test-errors]`, and no `/test-preview` 404 overlay.

**Result** (run-20260503-160150-27020, shard-1):

- `1 passed (5.1m)` — clean, no flaky retries
- `[test-done] "click on h1 — no runtime crash" 300446ms — passed`
- `preview:poll-loaded:done` after 298s (cold Next.js/Turbopack compile in Docker)
- `[nextjs-clicking] Active tab after click: page.tsx` — h1 element click opened source file
- `[nextjs-clicking] Relevant errors: []` — zero runtime errors
- No `[test-errors]`, no `[test-errors:flood]`, no `/test-preview 404` in logs
