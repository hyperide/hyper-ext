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
- **Run #29** (`run-20260429-110015-36155`) in progress, ~42 min:
  - S1: 163 tests, MEM 1.5GiB/6GiB, drag-reorder tests
  - S2: 155 tests, MEM 1.6GiB/6GiB, project-dependent empty/nested
  - S3: 192 tests, MEM 3.4GiB/6GiB, tamagui-style tests — healthy
  - 0 hard failures detected in any shard

### Test Matrix: Projects That NEVER Ran (run #28 OOM)

Run #28 S3 was killed at worker 62 (OOM). As a result, ~280 tests never executed:

**5 supported projects (×~40 tests each = ~200 tests)**:
- `webpack-react-cssmodules-spotify` — 0 test results
- `webpack-react-emotion-dashboard` — 0 test results
- `react-vite-sass-portfolio` — 0 test results
- `bun-tw-shadcn-sample` — 0 test results
- `nextjs-tw-sample` — 0 test results
- `webpack-react-tw3-kanban` — partial (killed mid)

**12 unsupported projects (~60 tests total)**:
react-vite-stylex, vanilla-extract, pandacss, unocss, mui, fluentui, antd, chakra, mantine, nextui, remix-mui, remix-antd — all 0

Run #29 with `--memory-swap -1` is the first run that should cover all of these.

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
5. **Any user question → background research → answer in Telegram** (`/Users/ultra/xp/codex-tg-bot/scripts/send-tg-report.sh`).
   User reads chat from phone. TG answer is mandatory — not optional, not "instead of inline". Russian, detailed (3-6 sentences, key numbers, root cause, next steps). Never dump raw logs.

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

### 2. ⚠️ ast-operations 606s timeouts — S3 OOM-induced (run #28)

**Root cause**: `setupPreviewWithDevServer()` polls up to 600s for dev server ready.
Under OOM-induced memory pressure (workers 63-68 in S3), webpack page-thrashed for 600s
without ever completing compilation → preview never loaded → timeout.

**Tests**: `ast-operations.spec.ts:58/89/106`:
- "elements identifiable via fiber-based selection (replaces data-uniq-id)"
- "nested components — multiple selectors found"
- "ExportNamedDeclaration — correct traversal order"

Both attempts failed at ~606s (HARD FAIL in run #28 S3).

**Expected fix**: run #29 with `--memory-swap -1` prevents OOM → webpack compiles normally.
These tests should pass in run #29. If they still fail → investigate separately.

**Status**: monitoring in run #29.

### 3. "component with error" 607s timeout — Vite watcher degradation

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

## 📍 2026-04-29 10:25 CEST — Run #28 final

### Run #28 Results (run-20260429-075702-41743)

- **S1**: DONE — **1 FAILED**, 10 FLAKY, 744 passed (2.5h)
  - FAILED: `undo-redo.spec.ts:341` — "redo limit — no redo after new edit" — 8s wait for redo-stack clear not enough under Docker watcher lag (watcher fires 7-9s after write)
  - FLAKY: "explorer component cache is rebuilt after extension reload" — error-handling
  - FLAKY: "worker thread error is captured in logs" — error-handling
  - FLAKY: "Typing in inspector input → canvas remains functional" — keybindings
  - FLAKY: "Setting change takes effect immediately", "autoStart false", "Model override", "Custom baseURL", "Backend for proxy/opencode" — settings timing (5 tests, all share VS Code instance, settings propagation lag)
  - FLAKY: "open preview command works" — smoke (extension activation timing)
  - FLAKY: "fallback saves file before undo" — unexpected `[useStyleSync] Element not found` console error (transient HMR race)
- **S2**: DONE — **1 FAILED**, 3 FLAKY, 425 passed (2.0h)
  - FAILED: `project-switching-stale-preview.spec.ts:118` — "switching from Twitter to Tamagui food delivery" — file picker returned AppContainer.tsx instead of App.tsx after workspace switch (VS Code indexer lag)
  - FLAKY: "component with error" ×2 (react-vite-tw3-kanban, react-vite-cssmodules-spotify) — 607-608s → retry pass
  - FLAKY: "Tamagui: style written as prop" (tamagui-banking) — strict mode violation → retry pass
- **S3**: KILLED — 360/729 — memory exhausted at worker 62+; 5 HARD FAILS (3 webpack 606s, 2 Tamagui prop)

### Root Cause Analysis (Run #28)

**S1 hard failure** — `redo limit`: VS Code file watcher fires 7-9s after write under 3-shard Docker load. The 8s fixed wait for `recordEdit()` to clear the redo stack is insufficient. REDO executes before stack is cleared.

**S2 hard failure** — `project-switching-stale-preview`: VS Code file indexer lags 10-30s after workspace switch. 3×1s retry in file picker insufficient.

**S3 webpack failures** — Memory exhaustion: by worker 62, container has 6.6GB used + swap full. webpack second compile page-thrashes for 285s instead of 1-2s.

**Vite "component with error" FLAKY** — Vite HMR watcher degrades under memory pressure, retry gets fresher state.

### Fixes Applied (not in run #28, landed for run #29)

| Commit | Repo | Fix |
|--------|------|-----|
| `1522602` | ext-test-projects | Tamagui poll resilience + dirty tab 500ms→2000ms |
| `b3bf206e` | hyper-canvas-draft | SSR mock adapter for Remix routes |
| `804eea3` | ext-test-projects | Vite refresh fallback: HMR 60s → force refresh → 180s |
| `08ed413` | ext-test-projects | Editor.ts file picker: 3×1s retry → 6×3s (post-workspace-switch) |
| `4f802bd` | ext-test-projects | docker --init + --memory-swap -1 |
| `a1ac0698` | hyper-canvas-draft | ext v0.1.29 built |
| `6df6548` | ext-test-projects | undo-redo: redo-stack wait 8s→15s for Docker watcher lag |

---

## 📍 2026-04-29 11:00 CEST — Run #29 launched

Run ID: `run-20260429-110015-36155` — 3 shards, all started at 11:00 CEST.

```bash
HYPER_E2E_SHARDS=3 HYPER_E2E_BUILD_IMAGE=0 bash e2e/scripts/docker-parallel-run.sh
```

**Note**: Added `HYPER_E2E_BUILD_IMAGE=0` to skip Docker image rebuild. There's a timezone
conversion bug in the image freshness check (`date -j` interprets Docker's UTC timestamp as
local CEST time → image appears 2h older than it is → unnecessary rebuild). The entrypoint
is bind-mounted at runtime so skipping the rebuild is safe.
