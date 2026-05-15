# tw-order follow-up: codex findings from limit-hit review

## Context

The original tw-order ralphex session (`a164a1ee` merged into main) hit Claude
rate limit at 03:13 mid-codex-iteration. Two codex findings were left open:

### Finding 1 — wrong starting visual order

`shared/canvas-interaction/order-class-utils.ts:58` returns `null` for items
with no explicit `order-*` class. `computeOrderWritePlan()` at
`shared/canvas-interaction/order-drag-detect.ts:164` then sorts all `null`
entries AFTER numeric orders. In CSS the default `order` is `0` and `order-first`
is negative, so parents that mix explicit `order-N` siblings with default/named
items will be renumbered from the wrong starting visual order.

**Repro:** parent with three children `<div class="order-2">`, `<div>` (no order),
`<div class="order-3">`. Visual order: middle div (default 0) → `order-2` →
`order-3`. Drag `order-3` to first slot. Current `computeOrderWritePlan`
treats the no-order div as last, so the renumber sequence is wrong.

### Finding 2 — cursor position not threaded into write plan

Claude was applying Fix 1 when limit hit:
> Fix 1: pass cursor-derived position into `_resolveOrderWritePlan`.

The drag-handler in `iframe-interaction.ts` `_dragPointerUp` knows where the
cursor dropped (left/right half of target, etc.) but doesn't thread that into
`_resolveOrderWritePlan`, which currently only knows source + drop-target ids.
For a "drop on left half of target X" the source should land BEFORE X, not at
X's old slot.

## Scope

Address both findings, add unit-test coverage, codex review pass to confirm
no new findings.

Out of scope:
- Drag insertion correctness for non-order-driven parents (unchanged path).
- Tamagui `$md`/etc. responsive variants (HYP-300 deferred).
- Anything in other parallel ralphex plans.

### Task 1: RED unit test — default-order item sorted in correct visual position

- [ ] Add a fixture to `shared/canvas-interaction/order-drag-detect.test.ts`:
      three siblings, two explicit `order-*` and one default (no order).
      Assert `computeOrderWritePlan` sorts the no-order child at the correct
      visual position (treat missing as 0, name `order-first` as -9999, etc.).
- [ ] Test must be RED on current main.

### Task 2: Fix order-class-utils to return numeric default for missing class

- [ ] In `getOrderValue` (or equivalent at line ~58), return `0` for elements
      without any `order-*` class, and the resolved numeric for `order-first`
      (-9999), `order-last` (9999), `order-none` (0).
- [ ] Update `computeOrderWritePlan` sort comparator to use the new numeric.
- [ ] Existing 53 unit tests + new test from Task 1 must all pass.

### Task 3: Thread cursor-derived position into _resolveOrderWritePlan

- [ ] Inspect `_dragPointerUp` in `vscode-extension/.../iframe-interaction.ts`
      — find where it computes drop-position relative to target (the existing
      `dropPosition` `'before' | 'after' | 'inside'` enum probably exists from
      the broader drag flow).
- [ ] Pass `dropPosition` into `_resolveOrderWritePlan`. Update
      `computeOrderWritePlan` signature: `({ source, target, position }) → plan`.
- [ ] When `position === 'before'`: source's new visual index is target's
      current visual index (target shifts after).
      When `position === 'after'`: source's new visual index is target's
      current visual index + 1.
      When `position === 'inside'`: undefined (not relevant for order-N — just
      use AST insert path; return null plan).
- [ ] Add a unit test per branch in
      `shared/canvas-interaction/order-drag-detect.test.ts`.

### Task 4: codex review pass — confirm no remaining findings

- [ ] Run `codex exec review --uncommitted` on the diff.
- [ ] Address any new findings.

### Task 5: TG handoff with E2E screenshot

- [ ] After Docker image rebuilds (corepack pnpm fix in main), run the two
      tw-order specs in `ext-test-projects/e2e/tests/project-dependent/`:
      - `bulka-tw-order-reorder.spec.ts`
      - `bulka-tw-order-md-breakpoint.spec.ts`
      via `HYPER_E2E_SHARDS=1 bun run test:docker -- --project=dep:bulka-the-dog`.
- [ ] Open the resulting screenshots with Read; verify visually that the rect
      of the dragged element ends up where the test expects, and the source
      file's classNames reflect the new order.
- [ ] Send a single TG report via `send-tg-report.sh` summarising both fixes,
      then `send-tg-file.sh ... --photo` for each screenshot. CLAUDE.md rule:
      no screenshot in TG = bug not fixed.

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD: unit tests RED first.
- Use the local `ralphex` CLI only. Never `RemoteTrigger` (CLAUDE.md).
- Worktree-isolated. Don't kill unrelated ralphex.
- Run e2e ONLY through `HYPER_E2E_SHARDS=1 bun run test:docker`.
- Telegram heartbeat every 15 min.

## Progress tracking

`.ralphex/progress/2026-05-08-tw-order-followup.txt`
