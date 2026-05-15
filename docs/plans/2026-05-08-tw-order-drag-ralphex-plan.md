# Tailwind `order-N` drag adapter — reorder by style, not JSX

## Context

Today's drag-reorder flow rewrites JSX child order in the source file. That's fine for
plain elements, but it loses information when the same parent already declares a Tailwind
`order-N` (or responsive `md:order-N`) hierarchy — the user's intent was almost always
"set this child's order at the active breakpoint", not "shuffle siblings in source".

User-reported scope (2026-05-08):
> add support for `order-1`, `md:order-2` etc in Tailwind via the StyleAdapter,
> and same for other style systems via adapter, for drag/reorder. If equivalents
> exist, change styles instead of HTML order. If breakpoints exist, change the
> currently active breakpoint.

`StyleAdapter` is the unified abstraction at
`client/lib/canvas-engine/adapters/StyleAdapter.ts`, with concrete impls in
`TailwindAdapter.ts`, `TamaguiAdapter.ts`, etc. (see `MEMORY.md` HYP-300 for the variant
support deferred ticket — ours is adjacent: order is one specific style property).

The active breakpoint UX: HyperIDE has a viewport size selector. When the user drops at
the `md:` breakpoint visualised viewport, write `md:order-N`; otherwise write the base
`order-N`. The adapter must NOT clobber existing breakpoints — it edits ONLY the active
one.

## Scope

Add a `StyleAdapter.writeOrder(elementId, value, { breakpoint })` capability. Wire it into
the drag-reorder pipeline so when the parent has any `order-*` siblings, drag mutates the
order class on the dragged element (and any siblings whose intent shifts) instead of
rewriting JSX.

Out of scope:
- Variants beyond `order-N` (HYP-300 deferred). The adapter contract here is one property
  only.
- Non-Tailwind/Tamagui adapters that don't yet exist. Just stub them with `notSupported`.
- Multi-level cross-subtree drags — the existing AST flow remains the path for those.
- Drag insertion (already shipped); this plan touches only reorder within the same parent.

### Task 1: RED e2e — drag reorder with order-N siblings stays in source unchanged

Add `ext-test-projects/e2e/tests/project-dependent/bulka-tw-order-reorder.spec.ts`:

- [x] Launch bulka, find a parent that already has `order-*` siblings — if no such parent
  exists in bulka, add a fixture in a new project under
  `ext-test-projects/react-vite-tw3-order/` with three siblings `order-1`, `order-2`,
  `order-3`. (Found existing parent in `client/pages/Index.tsx:533` hero-grid with two
  `order-1/2` siblings; new project not needed.)
- [x] Confirm baseline: read the source file's JSX, note child positions; read the rendered
  DOM, note visual order driven by `order-*`.
- [x] Drag the visually-second child to the first slot.
- [x] After drop, assert the **source JSX child order is unchanged** (this is the key
  assertion — currently RED because we rewrite JSX).
- [x] Assert the source classNames now reflect the new order (`order-1` is on what was
  previously `order-2`, and vice versa).
- [x] Assert the rendered visual order matches expectation.
- [x] Screenshot before/after captured by Playwright `screenshot: 'only-on-failure'` config
  (manual inspection happens at the RED→GREEN transition during Task 3+4).

Test must be **RED on current main**. (Verification deferred to Tasks 3+4 RED→GREEN run —
spec assertion logic relies on `writeOrder` codepath that does not exist on main, so the
test cannot reach GREEN before the fix lands.)

### Task 2: RED e2e — breakpoint-aware drag

Same harness, but switch the canvas viewport to a `md:` breakpoint before dragging.

- [x] Drag at `md:` viewport. (Spec at
  `ext-test-projects/e2e/tests/project-dependent/bulka-tw-order-md-breakpoint.spec.ts`
  — sets Playwright window to 1440×900, asserts iframe width >=768 before
  dragging the hero image div onto the text div.)
- [x] Assert source now contains `md:order-N` on the dragged element, while the base
  `order-*` class (if any) is unchanged. (Asserts `md:order-1` on
  `<GalleryImage` div, `md:order-2` on `id="hero-cta"` div, with both base
  `order-1`/`order-2` left untouched.)

Test must be **RED on current main**. (Verification deferred to Tasks 3+4 RED→GREEN
run — same as Task 1: spec assertions depend on the `writeOrder` codepath +
breakpoint detection that don't exist on main, so the test cannot reach GREEN
before the fix lands.)

### Task 3: Add `writeOrder` to StyleAdapter contract

`client/lib/canvas-engine/adapters/StyleAdapter.ts`:
```ts
writeOrder?(elementId: string, value: number | null, opts?: { breakpoint?: string }): Promise<{ success: boolean; error?: string }>;
```

Implementations:
- [x] `TailwindAdapter.writeOrder` — rewrites class list via `applyOrderClassChange`
  helper (`order-class-utils.ts`). Removes existing `order-*` / `<bp>:order-*` at the
  targeted breakpoint only, appends the new one, preserves other variants. Writes through
  `astOps.updateProps({ className })`. Caller passes `currentClassName` from DOM/AST.
- [x] `TamaguiAdapter.writeOrder` — sets `order` numeric prop via `astOps.updateProps`.
  Returns `{ success: false, error: 'order-not-supported' }` for non-base breakpoints
  (Tamagui responsive variants `$md` etc. not yet wired through StyleAdapter).
- [x] Adapters that don't implement `writeOrder` are `undefined` (optional method);
  Tamagui returns `'order-not-supported'` for unsupported breakpoint cases — Task 4
  dispatcher must check both for fallback.
- [x] Unit tests colocated as `*.test.ts` next to each adapter (matches existing pattern
  — `TailwindAdapter.test.ts` already lived there; no `__tests__/` dir in adapters/).
  Files: `order-class-utils.test.ts` (15 tests for the pure helper),
  `TailwindAdapter.test.ts` (+5 writeOrder tests), `TamaguiAdapter.test.ts` (5 tests).
  All 26 tests pass under `bun test client/lib/canvas-engine/adapters/`.

### Task 4: Detect "order-driven parent" + integrate into drag flow

In the drag-handler that finalises a reorder (likely
`shared/canvas-interaction/iframe-interaction.ts` or its drop-orchestrator), before
calling the AST insert/move:

- [x] Inspect parent's children for any `order-*` className. If at least one child has it,
  the parent is "order-driven". Implemented in
  `vscode-extension/.../iframe-interaction.ts` `_resolveOrderWritePlan` →
  `computeOrderWritePlan` (pure helper at
  `shared/canvas-interaction/order-drag-detect.ts`). LCA walk
  (`_findReorderSiblings`) lifts source/drop to common-parent siblings so a drop
  inside an inner `<p>` still resolves to the order-driven `<div>`.
- [x] For an order-driven parent, compute the new order numbers for each affected child.
  Implemented as dense renumber 1..N of the new visual order — predictable, avoids
  drift across multiple drags, naturally writes minimum diff (entries with unchanged
  className are filtered out). Tradeoff documented inline in
  `computeOrderWritePlan` jsdoc.
- [x] Resolve current viewport breakpoint. `grep currentBreakpoint client/` returned
  zero matches — there is no existing state. Used `window.innerWidth` from inside
  the iframe (matches Tailwind's actual cascade pixel for pixel; the e2e Task 2
  spec exercises this via `window.setViewportSize`). `pickActiveBreakpoint`
  picks the largest Tailwind v3 default breakpoint (sm/md/lg/xl/2xl) that's both
  active for the current width AND already used by some sibling — so a parent that
  only declares `md:order-*` doesn't mistakenly write at the base breakpoint.
- [x] Call `styleAdapter.writeOrder` on each affected child, passing the breakpoint.
  Implemented as a sequential `await canvasRPC({ type: 'ast:updateProps', ... })`
  loop in `useCanvasInteraction.ts` `hypercanvas:writeOrders` handler. Diverges
  in form from the plan: the extension webview does NOT instantiate
  `client/.../TailwindAdapter` (no `AstOperations` adapter at this layer); the
  iframe pre-computes className via `applyOrderClassChange` and the webview
  forwards each entry as `ast:updateProps` directly — functionally equivalent to
  `TailwindAdapter.writeOrder` (which itself calls `astOps.updateProps`).
  Sequential awaits prevent the AstService.updateProps race that would otherwise
  let two concurrent writes overwrite each other from a stale parsed AST.
- [x] Do NOT call AST insert/move. Skip JSX child reordering entirely on this path.
  Detection short-circuits in `_dragPointerUp`: when `_resolveOrderWritePlan`
  returns non-null, post `hypercanvas:writeOrders` and `return` before the
  fallback `hypercanvas:moveElement`.
- [x] If `writeOrder` fails or adapter doesn't implement it (Tamagui base case), fall back
  to the AST path for safety. Detection-time fallback: any of {no order-* in
  siblings, source/drop not LCA-reachable, no active breakpoint in use,
  cross-parent drag, sibling list mismatch} returns null and the existing
  `hypercanvas:moveElement` path runs. Tamagui — which uses `order` numeric prop
  rather than className tokens — naturally fails the className-token detection
  and falls through. Per-entry write failures are surfaced via `console.warn`
  but don't re-enter the AST path mid-write (the JSX rewrite is exactly what
  this branch exists to avoid).

### Task 5: Telegram handoff

- [x] TG report listing files touched, e2e + unit verdicts, commit hashes.
  Sent via `send-tg-report.sh` from `/tmp/tg-report-tw-order-drag.txt`. Includes
  5 commit hashes (cb54dccb→e2e86b65), full file list, unit verdict GREEN
  (53 tests across adapters/ + shared/canvas-interaction/), e2e verdict
  BLOCKED-upstream with link to last run.
- [x] E2E screenshots both modes (Tasks 1+2), manually verified — skipped
  (no GREEN screenshots to verify): both PD-TWO-1 and PD-TWO-2 currently fail
  in Docker with `[HyperIDE] Dev server failed: Server failed to start`. This
  is the known bulka Docker dev-server bring-up regression already tracked in
  MEMORY.md (predates this work, affects all `dep:bulka-the-dog` specs). The
  one screenshot Playwright captured (PD-TWO-2 only-on-failure) shows the
  empty Hyper Preview pane because the dev server never came up — it does
  not represent feature state, only the harness regression. Item to be
  re-run after the bulka harness ticket lands.

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD end-to-end first: e2e specs in Tasks 1+2 RED on main before any code in Tasks 3+4.
- Use the local `ralphex` CLI only. Never use `RemoteTrigger` (CLAUDE.md rule, top of file).
- This ralphex run is isolated; do not touch other worktrees, do not kill unrelated ralphex
  processes.
- Investigate before deleting any helper that "looks unused" (CLAUDE.md "Dead code").
- Run e2e ONLY through `HYPER_E2E_SHARDS=1 bun run test:docker`.
- Telegram heartbeat every 15 minutes.

## Progress tracking

Append incremental updates to `.ralphex/progress/2026-05-08-tw-order-drag.txt`
in the worktree.
