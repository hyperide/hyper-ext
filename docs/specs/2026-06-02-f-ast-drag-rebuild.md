# Feature F — AST Drag Reorder/Swap — Rebuild Spec

**Date:** 2026-06-02
**Linear:** HYP-272 (server move/swap), HYP-273 (client operations), HYP-274 (drag hook)
**Status:** AWAITING CTO REVIEW — do not implement until product decision below is made.
**Source:** Phase 1 branch `HYP-phase1-visual-foundation`; salvage analysis
`docs/specs/2026-06-02-phase1-visual-foundation-salvage.md`.

---

## What this feature is

Physically move JSX nodes within a file by drag & drop in the canvas — reorder
siblings, move into a different parent, swap two elements. The change is a
**structural edit to the source file** (the AST is mutated and written back).

This is **not** the CSS-order drag that main already ships
(`shared/canvas-interaction/order-drag-detect.ts`), which only rewrites Tailwind
`order-*` classes and never touches JSX structure. The two are orthogonal:
order-drag is visual-only cosmetics; AST-drag is source control.

---

## Why it is a rebuild, not a salvage

Phase 1's implementation is coupled to a substrate `main` has since abandoned:

| Phase 1 mechanism | Current main | Verdict |
| --- | --- | --- |
| Element identity = `data-uniq-id` attribute in the preview DOM | Removed by HYP-268; identity is now a fiber-based `nodeRef` (`file:line:col` [+ itemIndex]) resolved via `ElementTracer` | Element resolution must be rewritten |
| `useElementDrag` walks the DOM via `[data-uniq-id]` selectors to find drop targets | No such attribute; drop targets resolve through the tracer's fiber chain | Rewrite |
| Server routes `moveElement` / `swapElements` resolve via `findElementByUuid` | Deleted in main; current AST routes use `resolveElement({ nodeRef, ast })` + `findElementByPosition` | Rewrite on nodeRef |
| `ASTMoveOperation` / `ASTSwapOperation` call `engine.moveElement()` / `.swapElements()` | Those methods do not exist on main's `CanvasEngine` | Add methods |

**Reusable as-is (≈40%):** `drag-handler.ts` (pure mousedown/move/up state machine,
no substrate coupling), sibling-geometry + drop-indicator + spacing-guides
rendering, and the pure AST mutation bodies (`moveElementInAST`,
`swapElementsInAST`) extracted as functions.

**Already exists, not to be duplicated:** the VS Code extension already implements
`AstService.moveElement()` (fiber-based, same-file **and** cross-file). The SaaS
layer simply never wired an equivalent path. A platform message type
`ast:moveElement` is declared in `client/lib/platform/types.ts` with no SaaS handler.

---

## PRODUCT DECISIONS REQUIRED (blocking)

1. **Is structural AST-drag wanted in SaaS at all**, given CSS-order-drag already
   ships? They solve different problems, but the user-visible gesture (drag to
   reorder) overlaps — shipping both may confuse. Options:
   - (a) Build AST-drag as a distinct mode/affordance.
   - (b) Skip — CSS-order-drag is enough for the near term.
2. **Scope: same-file only, or cross-file?** Same-file is simpler; the VS Code
   extension already does cross-file. Recommend starting same-file.
3. **Map-rendered elements:** Phase 1 *blocked* reordering elements rendered via
   `.map()` (`notifyMapNotSupported`). Keep that limitation, or support it?

These are genuine product calls; sinking the ~1–2 week rebuild before answering
them risks wasted work.

---

## Proposed implementation (if approved)

### PR 1 — Server + AST foundation (isolatable, testable; no UI yet)
- `lib/ast/operations.ts`: pure `moveElementInAST(ast, sourcePath, targetPath, position)`
  and `swapElementsInAST(ast, pathA, pathB)` (adapted from Phase 1's route bodies).
- `server/routes/moveElement.ts`, `server/routes/swapElements.ts`: resolve via
  `resolveElement({ nodeRef, ast })`, call the pure helpers, write AST, fire
  `afterMutation`. **Must use the path-traversal guard** (`validateFilePath` +
  request-authorized `checkedProject.path`) once HYP-401/#255 lands; until then,
  mirror the current AST-route project/security pattern exactly.
- `CanvasEngine.moveASTElement(nodeRef, filePath, targetNodeRef, position)` and
  `swapASTElements(...)` + `ASTApiService(Impl)` methods. These are stubs with no
  UI caller in this PR — call that out; PR 1 alone does not ship user value.
- Tests: unit (`operations.test.ts`: sibling reorder, cross-parent, swap) + route
  tests (happy + traversal/not-found).

### PR 2 — `useElementDrag` rewrite on the tracer (UI)
- Rewrite element + drop-target resolution to use `ElementTracer`
  (`resolveClickLocal`, fiber parent chain, `getItemIndex`) instead of
  `[data-uniq-id]`. Keep Phase 1's geometry/indicator/spacing-guides logic.
- Drop action calls `engine.moveASTElement(...)` (target-relative before/after,
  not parent+index).
- Wire the hook + tracer into the Editor canvas.
- Tests: drop-position calc (reuse Phase 1 vectors); integration with a mocked
  tracer asserting `moveASTElement` args. Visual verification mandatory.

### PR 3 — Swap UI + polish (optional, post-MVP)
- Swap on drop-onto-another-selected-element; undo/redo via the operations;
  cursor/feedback polish.

**Estimate:** ~1–2 weeks after sign-off; ~600 LOC new/adapted.

---

## Risks
- **Undo/redo async**: Phase 1's operation returns success before the server
  responds; confirm `HistoryManager` awaits the pending promise or the undo stack
  desyncs on server failure.
- **Map reorder**: shared source ref across `.map()` instances (see the
  Shift+Enter multi-instance note in project memory) — reordering one instance is
  ambiguous; this is why Phase 1 blocked it.
- **Gesture overlap with CSS-order-drag** (product decision 1).

---

## Do NOT
- Copy Phase 1's `findElementByUuid`, `ASTMoveOperation`/`ASTSwapOperation`, or the
  old server routes verbatim — they are nodeRef-incompatible.
- Build PR 1's server routes as the *only* deliverable — orphan routes with no
  caller are dead code until PR 2 lands.
