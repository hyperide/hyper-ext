# React hooks: canvas/core components — fix deps with TDD

## Context

`oxlint` found hooks issues in canvas-related components:

### useProjectUIKit.ts — missing activeProject deps

```ts
useEffect(() => {
  if (!activeProject) { ... return; }
  setActiveProjectId(activeProject.id);
  setActiveProjectName(activeProject.name || null); // uses .name
  if (activeProject.publicDir) { ... }             // uses .publicDir
}, [activeProject?.id]); // MISSING: activeProject, activeProject.publicDir, activeProject.name
```

The dep array uses `activeProject?.id` (a derived value) but accesses `activeProject.name` and `activeProject.publicDir` inside. If these change without `id` changing, the effect won't re-run.

**Fix**: use `activeProject` itself as dep (if stable ref), or use individual property deps.

### useElementsTree.ts — unnecessary deps in useMemo

```ts
}, [engine, store, componentName, updateCounter, stateResult]);
//                  ^unnecessary  ^unnecessary
```

oxlint says `updateCounter` and `componentName` are unnecessary. These extra deps cause unnecessary useMemo recomputation.

**BUT**: investigate carefully — `componentName` might actually be used inside the memoized computation via `stateResult`. Verify before removing.

### useElementTracer.ts — missing componentPath dep

```ts
useEffect(() => {
  tracer.renderedFile = componentPath ?? null; // uses componentPath
  ...
}, [iframe, projectId, enabled, loadCounter]); // MISSING: componentPath
```

If `componentPath` changes, the tracer won't update `renderedFile`. This could cause stale element tracing.

### RightSidebar.tsx — unnecessary componentPath dep in useCallback

```ts
[i18nText, astOps, selectedId, componentPath, i18nDispatch, availableI18nKeys, canvas];
//                  ^unnecessary according to oxlint
```

Verify whether `componentPath` is actually used inside this callback.

### AnnotationsLayer.tsx — strict null issues (also reported by tsgo)

`pos.width` and `pos.height` possibly undefined. Check the type definition.

## Scope

### 1. useProjectUIKit.ts fix

Write unit test: verify effect re-runs when `activeProject.name` changes without `id` changing.
Fix: add `activeProject` to deps (or `activeProject?.name`, `activeProject?.publicDir`).
Confirm the effect doesn't run more than necessary.

### 2. useElementsTree.ts — careful investigation

First: read the full hook implementation. Verify whether `componentName` and `updateCounter` are actually used inside the memo. If they ARE used (possibly via stateResult computation), keep them. If they're truly unused in the computation, remove them and write a test proving memo stability.

### 3. useElementTracer.ts — add componentPath dep

Write unit test: verify tracer.renderedFile updates when componentPath changes.
Fix: add `componentPath` to the dep array.

**Risk**: adding `componentPath` to deps might cause the tracer to reinitialize more often.
Mitigation: check if the initialization is expensive. If so, separate the `renderedFile` assignment into its own lighter effect.

### 4. RightSidebar.tsx — verify and fix componentPath dep

Read the callback at line 879 to verify whether `componentPath` is actually used.
If not used: remove from deps.
If used: it was missing, add it.

### 5. AnnotationsLayer.tsx — null guards

Add null/undefined guards for `pos.width` and `pos.height`.
These are also strict-mode errors (tracked in ts-strict-migration plan) — coordinate to avoid merge conflict.

## Hard Rules

- Work in a NEW worktree. Create: `hooks-canvas-fix`.
- TDD: write failing unit test BEFORE each fix.
- Do NOT remove deps without verifying they're truly unused inside the computation.
- Do NOT add deps that would cause infinite re-render loops — trace data flow first.
- Check for existing unit tests in `*.test.ts` files in same directories before writing new ones.
- Commit each file fix separately.
- Use `bun test <specific-test-file>` to verify tests pass, not the full suite.
