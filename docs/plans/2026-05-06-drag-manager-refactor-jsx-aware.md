# Drag manager refactor — move JSX awareness into AstService.reorderElement

## Context

Current drag/drop pipeline mixes DOM heuristics with JSX-shape concerns inside
the drag manager (iframe-interaction.ts) and the drag-source-resolver. User
explicitly called this a kostyl: "Drag manager должно быть пофиг что там за
элементы можно тащить любой элемент куда угодно он не должен знать ничего про
эмоджи и карточки".

Right now there are two layers of compensation:

1. `shared/canvas-interaction/drag-source-resolver.ts` — walks up from a
   decorative `aria-hidden` span to its nearest source-bearing ancestor.
2. `shared/canvas-interaction/drop-target-lift.ts` — finds the lowest common
   DOM ancestor between drag source and drop target and promotes both sides
   to its direct children, so AstService.reorderElement gets siblings.

Both exist because `AstService.reorderElement` currently demands that source
and target are direct JSX siblings. If they aren't, it bails out with
"Elements must share a direct JSX parent".

## Goal

Push every JSX-shape decision down to `AstService.reorderElement`. The drag
manager only sends raw `sourceLocation` and `targetLocation` (and the
visual `position: 'before' | 'after'`). Server figures out the rest.

After this refactor, `drop-target-lift.ts` is **deleted**, and
`drag-source-resolver.ts` only does step 1+2 (resolve location of the
element under the cursor, with a single decorative-walk-up so we have a
real source for aria-hidden targets).

## Files to change

| File                                                                              | Change                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/services/AstService.ts` (and the VS Code AstBridge mirror)                | `reorderElement` accepts arbitrary source/target. Walks the JSX AST: finds the lowest common JSX parent, identifies the immediate-child of that parent on each side (`reorderable source`, `reorderable target`), then performs the reorder. Returns a structured error if either side has no path to a common parent (e.g. cross-component). |
| `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts` | `_dragPointerUp`: drop the `liftToCommonSiblings` call, drop `_resolveSourceWithFallback` for drop side. Send raw `sourceLoc` and `dropLoc` only.                                                                                                                                                                                             |
| `shared/canvas-interaction/drop-target-lift.ts`                                   | **Delete file** + delete its test file.                                                                                                                                                                                                                                                                                                       |
| `shared/canvas-interaction/drag-source-resolver.ts`                               | Keep as-is (decorative aria-hidden walk-up is still legitimate — the span genuinely has no JSX node of its own).                                                                                                                                                                                                                              |

## Acceptance Criteria

- [ ] Dragging an inner div / emoji / text-element inside a card and dropping
      onto another card REORDERS the cards (server-side lift).
- [ ] Dragging a card onto another card REORDERS the cards (no behavioural change).
- [ ] Dragging a deeply nested element onto a sibling of one of its ancestors
      reorders correctly (mid-tree common parent case).
- [ ] When source and target have no common JSX parent (cross-component or
      orphan), AstService returns a structured error and the drag manager
      shows a toast / no-op silently. No more "Elements must share a direct
      JSX parent" raw error from the user's perspective.
- [ ] `drop-target-lift.ts` is gone. `iframe-interaction._dragPointerUp` no
      longer calls `liftToCommonSiblings`.

## Tasks

### Task 1: Read the existing AstService.reorderElement implementation

- [ ] Read `server/services/AstService.ts` reorderElement function (and the
      VS Code mirror in `vscode-extension/hypercanvas-preview/src/bridges/AstBridge.ts`).
- [ ] Document its current input contract: what does it expect on
      `sourceLocation` and `targetLocation`? what JSX traversal does it do?
- [ ] Document where the "must share a direct JSX parent" error is thrown.

### Task 2: Add a JSX-aware `liftToCommonJsxParent` helper

- [ ] In `server/services/ast/` (or wherever the file-AST utilities live),
      add `function liftToCommonJsxParent(ast, sourceLoc, targetLoc): { sourceNode, targetNode } | { error }`.
- [ ] Walks AST, finds JSX nodes whose `loc` covers each location, walks
      their JSX-parent chains, finds the lowest common parent, then returns
      the immediate JSX-children of that parent on each side.
- [ ] Unit-test the helper (input AST + expected lift result) — at least 4
      cases: same-level siblings, deeply nested both sides, mixed depth,
      no common parent.

### Task 3: Use the helper in reorderElement

- [ ] Replace the current sibling-check in `reorderElement` with a call to
      `liftToCommonJsxParent`. If it returns nodes, splice them. If it
      returns `error`, propagate as a structured `ReorderError` (no more
      raw "must share a direct JSX parent" string).
- [ ] Run existing AST unit tests — assert no regressions.

### Task 4: Strip the DOM lift from iframe-interaction

- [ ] In `_dragPointerUp`, remove the `liftToCommonSiblings` block, the
      `_resolveSourceWithFallback` indirection for the drop side. Keep only:
      resolve drop element source via `iframeResolver.getSourceLocation` (with
      the existing decorative-walk-up if drop is aria-hidden).
- [ ] Send raw `sourceId` and `targetId` to `hypercanvas:reorderElement`.
- [ ] Delete `import liftToCommonSiblings` line.

### Task 5: Delete drop-target-lift module + its test

- [ ] Remove `shared/canvas-interaction/drop-target-lift.ts`.
- [ ] Remove `shared/canvas-interaction/drop-target-lift.test.ts`.
- [ ] Confirm no other module imports it (`grep`).

### Task 6: Add an E2E test for the cross-level drag (no DOM lift)

- [ ] In `../ext-test-projects/e2e/tests/project-independent/drag-reorder.spec.ts`
      add a case: drag the inner `<div>{t('test.greeting')}</div>` of the
      first card onto the second card → assert the two cards swapped order
      in the source file (read file content after drop).
- [ ] Run RED before refactor (current code may fail or only succeed because
      of the DOM lift), GREEN after.

### Task 7: Build, install, take E2E screenshot, send to TG

- [ ] `npm run package`, `code --install-extension`, reload.
- [ ] Run the new E2E case, capture before/after screenshots.
- [ ] `send-tg-photo.sh` with both shots and a critical visual review of
      what they prove.
