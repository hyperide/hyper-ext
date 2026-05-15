# Drag & Drop Bugs — 5 issues

## Context

User-reported (2026-05-09) after manual testing of ext v0.1.44. Five bugs in drag & drop:

1. **Overlay rects don't update during drag** — selection rect stays frozen at old position
   while dragging. Root cause: `_dragSourceEl.style.pointerEvents = 'none'` prevents
   `pointermove` from re-triggering overlay updates; `needsOverlayUpdate` is only set on
   state changes, not on every drag frame. Fix: force `needsOverlayUpdate=true` on each
   `_dragPointerMove` so the overlay loop re-evaluates during drag.

2. **Selection disappears after drop** — after a successful AST reorder or order-write,
   `selectedIds` is cleared (or HMR fires and clears it) and never re-broadcast.
   Root cause: `writeOrders`/`moveElement` handlers in PanelRouter/AstBridge don't
   re-broadcast the selection after the write completes + HMR. The grace cache covers the
   HMR gap but only if selectedIds were non-empty when it last persisted.
   Fix: after any drag-end write (orders or AST move), explicitly re-broadcast
   `selectedIds: [sourceId]` via postMessage to ensure grace cache has the correct id.

3. **Escape key doesn't cancel drag** — pressing Escape during active drag does nothing.
   Root cause: no `keydown` listener for Escape during drag in `iframe-interaction.ts`.
   The existing `keydownForwardingHandler` forwards to keydown handler which doesn't
   have an Escape case for drag.
   Fix: in `_dragPointerMove` (or on drag start), attach a `keydown` listener that calls
   `_dragCleanup()` on `e.key === 'Escape'` and prevents default; remove on drag end.

4. **Ghost element has no background for transparent elements** — dragging a transparent
   element (e.g. a div with `background: transparent`) shows an invisible ghost.
   Fix: in ghost creation, walk up DOM ancestors computing `getComputedStyle(el).backgroundColor`
   until a non-transparent color is found; set it explicitly on the ghost element. Also
   inherit `color` and `font-*` from the dragged element for text legibility.

5. **Drop indicator wrong direction in vertical flex container** — in a flex-col parent,
   the drop indicator shows as a VERTICAL line (column separator) instead of HORIZONTAL
   (row separator). Root cause: `_isHorizontalLayout(dropEl)` checks `dropEl.parentElement`
   via `chooseIndicatorOrientation`. When `dropEl` IS the flex-col container itself (cursor
   is over the container's padding, not a child), `chooseIndicatorOrientation` walks up to
   `dropEl.parentElement` (the container's parent) instead of `dropEl` itself.
   Fix: in `chooseIndicatorOrientation`, check if `el` itself is a flex/grid container
   before walking to `el.parentElement`. If `el` is a flex-col, return 'vertical'
   immediately. The indicator orientation should reflect where the item will be INSERTED,
   so check the container that will receive the drop.

## Files to read first

- `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`
  — `_dragPointerMove`, `_dragPointerUp`, `_dragCleanup`, ghost creation, indicator logic
- `shared/canvas-interaction/drop-indicator-orientation.ts`
  — `chooseIndicatorOrientation`, the parent-walk logic
- `vscode-extension/hypercanvas-preview/src/PanelRouter.ts`
  — `writeOrders`, `moveElement` handlers and selection re-broadcast after write
- `shared/canvas-interaction/selection-grace-cache.ts`
  — grace cache API for post-drop re-seeding

### Task 1: Read relevant files, understand current data flow

- [x] Read `iframe-interaction.ts` sections: `_dragPointerMove` (find where needsOverlayUpdate set), `_dragCleanup`, ghost creation (find background setting), `_dragPointerUp` (find post-drop re-broadcast)
- [x] Read `shared/canvas-interaction/drop-indicator-orientation.ts` — `chooseIndicatorOrientation` full implementation
- [x] Read `vscode-extension/hypercanvas-preview/src/PanelRouter.ts` — `writeOrders` and `moveElement` handlers, what they postMessage back after write
- [x] Document exact line numbers for each fix location

<!-- Fix locations:
  Bug 1 (overlay rects): iframe-interaction.ts:1585 — add `needsOverlayUpdate = true` right after `if (_dragState !== 'dragging') return`
  Bug 2 (selection after drop): useCanvasInteraction.ts:337 (moveElement), :356 (writeOrders) — add canvas.sendEvent state:update with selectedIds after write; usePreviewBridge.ts:305 handleLoad — add re-broadcast of lastSelectedIds after iframe reload
  Bug 3 (Escape cancel): iframe-interaction.ts:1541 (drag start transition) — add document.addEventListener keydown; :1644 _dragCleanup — remove listener
  Bug 4 (ghost background): iframe-interaction.ts:1559 after ghost appended — walk ancestors for non-transparent backgroundColor
  Bug 5 (indicator direction): drop-indicator-orientation.ts:49 chooseIndicatorOrientation — check el itself before walking to parentElement; currently starts at `el.parentElement` (line 52)
  Note: actual drag message handlers are in useCanvasInteraction.ts, NOT PanelRouter.ts
-->

### Task 2: RED — write 5 failing E2E tests

- [x] Create `../ext-test-projects/e2e/tests/project-independent/drag-drop-bugs.spec.ts`
- [x] Test 1 (overlay update): start drag → during drag → screenshot → assert selection rect X/Y changed (not frozen at original position)
- [x] Test 2 (selection after drop): complete drag → wait 1000ms → assert selection rect still visible on dragged element
- [x] Test 3 (Escape cancel): start drag → press Escape → assert ghost element gone, no drop occurred
- [x] Test 4 (ghost background): drag a transparent div → screenshot ghost → assert ghost has visible background (not invisible)
- [x] Test 5 (indicator direction): drag in flex-col container → screenshot drop indicator → assert indicator is HORIZONTAL (thin horizontal line, not vertical)
- [x] Run tests → confirm all 5 RED

<!-- E2E results (run-20260509-102527-99357):
  DRAG-BUG-1: failed (RED) ✓
  DRAG-BUG-2: PASSED (pre-fix GREEN) — grace cache already handles the normal drag scenario;
              test kept as regression guard. Bug 2 fix (Task 4) adds defense-in-depth
              re-broadcast for edge cases where grace cache TTL expires or race occurs.
  DRAG-BUG-3: failed (RED) ✓
  DRAG-BUG-4: failed (RED) ✓
  DRAG-BUG-5: failed (RED) ✓
  4/5 tests RED as expected; Bug 2 behavior already works via grace cache in normal scenarios.
-->

### Task 3: Fix overlay update during drag

- [x] In `iframe-interaction.ts` in `_dragPointerMove` handler: set `needsOverlayUpdate = true` at start of every call
- [x] Verify overlay loop checks `needsOverlayUpdate` flag and repaints

### Task 4: Fix selection disappears after drop

- [x] In `PanelRouter.ts` after `writeOrders` write completes: postMessage `{ type: 'stateUpdate', selectedIds: [sourceId] }` to iframe
- [x] In `PanelRouter.ts` after `moveElement` write completes: same postMessage with sourceId
- [x] Alternatively seed grace cache before write starts so HMR replay uses correct id

### Task 5: Fix Escape key cancel during drag

- [x] In `iframe-interaction.ts` drag start code (wherever `_dragSourceEl` is first set): add `document.addEventListener('keydown', _escapeHandler)`
- [x] `_escapeHandler`: on `e.key === 'Escape'`, call `_dragCleanup()` + `e.preventDefault()`
- [x] In `_dragCleanup`: remove the keydown listener

### Task 6: Fix ghost background for transparent elements

- [x] In `iframe-interaction.ts` ghost creation code: after cloning element, walk up `el.parentElement` chain with `getComputedStyle(ancestor).backgroundColor`
- [x] Stop when `backgroundColor` is not `'rgba(0, 0, 0, 0)'` and not `'transparent'`
- [x] Apply found background to `ghost.style.backgroundColor`
- [x] Also copy `color`, `fontFamily`, `fontSize` from dragged element to ghost

### Task 7: Fix drop indicator direction in flex-col

- [x] In `shared/canvas-interaction/drop-indicator-orientation.ts` `chooseIndicatorOrientation(el)`:
- [x] Before walking to `el.parentElement`: check `getComputedStyle(el).display` for `flex` or `grid`
- [x] If `el` itself is `flex` or `inline-flex`: check `flexDirection` — if `column` or `column-reverse`, orientation is `horizontal` (items stack vertically so separator is horizontal)
- [x] If `el` itself is `grid`: orientation is determined by grid direction (default horizontal)
- [x] Only walk to `el.parentElement` if `el` is NOT a flex/grid container

### Task 8: Build + install ext, run E2E → GREEN

- [ ] Run `./vscode-extension/hypercanvas-preview/build-and-install.sh`
- [ ] Run E2E: `cd /Users/ultra/work/ext-test-projects/e2e && HYPER_E2E_SHARDS=1 bun run test:docker --grep "drag-drop-bugs"`
- [ ] All 5 tests must be GREEN
- [ ] Check screenshot artifacts

### Task 9: Take E2E screenshots and send to Telegram

- [ ] Find screenshot artifacts from E2E run in `docker-artifacts/run-*/shard-*/`
- [ ] Read each screenshot with Read tool, verify it shows the fix
- [ ] Send to Telegram: `./send-tg-photo.sh <screenshot> "drag bug fixed: <name>"`
- [ ] One screenshot per bug (5 total)
- [ ] Commit remaining uncommitted changes
