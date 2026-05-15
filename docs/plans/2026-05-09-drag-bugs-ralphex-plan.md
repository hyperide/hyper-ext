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

## TDD approach

Tests in `../ext-test-projects/e2e/tests/project-independent/`. Use
`react-vite-tw3-kanban` (has flex rows) and `react-vite-tw4-twitter` (has flex-col feeds).

- Test 1 (RED): start drag → during drag → expect overlay rect moves with the drag source
- Test 2 (RED): complete drag drop → expect selection rect still visible on dragged element
- Test 3 (RED): start drag → press Escape → expect ghost disappears, drag cancelled
- Test 4 (RED): drag a transparent div → expect ghost has visible background
- Test 5 (RED): drag in flex-col container → expect indicator is HORIZONTAL (not vertical)

## Tasks

- [ ] Task 1: RED — write 5 failing E2E tests (or targeted unit tests for orientation)
- [ ] Task 2: Fix overlay update during drag — set `needsOverlayUpdate=true` in `_dragPointerMove`
- [ ] Task 3: Fix selection after drop — re-broadcast selectedIds in PanelRouter after write
- [ ] Task 4: Fix Escape cancel — add keydown listener in drag start, remove in cleanup
- [ ] Task 5: Fix ghost background — walk up for non-transparent bg, set on ghost
- [ ] Task 6: Fix indicator orientation — check el itself first in chooseIndicatorOrientation
- [ ] Task 7: Build + install ext, run E2E → GREEN
- [ ] Task 8: Codex review, fix findings
- [ ] Task 9: Send before/after screenshots to TG
