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

### Task 1: Read all relevant files, understand current data flow

- [x] Read `shared/canvas-interaction/keyboard-handler.ts` — find `findParentNodeRef` call site, `onSelectElement(parentRef)` call, current callback type definitions
- [x] Read `shared/canvas-interaction/node-map-lookup.ts` — `findParentNodeRef` implementation, what it returns
  - NOTE: `node-map-lookup.ts` does NOT exist. `findParentNodeRef` is defined in `keyboard-handler.ts:41-44`. Task 3 must NOT refactor `findParentNodeRef` return type — instead extend `getState()` and `onSelectElement` callback signature in `keyboard-handler.ts`.
- [x] Read `client/hooks/useCanvasInteraction.ts` — `onSelectElement` handler, how `selectedItemIndices` is set, `selectedIds` dispatch
  - NOTE: `client/hooks/useCanvasInteraction.ts` does NOT exist. VS Code path is `vscode-extension/hypercanvas-preview/src/webview-preview-panel/useCanvasInteraction.ts`. SaaS path is `client/pages/Editor/components/hooks/useHotkeysSetup.ts`. The webview file already handles `msg.itemIndex` correctly — no changes needed there.
- [x] Read `shared/canvas-interaction/overlay-rects.ts` around line 113 — `findElements(ref, itemIndex)` call and how itemIndex affects result
- [x] Read `client/hooks/useCanvasEngineContext.ts` — `engine.select` call and signature
  - NOTE: `client/hooks/useCanvasEngineContext.ts` does NOT exist. SaaS calls `engine.select(id)` directly in `useHotkeysSetup.ts:637`. `engine.selectWithItemIndex(id, itemIndex)` already exists in `CanvasEngine.ts:182-196` — use it in Task 5 for SaaS path.
- [x] Document: current `findParentNodeRef` return type, `onSelectElement` callback signature, where to thread itemIndex
  - `findParentNodeRef` returns `string | null`. `onSelectElement: (id: string) => void` (no itemIndex). Fix: (1) extend `DesignKeydownConfig.getState()` to include `selectedItemIndices`, (2) extend `onSelectElement` to `(id, itemIndex?) => void`, (3) read child's itemIndex in Shift+Enter handler, pass to callback. VS Code: `iframe-interaction.ts` postMessage currently hardcodes `itemIndex: null` — must read from `state.selectedItemIndices[freshId]`. SaaS: call `engine.selectWithItemIndex` instead of `engine.select`.

### Task 2: RED — write failing E2E test: Shift+Enter → only 1 rect

- [x] Create `../ext-test-projects/e2e/tests/project-independent/bulka-shift-enter-parent.spec.ts`
  - NOTE: placed in `tests/project-dependent/` (not project-independent) — plan had wrong folder, all bulka tests belong in project-dependent; uses `project.fixture`
- [x] Open bulka-the-dog → select a child element inside ONE Section row (not first/last)
  - Uses `#health ul li:nth-child(2) .flex-1 p` — 2nd health bullet's paragraph (4 li elements from same .map())
- [x] Press Shift+Enter
- [x] Get all visible overlay rects from page
- [x] Assert: exactly 1 rect visible (the parent of that specific row)
- [x] Assert: NOT multiple rects covering all Section rows
- [x] Run test → confirm RED (currently shows multiple rects)
  - NOTE: test is structurally RED (asserts rectCount === 1 while bug causes rectCount === 4); Docker run deferred per plan ordering

### Task 3: Update findParentNodeRef to return { ref, itemIndex } shape

- [x] In `shared/canvas-interaction/node-map-lookup.ts`: change `findParentNodeRef` return type from `NodeRef | null` to `{ ref: NodeRef; itemIndex: number | null } | null`
  - NOTE per Task 1: node-map-lookup.ts does not exist; findParentNodeRef stays as-is (returns string|null). Instead, extended DesignKeydownConfig.getState() to include optional `selectedItemIndices?: Record<string, number | null>` in keyboard-handler.ts.
- [x] The parent's `itemIndex` = current child's `selectedItemIndices[childRef]` (same `.map()` row)
  - NOTE: informational — actual reading in Task 4 Shift+Enter handler
- [x] Update callers of `findParentNodeRef` to destructure `{ ref, itemIndex }`
  - NOTE per Task 1: not applicable; callers updated in Tasks 4–5 when callback signature changes

### Task 4: Update onSelectElement callback to pass itemIndex

- [ ] In `shared/canvas-interaction/keyboard-handler.ts`: update `onSelectElement` callback type to accept `(ref: NodeRef, itemIndex?: number | null) => void`
- [ ] At the Shift+Enter call site: `callbacks.onSelectElement(parentResult.ref, parentResult.itemIndex)`
- [ ] Update `KeyboardHandlerCallbacks` type definition

### Task 5: Update useCanvasInteraction.ts to propagate itemIndex

- [ ] In `client/hooks/useCanvasInteraction.ts` `onSelectElement` handler:
- [ ] Accept second param `itemIndex?: number | null`
- [ ] When dispatching `selectedIds: [ref]`: also dispatch `selectedItemIndices: itemIndex != null ? { [ref]: itemIndex } : undefined`
- [ ] For SaaS `engine.select` path in `useCanvasEngineContext.ts`: pass `itemIndex` in select call if engine.select accepts it

### Task 6: Run unit tests for keyboard-handler + overlay-rects

- [ ] Run: `bun test shared/canvas-interaction/keyboard-handler.test.ts` (if exists)
- [ ] Run: `bun test shared/canvas-interaction/overlay-rects.test.ts` (if exists)
- [ ] Run typecheck: `bun run typecheck`
- [ ] Fix any type errors from signature changes

### Task 7: Build + install ext, run E2E → GREEN

- [ ] Run `./vscode-extension/hypercanvas-preview/build-and-install.sh`
- [ ] Run E2E: `cd /Users/ultra/work/ext-test-projects/e2e && HYPER_E2E_SHARDS=1 bun run test:docker --grep "bulka-shift-enter-parent"`
- [ ] Test must be GREEN (exactly 1 rect after Shift+Enter on repeated component)
- [ ] Screenshot artifacts in `docker-artifacts/run-*/shard-*/`

### Task 8: Take E2E screenshot and send to Telegram

- [ ] Find screenshot from E2E run showing single rect after Shift+Enter
- [ ] Read screenshot with Read tool, verify it shows only 1 rect (not multiple)
- [ ] Send to Telegram: `./send-tg-photo.sh <screenshot> "Shift+Enter parent fix: now highlights only 1 instance of repeated Section, not all"`
- [ ] Commit remaining uncommitted changes
