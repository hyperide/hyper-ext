# canvas-crash fix from stack trace

## Context

Two prior attempts to fix the canvas crash
(`TypeError: Cannot convert undefined or null to object at push (<anonymous>)`)
ended TASK_FAILED because the crash does **not** reproduce in headless Linux Docker.
It reproduces only on macOS with bulka-the-dog after Source Control "Discard All Changes".

`canvas-crash-capture-infra-ralphex-plan` shipped the missing observability:

- `process.on('unhandledRejection' | 'uncaughtException')` handlers in `activate()`
- NDJSON sink at `HYPERIDE_DIAGNOSTIC_ERROR_SINK` path
- Commands `hypercanvas.startDiagnosticCapture` / `hypercanvas.stopDiagnosticCapture`
- E2E harness (`bulka-canvas-discard-no-crash.spec.ts`) reads the same sink

This plan has two tracks that can proceed in parallel:

**Track A** — User-run macOS capture to get an actual stack trace, which unblocks the fix.
**Track B** — Investigate why Docker fails to repro (separate blocker for CI coverage).

## Overview

Track A gives us a stack trace within one user session (~10 min).
Track B may need several days of investigation but is a CI coverage win regardless.

Both tracks produce actionable output: Track A produces the exact file:line to fix;
Track B produces a Docker-reproducible repro or a root-cause explanation.

## Hard Rules

- Read `../ext-test-projects/CLAUDE.md` before any E2E work.
- Never `RemoteTrigger`. Ralphex is local CLI only.
- No "follow-up needed" placeholders — each task has an explicit deliverable.
- TG: never write file paths, always attach files via `tg --file <path> "caption"` (or `tg --photo` for screenshots).

---

## Track A — macOS capture → stack trace → fix

### Task A1: User runs capture and attaches the log

- [ ] Rebuild + install the extension from the current branch (this plan depends on
      the capture infrastructure being installed — run `/ext` command to build+install).
- [ ] Open VS Code Command Palette → "HyperIDE: Start Diagnostic Capture".
      Accept the default path (`~/.hyperide-diagnostics-<ts>.log`) or specify one.
      VS Code confirms "Diagnostic capture active…".
- [ ] Open Hyper Canvas on the bulka-the-dog project. Wait for the preview to render.
- [ ] In Source Control panel, click "Discard All Changes" (or use the SCM ⟳ button
      that calls `git.cleanAll`). Confirm the dialog.
- [ ] Wait 3–5 seconds. If the crash fires, the DiagnosticHub handler writes NDJSON
      to the sink file within milliseconds of the rejection.
- [ ] Open Command Palette → "HyperIDE: Stop Diagnostic Capture".
      VS Code shows stats: "Rejections: N, exceptions: M" and opens the log in an editor.
- [ ] Attach the `.log` file to a Telegram message via the `tg` CLI so the
      follow-up ralphex session can read it. Paste the path into a new plan comment:

      ```
      tg --file ~/.hyperide-diagnostics-<ts>.log "diagnostics log"
      ```

- [ ] If the log shows 0 rejections, the extension reload cleared the handler state —
      restart VS Code and repeat from the "Open Hyper Canvas" step without reloading
      in between.

### Task A2: Parse the stack trace and locate the call site

This task runs after the log file is attached. Ralphex reads the log and:

- [ ] Parse the NDJSON log. For each entry with `kind === 'unhandledRejection'`:
  - Extract `reason.stack`. The frame immediately after `at push (<anonymous>)` is
    the esbuild-bundled call site.
  - Map the bundled frame back to source using the `.map` file alongside `out/extension.js`.
    Command: `node --eval "
  const sm = require('source-map');
  const map = require('fs').readFileSync('out/extension.js.map', 'utf8');
  const sc = new sm.SourceMapConsumer(JSON.parse(map));
  const pos = sc.originalPositionFor({ line: <LINE>, column: <COL> });
  console.log(pos);
"`
    where `<LINE>` / `<COL>` come from the bundled frame.
- [ ] Identify the source file + line with the offending `.push(` or
      `Object.keys/entries/values/assign(` call.
- [ ] Write a minimal reproduction: call that function with `undefined` / `null`
      as argument, confirm TypeError fires.

### Task A3: Fix the call site

- [ ] Guard the identified call site: add a null-check or optional-chaining before
      the push/Object call. Prefer the narrowest guard — no blanket try/catch.
- [ ] Add a unit test in `vscode-extension/hypercanvas-preview/src/__tests__/` that
      calls the fixed path with `undefined` input and asserts no throw.
- [ ] Run `bun run typecheck` and `bun run test` in the extension package. Fix any
      errors.
- [ ] Rebuild + install the extension. Re-run the macOS repro manually to confirm
      the crash is gone (Start Capture → Discard All Changes → Stop Capture → log
      shows 0 rejections).
- [ ] Run the Docker e2e spec to confirm it still passes (it passes before the fix
      because Docker doesn't repro; it should continue passing after):

      ```bash
      cd ../ext-test-projects/e2e
      HYPER_E2E_SHARDS=1 bun run test:docker -- \
        --project="dep:bulka-the-dog" \
        tests/project-dependent/bulka-canvas-discard-no-crash.spec.ts
      ```

- [ ] Send a TG report with before/after screenshots via `tg --photo <path> "caption"`.
- [ ] Commit with message `fix(ext): guard push() call site — no crash on SCM discard`.
- [ ] Open a Linear ticket and link the commit. Close the ticket.

---

## Track B — Why doesn't Docker repro? Close the coverage gap.

### Task B1: Audit the discard trigger path in Docker vs macOS

The user-facing repro uses VS Code's "Discard All Changes" button, which internally
calls `git.cleanAll` → `git checkout -- <files>`. The Docker e2e uses
`execSync('git checkout -- <files>')` directly. The crash may not fire in Docker
for one of these reasons:

- [ ] **Hypothesis 1 — SCM watcher vs CLI git**: VS Code's git extension uses a
      FileSystemWatcher which fires `onDidChange` synchronously on inotify/kqueue
      events; the CLI `git checkout` bypasses the watcher debounce. On macOS
      kqueue the watcher fires before the file content is stable; on Linux inotify
      it fires after. Check `vscode-extension/src/extension.ts` for all
      `workspace.createFileSystemWatcher` calls that could fire during discard
      and trigger the offending code path.
      Deliverable: a comment in the spec explaining which watcher is involved.

- [ ] **Hypothesis 2 — HMR timing**: Vite dev server re-triggers HMR on file
      change; the extension may process `onDidChange` + HMR update simultaneously.
      On Docker the dev server may not be running for the bulka project when the
      discard fires (bulka bring-up regression — separate NEEDS LINEAR ticket).
      Check: does the bulka Docker run have a live Vite HMR connection at the
      moment `git checkout` runs? If not, that's why the watcher race doesn't
      manifest.
      Deliverable: log the dev-server state at discard time in the spec (already
      partially done via `setupPreviewWithDevServer`; add explicit assertion).

- [ ] **Hypothesis 3 — container FS isolation**: Docker container mounts the
      project dir as a bind mount. On macOS the inotify proxy (`fsevents`) over
      bind mounts has additional debounce delays not present in native macOS
      kqueue. This could suppress the watcher callback that triggers the crash.
      Deliverable: run the spec with `--headed` (if possible in Docker) and add a
      `console.log` in the onDidChange handler to confirm it fires during discard.

### Task B2: Add watcher-triggered discard via VS Code command (not raw git)

- [ ] Update `bulka-canvas-discard-no-crash.spec.ts` to attempt the discard via
      VS Code's built-in SCM command (`vscode.commands.executeCommand('git.cleanAll')`)
      instead of (or in addition to) raw `execSync`. This more faithfully replicates
      the user's macOS path.
      Note: `git.cleanAll` shows a confirmation dialog. Use
      `window.on('dialog', d => d.accept())` or set `git.confirmDiscard: false` in
      the test's `settings.json`.
- [ ] Confirm the new discard path fires `onDidChange` on the FileSystemWatcher by
      checking the diagnostic sink for any entry written within 500ms of the command.
      If the sink shows 0 entries during discard, the watcher is silent → update
      Hypothesis 1 comment accordingly.

### Task B3: Document findings and update the spec

- [ ] Add a `// Repro note:` block at the top of `bulka-canvas-discard-no-crash.spec.ts`
      explaining which hypothesis was confirmed or ruled out. Max 10 lines.
- [ ] If Docker now reproduces the crash (new `git.cleanAll` path), update the spec
      `// expected to fail RED` comment to reflect that the test catches the real bug.
- [ ] Commit with message `test(e2e): closer discard repro via SCM command + watcher audit`.

---

## Success criteria

- [ ] Track A: zero-rejection log after macOS repro with fix installed.
- [ ] Track B: spec comment documents the reproduction gap with a clear conclusion.
- [ ] `bulka-canvas-discard-no-crash.spec.ts` passes GREEN in Docker after both tracks land.
- [ ] TG confirmation with log + screenshot attached (no file paths in the message).
