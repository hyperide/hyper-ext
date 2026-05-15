# Selection survives i18n key/text change — element identity stays, only text mutates

## Critical context

Previous attempts (Path A "writeI18nResource returns new JSX loc", Path B
"overlay freeze") were **wrong by premise**. User correction:

> writeI18nResource возвращает new JSX loc — это неправильно. Нужно менять
> текст в существующем элементе, а не заменять элемент.

Right model:

- The JSX node is THE SAME node before and after. Its `loc` (filename:line:col)
  does not change because we only rewrite the argument string passed to
  `t(...)` (children expression of an existing JSX element).
- The selection ID is stable: same `path:line:col` before and after.
- Therefore selection MUST survive without any "return new ID" or "freeze"
  trickery — the ID is unchanged.

If selection visibly drops to nothing at 500ms (confirmed by user
screenshot), the bug is NOT "ID went stale". The bug is:

A. **HMR forces full page reload** instead of fast refresh, so React fiber
   tree is rebuilt; the iframe FSM cache that mapped `path:line:col` →
   DOM element is wiped and not rebuilt before we look up.
B. **`state.selectedIds` is reset to `[]`** somewhere in the reconnect path
   (state:init applying an empty default before the real state arrives).
C. **The overlay renderer hides the rect** when no DOM element matches the
   stored ID, even for a single frame, instead of waiting.

Path A (`return new ID`) is REVERTED because it implies the element changes,
which is not true. The previously-shipped commits that did this need to be
either:
1. removed if they actively broke things, or
2. left no-op if the new field is just unused.

## Files

- `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`
  — overlay renderer; reads `state.selectedIds[0]`, looks up DOM by source-id,
  draws the rect.
- `vscode-extension/hypercanvas-preview/src/services/scripts/source-cache.ts`
  (or wherever the iframe builds its `path:line:col → element` map) — needs
  to be rebuilt eagerly after HMR reload, BEFORE the renderer queries it.
- `client/components/RightSidebar/RightSidebar.tsx` — `handleI18nKeyChange`
  must NOT dispatch a "different" id. The original `selectedId` is and stays
  valid; no re-dispatch needed if everything else is correct.
- `client/lib/platform/shared-editor-state.ts` — Zustand store; ensure
  `state:init` after reload does not clobber a non-empty selectedIds with
  `[]`.

## Tasks

### Task 1: Revert / strip the "new JSX loc" return value

- [x] Remove the `newElementId` return from writeI18nResource AstBridge
      handler, AstService.writeI18nResource, and the client `astOps`
      contract. The post-write JSX node is identified by the SAME location.
      (no-op: `newElementId` was never actually shipped — AstBridge response
      data is `{ filePath }`, AstOperations.writeI18nResource returns
      `Promise<void>`, server route returns `{ success, filePath }`. The
      previous plan only proposed it; nothing reached the codebase.)
- [x] Remove the `i18nDispatch({ selectedIds: [newId] })` re-dispatch from
      RightSidebar. The original selection ID is and remains correct.
      (Removed the entire `i18nDispatch` `useMemo` and the dispatch calls
      inside `handleI18nKeyChange`. Also dropped the now-unused
      `createSharedDispatch` import.)
- [x] Remove the x3-dispatch kostyl entirely — it's papering over the wrong
      problem. (Dropped the immediate + 250ms + 800ms `setTimeout` re-broadcast
      block in `handleI18nKeyChange`.)

### Task 2: Diagnose why selection visibly disappears

- [x] Add console-tagged logging in iframe-interaction at every change to
      `state.selectedIds`. Reproduce on bulka-the-dog: select element, change
      i18n key. Capture the timeline: at what timestamp does selectedIds[0]
      change, and to what?
      (Added `logSelsurvSelectedIdsAssign(reason, prev, next)` helper near
      the `state` declaration, tag `[selsurv]`. Wrapped all 4 assignment
      sites in `iframe-interaction.ts`: click:additive, click:single,
      msg:stateUpdate, msg:goToVisual. Each emits
      `console.debug('[selsurv]', 'selectedIds change', { t, reason, prev, next })`
      only when the array actually changes — diff-gated, no spam. Reproduction
      itself will run in Task 5's frame-by-frame e2e, where these logs will
      be captured alongside the screenshots.)
- [x] Add overlay renderer logging: at every paint, log
      `(selectedIds[0], domElementFound, rectVisible)`. The 500ms gap user
      sees should appear in logs as `(stable id, false, false)` — i.e. ID
      is intact but DOM lookup misses.
      (Added `logSelsurvOverlayPaint(selectedId, domElementFound, rectVisible)`
      helper. Called inside `sendOverlayRects` after `computeOverlayRects`:
      re-resolves the DOM element via `iframeElementResolver.findElements`
      to derive `domElementFound`, and reads `rectVisible` from the matching
      selection rect (`width > 0 && height > 0`). Coalesces by tuple key so
      the console isn't flooded — only logs on transitions. Build verified
      with `node esbuild.js` (exit 0); all 6 instrumentation sites present
      in `out/iframe-interaction.js`.)

### Task 3: Eager source-cache rebuild after HMR

- [x] After Vite HMR fires `vite:beforeUpdate` or after the iframe reload
      event, eagerly walk the new fiber tree and rebuild the
      `path:line:col → element` map. Don't wait for the next render to ask
      it lazily.
      (Hooked `vite:afterUpdate` via `window.__vite_hot__.on(...)` in
      `iframe-interaction.ts`. Each HMR application invalidates the source
      cache, kicks off `warmClientSourceMaps()` + `requestServerSourceMaps()`,
      and forces an immediate overlay paint so `FiberSourceIndex.ensureBuilt()`
      runs against the fresh fibers without waiting for the next React commit.
      `__vite_hot__` is registered after Vite's runtime client boots, so the
      hook poll-installs for up to 5s. The `onCommitFiberRoot` invalidation
      already covers the React-only case; this hook closes the gap when Vite
      swaps the module a frame ahead of React commit. No code path uses
      `vite:beforeUpdate` — it fires while the OLD module is still mounted, so
      invalidating then would just rebuild the stale tree.)
- [x] Until the cache is rebuilt, the overlay renderer should not call
      `clearSelection()` on a missed lookup — it should wait one tick and
      retry.
      (`sendOverlayRects` doesn't call `clearSelection`, but it produces an
      empty selection rect on miss which the parent webview interprets as
      "selection lost". Added `selection-grace-cache.ts`: snapshots each
      successful per-elementId selection rect, and on a miss for an ID still
      in `state.selectedIds`, replays the cached rect for up to 800ms while
      scheduling a 50ms retry paint. Cache is pruned for IDs that leave
      `selectedIds` so a deselected element is NEVER replayed. Pure logic +
      9 unit tests in `__tests__/selection-grace-cache.test.ts` covering:
      snapshot/replay/expire, deselect-mid-grace, deadline refresh, zero-area
      miss, multi-selection independence, resizable preservation, hover
      passthrough.)

### Task 4: Guard `state:init` from clobbering selectedIds

- [x] If `state:init` arrives with `selectedIds: []` while the local store
      already has a non-empty selection, IGNORE the empty value (or merge,
      keeping local). The empty default is a race artefact, not user intent.
      (Extracted pure `mergeInitState(incoming, local)` in
      `client/lib/platform/shared-editor-state.ts`. The `init` action now
      calls `set((local) => mergeInitState(newState, local))` instead of
      naked `set(newState)`. Rule: when `local.selectedIds.length > 0` and
      `incoming.selectedIds.length === 0`, keep local `selectedIds` and
      `selectedItemIndices` (the latter is keyed by selection IDs and must
      stay in lockstep). Every other field — `currentComponent`,
      `canvasMode`, `engineMode`, `astStructure`, `hoveredId`, etc. —
      adopts the incoming snapshot unchanged so authoritative non-selection
      state (component swap, mode toggle) still flows through reload.)
- [x] Add a unit test for the merge logic.
      (Created `client/lib/platform/shared-editor-state.test.ts` — 5 tests:
      empty-incoming-keeps-local, non-empty-incoming-overrides, empty/empty
      stays empty, empty-incoming preserves selection but adopts other
      fields, non-empty-incoming brings its own `selectedItemIndices`.
      `bun test` 5/5 pass; biome and tsc clean.)

### Task 5: Frame-by-frame e2e

- [ ] Inside the iframe (not top-doc), capture screenshots every 50ms from
      0 to 1500ms after the combobox click. Assert that at every frame, the
      selection bounding-box overlay is non-empty AND at the same source
      location as before the click.
- [ ] Use `iframe.locator('[data-overlay-selection]')` (or whatever element
      class the overlay uses) — read its bounding box via
      `evaluate(el => el.getBoundingClientRect())`.

### Task 6: Build, install, run e2e, send screenshots only when verified

- [ ] `npm run package`, install, reload.
- [ ] Run frame-by-frame e2e. Open the 500ms and 1000ms screenshots with
      Read; both must show the outline at the SAME source location (same
      element).
- [ ] Send to TG with critical visual review only when verified. No ✅ until
      both frames pass the visual.
