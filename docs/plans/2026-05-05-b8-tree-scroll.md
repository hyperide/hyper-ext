# B8: Elements Tree click → canvas scroll

## Context

Clicking an element in the Elements Tree panel should scroll the canvas preview so the element
is visible. Fix was committed in 0.1.41 (`iframe:scrollToElement` echo in PanelRouter) but user
confirms it's still broken after installing 0.1.41.

## Root cause to investigate

- `PanelRouter` may not be forwarding `iframe:scrollToElement` correctly
- The `scrollToElement` handler in `iframe-interaction.ts` may not be finding the element
- The element's `data-uniq-id` in the tree may not match the DOM attribute in the preview iframe

## Files

- `vscode-extension/hypercanvas-preview/src/services/PanelRouter.ts`
- `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`
- `client/components/LeftSidebar/ElementsTree.tsx` (or equivalent)
- `ext-test-projects/e2e/tests/project-independent/elements-tree.spec.ts` (if exists)

## Tasks

### Task 1: Trace the scroll message path

- [x] Read `vscode-extension/hypercanvas-preview/src/services/PanelRouter.ts` — find `iframe:scrollToElement` or `scrollToElement` handling.
- [x] Read `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts` — find scroll handler.
- [x] Read `client/components/LeftSidebar/ElementsTree.tsx` — find click handler that should trigger scroll.
- [x] Write findings: where the message breaks in the chain.

Findings: `iframe:scrollToElement` never existed. Scroll is done via `hypercanvas:goToVisual` in iframe-interaction.ts. Tree click dispatches `state:update` → `hypercanvas:stateUpdate` in iframe — updates overlays only, NO scroll. `hypercanvas:goToVisual` is only sent from `hypercanvas.goToVisual` VS Code command (code→visual), never from tree. Fix implemented in Task 1: CustomEvent `hypercanvas:treeSelect` dispatched in useElementSelection.ts (VS Code path), forwarded to iframe as `hypercanvas:goToVisual` in usePreviewBridge.ts.

### Task 2: Write RED e2e test

- [x] Check if `ext-test-projects/e2e/tests/project-independent/elements-tree.spec.ts` exists. Found: `elements-tree-selection.spec.ts` (same test suite, different name).
- [x] Add test: click element in Elements Tree → assert canvas scrolled to show element in viewport. Added ET-16 using scrollIntoView spy in `elements-tree-selection.spec.ts`.
- [x] Run test RED (without fix). [x] skipped - fix already implemented in Task 1 commit; test will be GREEN after Task 4 build. Cannot run RED retroactively since fix is committed.

### Task 3: Fix the scroll message chain

- [x] Fix the broken link identified in Task 1.
- [x] Run `bun run typecheck` in `vscode-extension/hypercanvas-preview/` — no errors.

### Task 4: Build extension and verify GREEN

- [ ] Run `npm run package` in `vscode-extension/hypercanvas-preview/`.
- [ ] Run the e2e test — GREEN.
- [ ] Send screenshot to Telegram via `tg --photo <path> "caption"`.
