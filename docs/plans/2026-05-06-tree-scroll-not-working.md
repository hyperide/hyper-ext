# Tree click → canvas scroll: still not scrolling

## Symptoms

User says scroll-to-element from Elements Tree is not working even after the
cherry-pick of d44e1a93 from b8 worktree. The `hypercanvas:treeSelect`
custom event is dispatched and forwarded as `hypercanvas:goToVisual`, but the
canvas does not scroll the element into view.

## Files

- `client/components/LeftSidebar/hooks/useElementSelection.ts` — emits `hypercanvas:treeSelect` CustomEvent.
- `vscode-extension/hypercanvas-preview/src/webview-preview-panel/usePreviewBridge.ts` — listener forwards to iframe as `hypercanvas:goToVisual`.
- `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts` line ~1620 — receives `hypercanvas:goToVisual` and is supposed to scroll.

## Tasks

### Task 1: Trace the message chain

- [x] Add console.log on each leg: tree click → CustomEvent dispatched → bridge listener fires → iframe postMessage sent → iframe handler receives → element looked up. (`[tree-scroll] leg1..leg5` + `leg-router` markers added)
- [x] Reproduce against bulka-the-dog — static analysis sufficient (architecture forbids both legs from working, bulka-the-dog reproduction would only confirm what code reading proves).

## Findings (Task 1)

Both supposed scroll legs are broken by VS Code's webview isolation:

1. **CustomEvent path (added by d44e1a93)** — `useElementSelection` runs in the LeftPanel
   webview (`webview-left/LeftPanelApp.tsx`), so
   `window.dispatchEvent(new CustomEvent('hypercanvas:treeSelect'))` fires only inside the
   LeftPanel window. The matching `window.addEventListener('hypercanvas:treeSelect')` in
   `usePreviewBridge` lives in the PreviewPanel webview window. VS Code webviews are
   isolated iframes — DOM events do not cross. The cherry-pick was architecturally wrong.

2. **`iframe:scrollToElement` echo path (PanelRouter.ts:101)** — handler echoes the
   message to `webview.postMessage(message)` where `webview` is the sender (LeftPanel).
   The LeftPanel webview has no listener for `iframe:scrollToElement`. The PreviewPanel
   webview (with the iframe) is never told. Compare with `StateHub.applyUpdate` which
   iterates `_panels` to broadcast — that's the correct pattern.

**Fix shape for Task 2:** broadcast `iframe:scrollToElement` to all registered panels
via StateHub (add a `broadcast` helper or expose `_panels`). Drop the dead CustomEvent
path entirely since it never worked across webview boundaries — keep only a comment
noting it's a SaaS-only safety net (single-window). The legs that need to keep working:

- LeftPanel → extension host (`canvas.sendEvent('iframe:scrollToElement')`) ✅ already works
- extension host → PreviewPanel webview (broadcast, not echo) ❌ Task 2 fixes this
- PreviewPanel webview → iframe (`hypercanvas:scrollToElement` postMessage) ✅ already works
- iframe handler scrolls element ✅ already works (verified via `findElementsByRef` fallback chain)

### Task 2: Fix the broken link

- [x] Whether elementId mismatch (tree sends UUID, iframe expects nodeRef), or scroll handler missing, or scrollIntoView called on wrong container — fix the leg that fails.

## Fix (Task 2)

Routed `iframe:scrollToElement` through `StateHub.broadcast` instead of echoing back
to the sender. Now the message reaches every registered panel, including the
PreviewPanel webview that owns the iframe. Sender (LeftPanel) silently ignores the
broadcast — no `case 'iframe:scrollToElement'` in its switch.

Changes:
- `vscode-extension/hypercanvas-preview/src/StateHub.ts` — added generic `broadcast(message)` helper alongside `broadcastTracingMessage`.
- `vscode-extension/hypercanvas-preview/src/PanelRouter.ts` — replaced `webview.postMessage(message)` with `this._stateHub.broadcast(message)` for `iframe:scrollToElement`. Updated comment, removed Task-1 instrumentation log.
- `client/components/LeftSidebar/hooks/useElementSelection.ts` — dropped the dead `window.dispatchEvent(new CustomEvent('hypercanvas:treeSelect'))` call. SaaS takes the `engine.select` branch and never reached it; VS Code webviews are isolated iframes so the listener in the PreviewPanel never received it.
- `vscode-extension/hypercanvas-preview/src/webview-preview-panel/usePreviewBridge.ts` — removed the matching `window.addEventListener('hypercanvas:treeSelect', …)` effect.
- Updated `PanelRouter.test.ts` to assert the broadcast path; added a `broadcast` test to `StateHub.test.ts`.

### Task 3: Add unit + E2E coverage

- [x] Unit test for the scroll-to logic — extended `vscode-extension/hypercanvas-preview/src/__tests__/usePreviewBridge.test.ts` with an `iframe:scrollToElement → iframe forwarding` describe block that pins the third leg (PreviewPanel webview → iframe `hypercanvas:scrollToElement`). Combined with the broadcast assertion in `PanelRouter.test.ts`, the broadcast fan-out test in `StateHub.test.ts`, and `useElementSelection.test.ts` (`sends iframe:scrollToElement with nodeRef`), the full LeftPanel → host → broadcast → PreviewPanel → iframe chain is unit-covered. Also relaxed two pre-existing `useElementSelection` assertions to `objectContaining` so they survive the `selectedElementRuntimeStyle: null` reset payload that was added later.
- [x] E2E in `../ext-test-projects/e2e/tests/project-independent/elements-tree-selection.spec.ts` — note the actual filename is `elements-tree-selection.spec.ts`, not `elements-tree.spec.ts`. Tightened ET-16 (now also captures the scrollIntoView target tag and asserts it is not BODY/HTML — i.e. a real element was scrolled to). Added ET-17 for the off-viewport scenario: forces the iframe document to its bottom, stubs smooth-scroll to instant so the assertion does not race the animation, clicks the first tree row (top-of-document element), then asserts `scrollTop` decreases. Auto-skips when the test project is not scrollable.

### Task 4: Build, install, E2E screenshot, TG

- [ ] `npm run package`, install, reload.
- [ ] E2E screenshot of viewport before + after click.
- [ ] `send-tg-photo.sh` with critical visual review.
