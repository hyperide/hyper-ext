# canvas-crash retry v2 — capture infrastructure first

## Context

Previous canvas-crash ralphex sessions (`8a057900`-era + 2026-05-08-canvas-crash-bulka-retry)
both ended TASK_FAILED with the same root reason: **the unhandled rejection
`TypeError: Cannot convert undefined or null to object at push (<anonymous>)`
does NOT reproduce in headless Linux Docker — it only repros on the user's
local macOS Hyper Canvas with bulka after Source Control "Discard All Changes"**.

Static audit of `vscode-extension/src/` revealed all `Object.{keys,entries,values,assign}`
+ `.push(` call sites are guarded. The throwing frame must live in bundled `out/`
(post-esbuild) or a third-party dep, but pinpointing it requires a runtime stack
which we don't have.

## Scope

Build the missing capture infrastructure so the next debug iteration has a stack
trace to work with. Ship a hyper-canvas extension feature gated to debug builds:
"capture all extension-host unhandledRejection events to a structured file".
Then the user (or a follow-up ralphex) has the file/line to fix.

Out of nothing. If the work needs to land in shared/, ext-test-projects, or
both — do it. If it needs new commands, add them. If a Linear ticket needs to
be filed, file it. No "follow-up needed" placeholders.

### Task 1: Add `unhandledRejection` capture to extension `activate()`

- [x] In `vscode-extension/hypercanvas-preview/src/extension.ts` `activate()`,
      register `process.on('unhandledRejection', (reason) => { ... })`.
- [x] Reason is typed `unknown` — log:
      - reason if instanceof Error: `{ name, message, stack }`
      - reason as string otherwise: `JSON.stringify(reason)`
- [x] Always write to `OutputChannel('HyperIDE Diagnostics')`. If the env var
      `HYPERIDE_DIAGNOSTIC_ERROR_SINK` is set (a file path), also append-write
      `JSON.stringify({ ts, kind: 'unhandledRejection', reason: serialized })`
      followed by `\n`.
- [x] Mirror the same for `process.on('uncaughtException', ...)`.
- [x] Remove handler on `deactivate()`.
- [x] Unit test the serializer with a few Error/object/primitive cases in
      `vscode-extension/.../src/__tests__/`.

### Task 2: Add user-facing capture command

- [ ] Add a command `hypercanvas.startDiagnosticCapture` that:
      - asks for an output file path (default `~/.hyperide-diagnostics-<ts>.log`)
      - sets `HYPERIDE_DIAGNOSTIC_ERROR_SINK=<path>` for the current session
        (via `process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK = path`)
      - shows an information notification "Diagnostic capture active. Reproduce
        the bug, then run 'Stop Diagnostic Capture' to finish."
- [ ] Add a `hypercanvas.stopDiagnosticCapture` command that clears the env
      var, opens the resulting log in a new editor tab, and shows summary
      stats (count of unhandled rejections, count of exceptions).
- [ ] Wire both to package.json `contributes.commands` + Command Palette.
- [ ] Document in README/AGENTS the manual repro path: start capture →
      open Hyper Canvas on bulka → discard changes via SCM → stop capture →
      paste the log into a follow-up plan.

### Task 3: Make the e2e harness use the same capture sink

- [ ] In `ext-test-projects/e2e/fixtures/base.fixture.ts` (or the Docker
      entrypoint), set `HYPERIDE_DIAGNOSTIC_ERROR_SINK` to a per-test path
      under the test artifacts directory.
- [ ] Update `bulka-canvas-discard-no-crash.spec.ts` (already merged) to read
      that file at the end of the test and assert it's empty (or contains no
      rejections beyond a known-allowlist).
- [ ] If the spec's diagnostic-error pipeline already exists (it does — see
      `extension-diagnostic-errors.log` in artifacts), reuse it; just thread
      the new `unhandledRejection` events through.

### Task 4: Propose canvas-discard reproduction strategy

- [ ] Manual repro is the only known path until Linux+Docker reproduces. Open
      a follow-up plan describing two angles:
      1. User runs the capture command on macOS, attaches the log to a TG
         message and a follow-up `2026-05-08-canvas-crash-fix-from-stack.md`
         plan.
      2. Investigate why bulka-on-Docker doesn't repro — could be `git checkout`
         vs SCM `cleanAll` triggering different watchers, or HMR timing on
         vite-vs-webpack.

### Task 5: Telegram handoff (FILES, not paths)

- [ ] TG report via `send-tg-report.sh` summarising what landed.
- [ ] Send the new plan FILE itself via `send-tg-file.sh` (NOT a path string —
      CLAUDE.md rule). Same for the merged commit summary log if useful.
- [ ] If e2e capture proves a clean baseline (no spurious rejections), send
      that artifact via `send-tg-file.sh ... --photo` if it's a screenshot, or
      `send-tg-file.sh` for the log file.

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD: unit tests for the serializer are mandatory.
- Use the local `ralphex` CLI only. Never `RemoteTrigger` (CLAUDE.md).
- This ralphex run is isolated. Do not touch other worktrees, do not kill
  unrelated ralphex processes.
- Investigate before deleting. CLAUDE.md "Dead code".
- Run e2e ONLY through `HYPER_E2E_SHARDS=1 bun run test:docker`.
- TG: NEVER write file paths in messages — always attach the file via
  `send-tg-file.sh`. CLAUDE.md "Скриншоты и файлы — прикладывать, не писать
  пути".
- Telegram heartbeat every 15 min.

## Progress tracking

`.ralphex/progress/2026-05-08-canvas-crash-capture-infra.txt`
