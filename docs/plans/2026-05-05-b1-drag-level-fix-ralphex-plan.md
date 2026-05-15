# B1/B4: Drag Source Resolves to Wrong Level

## Context

Dragging `<span aria-hidden="true">🌀</span>` or `<div>{t("ui.appearance.tail")}</div>` inside
Bulka's cards picks the wrong DOM element. `resolveDragSource` returns the inner `<div>` wrapper
inside the card instead of the outer card element. Consequently `AstService.reorderElement` fails
with "Elements must share a direct JSX parent" because the inner-div's parent is the card, but the
drop target's parent is the grid — they don't share a common parent.

### DOM structure (bulka-the-dog Index.tsx)

```
<div data-outer-card class="bg-secondary/60 ...">  ← SHOULD DRAG THIS (has card siblings)
  <span aria-hidden="true">🌀</span>               ← emoji, aria-hidden, no source
  <div>                                             ← inner-div — resolveDragSource STOPS HERE now
    <div class="font-semibold">{t("...")}</div>
    ...
  </div>
</div>
```

### Root cause

`resolveDragSource` (step 2) walks up and stops at the first ancestor with a source location.
That's the inner `<div>` wrapper. It has no source-bearing siblings (only the decorative emoji span),
so there's nothing meaningful to reorder at that level. The outer card is the real draggable unit
because it has source-bearing siblings (other cards in the grid).

### Fix heuristic

After finding the initial candidate element, **walk further up** until finding an element whose
siblings include at least one element with a source location. This identifies the "outermost
meaningful draggable" — an element at the same JSX level as peers that can participate in reorder.

If no sibling with a source is found all the way to body, fall back to the initial candidate.

## Files to Change

| File | Change |
|------|--------|
| `shared/canvas-interaction/drag-source-resolver.ts` | Add "sibling check walk-up" pass after initial source resolution |
| `shared/canvas-interaction/__tests__/drag-source-resolver.test.ts` | Add test for nested-wrapper scenario |

Do NOT modify `AstService.ts` — its same-parent constraint is correct and intentional.

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD: write a failing unit test first, then implement.
- Do NOT kill existing ralphex processes.
- Write progress to `.ralphex/progress/progress-2026-05-05-b1-drag-level.txt`.
- Telegram heartbeat every 15 min.

This ralphex run is isolated. Use this worktree:
```
/Users/ultra/work/hyper-canvas-draft-worktrees/20260505-b1-drag-level/hyper-canvas-draft
```

Create it with:
```bash
git -C /Users/ultra/work/hyper-canvas-draft worktree add \
  /Users/ultra/work/hyper-canvas-draft-worktrees/20260505-b1-drag-level/hyper-canvas-draft \
  -b HYP-b1-drag-level-fix ultra/hyp-363-vs-code-preview-webview-opens-offscreen-in-e2e
```

## Implementation Details

### resolveDragSource — new "sibling check walk-up" pass

After step 3 (fallback), before `return { source, el }`, add:

```ts
// Step 4: walk further up until we find an element with at least one source-bearing sibling.
// This ensures we resolve to the outermost meaningful draggable (e.g. outer card, not inner wrapper).
// Without this, clicking inside a nested wrapper resolves to that wrapper instead of its parent card.
el = walkToMeaningfulDraggable(el, getSourceLocation);
// Re-resolve source for the final element (it should still have a source from step 2/3).
const finalSrc = getSourceLocation(el);
if (finalSrc) source = finalSrc;
```

New helper function to add below `resolveDragSource`:

```ts
/**
 * Walk up the DOM from `el` until finding an element that has at least one sibling
 * with a resolvable source location. Returns that element, or the original `el` if
 * no such ancestor is found before reaching document.body.
 *
 * Purpose: resolve to the outermost "card-level" element rather than inner wrappers.
 * Example: in "grid > card > inner-div > text", clicking inner-div walks up to card
 * because card has siblings (other cards) with source locations, but inner-div's only
 * sibling is a decorative aria-hidden span with no source.
 */
function walkToMeaningfulDraggable(
  el: HTMLElement,
  getSourceLocation: (el: HTMLElement) => SourceLocation | null,
): HTMLElement {
  let cur: HTMLElement = el;
  while (cur.parentElement && cur.parentElement !== document.body) {
    const siblings = Array.from(cur.parentElement.children) as HTMLElement[];
    const hasMeaningfulSibling = siblings.some(
      (s) => s !== cur && getSourceLocation(s) !== null,
    );
    if (hasMeaningfulSibling) {
      return cur;
    }
    // No source-bearing sibling — go one level up if parent has a source (otherwise stop)
    const parentSrc = getSourceLocation(cur.parentElement);
    if (!parentSrc) break;
    cur = cur.parentElement;
  }
  return cur;
}
```

### Unit test additions

File: `shared/canvas-interaction/__tests__/drag-source-resolver.test.ts`

Test scenario: nested card structure:
- outer-card has `getSourceLocation` → returns `{fileName:'Index.tsx', line:10, column:2}`
- inner-div has `getSourceLocation` → returns `{fileName:'Index.tsx', line:15, column:4}`
- emoji-span has `getSourceLocation` → returns null (aria-hidden, no source)
- other-card (sibling of outer-card) has `getSourceLocation` → returns `{fileName:'Index.tsx', line:20, column:2}`

When drag target = emoji-span:
1. step1 skipped (decorative)
2. step2 finds inner-div (first ancestor with source)
3. step3 fallback not needed (already found)
4. step4 `walkToMeaningfulDraggable(inner-div)`:
   - inner-div's siblings = [emoji-span (no source)] → no meaningful sibling → walk up
   - outer-card has sibling other-card (has source) → STOP
   - returns outer-card

Assertion: `result.el === outer-card`.

When drag target = text-div inside inner-div:
- Similar result: should resolve to outer-card.

When drag target = card in a flat list (no nesting):
- card has siblings with sources → should resolve to card immediately (no extra walk-up).

### Task 1: Write RED unit test

- [ ] Read `shared/canvas-interaction/__tests__/drag-source-resolver.test.ts` if it exists.
- [ ] Add the nested-card test scenario described above.
- [ ] Run `bun test shared/canvas-interaction/drag-source-resolver` — confirm RED (walks to inner-div now).

### Task 2: Implement fix in drag-source-resolver.ts

- [ ] Read `shared/canvas-interaction/drag-source-resolver.ts`.
- [ ] Add `walkToMeaningfulDraggable` helper.
- [ ] Wire step 4 in `resolveDragSource` after step 3.
- [ ] Run `bun test shared/canvas-interaction/drag-source-resolver` — confirm GREEN.

### Task 3: Regression test — flat list still works

- [ ] Confirm the existing flat-list tests pass (no over-walk for elements already at correct level).
- [ ] Run full `bun test shared/canvas-interaction/` — no regressions.

### Task 4: E2E test in ext-test-projects

- [ ] Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` first.
- [ ] Open `ext-test-projects/e2e/tests/project-independent/drag-reorder.spec.ts`.
- [ ] Add test: drag the emoji span `[aria-hidden="true"]` inside a Bulka card to a sibling card position.
  - Start drag on the emoji span element.
  - Drop on a sibling card.
  - Assert: the OUTER card moved (check DOM order of cards changed), NOT the inner div.
  - Assert: no "Elements must share a direct JSX parent" error in console.
- [ ] Run test RED (before ext rebuild).

### Task 5: Build + install extension

- [ ] `cd /Users/ultra/work/hyper-canvas-draft-worktrees/20260505-b1-drag-level/hyper-canvas-draft/vscode-extension/hypercanvas-preview && npm run package`
- [ ] `code --install-extension hypercanvas-preview-*.vsix --force`
- [ ] Reload VS Code: `vscmd workbench.action.reloadWindow -p /Users/ultra/work/ext-test-projects/bulka-the-dog`

### Task 6: Run E2E test — GREEN

- [ ] Re-run the drag e2e test — should pass.
- [ ] Screenshot: before (inner-div dragged, no movement) and after (outer card reordered).

### Task 7: Lint + typecheck

- [ ] `bun lint` in worktree root.
- [ ] Fix any errors.

### Task 8: Commit

- [ ] Commit: `fix(drag): walk up to sibling-level element for drag source resolution`

### Task 9: Telegram

- [ ] Send TG with: what was wrong, what changed, screenshot of reorder working.
