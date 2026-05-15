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

### 1. Tamagui FLAKY — stale element cache on warm VS Code

**Root cause**: warm VS Code reuses VS Code process across tests in same project group.
Extension element tree is cached from previous test's navigation state. After
`setupPreviewWithDevServer` refreshes the iframe, the extension doesn't re-scan
the elements tree. `setupWithElementSelected` clicks `treeItems.first()` which
may be a nested navigation screen (RecordScreen/HomeScreen/DriverMatchScreen)
instead of App.tsx's root element.

**Symptom**: "Tamagui: style written as prop, not className" fails on first attempt
(wrong file edited, different element type), passes on retry (fresh VS Code).

**Fix plan**: In `setupWithElementSelected` (`style-editing.spec.ts`), after
clicking first tree item, verify inspector has fill color control. If not
visible within timeout, pick next tree item. This ensures a styleable Tamagui
element is selected regardless of navigation state.

**Files**: `ext-test-projects/e2e/tests/project-dependent/style-editing.spec.ts`

### 2. "component with error" 607s timeout — Vite watcher degradation

**Root cause**: after ~40min of tests on warm VS Code, Vite's FS watcher degrades.
`editor.save()` writes to disk but Vite never detects the change.
`expect.poll({timeout: 600_000})` runs the full 600s budget.

**Symptom**: test times out at 607s on first attempt, passes on retry (fresh VS Code).

**Fix plan**: After `editor.save()` in `preview-render.spec.ts`, add fast-fail:
```typescript
await expect.poll(
  () => editor.getActiveEditorContent(),
  { timeout: 5_000, message: 'Editor should contain __BREAK__ after save' }
).toContain('__BREAK__');
```
This catches type/save failures in <5s. Vite watcher degradation still hits
600s timeout, but that's an extension-side issue (DevServerManager lifecycle).

**Files**: `ext-test-projects/e2e/tests/project-dependent/preview-render.spec.ts`

---

## Green Definition

- `0` failed tests (both attempts fail) across the full 2211-test matrix.
- FLAKY tests (fail+retry-pass) count as green once confirmed noise, but must be investigated.
- No unexpected teardown failures, save dialogs, persistent console errors.

---

## 📍 2026-04-29 Run #28 in progress

Run started: 07:57 CEST | Shards: 3 | Mode: `--retries=1`
Progress as of 08:55 CEST: S1=246, S2=198, S3=203 steps done
No hard failures confirmed yet.
Fixes to implement while run completes: issues #1 and #2 above.
