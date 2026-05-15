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

- [ ] Add console diagnostics in iframe-interaction tracking every change to
      `state.selectedIds` with stack trace.
- [ ] Reproduce: select element with t('test.greeting') in bulka-the-dog,
      change key via combobox, capture the timeline:
      a) when does the overlay disappear?
      b) what cleared the selection — DOM gone, state cleared, or overlay
         renderer skipped?
      c) when does the new ID arrive (if ever)?
- [ ] Document the trace in the plan.

### Task 2: Implement Path A — AstBridge returns new source location

- [ ] In `writeI18nResource` handler (server + AstBridge), after the JSX
      rewrite re-locate the rewritten JSX node and return its new source
      location.
- [ ] In `handleI18nKeyChange`, replace the x3-dispatch with one dispatch
      using the returned new ID. Single dispatch, single re-render.

### Task 3: Implement Path B — overlay freeze during write

- [ ] In iframe-interaction add `state.writeInProgress` flag, set true on
      `hypercanvas:writeI18nResource:start`, false on `:done`.
- [ ] In overlay renderer, while writeInProgress is true, retain the last
      computed bounding-rect even if `selectedIds[0]` does not currently
      match a DOM element. Snap to new rect when the match returns.
- [ ] Send the start/done events from RightSidebar via canvas bus.

### Task 4: Strip the x3-dispatch kostyl

- [ ] Remove the three setTimeout calls in `handleI18nKeyChange`. Trust the
      single dispatch + overlay freeze.

### Task 5: Unit + E2E

- [ ] Unit test for the freeze logic (overlay returns last rect when no
      match while writeInProgress).
- [ ] E2E: select element, pick new key, take screenshots at 16ms, 200ms,
      500ms — assert outline visible at every frame.

### Task 6: Build, install, E2E screenshots, TG

- [ ] `npm run package` from main, install, reload.
- [ ] Capture the 3-frame sequence proving no flicker.
- [ ] `send-tg-photo.sh` with critical visual review.
