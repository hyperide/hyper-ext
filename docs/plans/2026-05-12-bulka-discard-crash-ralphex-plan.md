# bulka discard crash — test fix + watcher verification

## Context

### The original bug

On bulka-the-dog, clicking "Discard All Changes" in VS Code Source Control while Hyper
Canvas is open crashes the extension host:

```
[Extension Host] [HyperIDE] Unhandled rejection in extension host:
  TypeError: Cannot convert undefined or null to object
    at push (<anonymous>)
```

After the crash the canvas iframe is dead and selection stops working.

### What was implemented so far

The original plan (`2026-05-08-canvas-crash-on-discard-ralphex-plan.md`, Tasks 1-4)
produced:

- **Task 1**: `process.on('unhandledRejection')` handler in extension host writes NDJSON
  to `diagnostic-errors.log` so Playwright can read it.
- **Task 2/3**: static audit of all `Object.{keys,assign,push,...}` call sites in
  `vscode-extension/src/`. Null-guarding added at the throwing site (or the upstream
  that produced undefined).
- **Task 4** (commit f898bcdd): entry-file-watcher. When the user discards `App.tsx`
  (or the detected router/entry file) via SCM, the `@hyperide-managed` route marker is
  removed from the file and the iframe gets a React Router 404. Fix: `extension.ts`
  calls `setupEntryFileWatcher(workspaceRootPath, modeManager)` which creates a
  `vscode.workspace.createFileSystemWatcher` on both the detected router file and the
  entry file. On `onDidChange`, debounced 300ms: `mgr.onComponentSelected()` +
  `previewPanel.refresh()`.

For bulka specifically:
- `index.html` has `<script src="/client/main.tsx">` → `_detectFrontendRoot()` returns
  `'client'`.
- `detectRouterFile()` checks `client/App.tsx` first → contains `BrowserRouter` →
  returns it. Watcher target is correct.

### The test infrastructure issue (hypothesis)

Test `bulka-canvas-discard-no-crash.spec.ts` fails BOTH retries in shards 2 and 3 in
Docker run-20260512-002106-89890.

The diagnosis says: `setupPreviewWithDevServer(window)` is called without an explicit
component file path. Auto-detection reads `testInfo.project.use.projectDir` via
`getCurrentProjectDir()`, which returns `'bulka-the-dog'` for the `dep:bulka-the-dog`
Playwright project. `resolveDefaultComponentFile` then checks `vite-react-ssg` in
bulka's package.json (present), finds `client/pages/Index.tsx` — so it should already
return the correct path.

**However**, this is unconfirmed. The actual failure mode in Docker may be different:
- The canvas loads the wrong component (explicit path would fix it).
- Or the entry-file-watcher does not re-patch after discard (watcher or repatch logic bug).
- Or the unhandled rejection from Tasks 2/3 is still firing on bulka-specific code path.

Task 1 below eliminates auto-detect as a variable by passing the path explicitly. If
that alone doesn't make the test GREEN, Task 2 adds diagnostic logging to find the
actual root cause.

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` first — mandatory before any e2e.
- Run e2e ONLY via `HYPER_E2E_SHARDS=1 bun run test:docker`. Never `bun run e2e`.
- Write progress to `.ralphex/progress/progress-2026-05-12-bulka-discard.txt`.
- Telegram heartbeat every 15 min.
- After any failed/interrupted Docker run: `pkill -9 -f <user-data-dir-prefix>` before
  retrying — do NOT leave zombie Electron/Playwright processes.
- NEVER `TaskOutput(block: true)`. Use `tail -20 <output-file>` to read bg task output.

Main worktree: `/Users/ultra/work/hyper-canvas-draft`

## Task 1: Fix test infrastructure — pass explicit component path

**File**: `/Users/ultra/work/ext-test-projects/e2e/tests/project-dependent/bulka-canvas-discard-no-crash.spec.ts`

Line 95:
```ts
const { canvas } = await setupPreviewWithDevServer(window);
```

Change to:
```ts
const { canvas } = await setupPreviewWithDevServer(window, 'client/pages/Index.tsx');
```

Rationale: `resolveDefaultComponentFile` already returns `client/pages/Index.tsx` for
bulka via the `vite-react-ssg` detection branch, so this change is semantically
identical to current behavior. Its value is to eliminate auto-detect as a variable and
make the test's intent explicit — the canvas must open on bulka's Index.tsx, not
whatever auto-detect produces if the detection logic changes.

Steps:
- [ ] Edit the spec file, change line 95.
- [ ] Rebuild and install the extension (needed if extension.ts changed since last
  Docker build — check `git log --oneline -5 vscode-extension/`; if any recent commits,
  run `/ext` skill to rebuild).
- [ ] Run test in Docker:
  ```bash
  cd /Users/ultra/work/ext-test-projects/e2e
  HYPER_E2E_SHARDS=1 bun run test:docker -- \
    --project="dep:bulka-the-dog" \
    tests/project-dependent/bulka-canvas-discard-no-crash.spec.ts
  ```
- [ ] Capture output with `tail -80`.

### If test is GREEN → skip Task 2, go to Task 3.

### If test still FAILS → proceed to Task 2 (diagnose).

Note which assertion failed:
- Step 5 ("no unhandled rejection during discard"): crash still happening → fix from
  Tasks 2/3 of the original plan is missing or broken.
- Step 6 ("preview iframe alive after discard"): canvas dead → watcher didn't repatch.
- Step 7 ("__canvas_preview__.tsx exists"): file was deleted by discard path → not
  the current test scenario (test only discards tracked files, not __canvas_preview__).
- Step 8 ("h1#hero-title clickable"): element not found → either canvas shows wrong
  page, or canvas is dead.

## Task 2: Diagnose if Task 1 didn't fix it

If test still fails, add diagnostic logging BEFORE re-running:

### 2a: Confirm which component is open in VS Code

Add a `console.log` or read `resolvedComponentFile` from `setupPreviewWithDevServer`
output. Confirm VS Code editor opened `client/pages/Index.tsx` (not `App.tsx` or
something from another project).

### 2b: Confirm watcher setup for bulka

In `extension.ts`, `setupEntryFileWatcher` resolves both router and entry files via
`detectRouterFile()` and `getEntryFilePath()`. Add temporary debug logging:
```ts
console.log('[HyperIDE] setupEntryFileWatcher routerFile:', routerFile);
console.log('[HyperIDE] setupEntryFileWatcher entryFile:', entryFile);
```
These appear in the extension host output and are captured by Playwright's console sink
in `base.fixture`. After adding: rebuild extension, re-run test, grep output for
`setupEntryFileWatcher`.

Expected: `routerFile` should end with `bulka-the-dog/client/App.tsx`, `entryFile`
with `bulka-the-dog/client/main.tsx`.

### 2c: Check if onComponentSelected fires after discard

Add logging at the start of `scheduleRepatch` callback in `setupEntryFileWatcher`:
```ts
console.log('[HyperIDE] entry-file-watcher: scheduleRepatch triggered');
```
If this log does NOT appear in the test output after the `execSync('git checkout -- ...')`
step, the watcher event is not firing.

### 2d: Confirm unhandled rejection path

If Step 5 ("no unhandled rejection") fails: the diagnostic sink should have NDJSON
entries. Grep output for `unhandledRejection`. Map the stack to the source file (the
unhandled rejection was the original bug — Tasks 2/3 of the first plan should have
fixed it, but bulka may hit a different code path than the static audit covered).

### Fix based on diagnosis

Based on findings:
- Wrong component: check if `vite-react-ssg` detection worked; fix `resolveDefaultComponentFile` if not.
- Watcher not firing: check `RelativePattern` uses correct workspace root vs. absolute
  path. `entryWatcherDisposables` may be getting disposed before the test runs
  (e.g., `syncWorkspaceRuntime` called again by a worspaceFolders change event).
- `onComponentSelected` fires but iframe still dead: `previewPanel?.refresh()` may be
  getting skipped if `previewPanel` is null at that point. Add null check log.
- Unhandled rejection: capture stack from diagnostic sink, map to source, apply
  targeted null-guard.

After fix: rebuild + re-run.

## Task 3: Verify GREEN in Docker

Run one final clean Docker run with `HYPER_E2E_SHARDS=1`:
```bash
cd /Users/ultra/work/ext-test-projects/e2e
HYPER_E2E_SHARDS=1 bun run test:docker -- \
  --project="dep:bulka-the-dog" \
  tests/project-dependent/bulka-canvas-discard-no-crash.spec.ts
```

- [ ] Both attempts (no retry needed) must show PASSED.
- [ ] Screenshot saved at `/tmp/bulka-canvas-discard-no-crash.png` by the test.
- [ ] Open screenshot with Read tool. Visually confirm: preview frame still rendered,
  h1 element selected, no error toast.

## Task 4: TG report

Send to Telegram via `send-tg-report.sh`:
- What failed (test infrastructure / watcher / rejection).
- What was fixed (explicit path and/or watcher fix).
- Before screenshot (Docker run showing RED) if available from run-20260512-002106-89890.
- After screenshot: the post-discard canvas with h1 selected.

No screenshot = bug not fixed (per CLAUDE.md feedback rule).
