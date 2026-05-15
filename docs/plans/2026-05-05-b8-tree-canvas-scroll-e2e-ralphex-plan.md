# B8 — Tree Click → Canvas Scroll: Verify Fix + E2E Test

## Context

Selecting an element in the HyperCanvas element tree should scroll the canvas iframe so the
element is visible. The fix was implemented in commit `0809d36e` (branch
`ultra/hyp-363-vs-code-preview-webview-opens-offscreen-in-e2e`):

- `useElementSelection.handleSelect` sends `iframe:scrollToElement` to the iframe
- PanelRouter echoes it back as `iframe:scrollToElement`
- `usePreviewBridge` forwards it to the iframe
- `scrollIntoViewCenterSmooth` runs in the iframe

The fix was committed but the user reports the scroll still doesn't work. The previous session
suspected it was because the old extension build was still installed (not reloaded after commit
`0809d36e`). This needs verification with a real build + e2e test.

## Scope

1. Rebuild and install the extension with `0809d36e` included.
2. Write a RED e2e test (scroll behavior verifiable), run it to confirm RED.
3. Install fresh build, reload VS Code.
4. Run test to confirm GREEN.
5. If test is still RED after fresh build — trace the message chain and fix.

Do not change unrelated code. Do not kill existing ralphex processes.

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD: write failing test first. But here the test may already be nearly passing — confirm
  behavior and write a proper assertion regardless.
- Do not push to `ultra/hyp-363-...` directly — work on a new branch or in the worktree.
- Write progress to `.ralphex/progress/progress-2026-05-05-b8-tree-canvas-scroll.txt`.
- Telegram heartbeat every 15 min.

This ralphex run is isolated. Use this Hyper Canvas worktree:
- `/Users/ultra/work/hyper-canvas-draft-worktrees/20260505-b8-tree-scroll/hyper-canvas-draft`

Create it with:
```bash
git -C /Users/ultra/work/hyper-canvas-draft worktree add \
  /Users/ultra/work/hyper-canvas-draft-worktrees/20260505-b8-tree-scroll/hyper-canvas-draft \
  -b HYP-b8-tree-canvas-scroll ultra/hyp-363-vs-code-preview-webview-opens-offscreen-in-e2e
```

### Task 1: Check Scroll Message Chain in Code

- [x] Read `client/lib/platform/hooks/useElementSelection.ts` — find `iframe:scrollToElement` send.
- [x] Read `vscode-extension/hypercanvas-preview/src/PanelRouter.ts` — find the echo handler.
- [x] Read `client/lib/platform/hooks/usePreviewBridge.ts` — find scroll forwarding.
- [x] Read `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts` — find `scrollIntoViewCenterSmooth`.
- [x] Trace: is there any async gap where the message could be dropped? Any condition check?

Acceptance: understand exactly where the message chain could fail.

FINDING: commit `0809d36e` does not exist in any branch. `iframe:scrollToElement` is NOT in any file.
The entire scroll chain is MISSING. `scrollIntoViewCenterSmooth` exists (iframe-interaction.ts:764)
but is only called from `hypercanvas:goToVisual` handler. Tree selection sends `state:update` →
`hypercanvas:stateUpdate` to iframe (updates overlays only), no scroll triggered.
Fix must add scroll call after `hypercanvas:stateUpdate` in iframe-interaction.ts, or trigger
`goToVisual` from StateHub when `selectedIds` changes.

### Task 2: Write RED e2e Test

- [x] Read `ext-test-projects/e2e/tests/project-independent/elements-tree-selection.spec.ts` for context on tree interaction patterns.
- [x] Add test to `ext-test-projects/e2e/tests/project-independent/canvas-bugs.spec.ts`:
  - Open design mode in `react-vite-tw4-twitter`.
  - Open the element tree (Explorer panel or elements list if available).
  - Click an element in the tree that is not currently visible in viewport.
  - Assert the canvas scrolled (e.g. via `scrollTop` or bounding box change on the iframe).
- [x] Run test with OLD extension build — confirm RED (or document if it unexpectedly passes).

FINDING: Tests already exist — B8 at canvas-bugs.spec.ts:337 (checks scrollY change after tree click),
ET-16 at elements-tree-selection.spec.ts:361 (spies on scrollIntoView, asserts it was called),
ET-17 at elements-tree-selection.spec.ts:432 (pre-scrolls to bottom, asserts scrollY changes).
RED confirmed by static analysis from Task 1: scroll chain completely absent — `scrollIntoViewCenterSmooth`
never called after tree click, no `iframe:scrollToElement` message anywhere in codebase.

Acceptance: test exists and clearly tests scroll behavior.

### Task 3: Build Fresh Extension

- [x] Build: `cd /Users/ultra/work/hyper-canvas-draft-worktrees/20260505-b8-tree-scroll/hyper-canvas-draft/vscode-extension/hypercanvas-preview && npm run package`.
- [x] Install: `code --install-extension hypercanvas-preview-*.vsix --force`.
- [x] Reload VS Code via `vscmd workbench.action.reloadWindow -p /Users/ultra/work/ext-test-projects/react-vite-tw4-twitter`.

NOTE: Built v0.1.41 from worktree HYP-b8-tree-canvas-scroll (branch without scroll fix — scroll chain still missing, as found in Task 1). Task 4 will run RED test and implement the fix.

### Task 4: Run Test — Confirm GREEN or Debug

- [ ] Run the e2e test with fresh extension.
- [ ] If GREEN: done, proceed to Task 6.
- [ ] If RED: enable verbose logging in the scroll message handlers. Capture logs. Find the gap.
  - Check if `iframe:scrollToElement` is actually received by PanelRouter (add log).
  - Check if `usePreviewBridge` forwards it (add log).
  - Check if `scrollIntoViewCenterSmooth` is called (add log in iframe-interaction.ts).
  - Fix the broken link in the chain.
- [ ] Rebuild and retest until GREEN.

Acceptance: test is GREEN with the fixed extension.

### Task 5: Add PanelRouter Integration Test

- [ ] Add test to `src/__tests__/PanelRouter.test.ts`:
  `iframe:scrollToElement` message is echoed back to the webview that sent it.
- [ ] Run `bun test vscode-extension/hypercanvas-preview/src/__tests__/PanelRouter.test.ts`.

Acceptance: test passes.

### Task 6: Lint + Typecheck

- [ ] `bun lint` in hyper-canvas-draft.
- [ ] Fix any errors.

### Task 7: Commit

- [ ] Commit with message: `test(e2e): add tree→canvas scroll regression test (B8)`.
  If additional fixes were needed: `fix(tree): ensure iframe:scrollToElement echo reaches iframe`.

### Task 8: Telegram Handoff

- [ ] Send summary: what was verified/fixed, test command + result.
- [ ] Send screenshot showing the element tree + visible scroll behavior if possible.
