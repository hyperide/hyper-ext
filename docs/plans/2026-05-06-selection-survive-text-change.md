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

- [ ] Remove the `newElementId` return from writeI18nResource AstBridge
      handler, AstService.writeI18nResource, and the client `astOps`
      contract. The post-write JSX node is identified by the SAME location.
- [ ] Remove the `i18nDispatch({ selectedIds: [newId] })` re-dispatch from
      RightSidebar. The original selection ID is and remains correct.
- [ ] Remove the x3-dispatch kostyl entirely — it's papering over the wrong
      problem.

### Task 2: Diagnose why selection visibly disappears

- [ ] Add console-tagged logging in iframe-interaction at every change to
      `state.selectedIds`. Reproduce on bulka-the-dog: select element, change
      i18n key. Capture the timeline: at what timestamp does selectedIds[0]
      change, and to what?
- [ ] Add overlay renderer logging: at every paint, log
      `(selectedIds[0], domElementFound, rectVisible)`. The 500ms gap user
      sees should appear in logs as `(stable id, false, false)` — i.e. ID
      is intact but DOM lookup misses.

### Task 3: Eager source-cache rebuild after HMR

- [ ] After Vite HMR fires `vite:beforeUpdate` or after the iframe reload
      event, eagerly walk the new fiber tree and rebuild the
      `path:line:col → element` map. Don't wait for the next render to ask
      it lazily.
- [ ] Until the cache is rebuilt, the overlay renderer should not call
      `clearSelection()` on a missed lookup — it should wait one tick and
      retry.

### Task 4: Guard `state:init` from clobbering selectedIds

- [ ] If `state:init` arrives with `selectedIds: []` while the local store
      already has a non-empty selection, IGNORE the empty value (or merge,
      keeping local). The empty default is a race artefact, not user intent.
- [ ] Add a unit test for the merge logic.

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
