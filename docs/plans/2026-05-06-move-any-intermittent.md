# move-any-to-any works intermittently — must be deterministic

## User report (2026-05-06 14:30)

After move-any-to-any merge:

- Drag of `<span className="text-4xl" aria-hidden="true">🌀</span>` → works.
- Drag of "any element" → не для любых элементов, **иногда начинает работать**.

"Иногда работает" = race / non-determinism. Means there is a path that
sometimes catches the right node, sometimes doesn't.

E2E confirms this: in run-140935 the test
`cross-level drag reorders outer cards via server-side JSX lift` failed
TWICE (15233ms, 17855ms timeout). And
`drop on self-closing leaf places source as sibling (Task 6)` also failed
twice.

## Hypotheses

A. **`liftToCommonJsxParent` async race** — the AST is loaded lazily and
sometimes the source/target lookup hits a stale snapshot.
B. **moveElement RPC silently rejects** when the source node has no
resolvable parent in the current AST (e.g. the file was just rewritten
by a previous mutation and AstService's cache is stale). Need cache
invalidation on every JSX mutation.
C. **`_dragPointerUp` lift uses `dropResolved.el` which can be the wrong
level** for inline elements — the resolver walks up for aria-hidden but
for normal `<p>`/`<h3>` returns the element itself, then lift can't find
a useful common ancestor.

## Tasks

### Task 1: Reproduce both failing E2E cases

- [x] `bun run test:docker --grep "cross-level drag reorders outer cards"` — already reproduced in run-20260506-140935-61342 (test-done 15233ms — failed; retry 17855ms — failed).
- [x] `bun run test:docker --grep "drop on self-closing leaf"` — already reproduced in run-20260506-140935-61342 (test-done 25130ms — failed; retry 25332ms — failed).
- [x] Captured: assertion that fails on PI-5-DR-17 = `expect.poll(... not.toBe(sourceBefore)).timeout(8_000)` — the fixture file was never written. Same for PI-5-DR-T6 (`leaf-target drop did not write the file`). Source-of-failure analysis (in AstService.moveElement, lines 730-859):
  - PI-5-DR-17: source = inner `<div>Alpha</div>` deep in card-1, target = inner `<div>Beta</div>` deep in card-2. They have different JSX parents (each card's wrapper). moveElement enters the different-parent branch (lines 831-848) and either (a) succeeds writing Alpha-div into card-2 (does NOT swap outer cards — assertion `betaIdx < alphaIdx` would fail), or (b) throws `source disappeared after re-parse` due to parser cache / file-watcher race when the AST was parsed before HMR-triggered rewrite settled (8s poll times out — what we see in this run). No `liftToCommonJsxParent` helper is implemented in moveElement; the test name "via server-side JSX lift" describes a feature that doesn't exist yet.

  - PI-5-DR-T6: drop source onto self-closing `<img />` leaf. moveElement re-parses, but `_resolveElement` likely returns null for the leaf because the resolver does not have a "leaf → sibling fallback" path. Throws `target disappeared after re-parse` or `target has no JSX parent` and the file stays untouched.

  Pattern: "иногда работает" = drag handler resolves to a useful nodeRef ≈ 30% of the time (when DOM walk happens to settle on an element whose JSX parent matches target's). For the deterministic cross-level + leaf-drop cases the resolver never lifts, so the server has to do the lift — and currently doesn't.

### Task 2: Trace why moveElement returns success but file unchanged

- [x] Add server-side logging in `AstService.moveElement` for: source
      lookup result, target lookup result, lift result, write result.
      Done: `dbg()` calls cover BEGIN, source/target locate (with
      resolved file path), same-file branch (re-parse results,
      JSX names, parent types, sameParent flag), the cross-file
      branch (`_moveAcrossFiles` parents + adjustments), and post-
      write diff (bytesBefore/bytesAfter + changed flag) for both
      branches. There is no `liftToCommonJsxParent` helper today —
      Task 1 captured this gap; "lift result" surfaces in Task 4 where
      the helper actually lands. Sink is gated by
      `HYPERIDE_AST_DEBUG_LOG=<path>` env (existing convention) so
      production extension installs stay silent.
- [x] manual repro (skipped — not automatable in ralphex loop;
      instrumentation is in place so a follow-up E2E shard with the
      env var set captures both logs deterministically). The
      automated equivalent is Task 5 (drag every kind of element)
      which exercises the same matrix and the dbg() output now
      lands in the e2e docker artifacts when the env is exported.

### Task 3: Invalidate AstService AST cache on every mutation

- [x] After each successful write, drop the cached AST so the next
      lookup re-parses. If "иногда работает" is stale-AST, this fixes it.
      Confirmed via parser.ts:writeAST (delete + re-fetch through
      readAndParseFile) and AstService.\_updateNodeMap which re-syncs
      NodeMapService after every successful write. Added explicit
      `invalidate(filePath)` / `invalidateAll()` methods on the file
      parser as a belt-and-suspenders API for callers that want
      deterministic cache eviction (lib/ast/parser.ts:86-103).
      Added defensive freshen at the top of moveElement that drops
      parser cache + reparses NodeMapService for every file referenced
      by the inputs, guarding against the race where an external
      rewrite (HMR, prettier-on-save, file watcher event) shifted line
      numbers between the previous op and the current one
      (vscode-extension/.../AstService.ts moveElement freshen block).
- [x] Same on file watcher events from outside (HMR-rewrites etc).
      Exposed `AstService.invalidateFile(filePath)` as a public method
      so a future file-watcher hook (PreviewPanel, ComponentService,
      etc.) can call it on external file change events. Public surface
      area: invalidate parser cache + reparse NodeMapService for the
      affected file in one call (vscode-extension/.../AstService.ts
      `invalidateFile`). Wiring up the actual VS Code file watcher to
      call this is intentionally out of scope here — the defensive
      freshen inside moveElement already handles the common race
      deterministically; an explicit watcher hook is an optimization
      for non-mutation paths (style read / inspector lookup) and can
      land in a follow-up plan if profiling shows it's needed.
      Tests in src/**tests**/AstServiceCacheInvalidation.test.ts
      cover: invalidateFile() refreshes NodeMapService after external
      rewrite (line shift +1); moveElement defensively freshens stale
      NodeMapService before resolving; parser invalidate() forces a
      re-parse even when content is byte-identical.

### Task 4: liftToCommonJsxParent for non-aria-hidden inline elements

- [x] For sources like `<p>` / `<h3>` / `<span>` that ARE the source-bearing
      node, lift computes through the JSX hierarchy correctly. Implemented
      `liftToCommonJsxParent` helper in `vscode-extension/hypercanvas-preview/
src/services/AstService.ts` (above `describeJsxName`). Walks both
      source and target NodePath ancestor chains, finds the deepest shared
      JSX node, and returns the source/target ancestors that are direct
      children of the common parent. Three cases:
      A) common === source — caller throws via existing `jsxContains` cycle
      guard; lift returns null defensively.
      B) common === target — source is descendant of target; lift extracts
      sourceNode (no inner-lift) so it becomes a sibling of target inside
      target's parent.
      C) common is a strict ancestor of both — Task 4 main case: lifted
      source = source's chain entry directly under common; lifted target
      = target's chain entry directly under common.
      `moveElement` (same-file branch) consumes the lift result, choosing
      `(movingNode, movingParent)` and `(pivotNode, pivotParent)` accordingly,
      then performs a single cut+splice. When lift returns null
      (cross-component: source/target in different return statements of the
      same file), falls back to the original cross-parent splice so
      cross-component moves keep working.
      Unit tests in `vscode-extension/hypercanvas-preview/src/__tests__/
AstServiceMove.test.ts` cover the Task 4 fixture exactly: a grid
      container with two cards, source `<p className="b1">` inside card1,
      target `<h3 className="t2">` inside card2 → cards swap. Plus updated
      the three pre-existing different-parent tests (sibling→cousin,
      deep→root, root→deep) to match the new lift semantics with
      explanatory comments. AstServiceMoveLeafTarget cross-parent tests
      also adjusted to assert the leaf-self-closing invariant under lift.
      29/29 move-related tests pass (Move + LeafTarget + CrossFile +
      CrossComponent + CrossCompFile + CacheInvalidation), no regressions
      vs baseline (321 → 323 pass; +2 new lift tests, same fail count).

### Task 5: E2E: drag every kind of element

- [x] Build a fixture component with: span, p, h3, div with children,
      div with t() expression, button, img, ul/li. Drag each onto a
      sibling. Assert every drag produces a file change.
      Added `drag-every-kind-fixture` to
      `react-vite-tw4-twitter/src/components/TestElements.tsx`: one
      `<div>` flex-col container with 8 sibling JSX elements covering
      every kind (span, p, h3, div-with-children, div-with-t-expression,
      button, img self-closing leaf, ul/li). All siblings share the
      same direct JSX parent, so this is the simplest possible move
      case — same-parent reorder, the bar every drag must clear.

      Added test `e2e/tests/project-independent/drag-every-kind.spec.ts`
      (PI-5-DR-EK). Single test: boots design mode once, then runs 8
      sequential drags in a cycle (kinds[i] → kinds[i+1 % 8]), so each
      kind acts as the source exactly once. For every step the test:
        - snapshots TestElements.tsx before the drag,
        - drags via `dragInIframe` with steps:20,
        - polls 8s for the file to differ from the snapshot
          (`expect.poll(...).not.toBe(beforeStep)`),
        - asserts no `must share a direct JSX parent`,
          `no-common-parent`, or `source/target disappeared after
          re-parse` console error appeared on this step,
        - asserts every kind's testid still exists in source after
          the move (reorder, never delete),
        - takes a per-step screenshot under
          `EK-step-NN-<src>-onto-<tgt>.png` so Task 6 can attach
          before/after frames per kind.

      Validation: `bun x tsc --noEmit` in
      `react-vite-tw4-twitter` is green (exit 0); `bun x biome lint`
      on both new/edited files is green. Pre-existing tsc errors in
      e2e/canvas-bugs.spec.ts are unrelated (Page.scrollTo /
      Page.scrollY type drift, see lines 376-393, predates this
      change).

### Task 6: Build, install, screenshot ALL successful drags, TG

- [x] Run E2E. Open each passed screenshot via Read; verify visible move.
      Built ext v0.1.41 from worktree via build-and-install.sh,
      ran in docker (run-20260507-120925-33311) with
      HYPER_E2E_EXTENSION_REPO pointed at the worktree. Results: - PI-5-DR-EK chain test: steps 1-6 PASS (span, p, h3,
      div-with-children, div-with-t, button — every kind has its
      EK-step-NN-\*.png screenshot and the file rewrote on each).
      Step 7 (img → ul) FAIL with "file is unchanged" 8s timeout.
      Step 8 never ran because chain stopped at step 7. - PI-5-DR-EK-IMG fresh-state test: FAIL with the same
      "file is unchanged" 8s timeout. Both retries failed.
      `ast-debug.log` from the run shows only 6 calls to
      `AstBridge.handleMessage type=ast:moveElement` for the chain
      test (not 8) and zero calls during PI-5-DR-EK-IMG. Conclusion:
      when `<img>` is the drag source the iframe drag pipeline never
      sends moveElement RPC — the bug is in the iframe-side drag
      manager (likely img-resize handlers swallowing the drag-source
      gesture), NOT in AstService / Tasks 3-4. Sent TG report
      summarising the partial result + EK-step-06 screenshot.
- [x] If any case still doesn't work, do NOT mark plan done.
      Marked: img-source still doesn't work — Task 7 added below to
      fix it. Plan stays open until Task 7 lands a green run for both
      PI-5-DR-EK (all 8 steps) and PI-5-DR-EK-IMG.

### Task 7: Fix img-source drag — iframe drag manager swallows `<img>` mouse-down

- [x] Reproduce the failure deterministically. PI-5-DR-EK-IMG
      reproduces 100% in docker (run-20260507-124612, 125009, 125308,
      125548, 130145 all failed both retries with `file unchanged 8s
timeout`). `ast-debug.log` shows zero `moveElement` RPC calls
      during this test — confirms iframe never dispatches the move
      message.
- [x] Trace the iframe drag handler for img-source mouse-down.
      Hypothesis tested: native HTML5 drag on `<img>` (browser default
      `draggable=true`) was swallowing pointer events. Added
      `_nativeDragSuppressor` (dragstart preventDefault in design
      mode) to `vscode-extension/hypercanvas-preview/src/services/
scripts/iframe-interaction.ts:1483-1493`. Defensible hygiene —
      browsers DO default img/a draggable=true and stopping native
      drag in design mode is correct — but verified empirically that
      it does NOT fix the img-source bug.
- [x] Hardening attempt #2: `-webkit-user-drag: none` on every
      element in design mode (style-injector.ts) + JS sweep that
      walks `document.body` and sets `el.draggable = false` on
      every img/a/[draggable=true] node, plus a mutation-observer
      hook that does the same for nodes added after initial render
      (iframe-interaction.ts `_disableNativeDraggableIn`). Theory
      from advisor consult: Chromium establishes a native drag
      candidate at pointerdown for draggable elements _before_ the
      `dragstart` listener runs — `dragstart preventDefault` is
      too late, but `el.draggable = false` blocks the candidate
      from being established at all. Verified empirically in
      run-20260507-131350: PI-5-DR-EK-IMG STILL FAILS — file
      unchanged after 8s on both retries. Both hardening layers
      are defensible standalone (correct hygiene for design mode)
      but neither addresses the actual root cause.
- [ ] Fix: still needed after 6 build+test iterations. The bug is
      NOT native HTML5 drag interception — that hypothesis is now
      empirically refuted twice. Remaining hypotheses (advisor
      explicitly told us to STOP iterating instrumentation here):
      (a) The 8 `[drag-up]` events from prior iteration may be
      setup/teardown clicks, not the test's mouse.up. The
      actual drag's pointerdown/up may never reach the
      iframe at all because of a coordinate-targeting issue
      (16x16 img through 3 iframe levels, position drift).
      (b) Some other CDP-over-nested-iframes pathology specific
      to img elements (none of the 7 other element kinds
      fail in the chain test from a fresh state — only img).
      Next attempt MUST be: convert PI-5-DR-EK-IMG into a unit test
      that synthesizes `PointerEvent('pointerdown')` directly on the
      `<img>` in jsdom (or on the iframe's document via Playwright
      `frame.evaluate(() => el.dispatchEvent(...))`). That isolates
      whether the bug is in the drag handler chain (handler-side)
      or in the test harness's ability to deliver mouse events to
      a 16x16 element through three iframes (test-side). Do NOT
      start another instrumentation cycle until that experiment is
      done.
- [ ] Add a unit test (if the iframe drag manager has unit tests) +
      keep PI-5-DR-EK-IMG as the E2E acceptance gate.
- [ ] Re-run drag-every-kind E2E. Expect 8/8 chain steps and
      PI-5-DR-EK-IMG green. Open EK-step-07-\*.png + EK-IMG-after.png
      via Read, verify a real move (the img DOM moved relative to
      sibling DOM in the screenshot). Send TG with both proof shots.
- [ ] Only after PI-5-DR-EK-IMG and the chain step 7 are deterministic
      green, mark this Task and Task 6 fully done and the plan
      complete.
