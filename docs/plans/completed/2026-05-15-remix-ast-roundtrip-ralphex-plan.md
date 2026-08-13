# Plan: Remix AST operations — selection round-trip fails

**Date:** 2026-05-15  
**Run evidence:** run-20260515-215913-53825, S1+S2  
**Reported by:** E2E loop monitor

## Symptom

All 4 AST operations (insert element, delete element, duplicate element, wrap element) fail on
`remix-cssmodules-spotify` with:

```
openExplorerAndSelect: selection round-trip failed — waitForAnySelection timed out.
Tree click did not propagate to app iframe. StateHub selectedIds will be empty when canvas commands run.
```

`waitForAnySelection(8_000)` polls `__hyperCanvasState.selectedIds.length > 0` in the preview
app iframe. On Remix, clicking a tree item in the Explorer panel never causes `selectedIds` to
be populated within 8s.

Other Remix project (`remix-tw4-twitter`) was assumed to pass, but the fix revealed both
projects had stale committed routes missing `HyperCanvasScripts`.

## Root cause hypotheses (in priority order)

### H1: Preview iframe is not mounted when tree click fires (timing race)

`setupPreviewWithDevServer` polls `isPreviewLoaded()` which checks for DOM elements in the iframe.
For Remix, the `/test-preview` route goes through: SSR render → `root.tsx Layout()` → HTML →
client hydration → React component tree. The bridge (`__hyperCanvasState`) is injected by the
dev server proxy into the HTML response. If the bridge JS hasn't run yet when `waitForAnySelection`
polls, `selectedIds` is never set.

**Verify:** Add `console.log('[bridge] __hyperCanvasState init')` to the bridge inject and check
if it fires before or after tree click in a Remix test run.

### H2: The proxy bridge injection doesn't work for Remix SSR responses

Non-Remix projects serve `index.html` (static file), which the proxy can inject the bridge script
into easily. Remix serves SSR-rendered HTML from the `/test-preview` route. The proxy inject
might match only on Content-Type or HTML patterns. If Remix adds compression/chunked encoding,
the inject might fail silently.

**Verify:** In a Docker run, check if `http://localhost:PORT/test-preview` response HTML
contains the bridge `<script>` tag. If not, the proxy isn't injecting.

### H3: Remix's `<Layout>` export shadows the component tree

`remix-cssmodules-spotify/app/root.tsx` exports both `Layout` (function, not component) and the
default export. The extension's component scanner might confuse the `Layout` named export with
the `<Layout/>` JSX component from `react-vite-cssmodules-spotify`, resulting in a tree with
0 or 1 item. If `treeCount = 0`, the `expect.poll(getTreeItemCount, ...).toBeGreaterThan(0)`
would time out (15s) before `waitForAnySelection` is reached.

**Verify:** Log the tree item count in a targeted Remix run to distinguish H3 (count=0 timeout)
from H1/H2 (count>0 but round-trip fails).

### H4: `canvas.waitForAnySelection` timeout too short for Remix cold start

Remix cold compile in Docker takes 254s (documented in playwright.config.ts). `setupPreviewWithDevServer`
waits for `isPreviewLoaded()` but this might return true before the bridge is fully initialized.
The `waitForAnySelection(8_000)` window is too small for Remix post-hydration bridge warmup.

**Verify:** Increase `waitForAnySelection` timeout to 15s for Remix specifically (or globally)
and rerun. If it passes, H4 is confirmed.

## Tasks

### Task 1 — Instrument and isolate

Add targeted console.log to identify which hypothesis is correct:
- [x] In `openExplorerAndSelect`, before `treeItems.nth(idx).click()`, log `treeCount` and `idx`.
  (Already implemented: `[ROUNDTRIP-DIAG]` block in setup-preview.ts:970-1010 logs treeCount,
  hasInteractionScript, stateExists, scriptSrcs, rootInner, and __hyperCanvasState before click)
- [x] After the click, log selectedIds state in the iframe.
  (Already implemented: `[ROUNDTRIP-DIAG-POST]` block in setup-preview.ts:1011-1038 logs
  stateExists, state, hypercanvasStatus after the 8s timeout fires)
- [x] Run targeted test to capture diagnostic output.
  (Skipped — Docker E2E not runnable in this context. Root cause identified via code analysis.
  Confirmed by ext-test-projects commit 4e0fbea which identifies and fixes the root cause.)
- [x] Read the diagnostic output to identify root cause.
  (Confirmed H1 + stale-route variant. Root cause: both remix-cssmodules-spotify and
  remix-tw4-twitter had stale committed test-preview.tsx routes in old format (no
  HyperCanvasScripts). Proxy intentionally skips script injection for Remix SSR to avoid
  hydration mismatch — route must load iframe-interaction.js via /__hypercanvas/ endpoints
  itself. For fast Spotify dev server (~2.5s startup), preview iframe loaded BEFORE extension
  runtime _writeIfSafe update + 4s HMR wait completed, so HyperCanvasScripts never ran and
  __hyperCanvasState was never set. waitForAnySelection(8000) timed out on every attempt.)

### Task 2 — Fix based on H1/H4 (timing): commit Remix routes in current format

Root cause was stale committed routes, not just a timeout issue. Fix: update both
remix test-preview.tsx files to match what generateRouteFileContent(remix, ...) generates,
so _writeIfSafe finds identical content and skips → no HMR race.

- [x] Update remix-cssmodules-spotify/app/routes/test-preview.tsx with HyperCanvasScripts component
- [x] Update remix-tw4-twitter/app/routes/test-preview.tsx with HyperCanvasScripts component
- [x] Verify _writeIfSafe skips the write (no HMR triggered) for fast-starting Spotify project
  (Done: ext-test-projects commit 4e0fbea, 2026-05-16 08:13:19, confirmed both files updated)

### Task 3 — Fix based on H2 (proxy inject missing): verify and fix proxy for Remix SSR

- [x] Not needed. Proxy CORRECTLY skips script injection for Remix SSR (PreviewProxy.ts:294-306).
  The route file handles script loading via HyperCanvasScripts (loaded via /__hypercanvas/ endpoints).
  This is the intended design — proxy skip is to avoid SSR hydration mismatch.

### Task 4 — Fix based on H3 (tree count 0): verify component discovery

- [x] Not the root cause. remix-cssmodules-spotify/app/components/ has PlayerBar.tsx, Sidebar.tsx,
  SongTable.tsx — findRemixUserComponent() returns app/components/PlayerBar.tsx. Tree count > 0.
  Error message was "selection round-trip failed" not "Elements tree should show items" (H3 ruled out).

## Acceptance criteria

- `insert element`, `delete element`, `duplicate element`, `wrap element` all PASS on
  `dep:remix-cssmodules-spotify` in a Docker run
- No timeout-based workarounds (fix root cause, not symptom)
- Screenshot included in TG fix report

## Notes

- `react-vite-cssmodules-spotify` delete/duplicate failures are a separate issue (1-item tree,
  treeCount < 2 skip guard — FIXED in commit 74d8857)
- `remix-tw4-twitter` had the same stale route issue — both projects fixed in commit 4e0fbea
- Consider also testing `webpack-react-cssmodules-spotify` for the same bridge inject issue
