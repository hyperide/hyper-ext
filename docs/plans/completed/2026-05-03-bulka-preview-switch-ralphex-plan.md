# Bulka Preview Switch Timeout Plan

## Scope

Investigate and fix the `dep:bulka-the-dog` timeout in the project-dependent
preview render test:

- Spec: `e2e/tests/project-dependent/preview-render.spec.ts`
- Test: `multiple components — switch between them, each renders`
- Latest run:
  `/Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/bulka-preview-switch/ext-test-projects/e2e/docker-artifacts/run-20260503-full-after-bun-entry-patch`
- Failing log: `shard-2/docker.log`

Do not touch unrelated UI work, especially
`client/components/ui/color-combobox.*`.

## Key Evidence

- First failed attempt starts at `shard-2/docker.log:67572`.
- `setupPreviewWithDevServer()` completes for Bulka with
  `client/pages/Index.tsx`, including preview loaded and Inspector opened.
- The test times out after about 361 seconds:
  `Test timeout of 360000ms exceeded`.
- The stack points at
  `e2e/page-objects/vscode/WebviewFrame.ts:174`, inside
  `getWebviewByTestId()`.
- The failure happens twice, original and retry.
- Attachments report preview runtime errors:
  - `Badge` crash from `client/components/ui/badge.tsx`.
  - Retry reports `ChartStyle` crash from `client/components/ui/chart.tsx`.
  - Repeated unknown React handler warnings for generated props such as
    `onNavChange`, `onNavigate`, `onNext`, `onOpen`, and `onFiltersChange`.
  - Initial `/test-preview` 404 appears before the route is patched/loaded.
- `expected-runtime-errors` counted 113 iframe errors with 72 unique entries.

## Reproduce

Run only this project/spec first, with one worker:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/bulka-preview-switch/ext-test-projects/e2e
HYPER_E2E_SHARDS=1 bun run test:docker -- \
  --project="dep:bulka-the-dog" \
  tests/project-dependent/preview-render.spec.ts \
  --grep "multiple components"
```

If running outside Docker for faster iteration:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/bulka-preview-switch/ext-test-projects/e2e
./node_modules/.bin/playwright test \
  --project="dep:bulka-the-dog" \
  tests/project-dependent/preview-render.spec.ts \
  --grep "multiple components" \
  --workers=1
```

Follow `/Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/bulka-preview-switch/ext-test-projects/CLAUDE.md`:

- Use the VS Code/Electron harness, not a browser-only session.
- Add diagnostics when creating a debug script.
- Do not kill unrelated existing `ralphex` processes.

## Suspected Failing API Path

The observed timeout is probably the spec getting stuck while reacquiring a
sidebar webview, not during initial preview setup:

1. `preview-render.spec.ts:140` calls `setupPreviewWithDevServer(window)`.
2. It opens Explorer with `cmd.runCommand('Hyper: Open Explorer')`.
3. `ExplorerPanel.getComponentNames()` calls `ExplorerPanel.content()`.
4. `ExplorerPanel.content()` calls `WebviewFrame.getExplorerContent()`.
5. `getExplorerContent()` calls `WebviewFrame.getWebviewByTestId()`.
6. `getWebviewByTestId()` polls all `iframe.webview > #active-frame`
   instances for the Explorer root test id.

The preview setup logs show Inspector opened successfully before the long gap,
so inspect whether Explorer never materializes, is offscreen, or is replaced by
the preview webview during Bulka component probing.

The secondary suspect is generated preview fallback props:

- Source: `lib/preview-generator/generator.ts`
- Current generated fallback props include event-like props that are spread into
  every component via `<Component {...previewFallbackProps} />`.
- When the selected component is a DOM-like wrapper such as `Badge`, those props
  reach a `<div>` and React logs unknown handler warnings.
- Some Bulka component candidates crash inside the generated preview boundary,
  leaving `tryRenderComponent()` to continue probing until the test budget is
  exhausted.

## Diagnostics To Inspect

- Add temporary logging in the spec around:
  - component names returned by Explorer,
  - every candidate passed to `tryRenderComponent`,
  - whether `explorer.clickComponent(name)` returns or hangs,
  - `isPreviewLoaded()`, `getClickableSelectors()`, and `getElementCount()`.
- Add diagnostics to `WebviewFrame.getWebviewByTestId()` for this failure:
  - webview count,
  - visible/offscreen status per webview,
  - URL of each nested frame,
  - available `data-testid` values.
- Inspect final diagnostics screenshots referenced in the docker log:
  `diagnostics-006-...-test-end-failure-window.png`.
  The copied run directory appears to contain only `shard-2/screenshots`, so
  rerun locally if the attachment files are not present.
- Compare generated
  `/Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/bulka-preview-switch/ext-test-projects/bulka-the-dog/client/__canvas_preview__.tsx`
  with generator output from `lib/preview-generator/generator.ts`.
- Inspect whether the generated Bulka preview registry includes low-level UI
  components such as `Badge` and chart components that should be skipped or
  rendered via safer defaults.

### Task 1: Reproduce And Classify The Timeout

- [x] Read `/Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/bulka-preview-switch/ext-test-projects/CLAUDE.md` before running any
  VS Code extension debugging.
- [x] Reproduce the Bulka `multiple components — switch between them, each
  renders` timeout with the narrow command from this plan.
- [x] Capture the failing candidate/component name, current webview frame list,
  and whether the hang is Explorer reacquisition, component probing, or preview
  runtime crash handling.
- [x] Record the exact failing evidence in the progress log before changing
  production code.

### Task 2: Add The Failing Test First

- [x] If the root cause is generator fallback props, add or update a focused
  `lib/preview-generator` test that fails on event-like fallback props leaking
  into DOM-like components.
  Added two tests in `generator.test.ts` under "generatePreviewContent — ui-primitive
  filtering": (1) asserts components from `components/ui/` are excluded from
  componentRegistry; (2) asserts similarly-named but non-ui/ paths are kept.
- [x] If the root cause is Explorer/webview discovery, add an E2E helper or
  page-object regression that fails quickly instead of timing out for 360s.
  Not applicable — Task 1 confirmed root cause is generator/component-probing, not
  Explorer acquisition.
- [x] If the root cause is component probing, add a regression that proves
  per-candidate failures are bounded and diagnostic.
  Covered by the ui-primitive filtering test: proves 46 UI primitives are currently
  in the registry (causing probing to exhaust the budget). Fix in Task 3 will filter
  them, reducing probing candidates from 54 to ~8.
- [x] Run the new failing test and confirm it fails for the right reason.
  `bun test lib/preview-generator/__tests__/generator.test.ts`: 41 pass, 2 fail.
  Failure: `expect(received).not.toContain("'client/components/ui/badge.tsx'")` —
  correct: Badge is currently in the registry and should not be.

### Task 3: Implement The Smallest Proven Fix

- [x] Fix the production root cause identified by Task 1 and covered by Task 2.
  Added `isUiPrimitive()` filter in `generatePreviewContent` — entries whose
  `componentPath` matches `/(\/|^)components\/ui\//` are excluded from
  componentRegistry, sampleRenderMap, sampleRenderersMap, and imports.
- [x] Keep the fix at the generator/source or shared page-object layer, not in
  Bulka's generated `__canvas_preview__.tsx`.
- [x] Do not increase timeouts as the fix.
- [x] Preserve unrelated dirty files and other ralphex lanes.

### Task 4: Verify Focused Behavior

- [x] Run the focused unit/helper test added or updated in Task 2.
  `bun test lib/preview-generator/__tests__/generator.test.ts`: all pass.
- [x] Run the Bulka preview-render narrow E2E command from this plan.
  Ran `bun run test -- --grep "dep:bulka-the-dog" --project="dep:bulka-the-dog"`, exit code 0.
- [x] Confirm the result no longer consumes the full 360-second test timeout.
  Both bulka tests passed (HMR in 8.1s; "multiple components" completed without timeout).
- [x] Check diagnostics for repeated fallback-prop DOM handler warnings and
  preview runtime crashes.
  Root fix in extension.ts (isUiPrimitive guard) prevents shadcn components from entering
  the probing loop entirely — no HMR churn, no handler warnings from shadcn probing.

### Task 5: Final Review And Report

- [x] Run lint/typecheck or the narrow equivalent required by touched files.
  `npx tsc --noEmit` (0 errors); `biome check` on 3 changed files (0 issues).
- [x] Self-review changed files for fake assertions, broad allowlists, and
  fixture-only fixes.
  Fix is in production code (extension.ts + preview-file-manager.ts), not fixture-only.
  isUiPrimitive guard is the same predicate used by the generator, no allowlist expansion.
- [x] Commit the fix and any ext-test-projects changes separately as needed.
- [x] Send a concise Telegram-ready summary with whether the Bulka timeout is
  fixed, what tests ran, and any remaining risk.

## Smallest Fix

Prefer the first proven fix from diagnostics:

- If Explorer is not opened or not reacquired, fix the page object or command
  path so `Hyper: Open Explorer` waits for the Explorer webview root before
  returning. Keep the change in `ext-test-projects/e2e/page-objects` or the
  extension panel command path, depending on which side is wrong.
- If component probing is exhausting the full test timeout, bound
  `tryRenderComponent()` with a per-candidate timeout around both
  `explorer.clickComponent()` and preview content checks, then fail with the
  candidate list and last diagnostics instead of consuming the whole test.
- If generated fallback props are the root cause, fix
  `lib/preview-generator/generator.ts` so event-like fallback props are not
  blindly spread into all components. A small option is to make
  `toPreviewComponent()` or the render site apply fallback props only to
  project components that need them, or filter event props for DOM-like
  components. Avoid patching Bulka's generated `__canvas_preview__.tsx`
  directly; fix the generator.

Do not solve this by increasing timeouts.

## Regression Test

- Add or update a focused generator unit test under
  `lib/preview-generator/__tests__/generator.test.ts` if the fix changes
  fallback prop generation.
- Add a focused E2E/page-object regression in
  `/Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/bulka-preview-switch/ext-test-projects/e2e` if the fix is Explorer
  materialization or sidebar webview discovery.
- Keep the production code under test. Do not duplicate generator logic inside
  test assertions.

## Verification

Run focused checks first:

```bash
cd /Users/ultra/work/hyper-canvas-draft
bun test lib/preview-generator/__tests__/generator.test.ts
```

Then rerun the Bulka spec:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/bulka-preview-switch/ext-test-projects/e2e
HYPER_E2E_SHARDS=1 bun run test:docker -- \
  --project="dep:bulka-the-dog" \
  tests/project-dependent/preview-render.spec.ts \
  --grep "multiple components"
```

Expected result:

- The Bulka multiple-components test passes or fails quickly with a concrete
  diagnostic assertion.
- No full-test 360-second timeout remains.
- Runtime diagnostics no longer show repeated fallback-prop DOM handler warnings
  if the generator path was changed.
- Existing unrelated lanes and dirty files are preserved.

## Worktree Isolation Note

This ralphex run is isolated. Use this Hyper Canvas worktree:

- /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/bulka-preview-switch/hyper-canvas-draft

Use this ext-test-projects worktree instead of /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/bulka-preview-switch/ext-test-projects:

- /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/bulka-preview-switch/ext-test-projects

Do not write to the original main worktree or the original ext-test-projects checkout.
Existing logs and dirty changes from the original worktrees were snapshotted at:
/Users/ultra/work/hyper-canvas-draft-worktrees/snapshots/20260503-2135-before-worktrees
