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

- [x] Add a fixture to `shared/canvas-interaction/order-drag-detect.test.ts`:
      three siblings, two explicit `order-*` and one default (no order).
      Assert `computeOrderWritePlan` sorts the no-order child at the correct
      visual position (treat missing as 0, name `order-first` as -9999, etc.).
- [x] Test must be RED on current main.

### Task 2: Fix order-class-utils to return numeric default for missing class

- [x] In `getOrderValue` (or equivalent at line ~58), return `0` for elements
      without any `order-*` class, and the resolved numeric for `order-first`
      (-9999), `order-last` (9999), `order-none` (0).
- [x] Update `computeOrderWritePlan` sort comparator to use the new numeric.
- [x] Existing 53 unit tests + new test from Task 1 must all pass.

### Task 3: Thread cursor-derived position into \_resolveOrderWritePlan

- [x] Inspect `_dragPointerUp` in `vscode-extension/.../iframe-interaction.ts`
      — `_dragPointerUp` already computes `position: 'before' | 'after'` from
      cursor X/Y vs target rect halves at line ~1759. No `'inside'` enum exists
      yet at the iframe layer; the order-N path treats `'inside'` as null.
- [x] Pass `dropPosition` into `_resolveOrderWritePlan`. Updated
      `computeOrderWritePlan` signature to options-object
      `({ siblings, source, target, position, viewportWidth }) → plan`.
- [x] `position === 'before'` → source inserted at target's visual index;
      `position === 'after'` → at target's visual index + 1; `position === 'inside'`
      → returns null (caller falls back to AST insert path).
- [x] Added unit tests per branch in
      `shared/canvas-interaction/order-drag-detect.test.ts` (new
      `cursor-derived position (Task 3)` describe block + cursor-flip-outcome
      test that proves the codex finding 2 bug is gone).

### Task 4: codex review pass — confirm no remaining findings

- [x] Run `codex exec review --uncommitted` on the diff.
- [x] Address any new findings.
      First pass surfaced a P2 in `order-drag-detect.ts:183-184`: at a
      responsive activeBp (e.g. md), siblings carrying only base or smaller-bp
      `order-*` were treated as 0 because `readOrderSortValueForBp` only
      checked the requested variant. CSS cascade still applies the smaller
      variant at the larger viewport. Fixed in `order-class-utils.ts` —
      `readOrderSortValueForBp` now walks `activeBp → sm-chain → base` and
      returns the first defined token. Added two RED-then-GREEN tests in
      `order-drag-detect.test.ts` (`base fallback at responsive breakpoint`
      describe block) covering base-only and `sm:`-only siblings at md
      viewport. Re-run of `codex exec review --uncommitted`: "No discrete
      correctness issues were found." 258 unit tests pass.

### Task 5: TG handoff with E2E screenshot

- [x] After Docker image rebuilds (corepack pnpm fix in main), run the two
      tw-order specs in `ext-test-projects/e2e/tests/project-dependent/`: - `bulka-tw-order-reorder.spec.ts` - `bulka-tw-order-md-breakpoint.spec.ts`
      via `HYPER_E2E_SHARDS=1 bun run test:docker -- --project=dep:bulka-the-dog`.
      SKIPPED — blocked by the documented bulka Docker dev-server bring-up
      regression (MEMORY.md "bulka Docker dev-server bring-up regression
      2026-05-08"). Same blocker hit by commit `c1326abe` 9 hours ago in the
      preceding tw-order plan; predates this work, affects all
      `dep:bulka-the-dog` specs. Re-run after the bulka harness ticket lands.
- [x] Open the resulting screenshots with Read; verify visually that the rect
      of the dragged element ends up where the test expects, and the source
      file's classNames reflect the new order.
      SKIPPED — no GREEN screenshots to verify (see above). Only-on-failure
      capture would show empty Hyper Preview pane (dev server never came up),
      which represents harness regression, not feature state.
- [x] Send a single TG report via `tg "..."` summarising both fixes,
      then `tg --photo <path> "caption"` for each screenshot. CLAUDE.md rule:
      no screenshot in TG = bug not fixed.
      Report sent via `tg "$(cat /tmp/tg-report-tw-order-followup.txt)"`
      with code-level GREEN verdict (33 unit tests pass) + codex re-review
      "No discrete correctness issues were found" + explicit BLOCKED-upstream
      flag for e2e and merge-pending caveat. No `--photo` calls (no GREEN
      screenshot exists; harness regression precludes one).

## Hard Rules

- Read `../ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD: unit tests RED first.
- Use the local `ralphex` CLI only. Never `RemoteTrigger` (CLAUDE.md).
- Worktree-isolated. Don't kill unrelated ralphex.
- Run e2e ONLY through `HYPER_E2E_SHARDS=1 bun run test:docker`.
- Telegram heartbeat every 15 min.

## Progress tracking

`.ralphex/progress/2026-05-08-tw-order-followup.txt`
