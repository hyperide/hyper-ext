# logs panel — dev server stop corrupts shared VS Code worker

## Context

### The test

`"logs panel opens after dev server stop"` in `tests/project-dependent/dev-server.spec.ts:80` (PD-2-7).

```typescript
test('logs panel opens after dev server stop', async ({ window }) => {
  test.setTimeout(400_000); // devServer.stop() leaves extension in cleanup state; teardown takes ~3min
  
  const { cmd } = await setupPreviewWithDevServer(window);
  const devServer = new DevServerControls(window);
  await devServer.stop();
  await cmd.runCommand('Hyper: Open Logs');
  const logs = new LogsPanel(window);
  const logCount = await logs.getLogCount();
  expect(logCount).toBeGreaterThanOrEqual(0);
});
```

The `test.setTimeout(400_000)` is intentional — the author knew that after `devServer.stop()`, teardown takes ~3 minutes.

### What's failing

S3 original (run-20260512-084158-98150): the test ran for **600,953ms (~10 minutes)**, which exceeds its 400s timeout. This suggests the test body eventually timed out at 400s, but the fixture teardown then ran for an additional ~200s before Playwright killed it.

After this test, 5 subsequent tests in the same shard failed with cascade timeouts (D2 victims) — all of them hit their own 83s timeouts instead of running normally. This pattern indicates the shared VS Code worker state is corrupted after the logs panel test.

### Root cause analysis

`DevServerManager.stop()` implementation (`src/services/DevServerManager.ts:349-391`):
- Sends SIGTERM → waits up to 5s → SIGKILL fallback → resolves
- Sets `_status = 'stopped'`
- Stops the preview proxy (`_stopProxy()`)

The stop itself is bounded (5s max). The problem is **what happens after stop in the shared VS Code worker**.

After `devServer.stop()`:
1. The preview panel is still open (tab is visible)
2. The preview iframe is trying to load `/test-preview` which is now served by a dead proxy
3. The extension host may still have async callbacks or watchers registered against the dead process

When the test ends and fixture teardown begins:
- **"Close Preview"** step tries to close the Hyper Canvas webview tab
- The webview may be frozen (iframe showing a connection error, no response to close)
- If `closePreview` implementation awaits a bridge ACK from the webview, it will hang until Playwright's fixture timeout

After the fixture teardown times out, the shared VS Code worker is left with:
- Hyper Canvas tab still open (or in an unknown state)
- Dev server stopped but extension state not reset
- Possible dangling file watchers from entry-file-watcher (commit f898bcdd)

The next test then starts in this broken state and fails at its own 83s timeout.

## Scope

**Allowed:**
- `ext-test-projects/e2e/tests/project-dependent/dev-server.spec.ts` — fix test teardown so it doesn't corrupt shared worker
- `vscode-extension/hypercanvas-preview/src/services/DevServerManager.ts` — if cleanup logic is missing
- `ext-test-projects/e2e/helpers/setup-preview.ts` — if closePreview helper hangs after devServer.stop()

**Forbidden:**
- Increasing timeouts without fixing root cause
- Changes to other test files

## Tasks

### Task 1: Identify where teardown hangs

- [ ] Add timing logs to the test: capture timestamps at start, after `devServer.stop()`, after `runCommand('Hyper: Open Logs')`, after `getLogCount()`, and at test end. Rerun to see which step takes the most time.
- [ ] Check `DevServerManager.ts` for pending async operations after stop (open file handles, pending promises, event listeners on the dead process) that could keep the extension busy
- [ ] Check `PreviewPanel.ts` (or equivalent) for the `closePreview` implementation — does it await a webview response? What's its timeout?
- [ ] Check if `setupEntryFileWatcher()` (added in f898bcdd) is properly disposed when devServer stops, or if it holds a reference that prevents clean teardown

### Task 2: Fix the teardown hang

Based on Task 1 findings, most likely fix:

**In the PD-2-7 test body, explicitly clean up before teardown:**

```typescript
test('logs panel opens after dev server stop', async ({ window }) => {
  test.setTimeout(400_000);
  
  const { cmd } = await setupPreviewWithDevServer(window);
  const devServer = new DevServerControls(window);
  await devServer.stop();
  
  await cmd.runCommand('Hyper: Open Logs');
  const logs = new LogsPanel(window);
  const logCount = await logs.getLogCount();
  expect(logCount).toBeGreaterThanOrEqual(0);
  
  // Explicit cleanup: close the preview panel before teardown runs.
  // Without this, the fixture teardown hangs trying to close a frozen webview.
  await cmd.runCommand('Hyper: Close Preview').catch(() => {/* already closed */});
  await window.waitForTimeout(500);  // brief settle
});
```

**If DevServerManager has dangling handles:**
- In `DevServerManager.stop()`, after killing the process: call `this._fileWatchers?.forEach(w => w.dispose())` (or equivalent) to release any watcher references
- Ensure `_previewProxy.stop()` is idempotent (can be called multiple times without hanging)

**If entry-file-watcher causes teardown hang:**
- In `setupEntryFileWatcher()`, return a disposable; dispose it inside `DevServerManager.stop()` or `DevServerManager.dispose()`

- [ ] Implement the cleanup fix
- [ ] `bun run typecheck` in `vscode-extension/hypercanvas-preview/`

### Task 3: Verify the cascade is eliminated

- [ ] Build extension: `/ext` skill
- [ ] Run full shard with the project that has this test: `HYPER_E2E_SHARDS=1 bun run test:docker`
- [ ] Confirm `logs panel opens after dev server stop` completes in <400s AND passes
- [ ] Confirm the 5 previously-cascading tests (ET fiber-based selection, nested components, ExportNamedDeclaration traversal, duplicate element preserves integrity, insert element) all pass
- [ ] Check `[fixture-timing]` lines in docker.log — "Close Preview" teardown should complete in <5s after the fix
- [ ] Send TG report: test time before/after, cascade victim status

## Acceptance criteria

1. `logs panel opens after dev server stop` completes in ≤120s (not 600s)
2. Fixture teardown completes cleanly (no frozen webview hang)
3. The 5 D2 cascade victims continue to pass in the same shard run
4. `test.setTimeout(400_000)` may remain as a safety net, but actual runtime should be ≤2min
