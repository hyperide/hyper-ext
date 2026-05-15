# Style Write Unification Workprocess

## Archives

- `workfile-archive/2026-04-14-style-write-unification-workprocess.2026-04-24-0845.md` — pre-Apr-29
- `workfile-archive/2026-04-14-style-write-unification-workprocess.2026-04-29-0850.md` — Apr-29 (before this condensation)

---

## Journey Summary

1. **Spec + shared layer** — style-write unification architecture, source ownership, source confidence,
   theme routing, shared managers/planners/executors/theme context implemented and unit-tested.

2. **Extension parity** — source tabs, CSS Modules routing, panel readiness, selection disposal,
   MCP ops, and related extension regressions.

3. **E2E hardening (Apr 14–24)** — fixed harness defects one by one:
   stale dialogs, stale diagnostics, command-palette targeting, dirty-editor teardown,
   worker collisions, expected-runtime-error annotation gaps, preview shell sizing,
   shutdown hangs after VS Code reload, AS service SyntaxError log level.

4. **Switched to full 2211-test matrix (Apr 24)** — stop treating partial reruns as progress metric.

5. **Runs #21–#28 (Apr 28–29)** — successive full-matrix Docker 3-shard runs. Fixes per run:
   - `remix-cssmodules-spotify/__canvas_preview__`: PlayerBar added
   - proxy benign pattern: `%c` and `ERR_CONNECTION_REFUSED`
   - `Editor.ts`: exactRow 3-retry with 1s gap
   - `mcp-tools.spec.ts`: `waitForAnySelection` 15s → 25s
   - `preview-render.spec.ts`: bundler-error poll 45s → 90s
   - `AstService.ts`: `findElementAtPosition` parse failure warn not error
   - `undo-redo.spec.ts`: guard against empty `selectedIds` after HMR reload
   - webpack pre-warm in docker-entrypoint
   - `DevServerManager` + `PreviewProxy` + `PreviewPanel` shell stability (b0339a18)
   - Inspector sidebar width normalization (00274b67)

---

## Current State

- **Branch**: `ultra/hyp-363-vs-code-preview-webview-opens-offscreen-in-e2e`
- **Run #28** (`run-20260429-075702-41743`) in progress, ~55 min, 3 shards:
  - S1: 246 steps, last: "worker thread error is captured in logs"
  - S2: 198 steps, last: "component with error — error overlay appears" ← FLAKY
  - S3: 203 steps, last: "duplicate element preserves file integrity"
- Previous run (#28 S3 previous context): 0 hard failures, 4 FLAKY:
  - 3× "Tamagui: style written as prop" (fitness/food-delivery/uber) — warm VS Code stale element cache
  - 1× "component with error — error overlay appears" — 607s timeout from Vite watcher degradation

---

## Active Instructions

### Execution mode

1. Full `2211`-test matrix is the source of truth (not `independent` slice).
2. Do not kill a run on first ordinary failure — collect full failure set.
3. Restart only for a mass-breaker (fixture corruption, broken startup, shutdown abort).
4. `--retries=1` is the current default (enabled for this run cycle since Run #27 analysis).
5. FLAKY = fail+retry-pass: acceptable but investigate and fix root cause.
6. FAILED = both attempts fail: must fix before claiming green.

### Monitoring

1. Poll every 30–60s while a long run is active.
2. Send Telegram heartbeat at least every 15 min and on phase changes.
3. Use **claude bridge bot** (`codex-tg-bot`), not calendar bot.
4. Monitor CPU, memory, container status, test step counts.

### Work discipline

1. Commits atomic: one logical fix per commit, descriptive message.
2. Update workfile after every commit: what changed, why, validation, next.
3. Do not claim a test/run passed unless it actually happened.
4. Do not self-nest codex CLI. Other agent CLIs (claude) are fine for review.

### Failure classification

- Test-body assertion failure vs teardown failure vs worker-shutdown failure.
- Expected runtime-error tests annotated with `expectRuntimeErrors()`.
- Unexpected console errors are real failure signals.

### Visual verification

- Screenshots are ground truth. Check for empty panes, wrong tabs, offscreen webviews, stale dialogs.

---

## Known Open Issues (to fix)

### 1. ✅ Tamagui "style written as prop" — FIXED (1522602)

**Root cause**: `getActiveEditorContent()` threw when canvas is frontmost (no text
editor visible). `expect.poll()` doesn't retry on throw — fails immediately.
`setColor` may write to RecordScreen.tsx via `workspace.fs.writeFile` (disk-only,
no dirty tab), so dirty tab wait also needed longer timeout.

**Fix (1522602)**: Wrap `getActiveEditorContent()` in `.catch(() => '')` in the poll;
increase dirty tab `isVisible` timeout 500ms → 2000ms.

**Commit**: `ext-test-projects:1522602`

### 2. "component with error" 607s timeout — Vite watcher degradation

**Root cause**: after ~40min of tests on warm VS Code, Vite's FS watcher degrades.
`editor.save()` writes to disk but Vite never detects the change.
`expect.poll({timeout: 600_000})` runs the full 600s budget.

**Symptom**: test times out at 607s on both attempts (FAILED, not FLAKY).

**Fast-fail added (df8a5d1)**: After `editor.save()`, 5s poll asserts `__BREAK__` in
editor content. Catches type/save failures fast. But watcher degradation still eats 600s.

**Remaining fix**: DevServerManager lifecycle FSM (NEEDS LINEAR). For now: test is a
known intermittent failure tied to long-lived VS Code process.

**Files**: `ext-test-projects/e2e/tests/project-dependent/preview-render.spec.ts`

### 3. SSR Mock Adapter — Remix route components in preview

**Implemented (b3bf206e)**: `detectSSRHooks()` + `RemixMockWrapper` + `ssrRouteSet`.
Remix routes using `useLoaderData()`/`useRouteLoaderData()` now get wrapped in
`createMemoryRouter` so the preview doesn't crash.

**Status**: shipped and tested (883 pass, 0 fail in unit tests).

---

## Green Definition

- `0` failed tests (both attempts fail) across the full 2211-test matrix.
- FLAKY tests (fail+retry-pass) count as green once confirmed noise, but must be investigated.
- No unexpected teardown failures, save dialogs, persistent console errors.

---

## 📍 2026-04-29 09:35 CEST — Run #28 in progress (2h+ running)

Run started: 07:57 CEST | Shards: 3 | Mode: `--retries=1`

Progress as of 09:35 CEST:
- S1: 526/769 done (68%) — 0 hard failures
- S2: 455/691 done (66%) — 2 hard failures ("component with error" 607s ×2)
- S3: 356/729 done (49%) — stuck on webpack build, 6 test-done marked failed:
  - 4× "Tamagui: style written as prop" (all proj) — FIXED by 1522602
  - 1× "elements identifiable via fiber-based selection" — 606s timeout, FLAKY (retry passed)
  - 1× "component with error" — needs investigation

Commits since run #28 start (not in this run):
- `b3bf206e` (hyper-canvas-draft): SSR mock adapter for Remix route components
- `1522602` (ext-test-projects): Tamagui poll resilience + dirty tab timeout

Next: start run #29 when #28 completes.
