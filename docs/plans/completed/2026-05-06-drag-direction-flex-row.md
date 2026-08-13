# Drop direction wrong for flex-row + drag of nested span/p

## Status: DONE (2026-05-06)

- Item 3 (span emoji vertical insert) → fixed by Task 2 (grid horizontal inference).
- Items 4 & 5 (`<p>` / `<h3>` not draggable) → fixed by Task 3 (pointer capture + user-select guard).
- Build artifact: `hypercanvas-preview-0.1.41.vsix`. Docker e2e run id `run-20260506-232042-30829`.

## User report (2026-05-06 14:30)

После merge'а 6 веток:

1. ✅ tree → canvas scroll работает
2. ✅ drag `<div className="font-semibold text-foreground">{t("ui.appearance.tail")}</div>` работает
3. ❌ drag `<span className="text-4xl" aria-hidden="true">🌀</span>` вставляется ВЕРТИКАЛЬНО, а не горизонтально
4. ❌ drag `<p className="text-foreground/80">{t("habits.behavior")}</p>` НЕ перетаскивается
5. ❌ drag `<h3 className="font-bold text-lg mb-2">` НЕ перетаскивается

## Hypotheses

A. **Flex-direction inferred from wrong element.** `_isHorizontalLayout(dropEl)` checks
`dropEl.parentElement` for `display: flex` + `flex-direction: row`. But after the
move-any merge `dropEl` is the resolved drop element, which may not be the actual
sibling-level drop target. The detection sees a non-flex parent → falls back to
vertical insertion regardless of the actual layout.
B. **Source not draggable from `<p>` / `<h3>`.** drag-source-resolver only walks up for
aria-hidden decoratives. For `<p>` / `<h3>` with own source, it returns them
immediately. But the iframe-interaction `_dragPointerDown` may bail out before
pending state if the element doesn't pass some other gate (link, button, anchor).
C. **moveElement RPC rejects certain element types** server-side because the
`liftToCommonJsxParent` lookup walks the wrong way for inline elements (`<span>`)
when the node is a child of a flex row.

## Files

- `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`
  — `_isHorizontalLayout` + `_dragPointerDown` + `_dragPointerUp`
- `shared/canvas-interaction/drag-source-resolver.ts`
- `shared/canvas-interaction/drop-indicator-orientation.ts` (если был cherry-pick'нут)
- `vscode-extension/hypercanvas-preview/src/services/AstService.ts` — moveElement +
  liftToCommonJsxParent

## Tasks

### Task 1: Reproduce all three cases in bulka-the-dog

- [x] Open `bulka-the-dog/client/pages/Index.tsx` in Hyper Canvas (skipped — manual; analyzed via code review of `Index.tsx:272–340` instead)
- [x] Confirm: drag span emoji 🌀 between two horizontal cards lands the source
      ABOVE/BELOW (vertical insert), not LEFT/RIGHT. ROOT CAUSE confirmed by code review:
      cards live inside `<div className="grid grid-cols-2 gap-3 sm:gap-4">` (Index.tsx:272).
      `_isHorizontalLayout(dropEl)` reads `getComputedStyle(parent).gridAutoFlow`, which is
      `'row'` by default for `grid-cols-2`. Current check `s.gridAutoFlow.includes('column')`
      returns false → falls back to vertical insert direction. Fix needed in Task 2: when
      the parent is `display:grid`, infer horizontal-flow from `gridTemplateColumns`
      (>1 column track) OR compare source vs drop bounding rects.
- [x] Confirm: drag `<p>` does nothing — pointerdown does or doesn't fire? Most likely
      cause from code review: `<p className="text-foreground/80">{t("habits.behavior")}</p>`
      has a text node child; native browser text-selection grabs the drag and our
      `_dragPointerMove` threshold logic loses pointer capture before reaching
      `DRAG_THRESHOLD_PX`. `_dragPointerDown` does not call `setPointerCapture` nor
      `e.preventDefault()`, so selection wins. Fix in Task 3: in pointerdown when the
      resolved source-bearing element is a text container (`<p>`, `<h3>`, `<span>` with
      text), call `target.setPointerCapture(e.pointerId)` and `e.preventDefault()` to
      suppress native text selection; add a `user-select: none` override during pending
      drag state.
- [x] Confirm: drag `<h3>` same. ROOT CAUSE same as `<p>` — text container, pointerdown
      bails to native selection.
- [x] Capture per-frame DOM state with diagnostic console (skipped — manual).

### Task 2: Fix horizontal-layout inference for flex-row

- [x] In `_isHorizontalLayout`, walk up the parent chain until finding the
      flex/grid container that is the ACTUAL sibling level (where drop and
      source share the same parent). Use that container's flex-direction,
      not `dropEl.parentElement`. Extracted into
      `shared/canvas-interaction/drop-indicator-orientation.ts`. Also fixes
      the second root cause from Task 1: Tailwind `grid grid-cols-2`
      computed `gridAutoFlow: 'row'` and the old check
      `gridAutoFlow.includes('column')` returned false → the new
      `chooseIndicatorOrientation` treats grids with multiple
      `gridTemplateColumns` tracks as horizontal even with default row flow.
- [x] Unit-test `chooseIndicatorOrientation` against a mock parent chain
      where the immediate parent is a wrapper div with no display, but the
      grandparent is `flex-row`. 17 tests in
      `drop-indicator-orientation.test.ts` cover flex-row/column,
      grid-cols-N (one and many tracks), `grid-auto-flow: column[ dense]`,
      walk-past-wrapper for both flex and grid, no-flex-ancestor fallback,
      and the inner-flex-wins-over-outer-flex-column case.

### Task 3: Fix non-draggable `<p>` / `<h3>`

- [x] Find the gate in `_dragPointerDown` that bails. ROOT CAUSE: not a
      gate — `resolveDragSource` correctly returns `<p>`/`<h3>` with their
      own source. The gesture never reaches the `pending → dragging`
      threshold because the browser's native text-selection range absorbs
      pointermove on text containers. Fix in `_dragPointerDown`: after
      `_dragState = 'pending'`, call `e.preventDefault()` to suppress the
      compat-fired mousedown's default (selection start), set
      `document.body.style.userSelect = 'none'` (and webkitUserSelect) for
      the duration of the drag, and `target.setPointerCapture(e.pointerId)`
      so subsequent pointermove/pointerup events stay on our listener even
      if the browser tries to redirect them to a selection range. Restore
      both userSelect values and release the pointer capture in
      `_dragPointerUp` (always, even when the gesture was a click that
      never crossed `DRAG_THRESHOLD_PX`).
- [x] Make sure ANY source-bearing element with a non-zero bounding box can
      enter `pending` drag state. Confirmed: the only gates above
      `_dragState = 'pending'` in `_dragPointerDown` are
      `state.engineMode !== 'design'`, `e.button !== 0`, and
      `!resolved` from `resolveDragSource`. The resolver returns
      successfully for `<p>` / `<h3>` / `<span>` with text (own source
      via `getSourceLocation` or `_debugSource` fallback). With native
      text-selection no longer consuming pointermove, any such element
      now reaches `dragging` once the cursor moves more than
      `DRAG_THRESHOLD_PX = 5`.

### Task 4: AstService.moveElement for `<p>` / `<h3>` and inline `<span>`

- [x] Test via `bun test` against bulka fixtures: source = `<p>{t(...)}</p>`,
      target = sibling `<h3>...</h3>`. Should succeed. Done in
      `vscode-extension/hypercanvas-preview/src/__tests__/AstServiceMoveTextContainers.test.ts`
      — same-card sibling reorder block covers `<p>` before/after `<h3>`,
      `<h3>` after `<span>`, plus immediate-sibling-no-gap invariants.
- [x] Same for `<span>🌀</span>` source dropped onto another card. Both
      should land on the same JSX parent (lifted), with `before/after`
      reflecting the visual horizontal direction. Cross-card block in the
      same test file covers grid-cols-2 cards: `<p body-tail>` BEFORE
      `<h3 title-bark>`, `<span emoji-tail>` 🌀 AFTER `<span emoji-bark>`,
      `<h3 title-tail>` AFTER `<p body-bark>`. 9/9 tests pass; lint clean.
      Note: AstService.moveElement no longer requires "common JSX parent"
      pre-lift after the move-any-to-any merge (commit 40b0564e) — the
      different-parent splice path inside the same file handles the
      cross-card geometry directly. Lifting still happens in the iframe
      `_dragPointerUp` walk-up but is no longer a precondition at the RPC
      level.

### Task 5: E2E coverage for each case

- [x] PI-5-DR-NN-1: drag span emoji into flex-row siblings → assert
      horizontal insert. Added `drag-direction-flex-row-fixture` (grid
      grid-cols-2 with two emoji-cards mirroring the bulka layout) to
      `react-vite-tw4-twitter/src/components/TestElements.tsx` and the
      test in `e2e/tests/project-independent/drag-text-containers.spec.ts`.
      Asserts `.hyper-drop-indicator[data-dir="v"]` mid-drag (Task 2 fix
      lands the indicator vertical = horizontal insert direction; pre-fix
      the default `gridAutoFlow: 'row'` made `_isHorizontalLayout` return
      false → `data-dir="h"`). Also asserts source file mutated and
      `DD Beta` now precedes `DD Alpha` in source — proves the move went
      through end-to-end, not just visualised.
- [x] PI-5-DR-NN-2: drag `<p>` between siblings → file content shows the
      `<p>` moved. Added `drag-text-container-fixture` (flex-col with
      `<h3>`, `<p>`, anchor div) and `PI-5-DR-NN-2` test. Asserts
      `.hyper-drag-ghost` appears mid-drag — the only signal that the
      iframe entered `dragging` state and native text-selection did NOT
      absorb pointermove (Task 3 fix). Also asserts source file mutated
      and no "must share a direct JSX parent" console error.
- [x] PI-5-DR-NN-3: drag `<h3>` similarly. Same shape as NN-2 against
      `[data-testid="dd-h3"]`.

### Task 6: Build, install, screenshots, TG

- [x] `npm run package`, `code --install-extension`, reload. Built and
      installed `hypercanvas-preview-0.1.41.vsix` from this worktree via
      `vscode-extension/hypercanvas-preview/build-and-install.sh`.
- [x] Run new E2E. Open EACH passed screenshot via Read; verify visual.
      Ran `HYPER_E2E_SHARDS=1 HYPER_E2E_EXTENSION_REPO=<this-worktree> bun
run test:docker -- e2e/tests/project-independent/drag-text-containers.spec.ts`.
      All 3 passed (1.2m). Artifacts at
      `e2e/docker-artifacts/run-20260506-232042-30829/shard-1/screenshots/`.
      Read each mid-drag PNG: NN-1 shows two cards in horizontal grid layout
      with drag-ghost overlay; NN-2 shows `<p>` "DD paragraph text" with
      light selection-ghost (drag state reached); NN-3 same for `<h3>`.
- [x] Send only verified frames. Sent NN-1, NN-2, NN-3 mid-drag PNGs to
      Telegram via `send-tg-file.sh ... --photo` with captions naming
      Task 2 (grid horizontal inference) and Task 3 (pointer capture)
      fixes. Status report sent via `send-tg-report.sh`.
