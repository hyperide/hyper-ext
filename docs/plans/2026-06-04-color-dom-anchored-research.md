# HYP-537 — Color pick must replace the value currently applied in the DOM (HYP-515 follow-up)

Research + design. Linear: HYP-537. Follow-up to HYP-515 / PR #353.

## Problem restated

HYP-515 made inspector color picks on complex-expression classNames strip the conflicting
same-Tailwind-group class from the **static** string literals of the expression
(cn/clsx/ternary/template/BinaryExpression). Documented limitation: a conflicting color living
ONLY in a dynamic sub-expression (`cn("p-2", cond && "text-red-500")`, or an opaque variable)
is NOT rewritten; the new class is appended. CTO directive: anchor on the CURRENT ACTUAL VALUE
applied in the DOM.

## The live applied value IS available client-side, but DROPPED before the writer

End-to-end trace of the live resolved className (`domClasses`):

- `client/lib/dom-utils.ts:28` `getDOMClassesFromIframe` → `element.className` (cn() resolved,
  dynamic branches included).
- `client/components/RightSidebar/hooks/useStyleSync.ts:140` captures it, passes via
  `engine.updateASTStyles(..., { domClasses })` (148-154).
- Threaded: `ASTStyleOperation.ts:74` → `CanvasEngine.ts:578` → `PlatformContext.tsx:313,441`
  → `ASTApiService.ts:131` (`UpdateStylesParams.domClasses`). Rides the RPC body.

Then dropped — consumed by nobody on the backend:

- SaaS `server/routes/updateComponentStyles.ts:96` destructures the body WITHOUT `domClasses`
  (interface 17-64 doesn't even declare it).
- VS Code `src/bridges/AstBridge.ts:325` message has no domClasses; forwards to
  `AstService.updateStyles` (`src/services/AstService.ts:635`, no domClasses param) →
  `executeStyleWriteRequest` (`lib/style-write/style-write-executor.ts:260`, no live input).
- `StyleWriteContext` (`lib/style-write/types.ts:223-230`) has no fiberTrace / runtime classes,
  unlike `StyleReadContext` (`lib/style-read/types.ts:504-510`, has `fiberTrace`).

The read side is already DOM-anchored (`TailwindAdapter.read` "Prefers DOM classes (actual
runtime) over AST", `client/lib/canvas-engine/adapters/TailwindAdapter.ts:82`). The write side
is not.

## The discriminator is WHERE the color lives, not which `cn` variant — three tiers

1. **Static literals + ternary branches** — HYP-515 handles
   (`replaceConflictingInStaticLiterals` recurses StringLiteral / ConditionalExpression /
   BinaryExpression / merge-call StringLiteral args).

2. **`cond && "text-red-500"` — a string literal inside a `LogicalExpression`** — was NOT
   handled (the mutator had no `isLogicalExpression` case). **Bounded, AST-only.** Real
   occurrence: `ext-test-projects/bulka-the-dog/client/components/ui/form.tsx:96`
   `cn(error && "text-destructive", className)`. **FIXED in this PR.**

3. **Opaque source** — color from a prop/variable/spread (`cn("...text-grey-01...",
titleClassName)`). No string literal to rewrite; only the DOM knows the active token. Real
   occurrence (the exact shape the HYP-515 commit cited):
   `ext-test-projects/conloca-monorepo/targets/conloca-app/src/app/ui/HostListRow.tsx:34`. And
   conloca's `cn` is `import cn from 'clsx'` (plain clsx, NO tailwind-merge anywhere in the
   repo) — so attribute/source order does NOT deterministically pick the winner; Tailwind's
   generated-CSS order does. **Genuine architectural + product residual — ESCALATED, not fixed.**

## Tier 2 fix (shipped here): REPLACE, don't append — no DOM value, no RPC plumbing

For `cn("p-2 text-red-500", cond && "text-green-500")` with a `color` pick of `text-blue-500`:
HYP-515 rewrote arg-1's static literal to blue, but the `cond && "..."` arg made
`hasUnanalyzableArg = true → guaranteedNewClass = false`, so `wrapInConcatenation` appended
OUTSIDE the call: `(cn(...)) + ' text-blue-500'`. At runtime clsx does no merge, the concat tail
isn't re-merged, CSS order decides → pick could lose, and the old branch color survived.

Fix: a `LogicalExpression` (`&&`/`||`) case in `replaceConflictingInStaticLiterals` that recurses
the RIGHT operand and STRIPS the conflicting color via the existing `removeConflictingClasses`,
but does NOT inject the new class into the branch and does NOT set `guaranteedNewClass` (so the
caller still appends once outside). New `stripConflictInLiterals` helper does strip-without-inject
(recurses parens/logical/ternary/concat/merge-call args). The merge-call arg loop now recurses
LogicalExpression args too. Net: `cn("p-2", cond && "")` + appended `text-blue-500` → blue on
every runtime path, no competing token survives, clsx-vs-twMerge ordering irrelevant.

Safe — narrows HYP-515's over-conservative documented limitation: that limitation feared
"dropping the color on the false branch", but a `&&`/`||` short-circuit "off" path is **already
colorless**, so stripping the consequent drops nothing. Ternary (`?:`) is deliberately left to the
existing ConditionalExpression case (both branches carry a class, so stripping one there WOULD be
a semantic change — HYP-515's caution stands for `?:`). Two existing tests that asserted the old
limitation behavior were updated to assert the new correct REPLACE behavior.

## Tier 3: ESCALATE — the genuine architectural + product fork (NOT in this PR)

Conloca's failing case is tier 3 (opaque `titleClassName`, plain clsx). Even WITH the live DOM
value you cannot make the pick win in plain clsx without a precedence decision, because the
override token lives in an opaque arg we won't rewrite. Options for the CTO:

- (a) Tailwind `!` important modifier on the appended class (`text-blue-500!`) — deterministic
  win, but also beats hover/responsive variants (over-wins).
- (b) Inject `tailwind-merge` + wrap the whole expression — changes the user's util, build risk
  if absent, alters merge behavior for the whole expression. Rejected as a "safe default".
- (c) Accept the limitation (current behavior: append, may lose under plain clsx).

Plus the plumbing tier 3 needs: `domClasses` → `ExecuteStyleWriteRequestInput.appliedClassName`
→ through the SaaS route + VS Code AstBridge/AstService message. Crosses general working code in
`server/` and `vscode-extension/` — multi-layer RPC change, NOT a one-file bounded fix. Deferred
to a product decision on (a)/(b)/(c) first.

## Two side-tickets worth filing regardless

- `domClasses` collected client-side then dropped on the backend write path (dead plumbing).
- `FiberTraceResult.runtimeClasses` misnamed: `StyleReadService.ts:187` fills it from the
  AST-static className (`StyleReadService.ts:149`), not the live DOM value.
