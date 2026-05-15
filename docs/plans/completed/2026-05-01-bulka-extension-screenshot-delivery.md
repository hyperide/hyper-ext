# Plan: Bulka VS Code Extension Screenshot Delivery

> For agentic workers: this plan is intended for ralphex execution. Execute one
> task at a time. Do not send anything to Telegram until Task 5.

## Overview

Deliver adequate screenshots of the `bulka-the-dog` site running inside VS Code
with the Hyper Canvas extension, as part of the extension E2E flow. If the
screenshots or tests are bad, fix the root cause first. Telegram delivery is
allowed only after local validation proves the screenshots are visually usable.

Current target project:
`/Users/ultra/work/ext-test-projects/bulka-the-dog`

Primary extension path:
`/Users/ultra/work/hyper-canvas-draft/vscode-extension/hypercanvas-preview`

Important workflow rules:

- Before any extension debugging, read
  `/Users/ultra/work/ext-test-projects/CLAUDE.md`.
- Use the VS Code E2E harness (`launchVSCode()` and
  `setupPreviewWithDevServer()`), not browser Playwright MCP.
- Keep Telegram as the final delivery step only.
- Do not reset or revert unrelated worktree changes.
- Existing partial fixes may already be present in the working tree. Start by
  reading `git status` and `git diff`, then continue from the actual state.

Known failure to investigate:

The Bulka preview can visually load while the test still fails because Vite
reports `Cannot access 'App' before initialization` from generated
`client/__canvas_preview__.tsx`. The suspected cause is `client/App.tsx` being
imported into the generated component registry for a Vite React SSG app, even
when the selected render target should be `client/pages/Index.tsx`.

## References

- `https://ralphex.com/docs/` - plan files live in `docs/plans/` and use
  `### Task N:` sections with `- [ ]` checkboxes.
- `https://ralphex.com/` - ralphex runs structured markdown plans task by task,
  validates after each task, reviews, commits, and moves completed plans.

## Validation Commands

Run the relevant subset after each task, and the full list before Telegram
delivery.

```bash
cd /Users/ultra/work/hyper-canvas-draft/vscode-extension/hypercanvas-preview
npm run build
```

```bash
cd /Users/ultra/work/hyper-canvas-draft
bun test lib/preview-generator/__tests__/scanner.test.ts \
  lib/preview-generator/__tests__/generator.test.ts \
  lib/preview-generator/__tests__/preview-file-manager.test.ts
```

```bash
cd /Users/ultra/work/ext-test-projects
bun test e2e/helpers/setup-preview.test.ts
```

```bash
cd /Users/ultra/work/ext-test-projects/e2e
EXT_ROOT=/Users/ultra/work/hyper-canvas-draft
EXTENSION_PATH="$EXT_ROOT/vscode-extension/hypercanvas-preview" \
  ./node_modules/.bin/playwright test --project="dep:bulka-the-dog" \
  tests/project-dependent/preview-render.spec.ts \
  -g "open component.*no white screen" --workers=1
```

## Acceptance Criteria

- The extension build passes.
- Preview generator unit tests pass.
- `setup-preview` helper tests pass, including the Bulka fixture case.
- `dep:bulka-the-dog` preview-render E2E passes with no `test-errors`,
  `pageerror`, or Vite diagnostic errors.
- Screenshots are full-window enough to prove VS Code and the extension are
  involved, not just a browser page.
- Screenshots show real Bulka content, not a white screen, stale dialog,
  "No component selected", clipped panel, or runtime overlay.
- Telegram photos are sent only after local visual validation.

### Task 1: Establish a clean reproducible baseline

- [x] Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` and follow its VS Code
      extension workflow rules exactly.
- [x] Record `git status --short` in both repositories:
      `/Users/ultra/work/hyper-canvas-draft` and
      `/Users/ultra/work/ext-test-projects`.
- [x] Inspect `git diff` for existing partial fixes and preserve unrelated
      user changes.
- [x] Stop stale dev servers and VS Code/Electron test processes that target
      Bulka ports. Do not kill unrelated user apps.
- [x] Clean only generated Bulka preview artifacts:
      `/Users/ultra/work/ext-test-projects/bulka-the-dog/client/__canvas_preview__.tsx`
      and `/Users/ultra/work/ext-test-projects/bulka-the-dog/.hyperide`.
- [x] Build the extension with `npm run build` from
      `vscode-extension/hypercanvas-preview`.
- [x] Run the Bulka preview-render E2E and save logs to
      `/tmp/bulka-preview-test.log`.
- [x] If it fails, capture the first real runtime or diagnostic error and the
      relevant generated `__canvas_preview__.tsx` lines before changing code.

### Task 2: Fix preview-generator root causes with regression tests

- [x] Add or verify a regression test for same-directory same-export alias
      collisions, such as `ui/toaster.tsx` and `ui/sonner.tsx` both exporting
      `Toaster`.
- [x] Add or verify scanner tests proving type-only exports and
      `React.createContext(...)` exports are not registered as renderable
      components.
- [x] Add or verify generator tests proving provider wrapper imports reserve
      their imported names, so registry aliases do not redeclare provider
      bindings.
- [x] Add a failing regression test for the Bulka/Vite React SSG shell case:
      selecting `client/pages/Index.tsx` must not force `client/App.tsx` into
      the generated component registry when that shell creates a router and
      imports the selected page.
- [x] Implement the smallest production-code fix in `lib/preview-generator/`.
      Prefer content-based exclusion or dependency-aware handling over
      hard-coding the Bulka project name.
- [x] Bump the preview generator schema marker if stale generated files could
      otherwise keep the broken registry.
- [x] Run the preview generator test command from the Validation Commands
      section and fix all failures.

### Task 3: Make Bulka component selection deterministic in E2E

- [x] In `/Users/ultra/work/ext-test-projects`, update the setup helper only if
      needed so Bulka defaults to `client/pages/Index.tsx`, not `client/App.tsx`.
- [x] Add or verify helper tests covering Vite React SSG projects and the real
      `bulka-the-dog` fixture.
- [x] Rebuild the extension after code changes.
- [x] Run `bun test e2e/helpers/setup-preview.test.ts` in `ext-test-projects`.
- [x] Run the `dep:bulka-the-dog` preview-render Playwright command with
      `EXTENSION_PATH` pointing at the local extension.
- [x] Confirm the E2E log has no `test-errors`, `pageerror`, runtime overlay, or
      Vite diagnostic error. If any remain, return to Task 2 with the new first
      error.

### Task 4: Capture screenshots locally without sending them

- [x] Create or reuse a no-send debug capture script in `ext-test-projects` that
      uses `launchVSCode()` and `setupPreviewWithDevServer(window,
      'client/pages/Index.tsx', app)`.
- [x] Capture at least two screenshots: the full VS Code window with the Hyper
      Canvas preview visible, and a closer preview-panel screenshot that clearly
      shows Bulka content.
- [x] Store screenshots under `/tmp/` or another explicit local path with
      `bulka` and a timestamp in the filename.
- [x] Add programmatic checks before visual review: dimensions are non-zero,
      file size is reasonable, image is not nearly all one color, and VS Code
      DOM does not contain "No component selected" or known preview error text.
- [x] Open every screenshot with the local image viewer tool and inspect the
      full window, not only a crop.
- [x] Reject screenshots that show a blank iframe, stale dialog, wrong active
      tab, clipped panel, runtime overlay, bad crop, or content not related to
      Bulka. Fix the cause and recapture.

### Task 5: Send verified screenshots to Telegram

- [x] Reuse the existing Telegram configuration from the current capture script
      or environment. Do not print the token in logs or final output.
- [x] Send only the screenshots accepted in Task 4.
- [x] Include captions that identify them as Bulka in VS Code with Hyper Canvas
      extension and mention that E2E passed.
- [x] Save the Telegram API response status or message IDs in a local log under
      `/tmp/`, without recording secrets.

### Task 6: Finish cleanly

- [x] Run `git status --short` in both repositories and list changed files.
- [x] Leave generated Bulka artifacts out of git unless a fixture update is
      intentionally required.
- [x] Summarize tests run, screenshots sent, and any remaining warnings.
- [x] Answer the completion checklist: what is done, what should be improved,
      and whether `/done` is needed.

<!-- Completion summary (2026-05-01):
hyper-canvas-draft: only untracked PNG marketing screenshots + .claude/scheduled_tasks.lock
ext-test-projects: many untracked debug scripts; bulka-the-dog submodule has
  untracked client/__canvas_preview__.tsx + .hyperide/ — not tracked, safe.

Tests run:
- preview generator unit tests (scanner, generator, preview-file-manager) — pass
- e2e/helpers/setup-preview.test.ts — pass
- dep:bulka-the-dog preview-render E2E (open component / no white screen) — pass

Screenshots sent to Telegram: 3 files (message_id 715, 716, 717)
- 01-full-window.png, 02-element-selected.png, 03-preview-focused.png

Remaining warnings:
- ext-test-projects root has ~30 untracked debug/capture scripts (not committed, user artefacts)
- bulka submodule .gitignore doesn't explicitly exclude __canvas_preview__.tsx / .hyperide
  but these are untracked and won't be committed without explicit git add

Completion checklist:
- Done: root cause fix (router shell exclusion), deterministic component selection,
  screenshot capture, Telegram delivery, regression tests, extension build
- Should improve: add __canvas_preview__.tsx + .hyperide to bulka submodule .gitignore
- /done: not needed from agent side — all plan tasks complete
-->
