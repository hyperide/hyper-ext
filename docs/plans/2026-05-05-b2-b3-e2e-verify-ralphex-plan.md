# B2/B3: E2E Verification — Delete Key + i18n Text Snap-Back

## Context

Extension 0.1.41 shipped fixes for B2 and B3:

- **B2**: `hypercanvas.rightPanelInputFocused` context variable prevents Delete/Backspace
  from firing the canvas `deleteElement` keybinding when an i18n text input is focused.
- **B3**: `isFocusedRef` pattern (onFocus/onBlur) prevents server re-read value from
  overwriting the input while user is typing.

E2E regression tests were already written:

- `PI-7-I18N-3` in `ext-test-projects/e2e/tests/project-independent/i18n-inspector.spec.ts`
- `PI-7-I18N-4` in the same file

**Goal**: run these tests to confirm they pass. If they fail despite the fix, diagnose why and fix.

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` first — mandatory.
- TDD is already done (tests exist). Goal is to make them GREEN.
- Do NOT kill existing ralphex processes.
- Write progress to `.ralphex/progress/progress-2026-05-05-b2-b3-verify.txt`.
- Telegram heartbeat every 15 min.

This ralphex run works in the main worktree (no separate worktree needed — read-only run + possible fix):

- Main worktree: `/Users/ultra/work/hyper-canvas-draft`

## Task 1: Confirm extension version

- [ ] Check current installed extension version: `code --list-extensions --show-versions | grep hypercanvas`
- [ ] If not 0.1.41+, build and install:
  ```bash
  cd /Users/ultra/work/hyper-canvas-draft/vscode-extension/hypercanvas-preview && npm run package
  code --install-extension hypercanvas-preview-*.vsix --force
  vscmd workbench.action.reloadWindow -p /Users/ultra/work/ext-test-projects/react-vite-tw4-twitter
  ```

## Task 2: Run B2 test (PI-7-I18N-3)

From `/Users/ultra/work/ext-test-projects`:

```bash
HYPER_E2E_SHARDS=1 bun run test:docker -- --grep "PI-7-I18N-3" 2>&1 | tail -60
```

### If test PASSES → done for B2. Screenshot to TG.

### If test FAILS with "canvas element deleted" (countAfter = 0):

The `hypercanvas.rightPanelInputFocused` context var is not being set.

Diagnose:

- [ ] Read `vscode-extension/hypercanvas-preview/src/PanelRouter.ts` — look for `panel:inputFocus` message handler.
- [ ] Read `client/components/RightSidebar/index.tsx` or similar — look for where `panel:inputFocus` is sent.
- [ ] Verify the `when` clause in `package.json` keybindings uses `hypercanvas.rightPanelInputFocused`.
- [ ] Fix: ensure `postMessage({type: 'panel:inputFocus', focused: true/false})` fires on focusin/focusout of the sidebar webview.
- [ ] Re-run test.

### If test FAILS with "isPreviewLoaded = false":

Canvas crashed. Take screenshot, check console errors, diagnose separately.

## Task 3: Run B3 test (PI-7-I18N-4)

```bash
HYPER_E2E_SHARDS=1 bun run test:docker -- --grep "PI-7-I18N-4" 2>&1 | tail -60
```

### If test PASSES → done for B3. Screenshot to TG.

### If test FAILS with "value snapped back":

The `isFocusedRef` fix is not working in the real WebviewView context.

Diagnose:

- [ ] Read `vscode-extension/hypercanvas-preview/src/components/sections/I18nSection.tsx` (or similar).
- [ ] Look for `isFocusedRef` and `onFocus`/`onBlur` handlers on the text input.
- [ ] Check: does the WebviewView sidebar fire `focus` events on inputs? (VS Code known issue: `document.activeElement` unreliable but `onFocus` event should still fire.)
- [ ] Fix: if `onFocus` fires but ref isn't checked before updating, add `if (isFocusedRef.current) return;` in the state update from server data.
- [ ] Re-run test.

## Task 4: Capture screenshots

- [ ] `/tmp/b2-delete-regression-pass.png` — test run showing PI-7-I18N-3 PASSED
- [ ] `/tmp/b3-snapback-regression-pass.png` — test run showing PI-7-I18N-4 PASSED

## Task 5: Telegram report

Send to TG:

- Test results for both
- Screenshots of passing tests or (if still failing) root cause + fix applied
