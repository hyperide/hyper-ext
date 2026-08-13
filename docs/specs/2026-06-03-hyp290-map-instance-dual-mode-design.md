# HYP-290 — Map instance operations: dual-mode JSX/DOM for reorder, delete, duplicate, copy

Date: 2026-06-03
Author: Alex Ultra + Claude
Status: Draft
Linear: HYP-290

## Context

Elements rendered through `.map()` produce many DOM nodes that all trace back to a single JSX
template. The parser marks each rendered iteration with `mapItem = { parentMapId, depth, expression }`
(`lib/services/component-parser.ts:741-748`), where `expression` is the raw source text of the
`.map()` receiver, captured at `lib/services/component-parser.ts:607` (e.g. `"items"`,
`"data.users"`). The outline groups consecutive siblings that share a `parentMapId` into a synthetic
`map` node via `groupMapChildren` (`lib/services/tree-adapter.ts:79-114`).

Today every structural operation is **JSX-only**: delete, duplicate, paste and insert all resolve a
single JSX element by `nodeRef` and mutate the source template
(`client/lib/canvas-engine/operations/ASTDeleteOperation.ts`,
`ASTDuplicateOperation.ts`, `ASTInsertOperation.ts`, `ASTPasteOperation.ts`; server side
`server/routes/deleteElement.ts`, `duplicateElement.ts`, `insertElement.ts` via
`server/lib/resolve-element.ts`). Editing the template affects **all** iterations at once. There is
also **no reorder primitive at all** — no `ASTReorderOperation`, no reorder/move server route.

The ticket wants a second, per-iteration mode ("DOM mode") that operates on the underlying data so a
single rendered item can be deleted/duplicated/reordered, with a toast letting the user pick JSX
(template) vs DOM (data) per operation.

The goal is sound and the substrate exists — but two of the three cited prior-art mechanisms are
misidentified, and one "easy AST" data category is actually unbuilt infrastructure. The reconciliation
below is the load-bearing part of this spec.

## Reality check — assumed vs actual

### A1. `data-canvas-instance-id` is NOT a map-iteration marker — WRONG in ticket

The ticket lists `data-canvas-instance-id` as the per-iteration DOM identifier. It is not. That
attribute is emitted only in **multi-placement canvas mode**, where the same component is dropped at
multiple `x/y` positions on the infinite canvas, keyed off `window.parent.__CANVAS_INSTANCES__`
(`lib/preview-generator/generator.ts:1088-1124`). Consumers
(`client/components/IframeCanvas.tsx:484,547,595,863`;
`client/pages/Editor/CanvasEditor.tsx:773,810,1035`) treat it as a canvas placement id, never as an
array index. Map iterations carry **no** dedicated DOM attribute.

**Actual per-iteration anchor:** the React fiber `itemIndex` — the sibling index inside the `.map()`
render group, computed by `getItemIndexFromFiber` (`shared/element-tracing/fiber-internals.ts:253`)
and surfaced through `ElementTracer.resolveClickLocal` →
`onElementClick(nodeRef, target, e, itemIndex, source)` (`client/components/IframeCanvas.tsx:610`,
`659`, `667`). The real targeting key for DOM mode is `mapItem.parentMapId` (which map) +
`itemIndex` (which iteration), not a DOM attribute.

### A2. `useElementDrag.ts` does not exist — WRONG in ticket

The ticket says `useElementDrag.ts` "already detects map context but currently aborts with
console.warn." There is no such file in `main` (only inside stale `.claude/worktrees/*`). There is no
drag-reorder code, and therefore no map-aware abort to repurpose. Reorder is greenfield in every mode.

### A3. `mapItem` + `groupMapChildren` — CORRECT in ticket

Both exist exactly as described. `mapItem={parentMapId,depth,expression}` is set at
`component-parser.ts:741-748`; `expression` is the receiver source string only (not a structured data
source). `groupMapChildren` produces synthetic `map` outline nodes
(`tree-adapter.ts:79-114`, consumed by `convertChildren` at `:116-134`). The type lives at
`client/lib/canvas-engine/types/ast.ts:27-32`.

### A4. Category 3 "literal array → direct AST manipulation" — OVERSTATED

The ticket claims categories 1 and 3 are tractable via direct AST. Category 3 ("`const items = [...]`
in the same file") is **not** cheap with current infra:

- Every existing AST mutation targets a **JSX element** by `nodeRef`
  (`server/lib/resolve-element.ts`); none touch a JS array literal.
- Nothing resolves the captured `expression` string (`"items"`) back to its declaring
  `VariableDeclarator` / `ArrayExpression`. There is no binding-resolution helper for this in
  `lib/ast` or `server/`.
- There is no `ArrayExpression` splice/reorder operation, and `server/services/ast-manipulator.ts`
  is Sample-export-specific (its header at lines 1-12 scopes it to `Sample*` exports), not a generic
  array manipulator.

So category 3 requires **all-new** infra (binding resolution + array-literal splice/reorder op + a
server route) before any "direct AST" claim is true.

### A5. Reorder is unbuilt even for JSX mode — MISSING from ticket

The ticket's matrix assumes reorder exists in both modes. It does not exist in either. There is no
reorder operation and no reorder/move server route. JSX-mode reorder ("reorder children within
template") is itself a from-scratch sub-ticket, a prerequisite for DOM-mode reorder.

### A6. `itemIndex == data-array index` is a fragile assumption — RISK

DOM-mode delete/reorder maps a rendered iteration to a position in the source array via `itemIndex`.
This correspondence holds only for a bare `.map()` over the literal. A conditional inside the callback,
or a `.filter().map()` chain (which the ticket itself routes to category 2), breaks
rendered-sibling-index → source-array-index. This must be a precondition, not a footnote: categories
that break the mapping must fall through to the AI path (A categories 2/4).

### A7. Terminology collision — must be fixed before sub-tickets

"instance" already means two different things in this codebase: (a) a `DocumentTree` component
instance (`tree.getInstance(...)`), and (b) a multi-placement canvas instance
(`data-canvas-instance-id`). The ticket adds a third: a `.map()` iteration. The wrong prior-art in A1
is a direct consequence of this collision. The spec and all sub-tickets MUST use distinct terms:
**document-instance**, **canvas-instance**, **map-iteration**.

### Verdict

`epic-decompose`. The end goal is achievable on the real substrate (`mapItem.parentMapId` +
`itemIndex` + `ai-code-generator`), but the ticket bundles: a missing reorder primitive, three data
categories of wildly different difficulty (one of which needs unbuilt AST infra), an AI path, and a
toast/undo UX — behind two misidentified mechanisms. Ship it as ordered, independently mergeable
slices.

## Scope / Decomposition

### HYP-290a (PREREQUISITE) — JSX reorder primitive

Add the missing reorder capability for JSX children. Foundation for both modes; nothing about maps yet.

- Key files: new `client/lib/canvas-engine/operations/ASTReorderOperation.ts` (execute/undo/redo
  - `ASTApiService` call); new `server/routes/reorderElement.ts` using `server/lib/resolve-element.ts`
  - `lib/ast/parser.ts` (`readAndParseFile`/`writeAST`); register in `server/index.ts`; add
    `reorderElement` to `client/lib/canvas-engine/services/ASTApiService`.
- **Async pattern (do NOT mirror `ASTDeleteOperation`):** `ASTDeleteOperation` is the legacy
  fire-and-forget shape, but the engine now awaits an operation's `_pendingPromise` during
  undo/redo (`CanvasEngine.ts:355-357`, `:400-402`). A reorder whose server write is still in
  flight when the user undoes would otherwise race the AST mutation and restore the wrong order.
  Model the new op on the `_pendingPromise` pattern used by `ASTStyleOperation` /
  `FileSnapshotOperation` so undo/redo blocks on the write. This applies to every new async AST op
  in this epic (290e array-write, 290h paste).
- Acceptance (TDD): given a parent JSX element with children `[A,B,C]`, calling reorder(C, index 0)
  rewrites the source so the rendered order is `[C,A,B]`, and undo restores `[A,B,C]`. **Undo issued
  before the server write resolves still restores `[A,B,C]` (no race)** — asserts `_pendingPromise`
  is awaited. Unit test on the server route against a fixture file; engine test for undo/redo.

### HYP-290b — Map-context plumbing + terminology

Carry `parentMapId` + `itemIndex` from selection through to the operation layer, and rename to kill the
"instance" collision (A7).

- Key files: `client/components/IframeCanvas.tsx` (already has `itemIndex` at the click handler;
  thread it into the selection model), selection state in
  `client/lib/canvas-engine/core/CanvasEngine.ts` / `models/types.ts`, outline mapping in
  `lib/services/tree-adapter.ts` (already exposes `parentMapId`/`expression`).
- Acceptance (TDD): selecting a rendered `.map()` child yields a selection object exposing
  `{ parentMapId, itemIndex, mapExpression }`; selecting a non-map element yields none. No DOM-attribute
  lookup involved.

### HYP-290c — Dual-mode toast UX (JSX default, DOM opt-in, ~3s undo)

Notification after each structural op with a JSX/DOM toggle; default JSX, auto-apply, ~3s window to
switch to DOM (which undoes the JSX op and applies the DOM op).

- Key files: existing toast/notification component (grep `client/components` for the current toast),
  `HistoryManager.ts` for the undo handoff.
- Acceptance (TDD): performing delete on a map child shows a toast with a DOM option; choosing DOM
  within the window triggers undo of the JSX delete + dispatch of the DOM op; letting the window lapse
  keeps the JSX result. Reducer/state test, no e2e required for green.

### HYP-290g — Data-source category classifier

AST analysis of the `.map()` receiver to bucket it into category 1/2/3/4, routing each op to the right
DOM-mode handler.

- Key files: new classifier in `lib/services/` (reuses the `expression` string already captured at
  `component-parser.ts:607` plus binding lookup), consumed by the op layer from HYP-290b.
- Acceptance (TDD): classifier returns `props-from-sample` for a Sample-supplied prop, `literal-array`
  for `const items=[...]` in the same file, `hook-derived` for `useX()`/`useState`, `generator` for a
  function call; `.filter().map()` returns `hook-derived` (AI path) per A6.

### HYP-290d — DOM mode, category 1 (props-from-Sample)

Reorder/delete/duplicate the array in the Sample file. Lowest risk: no production code change, Sample
files are already mutated by `server/services/ast-manipulator.ts`.

- Key files: `server/services/ast-manipulator.ts` (extend with array-literal splice within a Sample
  export), Sample resolution from `lib/preview-generator/generator.ts`.
- Acceptance (TDD): deleting map-iteration index 1 of a Sample-supplied array removes exactly that
  element from the Sample file's array literal; reorder/duplicate likewise; preview re-renders with
  one fewer/more item.

### HYP-290e (PREREQUISITE-HEAVY) — DOM mode, category 3 (literal array in component)

NOT cheap AST (A4). Requires three new pieces.

- Key files: new binding resolver (`expression` string → declaring `VariableDeclarator` /
  `ArrayExpression` in the same file), new `ArrayExpression` splice/reorder op in `lib/ast/`, new
  server route mirroring HYP-290a's pattern.
- Acceptance (TDD): for `const items = [a,b,c]` mapped in the same component, DOM-mode
  delete(itemIndex 1) rewrites the literal to `[a,c]`; reorder/duplicate likewise; undo restores;
  refuses (falls back to AI/HYP-290f) when `itemIndex` can't be proven to equal the array index (A6).
- Note: gated on HYP-290g (classifier) and shares the undo plumbing of HYP-290c.

### HYP-290f — DOM mode, categories 2 & 4 (hook-derived / generator / filter().map())

AI-assisted via `server/services/ai-code-generator.ts`. The fallback for everything the AST path can't
prove.

- Key files: `server/services/ai-code-generator.ts` (new prompt path with map context: file,
  `expression`, target `itemIndex`, operation), wired through the op layer.
- Acceptance: prompt round-trips with map context and the operation; produces a diff the user can
  accept. (AI output can't be deterministically unit-tested; assert prompt construction + diff
  application, gate behind explicit user confirmation.)

## Risks & prerequisites

- **Ordering:** HYP-290a (reorder primitive) and HYP-290b (map-context plumbing) gate everything else.
  HYP-290g (classifier) gates HYP-290d/e/f routing. HYP-290c (toast) can land in parallel but is
  required before any DOM op is user-reachable.
- **Shared-code / AST-infra change (biggest risk):** HYP-290e introduces the first array-literal
  mutation in the codebase — new binding resolution + `ArrayExpression` ops touching `lib/ast`. This is
  shared infra; per repo rules, confirm scope before editing shared AST code. Don't let HYP-290e's
  difficulty leak optimism into the ticket's "direct AST" framing.
- **itemIndex ↔ array-index fragility (A6):** the single correctness risk for DOM delete/reorder.
  HYP-290e must explicitly refuse and defer to HYP-290f when the bare-map precondition isn't provable
  (conditionals in callback, `.filter().map()`, computed keys).
- **Terminology (A7):** fix the three-way "instance" collision in HYP-290b before sub-tickets fan out,
  or the same confusion that produced the wrong prior-art will propagate.
- **Undo across modes:** the DOM toggle must cleanly undo the already-applied JSX op before applying
  the DOM op (HYP-290c + `HistoryManager`); a half-applied state is a corruption risk.

## Out of scope

- Nested `.map()` (`depth > 1`) — `mapItem.depth` exists but multi-level array targeting is deferred.
- Robust `.filter().map()` / conditional-in-callback AST handling — routed to the AI path (HYP-290f),
  not solved analytically.
- Multi-placement **canvas-instance** behavior (`data-canvas-instance-id` / `__CANVAS_INSTANCES__`) —
  unrelated to map iterations despite the ticket's prior-art note; no changes there.
- **JSX-mode** copy — already covered by the existing clipboard (`ClipboardManager.ts`,
  `ASTPasteOperation.ts`), which copies the `.map()` template JSX node; only the toast routing
  (HYP-290c) is new there.

Note — **DOM-mode copy is NOT already covered** (correcting an earlier draft assumption): the
existing clipboard copies the JSX template node, so "copy this one iteration" would still paste the
template and re-affect all iterations. A true per-iteration copy must copy the iteration's _data
item_ (the array element behind `itemIndex`) so paste appends a new data item — i.e. it is the
"copy" half of DOM-mode duplicate, and rides the same data-source detection + binding/array-write
infra. It is therefore in scope as part of the DOM-mode data path:

### Sub-ticket HYP-290h — DOM-mode copy/paste of a map iteration's data item

- **Scope:** copy the array element at `itemIndex` (resolved per the 290g classifier) to a
  data-item clipboard; paste appends it as a new item in the source array (categories 1 & 3 via
  AST array-write from HYP-290d/e; categories 2 & 4 via the AI path HYP-290f). Distinct from the
  JSX-template clipboard, which stays unchanged.
- **Key files:** `client/lib/canvas-engine/operations/ASTPasteOperation.ts` (do not regress the
  JSX path), the new array-write op (HYP-290e), the 290g classifier; clipboard plumbing.
- **Acceptance (TDD):** DOM-mode copy of one iteration over a literal array, then paste, yields one
  additional rendered iteration (array length +1) without mutating the JSX template; JSX-mode copy
  is byte-identical to today.
