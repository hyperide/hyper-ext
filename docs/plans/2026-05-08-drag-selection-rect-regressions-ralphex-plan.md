# Drag-end selection rect regressions: rects die + stale rect lag

## Context

User-reported (2026-05-08), two related rect-overlay regressions, both triggered by the
canvas drag flow:

1. **Selection rects stop working entirely after a drag.** Subsequent clicks on canvas
   elements no longer paint a selection rectangle. Only closing/reopening Hyper Canvas
   restores the behaviour. Inspector may still update on click (need to verify), but the
   rect overlay is dead.
2. **Stale rect lag.** During / right after a drag, the previously-selected rect lingers
   at the old element's position+size for a noticeable window before either disappearing
   or jumping to the new selection.

Both bugs share a layer (rect overlay rendering driven by selection state), so co-locate
the investigation. Likely root cause: drag-end fires a state mutation that leaves the rect
overlay's input (DOM ref or fiber-keyed lookup) stale or null, and a subsequent click never
rebinds it.

### Recent drag/rect commits to read first

- `917e5ee0 merge: move-any-intermittent — AST cache invalidation + lift for cross-subtree`
- `47d176fd fix: i18n text snap-back + drop reorder lift, with TDD coverage`
- `a40c1879 fix: drop reorder lifts to common siblings; create-key writes JSON; selection re-broadcast`
- `0c56bd29 fix(canvas): restore iframe-interaction.ts from drag commit (revert ...)`
- `dc9f7c5b fix: all keyboard navigation via postMessage to iframe DOM handler`
- `354dbe78 fix: drop indicator tracks element width, detects horizontal layout, fills transparent bg`
- `74633a06 fix(drag+i18n): fiber fallback in walk-up + TS locale key extraction`

The "selection re-broadcast" in `a40c1879` and the "AST cache invalidation + lift" in
`917e5ee0` are the most likely culprits for symptom (1) — if the broadcast doesn't fire
on every drag-end (e.g. only on cross-subtree lifts), drags within a subtree can leave the
overlay stuck on a stale fiber→DOM map. For symptom (2) the suspicion is React 19's
concurrent commit pacing: the rect overlay re-renders on the next paint, but the drag
handler reads element rect synchronously at drag-end, so the old rect persists for one
or two frames.

Out of scope for THIS plan:
- Drag insertion correctness (that's a separate ticket family).
- The PreviewPanel selection FSM refactor (deferred, see MEMORY).
- Anything in the other parallel ralphex plans (i18n, canvas-crash, shift-enter).

## Scope

Stop selection rects from dying after a drag, and remove the stale-rect lag. Two e2e tests
locking each behaviour, plus the smallest fix. **End-to-end TDD first**: each e2e RED on
main before any source change.

### Task 1: RED e2e — rect survives a drag

Add `ext-test-projects/e2e/tests/project-dependent/bulka-drag-rect-still-works.spec.ts`:

1. Launch bulka via `launchVSCode` (per `ext-test-projects/CLAUDE.md`).
2. Open Hyper Canvas, wait for preview.
3. Drag an element a small distance (use the existing drag helpers in `e2e/helpers/`).
   Prefer a within-subtree drag so we exercise the symptom-(1) class.
4. Click a DIFFERENT canvas element after the drop.
5. Assert the selection rect is rendered around the new element (poll the overlay
   `data-testid` — verify the actual id with `grep` first).
6. Compare bounding boxes: the rect must NOT be at the previously-selected element's old
   position. If it is, that's the regression.
7. Screenshot AFTER the post-drag click. Visual check: rect on the freshly-clicked element.

Test must be **RED on current main**. **GREEN after** Task 3.

### Task 2: RED e2e — rect updates immediately on drag end

Add `ext-test-projects/e2e/tests/project-dependent/bulka-drag-rect-no-stale-lag.spec.ts`:

1. Launch bulka, open canvas, click an element to select. Record its rect bbox.
2. Drag it ~80px in either direction. Drop.
3. Within 200ms (poll every 16ms, fail at 200ms) assert the selection rect's bounding box
   either (a) matches the new element position, or (b) is gone — but NOT the OLD bbox.
4. Repeat with a child element nested inside a flex/grid layout (more re-layout work).
5. Screenshot at T+50ms after drop. Visual: rect either tracks the new position or absent.

Test must be **RED on current main** (rect lingers in old place). **GREEN after** Task 3.

### Task 3: Diagnose + fix

Both symptoms point at the same overlay subscription:

- Find the overlay component that renders the selection rect (likely
  `client/components/Canvas/SelectionOverlay.tsx` or similar — `grep -rn "selection-rect" client/`).
- Trace its inputs: which selection state, which DOM-ref / fiber-key map.
- Diff the drag-end flow vs. plain-click flow:
  - Plain click → updates selection state → overlay reads fresh DOM ref → rect renders.
  - Drag end → ??? — figure out which input goes stale or never updates.
- Likely fixes:
  1. Re-broadcast selection on every drag-end (not just cross-subtree lift).
  2. Force the overlay's DOM-ref subscription to re-resolve after the AST cache
     invalidation event.
  3. requestAnimationFrame-driven rect recomputation post-drop to flush the React 19
     commit lag.

Add a unit test in the closest `__tests__/` directory covering the regression seam.

### Task 4: Telegram handoff

- TG report listing files touched, both e2e + unit verdicts, commit hashes.
- E2E screenshots from Tasks 1+2, manually inspected (CLAUDE.md screenshot rule: rect
  must visibly be on the right element / not in the wrong place).

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD end-to-end first: both e2e specs RED on main before Task 3 lands.
- Use the local `ralphex` CLI only. Never use `RemoteTrigger` (CLAUDE.md rule).
- This ralphex run is isolated; do not touch other worktrees, do not kill unrelated ralphex
  processes.
- Never delete a function/file because grep finds no callers (CLAUDE.md "Dead code") —
  this codebase has burned hours on that exact mistake.
- Run e2e ONLY through `HYPER_E2E_SHARDS=1 bun run test:docker`.
- Telegram heartbeat every 15 minutes (one human-written line, not raw logs).

## Progress tracking

Append incremental updates to `.ralphex/progress/2026-05-08-drag-selection-rect-regressions.txt`
in the worktree.
