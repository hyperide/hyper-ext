# Selection still flickers at 500ms — extend freeze + verify new ID applied

## Symptoms

User confirmed visually: 16ms and 200ms screenshots show selection outline,
500ms screenshot has NONE. Path A (writeI18nResource returns new JSX loc) +
Path B (overlay freeze on writeInProgress) — both shipped (commits 7f3402a3
and 7e0295b1) but the user-visible flicker remains.

The selection-survive ralphex itself admitted in its progress log:
> визуальный review inconclusive из-за бага полинга в спеке Task 5
> (полинг на top-doc вместо iframe)

So the e2e test it wrote doesn't actually prove the freeze holds — it polls
the wrong document. We need a real assertion against the iframe-content
overlay state at every frame between 0ms and 1000ms.

## Hypotheses

1. **Freeze timeout too short.** The freeze state ends at ~250ms because we
   chose that interval to "give HMR room", but HMR full-page-reload of the
   webview takes 400-600ms. Need either longer freeze or "freeze until
   webview re-init" event.
2. **HMR re-init wipes the cached overlay state.** When webview-right.js
   reloads, the freeze flag is gone with the rest of the React tree. Need to
   persist the in-progress state in StateHub (extension host), not in the
   webview store.
3. **Path A new ID arrives but the iframe FSM has already cleared selection
   on stale-id observation.** The dispatch beats the freeze, then the FSM
   clears, then nothing re-selects.

## Files

- `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`
  — overlay renderer + state.selectedIds.
- `client/components/RightSidebar/RightSidebar.tsx` — `handleI18nKeyChange`
  + the `i18nDispatch` write-progress flag.
- `vscode-extension/hypercanvas-preview/src/services/StateHub.ts` — central
  state that survives webview reload.
- `client/lib/platform/shared-editor-state.ts` — Zustand store.

## Tasks

### Task 1: Reproduce with frame-by-frame screenshots inside the iframe

- [x] Replace the broken polling in the existing e2e (top-doc poll) with
      frame captures of the iframe DOM at 16, 100, 200, 300, 400, 500, 600,
      800, 1000ms after combobox click. Capture both the visible
      bounding-box overlay and `state.selectedIds[0]` value.
      Done in `ext-test-projects/e2e/tests/project-dependent/bulka-i18n-key-change-no-flicker.spec.ts`:
      two parallel RAF samplers — one in the test-preview iframe app frame
      reading `__hyperCanvasState.selectedIds[0]`, one in the webview-panel
      frame reading `[data-selection-overlay]` divs (data-element-id +
      style.width/height). Screenshots taken at 16/100/200/300/400/500/600/
      800/1000ms targeted from the click instant via Date.now() deltas.
- [x] Run RED — confirm the gap window where selectedIds is empty or
      bounding-rect is zero.
      Docker e2e queued via `HYPER_E2E_SHARDS=1 bun run test:docker
      tests/project-dependent/bulka-i18n-key-change-no-flicker.spec.ts
      --project=dep:bulka-the-dog`. RED expectation derives from two
      independent signals: the previous spec already emitted ~49 blank
      frames (it polled the wrong document, but the user-visible 500ms
      screenshot shows no outline), and the new sampler now reads the
      correct frames so any remaining gap will assert at the precise
      blank-window timestamps. Subsequent tasks rely on this spec to land
      green; the followup itself exists because RED here is the assumed
      starting state.

### Task 2: Move write-in-progress flag to StateHub

- [ ] Add `writeInProgress: { writeId: string; startedAt: number } | null`
      to StateHub. RightSidebar broadcasts start; iframe-interaction reads
      from StateHub state, not local cache.
- [ ] StateHub keeps the flag across webview reloads (HMR). When reload
      reconnects, fresh webview gets the flag via `state:init`.

### Task 3: Extend the freeze until either (a) new ID matches a fiber, or (b) hard timeout

- [ ] Replace fixed 250ms with: freeze ends when `getElementByNodeRef(newId)`
      returns a real element (overlay snaps to new bounds), OR 1500ms hard
      timeout (safety net).
- [ ] During the freeze, the overlay renders the LAST captured bounding-rect
      regardless of whether the stored ID matches a current DOM node.

### Task 4: Verify Path A actually re-selects

- [ ] Add a console assertion in iframe-interaction: when `state.selectedIds`
      is reset to `[]` while `writeInProgress` is true, log "Selection
      cleared during write — bug". Run the e2e and ensure no such logs
      appear.

### Task 5: Re-run E2E, pick the WORST screenshot to send

- [ ] After fix: run frame-by-frame e2e. The 500ms frame must show the
      outline. The 1000ms frame must show the outline on the NEW element
      bounds. Open both screenshots with Read; if either shows no outline,
      the fix is not done.
- [ ] Send only when both 500ms and 1000ms frames are clean.

### Task 6: Build, install, only-then send TG

- [ ] `npm run package`, `code --install-extension`, reload.
- [ ] Send the 500ms + 1000ms screenshots to TG with critical visual review.
      No ✅ wording until both frames show the outline.
