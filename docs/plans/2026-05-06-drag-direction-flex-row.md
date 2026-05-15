# Drop direction wrong for flex-row + drag of nested span/p

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

- [ ] Open `bulka-the-dog/client/pages/Index.tsx` in Hyper Canvas
- [ ] Confirm: drag span emoji 🌀 between two horizontal cards lands the source
      ABOVE/BELOW (vertical insert), not LEFT/RIGHT.
- [ ] Confirm: drag `<p>` does nothing — pointerdown does or doesn't fire?
- [ ] Confirm: drag `<h3>` same.
- [ ] Capture per-frame DOM state with diagnostic console.

### Task 2: Fix horizontal-layout inference for flex-row

- [ ] In `_isHorizontalLayout`, walk up the parent chain until finding the
      flex/grid container that is the ACTUAL sibling level (where drop and
      source share the same parent). Use that container's flex-direction,
      not `dropEl.parentElement`.
- [ ] Unit-test `chooseIndicatorOrientation` against a mock parent chain
      where the immediate parent is a wrapper div with no display, but the
      grandparent is `flex-row`.

### Task 3: Fix non-draggable `<p>` / `<h3>`

- [ ] Find the gate in `_dragPointerDown` that bails. Most likely:
      - element is a text-formatting container with `user-select: text`
      - aria-hidden walk-up triggers but resolver returns null because
        `getSourceLocation(p)` fails for a server-rendered text node
- [ ] Make sure ANY source-bearing element with a non-zero bounding box can
      enter `pending` drag state.

### Task 4: AstService.moveElement for `<p>` / `<h3>` and inline `<span>`

- [ ] Test via `bun test` against bulka fixtures: source = `<p>{t(...)}</p>`,
      target = sibling `<h3>...</h3>`. Should succeed.
- [ ] Same for `<span>🌀</span>` source dropped onto another card. Both
      should land on the same JSX parent (lifted), with `before/after`
      reflecting the visual horizontal direction.

### Task 5: E2E coverage for each case

- [ ] PI-5-DR-NN-1: drag span emoji into flex-row siblings → assert
      horizontal insert (X coordinate of moved element changes, Y stays).
- [ ] PI-5-DR-NN-2: drag `<p>` between siblings → file content shows the
      `<p>` moved.
- [ ] PI-5-DR-NN-3: drag `<h3>` similarly.

### Task 6: Build, install, screenshots, TG

- [ ] `npm run package`, `code --install-extension`, reload.
- [ ] Run new E2E. Open EACH passed screenshot via Read; verify visual.
- [ ] Send only verified frames.
