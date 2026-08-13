# delete element regression — file unchanged after delete + CSS Modules hang

<!-- commission: wc-20260513-6772420c | decision: dec-20260513-class-e-delete-element-regression -->

## Context

### Failures observed

Two distinct failure modes both hitting the same test:
`"delete element — removed from file, cascade to children"` in `ast-operations.spec.ts:217`.

**Mode A — silent no-op on Vite projects (~19–24s, assertion failure):**
- S1: `react-vite-tw3-kanban` — 2 failures, 21s and 24s
- S2: `react-vite-styled-shopify` — 2 failures, ~20s each

Error message (from docker.log line 73131):
```
Error: File content should change after delete
expect(received).not.toBe(expected) // Object.is equality
Call Log: Timeout 15000ms exceeded while waiting on the predicate

> 237 |     await expect.poll(
    |     ^
238 |       () => editor.getActiveEditorContent().catch(() => contentBefore),
239 |       { timeout: 15_000, message: 'File content should change after delete' }
240 |     ).not.toBe(contentBefore);
```

The comment at line 235-236 says: `"Failure here means deleteSelected() is broken for this project (invalid nodeRef or selection not propagated)."`

**Critical signal:** `ast-debug.log` for S1 contains zero entries for delete or duplicate operations — `AstService.deleteElement()` is never called. The command ran (no crash, test ran 21s not 360s) but silently no-opped somewhere in the extension command handler.

**Mode B — hanging promise on webpack+CSS Modules (~360–472s, timeout):**
- S3 re-run: `webpack-react-cssmodules-spotify` — 2 failures, 382s and 472s

Root cause: `openExplorerAndSelect` in `setup-preview.ts:909` calls `inspector.getComponentName()` wrapped in `.catch(() => '')`. On webpack+CSS Modules projects, `getComponentName()` returns a promise that **never resolves and never rejects** — `.catch()` never fires → `expect.poll` hangs for the full test.slow() timeout (3 × 120s = 360s).

**Also failing alongside delete element:**
- `duplicate element preserves file integrity` (S1: tw3-kanban; S2: tw4-twitter, cssmodules-spotify, styled-shopify, emotion-dashboard)
- `duplicate element — file content grows after duplicate` (same projects)
- Same pattern: content unchanged after operation, AstService never called.

### Common root cause (Mode A)

`openExplorerAndSelect(window, cmd, 1)` clicks tree item index 1 and waits for `inspector.getComponentName()` to be truthy. Inspector shows a componentName — so the selection appears to propagate through StateHub to the inspector. But `Hyper: Delete Selected Elements` then no-ops: no AstService call.

Hypothesis: the extension command handler for `hypercanvas.deleteSelectedElements` reads `selectedElements` from a canvas state snapshot. After `setupPreviewWithDevServer` + `openExplorerAndSelect`, the canvas state may hold the ROOT component (from setupPreview), but the extension's selection model may not have been updated with the tree-selected element. The inspector shows the componentName via a separate bridge path that doesn't update the `deleteSelected` state.

Alternative hypothesis: entry-file-watcher (added in v0.1.46, commit f898bcdd) fires on some project types after `setupPreviewWithDevServer` opens the editor, triggering `modeManager.onComponentSelected()` + `previewPanel.refresh()` — which resets selection state between `openExplorerAndSelect` and the delete command.

## Scope

**Allowed:**
- `ext-test-projects/e2e/helpers/setup-preview.ts` — fix hanging promise in `openExplorerAndSelect`
- `ext-test-projects/e2e/tests/project-dependent/ast-operations.spec.ts` — improve test robustness
- `vscode-extension/hypercanvas-preview/src/extension.ts` — investigate delete/duplicate command handlers (read-only first)
- `vscode-extension/hypercanvas-preview/src/services/PreviewModeManager.ts` — if entry-file-watcher is the cause

**Forbidden without new plan:**
- Changes to `AstService.ts` or core L1 engine
- Changes to `useElementSelection.ts` or StateHub — these touch many tests

## Tasks

### Task 1: Fix Mode B — hanging promise in `openExplorerAndSelect`

**File:** `ext-test-projects/e2e/helpers/setup-preview.ts:909`

Current code (simplified):
```typescript
await expect.poll(
  () => inspector.getComponentName().catch(() => ''),
  { timeout: 10_000, message: '...' }
).toBeTruthy();
```

**Problem:** `getComponentName()` on webpack+CSS Modules returns a promise that never settles.
`.catch()` only fires on rejection — a hung promise is neither resolved nor rejected.

**Fix:** Wrap with `Promise.race` against a timeout that rejects:

```typescript
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('componentName-timeout')), ms)),
  ]);

await expect.poll(
  () => withTimeout(inspector.getComponentName(), 3_000).catch(() => ''),
  { timeout: 10_000, message: 'Inspector componentName should appear after tree selection' }
).toBeTruthy();
```

After the fix: on webpack+CSS Modules, each `getComponentName()` attempt times out after 3s, `.catch()` returns `''`, `expect.poll` retries up to 10s total, then the `openExplorerAndSelect` exits (not hangs indefinitely). The caller still gets `{ treeCount }`. Test moves on and the delete assertion fires in ~20s (Mode A territory).

- [ ] Apply the `Promise.race` fix in `openExplorerAndSelect`
- [ ] Verify tsc passes

### Task 2: Investigate Mode A — why AstService never called

**Goal:** find where the extension command handler silently returns without calling `AstService.deleteElement()`.

- [ ] Read `vscode-extension/hypercanvas-preview/src/extension.ts` — find the `hypercanvas.deleteSelectedElements` command handler
- [ ] Trace: what `selectedElements` does the handler read? From which object/service?
- [ ] Check if `openExplorerAndSelect` (tree item click) updates the same selection state
- [ ] Check if entry-file-watcher fires between tree click and delete command on tw3-kanban / styled-shopify
- [ ] Log findings: which code path early-returns without calling AstService

### Task 3: Fix Mode A — ensure delete/duplicate operate on tree-selected element

Based on Task 2 findings, one of:

**If selection state mismatch:**
- After `openExplorerAndSelect`, explicitly sync the tree selection to the extension's selectedElements — e.g., call `canvas.selectElementByNodeRef(...)` after tree click
- OR: change the test to use `canvas.selectElement(NODEREF)` directly (like the bulka-specific test at line 265) instead of `openExplorerAndSelect`

**If entry-file-watcher interference:**
- In `setupEntryFileWatcher()`: add a guard — don't fire `onComponentSelected()` if the preview is mid-test (e.g., check a test-mode flag) OR debounce long enough that the test's action completes first

**If command handler bug:**
- Fix the command handler to use the correct selection source

- [ ] Implement fix based on Task 2 findings
- [ ] `bun run typecheck` in `vscode-extension/hypercanvas-preview/`
- [ ] Run E2E: `HYPER_E2E_SHARDS=1 bun run test:docker` with `--grep "delete element|duplicate element"` on `react-vite-tw3-kanban`
- [ ] Confirm test GREEN, ast-debug.log shows delete/duplicate AstService calls
- [ ] Send screenshot to TG

### Task 4: Verify no regressions on CSS Modules projects

- [ ] Run E2E subset with `--project dep:webpack-react-cssmodules-spotify` and `--grep "delete element"`
- [ ] Confirm test completes in <60s (no 382s hang), result is GREEN or clean assertion failure (not timeout)
- [ ] Send TG report with timings

## Acceptance criteria

1. `delete element` test completes in ≤60s on `webpack-react-cssmodules-spotify` (no 382-472s hang)
2. `delete element` test passes (GREEN) on `react-vite-tw3-kanban` and `react-vite-styled-shopify`
3. `duplicate element preserves file integrity` and `duplicate element — file content grows` pass on all projects that currently fail them
4. `ast-debug.log` shows `[AstService._resolveElement]` entries when delete/duplicate commands run
