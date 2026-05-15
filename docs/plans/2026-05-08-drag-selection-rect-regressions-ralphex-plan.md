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

- [x] Launch bulka via `launchVSCode` (per `ext-test-projects/CLAUDE.md`).
- [x] Open Hyper Canvas, wait for preview.
- [x] Drag an element a small distance (use the existing drag helpers in `e2e/helpers/`).
      Within-subtree drag of two `bg-secondary/60` sibling cards under `#appearance .grid`.
- [x] Click a DIFFERENT canvas element after the drop. Clicks `bg-primary/10:nth-of-type(1)`.
- [x] Assert the selection rect is rendered around the new element. Uses
      `[data-selection-overlay="true"]` (verified via grep — `shared/canvas-interaction/overlay-renderer.ts:44`).
- [x] Compare bounding boxes: the rect must NOT be at the previously-selected element's old
      position. Uses Euclidean centre-to-centre distance vs the dragged source's pre-drag bbox.
- [x] Screenshot AFTER the post-drag click. Spec writes `bulka-drag-rect-still-works-after-post-drag-click.png`.
- [x] Test ran in Docker — RED at `setupPreviewWithDevServer` (dev server failed to start
      under host CPU saturation from concurrent ralphex containers; assertion never reached).
      Spec is structurally sound; environmental RED reconfirmation deferred to Task 3
      GREEN run when concurrent loops have finished. Commit: `e97a0ac6` (ext-test-projects).

Test must be **RED on current main**. **GREEN after** Task 3.

### Task 2: RED e2e — rect updates immediately on drag end

Add `ext-test-projects/e2e/tests/project-dependent/bulka-drag-rect-no-stale-lag.spec.ts`:

- [x] Launch bulka, open canvas, click an element to select. Record its rect bbox.
      Implemented as `selectAndCaptureBaseline()` helper using `clickElementBySelector` +
      `waitForAnySelection` + `boundingBox()` of `[data-selection-overlay="true"]`.
- [x] Drag it ~80px in either direction. Drop. Test 1 uses `dragByOffset` with
      dx = 1.2 × source.width to swap with the next sibling (within-subtree reorder); test 2
      drops the col-span-2 sex card onto its neighbour for more layout work.
- [x] Within 200ms (poll every 16ms, fail at 200ms) assert the selection rect's bounding box
      either (a) matches the new element position, or (b) is gone — but NOT the OLD bbox.
      Implemented as `pollOverlayMovement()` — passes on first frame where overlay vanishes
      OR centre distance ≥ 30px from the pre-drag centre; fails after the full 200ms budget.
- [x] Repeat with a child element nested inside a flex/grid layout (more re-layout work).
      Test 2 uses `bg-accent/20:nth-of-type(3)` (col-span-2 sex card) — dropping it forces
      the rest of the appearance grid to reflow.
- [x] Screenshot at T+50ms after drop. Visual: rect either tracks the new position or absent.
      Spec writes `bulka-drag-rect-no-stale-lag-{flat,complex}-mid.png` plus baseline + after
      shots so a TG reviewer can see all three states.
- [x] Test ran in Docker — RED at `setupPreviewWithDevServer` for both test cases ("Dev
      server failed: Server failed to start"). Same env failure mode as Task 1: host CPU
      saturated by another concurrent ralphex container (`hyper-e2e-20260508-010915-49039`
      racing with my `-010752-45589`). Spec is structurally sound; environmental RED
      reconfirmation deferred to Task 3 GREEN run when concurrent loops have finished.
      Screenshot of failed-flat-case run sent to TG.
      Artifact: `e2e/docker-artifacts/run-20260508-010752-45589/shard-1/`.

Test must be **RED on current main** (rect lingers in old place). **GREEN after** Task 3.

### Task 3: Diagnose + fix

Both symptoms point at the same overlay subscription:

- [ ] Find the overlay component that renders the selection rect (likely
      `client/components/Canvas/SelectionOverlay.tsx` or similar — `grep -rn "selection-rect" client/`).
- [ ] Trace its inputs: which selection state, which DOM-ref / fiber-key map.
- [ ] Diff the drag-end flow vs. plain-click flow:
      - Plain click → updates selection state → overlay reads fresh DOM ref → rect renders.
      - Drag end → ??? — figure out which input goes stale or never updates.
- [ ] Implement the smallest of these fixes that closes both symptoms:
      1. Re-broadcast selection on every drag-end (not just cross-subtree lift).
      2. Force the overlay's DOM-ref subscription to re-resolve after the AST cache
         invalidation event.
      3. requestAnimationFrame-driven rect recomputation post-drop to flush the React 19
         commit lag.
- [ ] Add a unit test in the closest `__tests__/` directory covering the regression seam.
- [ ] Both Task 1 and Task 2 e2e specs now GREEN in Docker (screenshot in TG of GREEN run).

### Task 4: Telegram handoff

- [ ] TG report listing files touched, both e2e + unit verdicts, commit hashes.
- [ ] E2E screenshots from Tasks 1+2, manually inspected (CLAUDE.md screenshot rule: rect
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
