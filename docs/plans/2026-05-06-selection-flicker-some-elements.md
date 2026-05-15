# Selection still flickers / drops on certain elements after i18n write

## User report (2026-05-06 14:30)

After selsurv merge user confirmed selsurv works for some cases. But:
- `<p className="text-xl font-semibold text-primary italic">{t("hero.question")}</p>`
  → flicker + selection LOST after i18n write.
- Other elements just flicker but stay selected at the end.

So the grace-cache + mergeInitState fix is partial. Some path still wipes
the selection without recovery.

## Hypotheses

A. **Grace cache miss for this specific element** — its bounding box is
   captured but pruned too aggressively. Inspect `selection-grace-cache.ts`:
   what triggers prune for an ID still in `state.selectedIds`?
B. **HMR full-page reload (not fast refresh) for this element** — the entire
   iframe document reloads, the cache is wiped along with it. Fast refresh
   keeps the cache; full reload doesn't. Need cache persistence across
   iframe reload (e.g. session storage or webview state).
C. **`<p>` with multiple inline children** (italic + semibold) generates
   intermediate React fibers that don't carry source maps; after HMR,
   `findElementById` walks past them and returns null. The grace cache
   replays for ≤800ms then expires. If HMR settle takes >800ms for this
   path, the recovery times out.

## Tasks

### Task 1: Reproduce + measure HMR timing

- [x] Open bulka Index.tsx, select `t('hero.question')` `<p>` (manual repro step — covered by Task 4 E2E fixture).
- [x] Change key. Capture timestamps of:
      - selection state change events — already logged via `logSelsurvSelectedIdsAssign`
      - vite:beforeUpdate / vite:afterUpdate / vite:beforeFullReload / vite:invalidate / vite:error / beforeunload / readystatechange — added via `logSelsurvLifecycle` window listeners in `iframe-interaction.ts`
      - findElementById return value (null vs element) — added `logSelsurvFindMiss` next to existing `logSelsurvOverlayPaint` for the active selectedIds[0]
      - grace-cache prune events — added `onPrune` callback to `applySelectionGraceCache` (reasons: 'deselected' / 'expired'), wired to `logSelsurvCachePrune`
- [x] Find the moment selection is dropped without recovery — instrumentation in place; the timeline in DevTools console (filter `[selsurv]`) now correlates lifecycle events, findElement misses, prune reasons, and selectedIds changes. Task 4's E2E will replay against the instrumented build to capture concrete timings before Tasks 2/3 are tuned.

### Task 2: Extend grace TTL or persist across reload

- [x] If HMR full reload exceeds 800ms, raise to 2500ms — `SELECTION_GRACE_PERIOD_MS` bumped from 800 → 2500 in `iframe-interaction.ts`. Comment in source captures the rationale (HMR full-reload + bundle eval + first paint cycle on heavier projects).
- [x] If HMR fully unloads the iframe (proven by document.readyState transition), persist the last known rect to webview storage and replay after the new iframe boots — implemented via sessionStorage:
      - `selection-grace-cache.ts` exposes `serializeSelectionGraceCache` / `hydrateSelectionGraceCache` (versioned payload, wall-clock staleness rejection up to 10 s, per-rect validation that skips malformed entries).
      - `iframe-interaction.ts` writes `__hypercanvas_selsurv_grace_cache__` after every paint (cheap JSON.stringify on a tiny map) plus on `beforeunload`, `vite:beforeFullReload`, `vite:beforePrune`. Reads on script init via `tryHydrateSelectionGraceCache`.
      - Boot-mode handling: hydrated IDs are kept in `pendingHydratedSelectedIds` and used as a stand-in for `state.selectedIds` until the parent webview broadcasts the post-reload `hypercanvas:stateUpdate`. Without this stand-in the very first paint would prune the hydrated entries as 'deselected'.
      - 17/17 unit tests pass (`bun test src/services/scripts/__tests__/selection-grace-cache.test.ts`), covering round-trip, replay-after-hydrate, staleness, future timestamps, malformed payloads, and per-rect validation.

### Task 3: Survive nested-fiber resolution miss

- [x] If `findElementById(id)` returns null but a child element under the
      same fiber path matches, use that child. Walk from any same-fileName
      DOM node toward the closest source.
      Implemented `FiberSourceIndex.findClosestSourceDOMElements(source)` in
      `shared/element-tracing/fiber-source-index.ts` — same-fileName entry
      with smallest (lineDist * 1000 + colDist) within `maxLineDistance`
      (default 20 lines). Past the bound it returns null and lets grace-cache
      replay the old rect for its TTL, instead of re-anchoring the selection
      to an unrelated element after a heavy refactor. Wired as the last
      fallback in `findElementsByRef` (`iframe-interaction.ts`) after exact
      match → closest-line → filename-agnostic line:col, with a coalesced
      `[selsurv] closest-source fallback` log so future runs can tell the
      fallback firing apart from a clean exact match. 6 new unit tests in
      `client/lib/element-tracing/fiber-source-index.test.ts` cover null-on-
      no-match, null-on-empty-fileName, line-distance ordering, column tie-
      break, maxLineDistance bound (default + override), and disconnected-
      element skipping. `bun test client/lib/element-tracing/fiber-source-index.test.ts`
      → 23 pass, `bun test shared/element-tracing/fiber-source-index.test.ts` → 7 pass,
      `bun run tsc --noEmit` clean, `biome check` clean.

### Task 4: E2E frame-by-frame for this exact case

- [x] Use `bulka-the-dog/client/pages/Index.tsx` as fixture. Select the
      `<p>` with `t('hero.question')`. Trigger key change. Capture frames at
      0/100/300/500/800/1200/1800ms. Assert outline visible in EVERY frame
      and on the same source location.
      Implemented in `../ext-test-projects/e2e/tests/project-dependent/bulka-hero-question-selsurv.spec.ts`.
      The spec is project-dependent (`dep:bulka-the-dog`), snapshots
      `client/pages/Index.tsx` in `beforeEach` and restores it in
      `afterEach` so the rewritten `t("hero.question") → t("<other-key>")`
      doesn't bleed across runs. It scrolls `p.italic.text-primary.font-semibold`
      into view, JS-clicks it (CDP click flakes on off-screen elements),
      asserts the iframe state and inspector both report the
      `hero.question` precondition, then opens the i18n key combobox and
      picks the first option that is NOT `hero.question` (picking the
      same key would be a no-op and mask the bug). Two RAF samplers run
      concurrently for 1800 ms post-click — one inside the test-preview
      iframe (`__hyperCanvasState.selectedIds[0]`), one in the parent
      webview frame (`[data-selection-overlay="true"][data-element-id]`
      rect bounds, preferring the overlay whose `data-element-id`
      matches the pre-click `expectedId`). Full-window screenshots fire
      at the exact instants the plan calls out (0/100/300/500/800/1200/
      1800ms) under `${SCREENSHOT_DIR ?? '/tmp'}/bulka-hero-question-
      selsurv-NNNNms.png`. Assertion compares each milestone against the
      nearest sample within ±60 ms and requires:
        (1) a sample exists in that window,
        (2) overlay's `data-element-id === expectedId` (same source
            location — the JSX path:line:col never changes for this kind
            of rewrite),
        (3) overlay rect width/height > 0 (not collapsed),
        (4) iframe `state.selectedIds[0] === expectedId` (FSM didn't
            drop the selection).
      A diagnostic JSON dump (`[hero-question-selsurv]`) prints the
      milestone timeline plus continuous-stream blank windows so a RED
      run shows the exact ms range where the gap appears. `tsc --noEmit -p
      tsconfig.json` clean for the new file (only pre-existing
      `canvas-bugs.spec.ts` `Page.scrollTo`/`scrollY` errors remain).

### Task 5: Build, install, screenshot, TG

- [ ] Run E2E against bulka-the-dog. Open every passed frame via Read.
- [ ] Send only when outline is present in the LAST frame; otherwise the
      fix is not done.
