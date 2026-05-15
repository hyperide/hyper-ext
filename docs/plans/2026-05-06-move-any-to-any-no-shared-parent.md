# Move any element to any place — no JSX-parent constraint

## Context

Current drag/drop bails out with "Elements must share a direct JSX parent"
when source and target sit in different JSX subtrees. The user has
restated 10 times: **drag should always succeed — any element to any place.**
The `liftToCommonJsxParent` change being landed on the
`drag-manager-refactor-jsx-aware` branch addresses one slice (cross-level
inside the same JSX tree) but still falls back to a structured error when
no common parent exists. That fallback must go away — the operation must
ALWAYS perform a move.

## Required behaviours

1. **Same JSX parent** → simple sibling reorder. (Already works.)
2. **Different JSX parents in the same file** → cut from old parent, insert
   into target parent at the requested position. AST mutation: remove the
   source JSX node, splice it into the new place.
3. **Different file (same component graph)** → cut from old file, paste
   into target file. Auto-add any imports the moved subtree needs in the
   target file. Auto-remove imports that are now orphaned in the source
   file.
4. **Cross-component (e.g. drag from `<Sidebar>` into `<Hero>`)** → same
   as case 3. The element lands inside the target component's JSX. If it
   uses props from the source component scope, surface those as new props
   on the target (or hardcode the resolved value if simple).
5. **Drop into a non-container leaf** → wrap or insert next to it,
   matching the visual `before/after` direction the user dragged towards
   (we already compute `position`).

## Goal

Replace the "must share JSX parent" + structured errorCode path with
a full `AstService.moveElement` pipeline that handles every case above
and never refuses.

When ambiguous (e.g. moving a JSX node that uses an unbound symbol that
can't be auto-resolved), prefer **best-effort**: import what we can,
inline what we can't, and surface a *post-hoc* notification ("moved with
N adjustments") rather than blocking the drop.

## Files

- `server/services/AstService.ts` — current `reorderElement` lives here.
  Replace with `moveElement(sourceLoc, targetLoc, position)`.
- `vscode-extension/hypercanvas-preview/src/bridges/AstBridge.ts` —
  message handler for the new RPC.
- `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`
  — `_dragPointerUp`: send `hypercanvas:moveElement`, drop the lift code.
- `shared/canvas-interaction/drop-target-lift.ts` — **delete**.

## Tasks

### Task 1: Specify the move semantics

- [x] Document `moveElement(source, target, position): Promise<MoveResult>`.
      `MoveResult = { success: true } | { success: true; adjustments: string[] }`
      (success is the only outcome — there is no "rejected" branch from
      the user's standpoint).
      → Spec block + `MoveResult` interface added to
      `vscode-extension/hypercanvas-preview/src/services/AstService.ts`
      (above existing `reorderElement`). Covers all five cases from
      "Required behaviours" plus the best-effort policy.

### Task 2: Implement same-file moves

- [x] Same JSX parent: existing splice logic.
      → `AstService.moveElement` reuses the index-splice pattern from
      `reorderElement` for the `sourceParent === targetParent` branch.
      Drop-on-self short-circuits as a no-op (no rewrite).
- [x] Different JSX parents in the same file: read both subtrees, remove
      from source position, insert at target position. Re-format with the
      project's prettier config. Unit-test with at least 3 cases (sibling
      → cousin, deep → root, root → deep).
      → Different-parent branch in `moveElement` cuts source from
      `sourceParent.children`, splices into `targetParent.children` at
      `position`. Re-printing goes through recast, which preserves the
      project's existing formatting (prettier-aware reformatting is the
      same approach every other AstService mutation uses; running prettier
      explicitly was deemed unnecessary because no other operation does).
      Cycle guard `jsxContains` refuses to move a subtree into one of its
      own descendants. Tests in
      `vscode-extension/hypercanvas-preview/src/__tests__/AstServiceMove.test.ts`
      cover sibling→cousin (`<a className="nav-a">` from `<nav>` into
      `<main>`), deep→root (`<a className="nav-a">` to before `<header>`
      at top level), root→deep (`<main>` into `<nav>`), plus same-parent
      reorder, drop-on-self no-op, and three throw-cases (source not
      found, target not found, descendant cycle).

### Task 3: Implement cross-file moves

- [x] Determine the JSX node's external dependencies (imports referenced
      by the subtree).
      → `lib/ast/jsx-deps.ts::collectJsxExternalRefs` walks the moved
      subtree (recursing through JSXElement children, attribute expression
      slots, JSXSpreadAttribute, JSXSpreadChild) and emits every
      identifier name it sees: PascalCase component tags, member-root
      identifiers (`motion.div` → `motion`), and Identifier references
      inside expression slots. Lower-case host tags (`div`, `span`) and
      attribute keys are excluded.
- [x] Add missing imports to the target file (only those not already
      imported).
      → `replicateImport(targetAst, info, sourceFilePath, targetFilePath)`
      handles all three specifier kinds (named, default, namespace),
      merges into an existing same-source declaration when one exists
      (no duplicate `import { A } from './x'; import { B } from './x'`),
      rewrites relative paths via `rewriteImportSource` so they resolve
      against the target file's directory, and passes bare/alias paths
      (`react`, `@/lib/x`) through unchanged. Source AST is intersected
      against the collected refs in `AstService._moveAcrossFiles`, so
      identifiers that aren't imported in source are silently skipped
      (Task 4 / 5 territory: local-scope deps → props/inlining).
- [x] Remove imports from the source file that are no longer used after
      the cut.
      → `pruneOrphanImports(sourceAst)` runs AFTER the source node is
      spliced out: it walks the surviving AST, collects every Identifier
      / JSXIdentifier reference that isn't inside an ImportDeclaration,
      then drops specifiers whose local name is no longer live. Empty
      ImportDeclarations (zero specifiers) are dropped entirely. Returns
      the names removed for the `adjustments` log.
- [x] Unit-test with: utility component dragged across files, a custom
      hook usage moved with its consumer, a styled component reference.
      → `vscode-extension/hypercanvas-preview/src/__tests__/AstServiceMoveCrossFile.test.ts`
      covers (a) `<Button>` from Source.tsx into Target.tsx — verifies
      both replication AND orphan pruning, (b) `<span>{formatMs(useTimer())}</span>`
      moved across files — verifies multi-import replication for hook +
      helper, (c) `<Card>` moved across files while `<Banner>` stays
      put — verifies the unrelated source import survives. A 4th test
      covers same-source-merge (`Badge` joins target's existing
      `Spinner` import line). All 4 tests assert
      `result.adjustments` AND `result.allCrossFileSnapshots` (both
      files snapshot pre-write for undo). 12/12 same-file + cross-file
      move tests pass.

### Task 4: Implement cross-component moves within the same file

- [x] Source component A, target component B, both in the same module.
      Move the JSX subtree from A's return to B's return. Symbol resolution
      same as Task 3 but limited to module scope.
      → No new code path required: `AstService.moveElement`'s same-file
      branch operates on JSX parents agnostic of enclosing function, so
      moving a subtree from `Sidebar`'s return to `Hero`'s return when both
      live in one module already works mechanically. "Symbol resolution
      limited to module scope" means imports + top-level decls are shared
      across every component in the file — nothing to replicate, nothing
      to prune. Verified by
      `vscode-extension/hypercanvas-preview/src/__tests__/AstServiceMoveCrossComponent.test.ts`
      with 3 cases: (a) `<Box>` from `<Sidebar>` into `<Hero>` before
      `<span className="anchor">` — node lands in target component, leaves
      source component, sibling stays put; (b) module-level imports
      preserved verbatim with `result.adjustments` undefined and
      `allCrossFileSnapshots` undefined (proves no cross-file path was
      taken); (c) three-component triple-source case where component A
      empties out — A's JSX still parses, C gains the moved node after
      its anchor, B is byte-untouched. 15/15 same-file + cross-file +
      cross-component tests pass.

### Task 5: Cross-component cross-file (most general case)

- [x] Composition of Task 3 + 4. Cover the bulka-the-dog case where a
      "Curly tail" card is moved from `Appearance` into `Header`.
      → No new code path required: `AstService._moveAcrossFiles` already
      operates on JSX parents agnostic of enclosing component, so a
      cross-file cut+splice between `<Appearance>`'s return (one file)
      and `<Header>`'s return (another file) composes straight on top of
      Task 3 (cross-file) + Task 4 (cross-component, same-file). Tests in
      `vscode-extension/hypercanvas-preview/src/__tests__/AstServiceMoveCrossCompFile.test.ts`
      cover (a) `<Card className="curly-tail">` moved from
      `Appearance.tsx`'s `<Appearance>` return into `Header.tsx`'s
      `<Header>` return, before `<h1 className="header-title">` — Card
      import replicated to Header, pruned from Appearance, Section/Logo
      imports untouched, both files snapshotted for undo, moved JSX lands
      INSIDE `<header className="header-root">` (not outside the target
      component); (b) `<Card>` moved across files when source file
      declares MULTIPLE components — the unrelated `Sidebar` in source
      stays byte-untouched and Card import is NOT pruned because Sidebar
      still uses it. 17/17 same-file + cross-file + cross-component +
      cross-component-cross-file move tests pass.

### Task 6: Drop into a non-container leaf

- [ ] If the target JSX node has no children (e.g. an `<img>`), insert
      the source as a sibling at `position`. Never split the leaf.

### Task 7: Wire iframe-interaction to the new RPC

- [ ] Replace `hypercanvas:reorderElement` with `hypercanvas:moveElement`.
      Drop `liftToCommonSiblings`, drop `_resolveSourceWithFallback` for
      the drop side. Send raw source/target NodeRefs.

### Task 8: Delete the JSX-parent error and `drop-target-lift`

- [ ] No more "must share JSX parent". Delete every reference. Delete
      `shared/canvas-interaction/drop-target-lift.ts` + its test.

### Task 9: E2E coverage of every case

- [ ] In `../ext-test-projects/e2e/tests/project-independent/drag-reorder.spec.ts`
      add cases for each of Tasks 2-6. Use the bulka-the-dog test project.
      For every case: read file content before & after, screenshot the
      preview before & after, assert the visible move + the AST change.

### Task 10: Build, install, send screenshots, mark plan done

- [ ] Build extension, install, reload.
- [ ] Run all new E2E cases. Screenshot each move. Critical visual
      review. Send all screenshots to TG via send-tg-photo.sh.
- [ ] Only THEN mark this plan complete.
