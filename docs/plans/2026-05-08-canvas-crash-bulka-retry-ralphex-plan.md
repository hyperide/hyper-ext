# canvas-crash retry — bulka harness now available

## Context

The original `2026-05-08-canvas-crash-on-discard-ralphex-plan.md` ralphex
session (TASK_FAILED, see `git log --grep=canvas-crash`) ended with three
next-iteration paths. Path 1 — "get bulka Docker dev-server back" — is now
available: `d963a9b2` (ProjectDetector reads `packageManager` field) +
ext-test-projects Dockerfile.e2e (corepack enable + prepare pnpm@10.14.0)
landed on main today. Docker image is being rebuilt with corepack now.

## Reminder of what's known

- Bug only repros on bulka. Project-independent variant on react-vite-tw4-twitter
  PASSES both with default-component view and i18n-bound TestElements.tsx.
- Static audit of `vscode-extension/.../src/` showed all `Object.{keys,assign,push,…}`
  call sites guarded.
- Throwing frame must live in bundled `lib/` or a third-party dep. Need a runtime
  stack from inside the bulka container.
- Symptoms: `[HyperIDE] Unhandled rejection: TypeError: Cannot convert undefined
or null to object at push (<anonymous>)` after Source Control "Discard All
  Changes" while Hyper Canvas is open.

## Scope

Reproduce the unhandled rejection inside bulka with the now-working harness,
capture the runtime stack, identify the throwing call site, fix it, prove via
the existing RED e2e (`bulka-canvas-discard-no-crash.spec.ts` already merged
into main as part of plan `8a057900`-era work).

Out of scope:

- Refactoring `FileStructureStore` or `PreviewPanel` lifecycle (deferred FSM
  ticket exists in MEMORY).

### Task 1: Reproduce + capture stack

- [ ] Run the merged spec
      `ext-test-projects/e2e/tests/project-dependent/bulka-canvas-discard-no-crash.spec.ts`
      via `HYPER_E2E_SHARDS=1 bun run test:docker -- --project=dep:bulka-the-dog`.
- [ ] Confirm RED on current main (it's been RED since the spec landed).
- [ ] Add an `unhandledRejection` listener to the top of the extension's
      `activate()` (committed in same branch — gated to test runs only) that
      writes `error.stack` to `console.error` so Playwright's harness captures
      it via the iframe error log.
- [ ] Re-run, copy the stack trace, paste into commit message.

### Task 2: Identify throwing site, apply minimal fix

- [ ] From the stack, locate the `.push()` call site in
      `vscode-extension/.../out/extension.js` or
      `vscode-extension/.../node_modules/<dep>/...`. Map back to source.
- [ ] Apply smallest correct fix at the upstream that produces null/undefined,
      OR at the call site with a comment explaining when input can be missing.
      Do NOT wrap the whole extension in try/catch.
- [ ] Add a unit test in the closest `__tests__/` dir.
- [ ] Re-run the e2e — must be GREEN.

### Task 3: TG handoff with E2E screenshot

- [ ] Run the spec one more time, capture the AFTER screenshot (canvas frame
      still visible, an element selectable, no error overlay).
- [ ] Open the screenshot with Read. Verify visually that the canvas survived
      the discard and a click selects an element.
- [ ] TG report via `tg "..."` + screenshot via `tg --photo <path>
"caption"`. CLAUDE.md: no screenshot = bug not fixed.

## Hard Rules

- Read `../ext-test-projects/CLAUDE.md` before any extension E2E.
- Use the local `ralphex` CLI only. Never `RemoteTrigger` (CLAUDE.md).
- Worktree-isolated. Don't kill unrelated ralphex.
- Run e2e ONLY through `HYPER_E2E_SHARDS=1 bun run test:docker`.
- Telegram heartbeat every 15 min.

## Progress tracking

`.ralphex/progress/2026-05-08-canvas-crash-bulka-retry.txt`
