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

- [ ] Add console.log on each leg: tree click → CustomEvent dispatched → bridge listener fires → iframe postMessage sent → iframe handler receives → element looked up.
- [ ] Reproduce against bulka-the-dog. Determine where the chain breaks.

### Task 2: Fix the broken link

- [ ] Whether elementId mismatch (tree sends UUID, iframe expects nodeRef), or scroll handler missing, or scrollIntoView called on wrong container — fix the leg that fails.

### Task 3: Add unit + E2E coverage

- [ ] Unit test for the scroll-to logic (`shared/canvas-interaction/scroll-to-element.test.ts` or extend existing).
- [ ] E2E in `../ext-test-projects/e2e/tests/project-independent/elements-tree.spec.ts` — click off-viewport tree row, assert canvas scrolled.

### Task 4: Build, install, E2E screenshot, TG

- [ ] `npm run package`, install, reload.
- [ ] E2E screenshot of viewport before + after click.
- [ ] `send-tg-photo.sh` with critical visual review.
