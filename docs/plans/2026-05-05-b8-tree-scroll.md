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

- [ ] Read `vscode-extension/hypercanvas-preview/src/services/PanelRouter.ts` — find `iframe:scrollToElement` or `scrollToElement` handling.
- [ ] Read `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts` — find scroll handler.
- [ ] Read `client/components/LeftSidebar/ElementsTree.tsx` — find click handler that should trigger scroll.
- [ ] Write findings: where the message breaks in the chain.

### Task 2: Write RED e2e test

- [ ] Check if `ext-test-projects/e2e/tests/project-independent/elements-tree.spec.ts` exists.
- [ ] Add test: click element in Elements Tree → assert canvas scrolled to show element in viewport.
- [ ] Run test RED (without fix).

### Task 3: Fix the scroll message chain

- [ ] Fix the broken link identified in Task 1.
- [ ] Run `bun run typecheck` in `vscode-extension/hypercanvas-preview/` — no errors.

### Task 4: Build extension and verify GREEN

- [ ] Run `npm run package` in `vscode-extension/hypercanvas-preview/`.
- [ ] Run the e2e test — GREEN.
- [ ] Send screenshot to Telegram via `/Users/ultra/xp/codex-tg-bot/scripts/send-tg-report.sh`.
