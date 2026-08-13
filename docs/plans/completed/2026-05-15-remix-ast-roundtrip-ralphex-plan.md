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

Other Remix project (`remix-tw4-twitter`) presumably passes these tests. This suggests the
issue is specific to `remix-cssmodules-spotify` structure, not Remix hydration in general.

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

1. In `openExplorerAndSelect`, before `treeItems.nth(idx).click()`, log `treeCount` and `idx`.
2. After the click, log every 1s what `__hyperCanvasState.selectedIds` is in the iframe:
   ```typescript
   const poll = setInterval(async () => {
     const ids = await appFrame.evaluate(() => (window as any).__hyperCanvasState?.selectedIds);
     console.log("[round-trip-diag]", ids);
   }, 1000);
   ```
3. Run targeted test:
   ```bash
   cd /Users/ultra/work/ext-test-projects/e2e
   HYPER_E2E_SHARDS=1 bun run test:docker -- \
     --project="dep:remix-cssmodules-spotify" \
     tests/project-dependent/ast-operations.spec.ts \
     --grep "insert element"
   ```
4. Read the diagnostic output to identify if: tree has 0 items (H3), bridge script missing (H2),
   or selectedIds never appears (H1/H4).

### Task 2 — Fix based on H1/H4 (timing): increase waitForAnySelection timeout for tree clicks

In `setup-preview.ts`, `openExplorerAndSelect`:

```typescript
// Before: hardcoded 8s
await canvas.waitForAnySelection(8_000);
// After: configurable with Remix-safe default
await canvas.waitForAnySelection(options.selectionTimeout ?? 12_000);
```

If H4 (too short), this fix alone resolves it. Pass `selectionTimeout: 15_000` for Remix
projects in the test.

### Task 3 — Fix based on H2 (proxy inject missing): verify and fix proxy for Remix SSR

In the extension's dev server proxy (look for `injectBridge` or similar), ensure it handles
SSR chunked HTML responses from Remix:

- Use `concat-stream` or buffer the full response before inject
- Match on `Content-Type: text/html` regardless of chunked/gzip encoding
- Add a fallback: if no `</head>` tag found in first chunk, try `</body>`

This is an extension-side fix, not a test fix.

### Task 4 — Fix based on H3 (tree count 0): add `toBeGreaterThan(0)` diagnostic

If `treeCount = 0`, the `expect.poll` 15s timeout fires inside `openExplorerAndSelect`, not in
`waitForAnySelection`. The error message would be "Elements tree should show items" — different
from "selection round-trip failed". So H3 is likely NOT the root cause here. But verify.

## Acceptance criteria

- `insert element`, `delete element`, `duplicate element`, `wrap element` all PASS on
  `dep:remix-cssmodules-spotify` in a Docker run
- No timeout-based workarounds (fix root cause, not symptom)
- Screenshot included in TG fix report

## Notes

- `react-vite-cssmodules-spotify` delete/duplicate failures are a separate issue (1-item tree,
  treeCount < 2 skip guard — FIXED in commit 74d8857)
- `remix-tw4-twitter` presumably doesn't have this issue (different component structure)
- Consider also testing `webpack-react-cssmodules-spotify` for the same bridge inject issue
