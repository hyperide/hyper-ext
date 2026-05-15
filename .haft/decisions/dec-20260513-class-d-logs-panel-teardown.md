---
id: dec-20260513-class-d-logs-panel-teardown
kind: DecisionRecord
version: 2
status: active
title: "Fix logs panel test teardown — frozen webview corrupts shared VS Code worker"
mode: standard
created_at: 2026-05-13T11:30:00Z
updated_at: 2026-05-13T11:30:00Z
links:
  - ref: prob-20260513-class-d-logs-panel-teardown
    type: addresses
  - ref: ES.RTP.001
    type: governs
---

# Fix logs panel test teardown — frozen webview corrupts shared VS Code worker

## 1. Problem Frame

`"logs panel opens after dev server stop"` in `dev-server.spec.ts:80` ran for **600,953ms (~10min)** in S3 (run-20260512-084158-98150), exceeding its 400s timeout. After the test, 5 subsequent tests failed with cascade 83s timeouts — the shared VS Code worker was left in a corrupt state.

**Root cause:** After `devServer.stop()`, the preview iframe tries to load `/test-preview` from a dead proxy. Fixture teardown calls `closePreview`, which awaits a webview bridge ACK that never arrives (frozen iframe). The teardown hangs until Playwright kills it (~200s after the test body timeout), leaving the shared worker with an open Hyper Canvas tab, stopped dev server, and potentially dangling file watchers from entry-file-watcher (`f898bcdd`).

The next test starts in this broken state and times out at its own limit.

## 2. Decision

**Selected:** Add explicit `cmd.runCommand('Hyper: Close Preview').catch(() => {})` at the end of the test body, before teardown runs. Also investigate DevServerManager for dangling async handles and entry-file-watcher disposal on stop.

**Why selected:** The teardown helper (`closePreview`) awaits a bridge ACK. After devServer.stop(), the webview is frozen and never sends the ACK. Closing the panel explicitly from the test body — while the test is still active and can fire commands — avoids the deadlock.

**Affected files:**
- `ext-test-projects/e2e/tests/project-dependent/dev-server.spec.ts`
- `vscode-extension/hypercanvas-preview/src/services/DevServerManager.ts` (if dangling handles found)
- `ext-test-projects/e2e/helpers/setup-preview.ts` (if closePreview timeout is missing)

**Forbidden:**
- Increasing timeouts without fixing root cause
- Changes to other test files

**Evidence requirements:**
- `HYPER_E2E_SHARDS=1 bun run test:docker --grep "logs panel opens after dev server stop"` — completes in ≤120s
- `[fixture-timing]` lines in docker.log: "Close Preview" teardown completes in <5s
- The 5 D2 cascade victims (fiber-based selection, nested components, ExportNamedDeclaration, duplicate element preserves integrity, insert element) all pass in the same shard run

## 3. Rationale

**Counterargument:** Fixing DevServerManager to signal the preview webview on stop (so it can close itself cleanly) would be the complete fix. Rejected for this commission: it requires extension changes + rebuild + E2E cycle. The test-body explicit close is sufficient to unblock the cascade and can land immediately.

**Rejected alternatives:**
| Variant | Verdict | Reason |
|---------|---------|--------|
| Add 10s timeout to closePreview | Rejected | Still leaves shared worker in unknown state after timeout. |
| Remove the test | Rejected | Logs panel behavior is a real feature. |
| Fix DevServerManager webview signalling | Deferred | Valid long-term fix; separate Linear ticket. |

**Weakest link:** Entry-file-watcher (`f898bcdd`) may hold a file watcher after devServer.stop() that prevents clean GC of the extension host. If cascade persists after the test-body fix, investigate watcher disposal in DevServerManager.stop().

## 4. Consequences

**Rollback plan:**
- If `cmd.runCommand('Hyper: Close Preview')` itself hangs after devServer.stop(): add `.catch(() => {})` + `window.waitForTimeout(2000)` as a time-bounded best-effort close.

**Refresh triggers:**
- Changes to DevServerManager teardown or PreviewPanel close logic
- Entry-file-watcher disposal changes
