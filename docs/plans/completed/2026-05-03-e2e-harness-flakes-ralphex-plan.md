# E2E Harness Flakes Ralphex Plan

## Scope

- Lane: harness/flakes only.
- Repositories:
  - `/Users/ultra/work/hyper-canvas-draft`
  - `/Users/ultra/work/ext-test-projects`
- Latest artifact run:
  `/Users/ultra/work/ext-test-projects/e2e/docker-artifacts/run-20260503-full-after-bun-entry-patch/`
- Do not touch `client/components/ui/color-combobox.*`.
- Do not edit test assertions directly for this first fix.
- Do not kill existing `ralphex` processes.

## Artifact Evidence

The run summary in
`e2e/docker-artifacts/run-20260503-full-after-bun-entry-patch/shard-1/docker.log`
reports `6 flaky`, `165 skipped`, and `940 passed (2.9h)`.

Recurring patterns found in shard logs:

- VS Code workbench alert fetch noise:
  - `shard-1/docker.log:70481`:
    `%c  ERR color: #f33 Error: Fetch timeout: 20000ms`
  - `shard-1/docker.log:70485`:
    `at async M$e.fetchAlerts`
  - `shard-1/docker.log:75375`:
    `ExportNamedDeclaration — correct traversal order` failed only through
    `[test-errors]` with this VS Code workbench stack.
  - `shard-1/docker.log:75388`:
    `duplicate element preserves file integrity` failed with the same fetch
    alert stack plus `net::ERR_NAME_NOT_RESOLVED`.
- Vite HMR reload noise:
  - `shard-1/docker.log:74931`:
    `Cmd+S from iframe` failed through `[test-errors]` after a Vite 500 and
    `[vite] Failed to reload /src/App.tsx`.
  - Similar Vite reload triplets appear in both shards, for example
    `shard-2/docker.log:2232-2234` and `shard-2/docker.log:60209-60212`.
- Settings editor strict locator flake:
  - `shard-1/docker.log:75079-75081`:
    `locator('.editor-instance') resolved to 2 elements`, one in the normal
    editor group and one in `Modal Editor Area`.
  - Source reference: `e2e/tests/project-independent/settings.spec.ts:281`.
- Diagnostics teardown timeout:
  - `shard-1/docker.log:75371`:
    `Tearing down "diagnostics" exceeded the test timeout of 720000ms`.
- Bun refresh blocked client noise:
  - `shard-2/docker.log:64090-64091`:
    two `net::ERR_BLOCKED_BY_CLIENT` console errors.
  - `shard-2/docker.log:74346`:
    `preview refresh command — iframe reloads` failed only through those
    blocked-client console errors.

## Chosen First Fix

Add a narrow benign-runtime filter for VS Code workbench alert fetch failures.

Rationale:

- It caused two unrelated AST tests to be marked flaky.
- The stack is clearly VS Code workbench internals:
  `workbench.desktop.main.js`, `logAndRequest`, `doFetchAlerts`, and
  `fetchAlerts`.
- It is not emitted by the user preview, extension source, Vite, or the AST
  operation under test.
- The harness already has the exact owner for this kind of noise:
  `e2e/helpers/benign-runtime-errors.ts`.
- The fixture already routes console and diagnostic sink errors through that
  filter before failing tests:
  `e2e/fixtures/base.fixture.ts:525-553` and `e2e/fixtures/base.fixture.ts:639-648`.

Defer the settings strict-locator and diagnostics teardown timeout to separate
fixes. Both are valid, but the alert-fetch filter is smaller and removes two
false failures without changing test behavior.

## Execution Tasks

### Task 1: Implement Narrow Alert Fetch Filter

In `/Users/ultra/work/ext-test-projects`:

- [x] Update `e2e/helpers/benign-runtime-errors.ts`.
- [x] Add a helper `isVSCodeWorkbenchAlertFetchNoise(text: string)`.
- [x] Match all of the following:
  - `Error: Fetch timeout: 20000ms`
  - `workbench.desktop.main.js`
  - `logAndRequest`
  - `doFetchAlerts`
  - `fetchAlerts`
- [x] Add it to `isBenignRuntimeError`.
- [x] Do not filter generic `Fetch timeout`, generic `ERR_NAME_NOT_RESOLVED`, or
      generic resource-load failures.
- [x] Add tests in `e2e/helpers/benign-runtime-errors.test.ts`:
  - Positive: exact shard-1 workbench alert stack is benign.
  - Negative: an app or extension `Fetch timeout: 20000ms` without
    `fetchAlerts` remains non-benign.
  - Negative: `ERR_NAME_NOT_RESOLVED` alone remains non-benign.

### Task 2: Run Focused Harness Verification

Run the focused unit test and the project-dependent AST spec listed below.
Inspect the resulting log for `fetchAlerts`, `Fetch timeout: 20000ms`, and
`[test-errors]`. If a real product failure remains, stop and record it instead
of broadening the filter.

## Reproduce Command

Use the specific failed AST project because it produced both alert-fetch false
failures:

```bash
cd /Users/ultra/work/ext-test-projects/e2e
HYPER_E2E_SHARDS=1 bun run test:docker -- \
  --project="dep:react-vite-emotion-dashboard" \
  tests/project-dependent/ast-operations.spec.ts
```

Use this focused unit command before the E2E run:

```bash
cd /Users/ultra/work/ext-test-projects/e2e
bun test helpers/benign-runtime-errors.test.ts
```

## Verification

Expected unit verification:

- `bun test helpers/benign-runtime-errors.test.ts` passes.
- The new positive fixture returns `true`.
- Negative fixtures for app fetch timeout and plain name resolution failure
  return `false`.

Expected E2E verification:

- The AST command above does not fail through `[test-errors]` for
  `M$e.fetchAlerts`.
- The log still fails on real Vite, preview, extension, AST, or diagnostic
  errors.
- Grep after the run:

```bash
rg -n "fetchAlerts|Fetch timeout: 20000ms|test-errors" \
  /tmp/<run-log>.log \
  /Users/ultra/work/ext-test-projects/e2e/docker-artifacts/<new-run>/
```

## Follow-Up Candidates

- Add a settings page-object helper for the active non-modal settings editor,
  replacing raw `.editor-instance` strict locators in
  `e2e/tests/project-independent/settings.spec.ts`.
- Investigate `DiagnosticsSession.close()` teardown hangs. The likely owner is
  `e2e/helpers/diagnostics.ts`, where queued auto-capture work can still be
  draining while Playwright enters fixture teardown.
- Investigate whether Vite 500/HMR reload failures after edits are product
  failures or expected transient HMR noise. Do not globally filter these without
  proving the edited file is syntactically valid and final preview state is
  healthy.
- Add a narrow Bun runtime refresh filter only if the failing resource URL proves
  it is a browser/client refresh request unrelated to preview behavior.
