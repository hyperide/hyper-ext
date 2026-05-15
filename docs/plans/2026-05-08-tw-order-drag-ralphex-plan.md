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

1. Launch bulka, find a parent that already has `order-*` siblings — if no such parent
   exists in bulka, add a fixture in a new project under
   `ext-test-projects/react-vite-tw3-order/` with three siblings `order-1`, `order-2`,
   `order-3`.
2. Confirm baseline: read the source file's JSX, note child positions; read the rendered
   DOM, note visual order driven by `order-*`.
3. Drag the visually-second child to the first slot.
4. After drop, assert the **source JSX child order is unchanged** (this is the key
   assertion — currently RED because we rewrite JSX).
5. Assert the source classNames now reflect the new order (`order-1` is on what was
   previously `order-2`, and vice versa).
6. Assert the rendered visual order matches expectation.
7. Screenshot before/after, manually inspected.

Test must be **RED on current main**.

### Task 2: RED e2e — breakpoint-aware drag

Same harness, but switch the canvas viewport to a `md:` breakpoint before dragging.

1. Drag at `md:` viewport.
2. Assert source now contains `md:order-N` on the dragged element, while the base
   `order-*` class (if any) is unchanged.

Test must be **RED on current main**.

### Task 3: Add `writeOrder` to StyleAdapter contract

`client/lib/canvas-engine/adapters/StyleAdapter.ts`:
```ts
writeOrder?(elementId: string, value: number | null, opts?: { breakpoint?: string }): Promise<{ success: boolean; error?: string }>;
```

Implementations:
- `TailwindAdapter.writeOrder` — rewrites class list. Removes any existing `order-N` /
  `<bp>:order-N` matching the targeted breakpoint, adds the new one. Preserves all other
  breakpoint variants intact.
- `TamaguiAdapter.writeOrder` — set `order` style prop / variant. If Tamagui breakpoints
  not wired yet, return `notSupported` for non-base breakpoints.
- Adapters that don't support order: return `{ success: false, error: 'order-not-supported' }`.

Add unit tests next to each adapter file under `__tests__/`.

### Task 4: Detect "order-driven parent" + integrate into drag flow

In the drag-handler that finalises a reorder (likely
`shared/canvas-interaction/iframe-interaction.ts` or its drop-orchestrator), before
calling the AST insert/move:

1. Inspect parent's children for any `order-*` className. If at least one child has it,
   the parent is "order-driven".
2. For an order-driven parent, compute the new order numbers for each affected child
   (typically just the dragged element + the one it displaces). Multiple strategies:
   - `dense` — renumber ALL siblings 1..N (predictable, mutates more files).
   - `sparse` — assign mid-points (`order-2` between `order-1` and `order-3` becomes
     `order-1.5`? Tailwind doesn't allow fractions; pick `dense` for v1).
   - `prepend/append` — only mutate the dragged + nearest neighbour. Risky if siblings
     have explicit numbers.
   Pick `dense`. Document tradeoff in code comment.
3. Resolve current viewport breakpoint (state already exists in HyperIDE; find it via
   `grep currentBreakpoint client/`).
4. Call `styleAdapter.writeOrder` on each affected child, passing the breakpoint.
5. Do NOT call AST insert/move. Skip JSX child reordering entirely on this path.
6. If `writeOrder` fails or adapter doesn't implement it (Tamagui base case), fall back
   to the AST path for safety.

### Task 5: Telegram handoff

- TG report listing files touched, e2e + unit verdicts, commit hashes.
- E2E screenshots both modes (Tasks 1+2), manually verified to show:
  - JSX in source unchanged
  - className contains the new `order-N` / `md:order-N`
  - Visual order matches expectation

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
