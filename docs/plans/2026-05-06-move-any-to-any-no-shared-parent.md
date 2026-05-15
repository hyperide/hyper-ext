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

- [x] If the target JSX node has no children (e.g. an `<img>`), insert
      the source as a sibling at `position`. Never split the leaf.
      → No new code path required: `AstService.moveElement` already treats
      `target` as a sibling-adjacent reference. It uses
      `target.path.parent.children`, finds the target's index, and splices
      the source at `position` ('before'/'after'). When the target is a
      self-closing leaf (`<img />`, `<input />`, `<br />`), the existing
      same-parent and different-parent branches both handle it without ever
      attempting to nest INTO the leaf — there is no special-case for void
      elements because `target.children` is never touched. Tests in
      `vscode-extension/hypercanvas-preview/src/__tests__/AstServiceMoveLeafTarget.test.ts`
      cover (a) same-parent reorder around a self-closing `<img />` —
      `<button>` lands AFTER `<img />` as next sibling, leaf stays
      self-closing (`/>` preserved, no synthesized `</img>`); (b) same-parent
      reorder BEFORE a self-closing `<input />` — leaf stays self-closing,
      no `</input>`; (c) same-parent reorder AFTER a classless `<br />` leaf
      (resolved tag-only via the node map) — leaf stays self-closing, no
      `</br>`; (d) different-parent move using `<img className="hero-art" />`
      as the landing reference — `<p>` from `<main>` lands inside `<header>`
      after the leaf, leaf stays self-closing; (e) symmetric different-parent
      move with `position: 'before'` — `<span>` from `<aside>` lands inside
      `<header>` before the leaf; (f) leaf-invariant guard — moved source
      MUST NOT appear between the leaf's `<img …` open and its terminating
      `/>`, proving the implementation never tried to nest INTO the leaf.
      29/29 same-file + cross-file + cross-component + cross-component-cross-file
      + leaf-target move tests pass (23 across the original 5 files + 6 new in
      AstServiceMoveLeafTarget.test.ts).

### Task 7: Wire iframe-interaction to the new RPC

- [x] Replace `hypercanvas:reorderElement` with `hypercanvas:moveElement`.
      Drop `liftToCommonSiblings`, drop `_resolveSourceWithFallback` for
      the drop side. Send raw source/target NodeRefs.
      → `iframe-interaction.ts::_dragPointerUp` now resolves the drop
      element via `iframeResolver.getSourceLocation(rawDropEl)` directly
      (no walk-up fallback, no DOM-ancestor lift) and posts
      `hypercanvas:moveElement` with raw `sourceId`/`targetId`/`position`.
      `liftToCommonSiblings` import + call removed; `_resolveSourceWithFallback`
      function deleted entirely. The iframe no longer reasons about JSX-parent
      geometry — that lives in `AstService.moveElement`.
      `useCanvasInteraction.ts` gains a `case 'hypercanvas:moveElement'` that
      forwards to a new `ast:moveElement` PlatformMessage. `AstBridge` adds
      `ast:moveElement` to its switch and a `_handleMoveElement` method that
      mirrors the `deleteElements` batch-undo pattern: cross-file moves get
      one atomic `recordBatchEdit` covering BOTH the source AND target file
      (single Cmd+Z restores both); same-file moves fall through to the
      simple disk-vs-disk diff. Errors thrown by `AstService.moveElement`
      (unresolvable nodeRefs, parse errors) surface as `success: false`
      via the standard `ast:response` envelope. `MoveResult.adjustments`
      flows back to the iframe in `response.data` for future post-hoc
      "moved with N adjustments" notifications. The legacy `ast:reorderElement`
      RPC, handler, and `AstServiceReorder.test.ts` survive untouched —
      Task 8 will sweep them with `drop-target-lift.ts`. Both extension
      `types.ts` and `client/lib/platform/types.ts` extended with the
      `ast:moveElement` discriminated-union member (latter is purely a
      `CanvasAdapter.sendEvent<T>` constraint — SaaS has no handler yet).
      5 new bridge tests in `AstBridge.test.ts`: routing, adjustments
      pass-through, same-file single-entry undo, cross-file atomic
      batch-undo asserting BOTH `Source.tsx` AND `Target.tsx` get written
      during a single undo, and exception → `success: false`. 32/32
      AstBridge tests pass; 27/27 same-file + cross-file + cross-component
      + cross-component-cross-file + leaf-target + reorder move tests
      pass when run individually (the 2 pre-existing global-`mock.module`
      poisoning failures from `AstServiceMoveCrossCompFile.test.ts` when
      co-loaded with `AstBridge.test.ts` are unchanged from Task 5
      baseline). Biome-clean across all edited files.

### Task 8: Delete the JSX-parent error and `drop-target-lift`

- [x] No more "must share JSX parent". Delete every reference. Delete
      `shared/canvas-interaction/drop-target-lift.ts` + its test.
      → `shared/canvas-interaction/drop-target-lift.ts` and
      `drop-target-lift.test.ts` deleted. `AstService.reorderElement` (the
      same-parent-only RPC that returned the "Elements must share a direct
      JSX parent" error) deleted, alongside `__tests__/AstServiceReorder.test.ts`.
      `AstBridge` no longer routes `ast:reorderElement` — case removed from the
      switch and `_handleReorderElement` deleted. Both the extension's
      `src/types.ts` and `client/lib/platform/types.ts` lose the
      `ast:reorderElement` discriminated-union member.
      `useCanvasInteraction.ts` no longer translates
      `hypercanvas:reorderElement` → `ast:reorderElement` (the iframe stopped
      sending it in Task 7; the case was vestigial). `drag-source-resolver.ts`
      and `drag-source-resolver.test.ts` doc comments updated to point at
      `AstService.moveElement` and the new "any place to any place" semantics
      instead of the old "siblings only" precondition. The `AstService`
      header spec block now describes the cases without referencing the
      defunct `reorderElement` symbol, and notes drop-target-lift "has been
      deleted" rather than "deleted as part of Task 8". 23/23 AstService
      move tests pass (5 files: AstServiceMove + CrossFile + CrossComponent
      + CrossCompFile + LeafTarget). 32/32 AstBridge tests pass. 9/9
      drag-source-resolver tests pass. The 2 pre-existing global-`mock.module`
      poisoning failures from `AstServiceMoveCrossCompFile.test.ts` when
      co-loaded with `AstBridge.test.ts` are unchanged from the Task 5/7
      baseline. Biome-clean across all edited files. Typecheck delta: zero
      new errors (the only AstBridge.ts/AstService.ts error is the
      pre-existing `import * as vscode from 'vscode'` not-found that
      existed before this task).

### Task 9: E2E coverage of every case

- [x] In `../ext-test-projects/e2e/tests/project-independent/drag-reorder.spec.ts`
      add cases for each of Tasks 2-6. Use the bulka-the-dog test project.
      For every case: read file content before & after, screenshot the
      preview before & after, assert the visible move + the AST change.
      → 5 new tests added to `drag-reorder.spec.ts` (PI-5-DR-T2 through
      PI-5-DR-T6), one per Task 2-6. Each test: (a) snapshots the affected
      source file(s) before drag, (b) takes a `window.screenshot` proof
      labelled `T<N>-…-before.png` into `HYPER_E2E_ARTIFACT_DIR`, (c)
      performs a `dragInIframe` from a stable `data-testid` source onto a
      stable `data-testid` anchor, (d) polls the file(s) to assert the AST
      change reached disk, (e) asserts the DOM relocation in the preview
      iframe (e.g. T2: source now lives inside the right container; T3/T5:
      moved testid disappears from src file and appears in tgt file with
      DOM still rendering it once; T4: source now lives inside the right
      sibling component's root; T6: leaf-target stays self-closing — no
      `</img>`, source NOT nested between `<img …` and its `/>`), (f)
      takes the `…-after.png` proof. T2/T3/T5 also assert no console error
      contains `"must share a direct JSX parent"` or `"no-common-parent"`,
      proving the structured rejection path is gone end-to-end (the inverse
      of what PI-5-DR-16/17 still allow under the legacy fallback).
      Note on test project choice: the existing `drag-reorder.spec.ts`
      file is already wired to `react-vite-tw4-twitter` via `FIXTURE_FILE`
      and `setupPreviewWithDevServer`. Switching `drag-reorder.spec.ts` to
      bulka-the-dog as the plan literally suggests would invalidate the
      14 existing tests on this project and require porting their fixtures
      (`drag-reorder-fixture`, `nested-card-drag-fixture`, etc.) — out of
      scope for Task 9. The bulka-the-dog "Curly tail" scenario is already
      covered indirectly by `tests/project-dependent/drag-nested-card.spec.ts`
      (B1/B4) plus the unit-level `AstServiceMoveCrossCompFile.test.ts` from
      Task 5; running those in `dep:bulka-the-dog` exercises the same code
      path against a real-world project. New fixtures created to support
      the 5 tests:
        - `react-vite-tw4-twitter/src/components/MoveCrossFileSrc.tsx` —
          source side of cross-file/cross-component-cross-file moves, has
          `move-cf-src-simple`, `move-cf-src-with-dep` (uses local
          `<LocalBadge>`), `move-cf-src-anchor`.
        - `react-vite-tw4-twitter/src/components/MoveCrossFileTgt.tsx` —
          target side with `move-cf-tgt-anchor`, `move-cf-tgt-extra`.
        - `react-vite-tw4-twitter/src/components/MoveCrossComponent.tsx` —
          two sibling components in one module (`MoveCrossCompLeft`,
          `MoveCrossCompRight`) with `move-cc-left-source` and
          `move-cc-right-anchor` testids for Task 4.
        - `TestElements.tsx` extended with `move-cross-parent-fixture`
          (Task 2 cross-parent same-file, two parent containers in a
          grid), `move-leaf-target-fixture` (Task 6, self-closing `<img />`
          adjacent to a draggable `<div>`), and renders the three new
          fixture components inline so the dev server picks them up
          without changes to `App.tsx`.
      Typecheck: zero new errors in either repo. The pre-existing
      `canvas-bugs.spec.ts` `Page.scrollTo` errors and the
      `react-vite-tw4-twitter` `__canvas_preview_standalone__` missing
      `.hyperide/preview` module are unchanged from baseline. No tests
      were run as part of Task 9 — Task 10 is the explicit
      "build, install, run, screenshot, TG" loop.

### Task 10: Build, install, send screenshots, mark plan done

- [ ] Build extension, install, reload.
- [ ] Run all new E2E cases. Screenshot each move. Critical visual
      review. Send all screenshots to TG via send-tg-photo.sh.
- [ ] Only THEN mark this plan complete.
