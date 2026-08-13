# drag-EK-DR1: PI-5-DR-EK / PI-5-DR-EK-IMG / PI-5-DR-1 E2E green

## Context

Three drag-related E2E tests consistently fail in run-20260512-002106-89890 (first full Docker run that includes these tests — they were added 2026-05-06 but never ran in Docker before):

1. `PI-5-DR-EK: every kind drags onto a sibling and writes the file` — shard-1, both retries (~34s each). Fails at chain step 7 of 8 (img → ul). Steps 1–6 pass (span→p, p→h3, h3→div, div→div-t, div-t→button, button→img all succeed).
2. `PI-5-DR-EK-IMG: img drags onto a sibling from fresh state` — shard-1, both retries (~25s each). Fresh state single drag img → ul. File not written in 8s poll.
3. `PI-5-DR-1: drag element in flex container reorders children` — shard-1, both retries (~18s each). Basic flex-container drag "Flex A" → "Flex B". File not written in 8s poll.

### What was NOT done

These tests are **first-time runs** — they don't appear in ANY earlier Docker artifacts (run-20260511-*). They are NOT regressions from the entry-file-watcher fix (commit 7e98658a).

### Related plan

`docs/plans/2026-05-06-move-any-intermittent.md` — Task 7 "Fix img-source drag" is **open** (Tasks 7.3–7.7 unchecked). Previous 6 fix iterations failed. The plan comment: "The bug is still needed after 6 build+test iterations."

### Root cause hypotheses

**PI-5-DR-EK-IMG and PI-5-DR-EK step 7**: img `<img>` element has `pointer-events: none` and `-webkit-user-drag: none` (browser default for images). The iframe drag manager fires `mousedown` on `<img>` but Chromium swallows it for native drag-start, and the synthetic drag pipeline never gets a `pointerdown`. The `dragInIframe` helper relies on `window.mouse.down/move/up` which bypasses native drag but the iframe's drag handler never fires `dragstart` callback because the target is an img.

**PI-5-DR-1**: `drag-reorder-fixture` uses plain `<div>` children. The drag may succeed but `moveElement` returns a no-op — the "Flex A" / "Flex B" children share a parent BUT the AstService resolver may be returning the wrong lift level. The test runs ~18s (3s setup + ~15s poll timeout). DR-2 through DR-17 are passing — they test ghost, position, animation, undo, not file-write of the specific drag-reorder-fixture.

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD: tests exist, goal is GREEN.
- Write progress to `.ralphex/progress/progress-2026-05-12-drag-ek-dr1.txt`.
- TG heartbeat every 15 min.
- E2E ONLY via `HYPER_E2E_SHARDS=1 bun run test:docker -- --grep "PI-5-DR-EK|PI-5-DR-1"`.
- Main worktree: `/Users/ultra/work/hyper-canvas-draft`.

## Task 1 — Isolate PI-5-DR-EK-IMG failure

Run the focused img test in isolation:

```bash
cd /Users/ultra/work/ext-test-projects/e2e
HYPER_E2E_SHARDS=1 bun run test:docker -- \
  --grep "PI-5-DR-EK-IMG" 2>&1 | tail -40
```

Check:
- Does `window.screenshot` show the img element visible before drag?
- Does `ast-debug.log` show any `moveElement` RPC call during the test?
- If NO moveElement call: the drag gesture is not reaching the extension → fix is in `dragInIframe` helper or the iframe event handler.
- If moveElement called but returns no-op: fix is in AstService.moveElement for img source.

## Task 2 — Fix img source drag

If no `moveElement` is called:

- [ ] Read `ext-test-projects/e2e/helpers/iframe-mouse.ts` — `dragInIframe` implementation. Does it use `window.mouse.down/move/up` or `dispatchEvent`?
- [ ] Read `client/canvas-interaction/iframe-interaction.ts` — the drag handler. How does it detect drag-start?
- [ ] Check: does the img element have `pointer-events: none` CSS? Does `-webkit-user-drag: none` prevent the mousedown from registering?
- [ ] Fix: if the drag handler checks `e.target.tagName === 'IMG'`, the listener may bail early. Remove that guard or handle IMG as a valid drag source.
- [ ] Fix alternative: in `dragInIframe`, use `dispatchEvent` with `PointerEvent` instead of `mouse.down` for img targets.

If moveElement called but no-op:

- [ ] Check AstService.moveElement return for img source → what resolvedSource looks like for a self-closing element.
- [ ] See move-any-intermittent plan Task 4 (liftToCommonJsxParent for self-closing).

## Task 3 — Fix PI-5-DR-1 (flex-container reorder)

Run in isolation:

```bash
HYPER_E2E_SHARDS=1 bun run test:docker -- --grep "PI-5-DR-1:" 2>&1 | tail -40
```

- [ ] Check `ast-debug.log` for `moveElement` call during the test.
- [ ] If called: what does the return value show? Does the resolver find `drag-reorder-fixture > div:nth-child(1)` as a valid source?
- [ ] If the resolver lifts the drag source to the wrong level (fixture container instead of child), fix `liftToCommonJsxParent` to not over-lift when both source and target share a direct parent.

## Task 4 — Confirm GREEN

```bash
HYPER_E2E_SHARDS=1 bun run test:docker -- \
  --grep "PI-5-DR-EK|PI-5-DR-1" 2>&1 | tail -40
```

All 3 tests must PASS (not skip, not fail).

Update `docs/plans/2026-05-06-move-any-intermittent.md` Task 7 with findings.

## Task 5 — TG report

Send via `cd /Users/ultra/xp/codex-tg-bot && bash scripts/send-tg-report.sh`:
- Which task fixed it (img drag gesture or moveElement or resolver)
- Files changed, commits
- Screenshot showing PI-5-DR-EK-IMG GREEN
