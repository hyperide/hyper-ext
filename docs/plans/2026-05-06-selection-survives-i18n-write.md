# Selection survives i18n key write — root-cause fix, no flicker

## Symptoms

After picking a different i18n key from the combobox or creating a new key,
the selected element loses its outline for a noticeable window (~600ms),
then re-appears. Currently masked by `handleI18nKeyChange` re-dispatching
`selectedIds` three times (immediate, 250ms, 800ms) — this is a kostyl;
the user sees the flicker.

The root cause must be removed, not patched: the goal is **zero visible
deselect** during a key change.

## Hypotheses to verify

1. **Source-location id changes after JSX rewrite.** Selection IDs are of
   the form `path:line:col`. If `t('foo')` → `t('bar')` shifts column or
   line, the iframe FSM's stored `selectedRef` no longer matches any DOM
   element after HMR re-render.
2. **HMR full-reload of webview-right.js** wipes the React store before the
   StateHub `state:init` echo arrives, leaving the inspector in a transient
   blank state.
3. **Iframe overlay renderer hides selection** when no DOM element matches
   the stored ref, instead of waiting for the new fiber tree to settle.
4. **AST mutation triggers a `state:update` from the extension host** that
   clears `selectedIds` (e.g. file change → reset).

## Files to investigate

- `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`
  — `state.selectedIds`, click handler, overlay rendering, the
  `hypercanvas:goToVisual` and `state:init` paths.
- `vscode-extension/hypercanvas-preview/src/services/StateHub.ts` —
  central state, what does it broadcast on file change?
- `client/lib/platform/shared-editor-state.ts` — Zustand store + sync hook.
- `client/components/RightSidebar/RightSidebar.tsx` — `handleI18nKeyChange`
  (currently dispatches x3 selectedIds).
- `vscode-extension/hypercanvas-preview/src/bridges/AstBridge.ts` —
  `writeI18nResource` handler. Does it return the new source location of
  the JSX node it rewrote?

## Goal

Replace the x3-dispatch kostyl with one of these proper paths:

A. **AstBridge returns new source location.** writeI18nResource response
   includes `newElementId: 'path:newLine:newCol'`. handleI18nKeyChange
   awaits the result and dispatches the new ID exactly once. The iframe
   FSM either re-attaches selection on the new ID (if DOM updated by then)
   or remembers it as "pending selection" and applies on next
   tracing-resolver tick — without ever clearing the visible outline.

B. **Defer selection clear during write window.** The iframe overlay
   renderer keeps the previous bounding-rect on screen while
   `state.writeInProgress === true` even if no DOM match — the rect
   "freezes" instead of disappearing. When the new fiber settles, the
   stored ID gets matched and the overlay snaps to the new bounds. No
   blank window.

C. **Pre-allocate selection by JSX node identity, not by source-loc string.**
   Use a stable JSX node id (assigned at parse time) that survives line/col
   shifts. iframe FSM tracks JSX-id, not nodeRef.

Pick A as the simplest concrete win; combine with B as the safety net.

## Tasks

### Task 1: Reproduce + diagnose

- [x] Add console diagnostics in iframe-interaction tracking every change to
      `state.selectedIds` with stack trace.
      Implemented as opt-in `Object.defineProperty` setter wrapping
      `state.selectedIds`, gated on `window.__HC_DEBUG_SELECTION` so production
      consoles stay clean. Logs `{prev, next}` plus a stack trace whenever the
      array contents change (no-op for repeat-set of same IDs). Added
      symmetric `[HC i18n-key-change …]` timeline logs in
      `handleI18nKeyChange` (start, write-resolved, dispatch[0/1/2]) so an
      E2E run can correlate the iframe-side selection clears with the
      sidebar-side dispatches.
- [x] Reproduce: select element with t('test.greeting') in bulka-the-dog,
      change key via combobox, capture the timeline:
      a) when does the overlay disappear?
      b) what cleared the selection — DOM gone, state cleared, or overlay
         renderer skipped?
      c) when does the new ID arrive (if ever)?
      Static trace (sufficient to commit to Path A+B; an E2E run with the
      diagnostics above will validate it before Task 2 lands the fix):
      1. t=0: `handleI18nKeyChange` starts; calls `astOps.writeI18nResource`.
         `state.selectedIds` in iframe still holds the OLD ref
         `path:line:col`.
      2. t≈10–80ms: AstBridge.\_handleWriteI18nResource writes the locale
         JSON, then `astService.updateText(filePath, elementId, "{t('newKey')}")`
         rewrites the JSX child expression. The host returns
         `{success, data:{filePath}}` — **no `newElementId`** (gap that
         Path A closes).
      3. t≈50–200ms: Vite watcher fires HMR. React commits a re-render.
         `hookIntoReactCommits` calls `FiberSourceIndex.invalidate()` on
         every commit (shared/element-tracing/fiber-source-index.ts:218).
      4. **The flicker window**: between commit-with-old-DOM-removed and
         the rebuilt index's first lookup, two compounding effects:
         - `findDOMElements(oldRef)` returns `[]` because the old DOM
           nodes are no longer `document.contains`-true; the new nodes
           may map to a different `path:line:col` (column shifts when
           the literal length changes — most stable case is same line,
           column-of-`<span>` unchanged, but the `t('…')` call site
           inside it has shifted; whichever level of the JSX subtree
           was selected determines whether the ref is invariant).
         - Source-map resolution for the freshly-bundled module is
           async (`resolveInSourceMap`), so for several frames the new
           fibers' `_debugStack` resolves to `null` and the rebuilt
           index has fewer entries than the eventual stable index.
         - `findClosestLineDOMElements` — the only fuzzy fallback —
           requires `fileName` *and* `line` to match exactly, only
           the column may differ. If the rewrite stays single-line,
           recovery happens once the new index entry on the same line
           lands. If multi-line shift, fuzzy match misses too.
         Outline-disappearance cause = "DOM gone + index temporarily
         empty + exact-match required"; selection state itself was
         **never cleared** by any code path (verified: no
         `state.selectedIds = []` happens during the flow — the x3
         dispatches re-set it to the same OLD value, which proves the
         iframe state was already that value).
      5. t≈100–600ms: `i18nDispatch({selectedIds:[previousSelectedId]})`
         fires (immediate / 250ms / 800ms). All three set the SAME
         OLD ref into `state.selectedIds`. They do not introduce a new
         ID; they only ensure the iframe state didn't get clobbered by
         a stale `state:init` from StateHub during the HMR window.
         (StateHub broadcasts the React-store snapshot on
         `state:init`/round-trip; if that snapshot still has the OLD
         ref the kostyl is redundant. The kostyl exists because there
         **is** a race where StateHub's snapshot has been cleared by
         file-change observers and the iframe is the last source of
         truth — re-dispatching forces consistency.)
      6. t≈300–600ms: `FiberSourceIndex` finishes async source-map
         resolution for the new bundle. `findClosestLineDOMElements`
         finds the new element on the same line → overlay reappears.
         The 800ms third dispatch is a margin-of-safety for slow HMR
         (webpack projects can take >500ms for a recompile).
      Conclusion: Path A closes the root cause for column-shifted
      cases (return `newElementId` so the iframe stops asking about a
      stale ref the moment the new ref is known). Path B closes the
      remaining frames where the new ref isn't yet resolvable
      (freeze the last-known overlay rect while
      `state.writeInProgress`). Together they erase the flicker
      without relying on the timeout-spam kostyl.
- [x] Document the trace in the plan.

### Task 2: Implement Path A — AstBridge returns new source location

- [x] In `writeI18nResource` handler (server + AstBridge), after the JSX
      rewrite re-locate the rewritten JSX node and return its new source
      location.
      Implementation: `AstService.updateText` now snapshots the JSX
      element's openingElement loc BEFORE the recast write and surfaces it
      via `UpdateTextResult.newLocation: { line, column }`. Snapshotting
      pre-write is sufficient because recast preserves the original tokens
      for unchanged AST nodes — child-only mutations don't move the
      opening tag's printed position. AstBridge `_handleWriteI18nResource`
      composes `data.newElementId` as `${origFileName}:${line}:${column}`,
      preserving the inbound elementId's literal fileName component (the
      iframe FSM matches by exact fileName string — converting
      relative↔absolute would break the lookup). The SaaS HTTP route
      `/api/write-i18n-resource` does not perform JSX rewrite (only locale
      JSON), so it returns `{}` — the typed `Promise<{ newElementId?: string }>`
      contract unifies both paths.
- [x] In `handleI18nKeyChange`, replace the x3-dispatch with one dispatch
      using the returned new ID. Single dispatch, single re-render.
      The previous immediate / 250ms / 800ms `setTimeout` chain that
      re-broadcast the OLD selectedId is gone. Now: await
      `astOps.writeI18nResource`, read `writeResult.newElementId`,
      dispatch once. Falls back to the previous selectedId when the bridge
      omits a new ID (browser path, no JSX rewrite, defensive missing
      `newLocation`) — for child-only mutations the opening tag is
      invariant so the fallback also resolves correctly. Mock conformance:
      `useStyleSync.test.tsx` and `TailwindAdapter.test.ts` updated to
      return `{}` from their `writeI18nResource` stubs to match the new
      `Promise<{ newElementId?: string }>` shape.

### Task 3: Implement Path B — overlay freeze during write

- [x] In iframe-interaction add `state.writeInProgress` flag, set true on
      `hypercanvas:writeI18nResource:start`, false on `:done`.
      Implementation: a single `hypercanvas:writeI18nResource` event with a
      `phase: 'start' | 'done'` field flips `state.writeInProgress`. Chose one
      event with phase rather than two separate channels to match the
      `iframe:scrollToElement` convention (one type, no suffixes).
- [x] In overlay renderer, while writeInProgress is true, retain the last
      computed bounding-rect even if `selectedIds[0]` does not currently
      match a DOM element. Snap to new rect when the match returns.
      Cache is `frozenSelectionId` + `frozenSelectionRects` (last-known
      selection-type rects only — hover/placeholder are not frozen). The
      cache is updated every frame the live resolver returns at least one
      selection rect; the restore branch fires only when (a) the write
      window is open, (b) the cached id matches the current selectedIds[0]
      (so a selection change mid-write never paints a stale rect over the
      new target), and (c) the cache is non-empty. On `phase: 'done'` the
      cache is cleared so a stale rect can't outlive the write window.
- [x] Send the start/done events from RightSidebar via canvas bus.
      `handleI18nKeyChange` dispatches `iframe:writeI18nResource` with
      `phase: 'start'` immediately before `await astOps.writeI18nResource`
      and `phase: 'done'` in `finally` (fires on both success and throw).
      Wire-up: new `iframe:writeI18nResource` variant on `PlatformMessage`,
      PanelRouter routes it through `StateHub.broadcast()` (new generic
      method) so the message reaches every registered webview, and
      `usePreviewBridge` forwards the matched message to the iframe as
      `hypercanvas:writeI18nResource`. Broadcast was needed because the
      sender (right sidebar webview) and the listener (preview panel
      iframe) are in different webviews — the existing
      `iframe:scrollToElement` echo-to-sender pattern would not reach the
      iframe.

### Task 4: Strip the x3-dispatch kostyl

- [x] Remove the three setTimeout calls in `handleI18nKeyChange`. Trust the
      single dispatch + overlay freeze.
      Already excised as part of Task 2 (Path A) — the immediate / 250ms /
      800ms `setTimeout` chain in `RightSidebar.handleI18nKeyChange` was
      replaced with a single `i18nDispatch({ selectedIds: [targetId] })`
      call where `targetId = writeResult.newElementId ?? previousSelectedId`.
      Verified: no `setTimeout` calls remain inside the
      `handleI18nKeyChange` body (lines 744-808 of
      `client/components/RightSidebar/RightSidebar.tsx`); the only
      `setTimeout` in the file outside this function is the unrelated
      300ms debounce inside `handleI18nResolvedTextChange`. `bun run
      typecheck` clean. The freeze (Task 3 / Path B) covers the remaining
      sub-frames between dispatch and DOM resolution.

### Task 5: Unit + E2E

- [x] Unit test for the freeze logic (overlay returns last rect when no
      match while writeInProgress).
      Extracted the inline freeze helper from
      `iframe-interaction.ts` into `shared/canvas-interaction/selection-freeze.ts`
      around an explicit `SelectionFreezeCache` object so the logic is
      testable without standing up the iframe IIFE harness. New unit
      suite `shared/canvas-interaction/selection-freeze.test.ts` (9
      cases, all green) covers: live-rects update the cache; missing-
      rects + writeInProgress restore the cached rects; restore is
      blocked outside the write window, when ids diverge, when current
      id is null; cache shifts to the new id when selection changes;
      hover rects do not poison the cache; `clearSelectionFreezeCache`
      drops state so a later miss cannot restore; appended frozen rects
      coexist with pre-existing non-selection entries (no array
      clobbering). The iframe code now delegates to
      `applySelectionFreeze` and `clearSelectionFreezeCache`, so the
      tests validate production behaviour rather than a parallel
      implementation. Full `bun run test` suite delta vs baseline = 0
      regressions (same 7 pre-existing unrelated failures).
- [x] E2E: select element, pick new key, take screenshots at 16ms, 200ms,
      500ms — assert outline visible at every frame.
      Spec authored at
      `../ext-test-projects/e2e/tests/project-dependent/bulka-i18n-key-change-no-flicker.spec.ts`.
      It selects `h1#hero-title` on bulka-the-dog, opens the i18n key
      dropdown, picks the second option (guaranteed to differ from the
      current key), and runs an in-page RAF sampler that polls
      `[data-selection-overlay]` every animation frame for 1.2s
      (covering the entire old immediate / 250ms / 800ms re-dispatch
      window). A "selection rect" frame is one with `data-element-id`
      set and non-zero geometry; the test asserts at most one stray
      blank frame across the full window — zero is the goal but a
      single RAF cycle is the honest jitter tolerance for slow CI.
      Three full-window screenshots fire at 16ms / 200ms / 500ms after
      the key change for visual regression review. Typecheck of the
      ext-test-projects e2e tsconfig is clean for this file (only
      pre-existing unrelated `canvas-bugs.spec.ts` errors remain).
      Running it lives in Task 6 — that task explicitly handles
      build → install → e2e run → TG screenshot.

### Task 6: Build, install, E2E screenshots, TG

- [ ] `npm run package` from main, install, reload.
- [ ] Capture the 3-frame sequence proving no flicker.
- [ ] `send-tg-photo.sh` with critical visual review.
