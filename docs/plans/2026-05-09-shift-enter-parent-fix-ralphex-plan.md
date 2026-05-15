# Shift+Enter — select parent: wrong rect on repeated instances

## Context

User-reported (2026-05-09): Shift+Enter for "select parent" highlights ALL instances of
a repeated parent (e.g. a Section component rendered once per item in a `.map()`) instead
of only the parent of the currently selected item.

From MEMORY deferred ticket (2026-05-08):
> When the parent is a repeated-instance host (e.g. bulka `Section` wrapper rendered once
> per Section invocation), all instances share one source ref. After Shift+Enter,
> `onSelectElement(parentRef)` in `keyboard-handler.ts:181` emits id-only with
> `itemIndex: null`, host's `useCanvasInteraction.ts:211` skips `selectedItemIndices`
> patch, and `overlay-rects.ts:113` calls `findElements(parentRef, null)` → highlights
> every parent instance.
> Fix: plumb parent itemIndex through keyboard-handler callback API + SaaS `engine.select`.

## Root cause

In `keyboard-handler.ts:179-181`:
```ts
const parentRef = findParentNodeRef(freshId, nodeMapLookup);
if (parentRef) {
  callbacks.onSelectElement(parentRef);  // ← no itemIndex
}
```

`onSelectElement` only takes a `nodeRef` (source id). The parent's `itemIndex` is not
passed. In `useCanvasInteraction.ts`, `onSelectElement` dispatches `selectedIds: [ref]`
without `selectedItemIndices`, so `findElements(ref, null)` returns ALL DOM elements
with that source → highlights every instance of the repeated component.

Fix:
1. `findParentNodeRef` needs to also return the parent's itemIndex — the selected child
   has `selectedItemIndices[childRef]` = N, so the parent's itemIndex is also N (same
   `.map()` row).
2. `onSelectElement` callback signature needs to accept optional `itemIndex`.
3. `useCanvasInteraction.ts` must propagate `itemIndex` to `selectedItemIndices` dispatch.

## Files to read first

- `shared/canvas-interaction/keyboard-handler.ts` — `findParentNodeRef`, `onSelectElement` call
- `shared/canvas-interaction/node-map-lookup.ts` — `findParentNodeRef` implementation
- `client/hooks/useCanvasInteraction.ts` — `onSelectElement` handler, selectedItemIndices
- `shared/canvas-interaction/overlay-rects.ts:113` — `findElements` call site
- `client/hooks/useCanvasEngineContext.ts` — `engine.select` call (SaaS path)

## TDD approach

Test in `../ext-test-projects/e2e/tests/project-independent/`:
- Open bulka-the-dog (has repeated Section instances)
- Select a child element inside Section row N
- Press Shift+Enter
- Expect: only ONE rect visible (the parent of row N)
- Expect: NOT multiple rects covering all Section rows

## Tasks

- [ ] Task 1: Read all relevant files, understand current data flow
- [ ] Task 2: RED — write failing E2E test: Shift+Enter → only 1 rect
- [ ] Task 3: Update `findParentNodeRef` to return `{ ref, itemIndex }` shape
- [ ] Task 4: Update `onSelectElement` callback in keyboard-handler to pass itemIndex
- [ ] Task 5: Update `useCanvasInteraction.ts` to propagate itemIndex to selectedItemIndices
- [ ] Task 6: Run unit tests for keyboard-handler + overlay-rects
- [ ] Task 7: Build + install ext, run E2E → GREEN
- [ ] Task 8: Codex review — disabled (codex limits until 2026-05-12, skip this task)
- [ ] Task 9: Send screenshot to TG showing single rect on Shift+Enter
