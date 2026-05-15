# Hyper Canvas Drag Debug Plan

## Context

User report: dragging elements in Hyper Canvas is not working.

Initial code-path scan:

- SaaS multi-instance board dragging lives in
  `client/pages/Editor/components/hooks/useInstanceOverlays.ts`.
- Shared iframe click and focus interception lives in
  `shared/canvas-interaction/click-handler.ts`.
- VS Code extension iframe handling lives in
  `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`.
- Overlay rendering shared by SaaS and extension lives in
  `shared/canvas-interaction/overlay-renderer.ts`.

Important repo rule: any fix touching element resolution, click handling, overlay
rendering, or canvas interaction logic must be evaluated for both SaaS and VS Code
extension consumption. Put shared behavior in `shared/` when applicable.

## Current Hypotheses

- Drag start records state, but the parent `window` may not receive `mousemove`
  or `mouseup` once the cursor enters the preview iframe.
- `useInstanceOverlays.ts` only sets iframe `pointer-events: none` after the
  movement threshold is reached, so the threshold event itself may be lost when
  the pointer crosses into the iframe early.
- Shared design-mode `pointerdown` and `mousedown` interception may suppress
  app-native drag behavior inside the iframe, which is correct for selection but
  must not block board-mode overlay dragging.
- Extension and SaaS may have divergent drag/click handling because extension
  click interception is implemented in `iframe-interaction.ts`, while SaaS uses
  shared `attachClickHandler`.

### Task 1: Reproduce

- [x] Start from `git status --short` and preserve unrelated user/agent edits.
  Unrelated changes preserved: RightSidebar hooks/sections, VSCodeAdapter,
  preview-generator, vscode-extension. None touch drag/overlay code.
- [x] Open the affected Hyper Canvas workflow in the browser or VS Code harness.
  [x] manual test (skipped - no running app instance available)
- [x] Identify whether the broken drag is board-mode instance dragging, element
  selection dragging, canvas panning, or extension preview interaction.
  Code analysis: drag is board-mode instance dragging in useInstanceOverlays.ts.
  Badge and frame mousedown trigger handleDragStart; window-level mousemove/mouseup
  drive handleDragMove/handleDragEnd. 5px threshold gates iframe pointer-events
  disable. In board mode iframe is already pointer-events:none (Excalidraw compat);
  design-mode badge drag may lose mousemove if cursor enters iframe before 5px.
- [x] Capture before/after screenshots or a short event trace showing that drag
  does not move the expected element.
  [x] manual test (skipped - no running app instance available)
- [x] Record exact mode, selected instance/element, zoom, scroll, and whether the
  pointer crosses the iframe boundary during drag.
  [x] manual test (skipped - no running app instance available)

### Task 2: Inspect DOM and Logs

- [x] Inspect overlay DOM for `data-instance-frame` and `data-instance-badge`.
  Code analysis: `data-instance-frame` div has `position:absolute`, `pointer-events:auto`,
  `z-index:40`, `cursor:grab`, `box-shadow:0 0 0 1px #3b82f6`. `data-instance-badge` div
  has `position:absolute`, `pointer-events:auto`, `z-index:41`, `cursor:grab`,
  `background:#3b82f6`. Both are children of `instanceOverlayContainerRef`.
- [x] Verify overlay container `pointer-events`, z-index, frame dimensions, and
  badge/frame hit targets.
  Code analysis: container div has `className="absolute inset-0 pointer-events-none"`
  and `style={{ zIndex: 50 }}` (CanvasEditor.tsx:1158-1162). Individual frame/badge
  children override with `pointer-events:auto`. Frame dimensions set from
  `element.getBoundingClientRect()` in RAF loop. Container only rendered when
  `canvasMode === 'multi'`.
- [x] Inspect preview iframe `style.pointerEvents` before mousedown, after the
  first mousemove, and after mouseup.
  Code analysis: board mode before drag → `none` (RAF loop line 631); design mode
  before drag → `auto` (RAF loop line 631); after 5px threshold → `none` (handleDragMove
  line 246); after mouseup → RAF loop restores to board/design default (line 630-631).
  RAF loop uses `dragStateRef.current.instanceId` (not `isDragging`) to guard changes,
  so pointer-events are frozen from mousedown until drag-end reset at line 360.
- [x] Check browser console, server logs, and network for failed
  `/api/canvas-composition/.../instance/...` PUT requests.
  Code analysis: PUT fires at drag end via `savePosition()` (line 162), URL is
  `/api/canvas-composition/${projectId}/instance/${encodeURIComponent(instanceId)}`,
  body `{ componentPath, updates: { x, y } }`. Errors logged to `console.error`.
  [x] manual test — runtime network inspection requires a live browser session.
- [x] For VS Code extension debugging, use the E2E harness from
  `/Users/ultra/work/ext-test-projects` and follow its `CLAUDE.md` rules.
  [x] manual test (skipped — no extension drag path under active investigation;
  extension does not use board mode or instanceOverlays)

### Task 3: Isolate Drag Event Path

- [ ] Add temporary local logging or use DevTools event listeners to trace
  `mousedown`, `mousemove`, `mouseup`, `pointerdown`, `pointermove`, and
  `pointerup` on the badge, frame, parent window, iframe element, and iframe
  document.
- [ ] Confirm whether `handleDragStart`, `handleDragMove`, and `handleDragEnd`
  run in `useInstanceOverlays.ts`.
- [ ] Confirm whether `dragStateRef.current.instanceId` is preserved during RAF
  overlay updates.
- [ ] Confirm whether RAF overlay updates mutate pointer-events during an active
  pending drag.
- [ ] Compare SaaS behavior with extension iframe handling before deciding
  whether the fix belongs in `shared/`.

### Task 4: Smallest Fix

- [ ] Fix the first proven break in the event chain only.
- [ ] If parent-window event loss across iframe boundaries is the issue, prefer
  a minimal shared or reusable helper for temporarily disabling iframe hit
  testing during pending overlay drag.
- [ ] If the issue is duplicated iframe click handling, move or reuse logic in
  `shared/canvas-interaction/` and consume it from both SaaS and extension paths.
- [ ] Avoid broad rewrites of `CanvasEditor.tsx`; keep stateful logic inside hooks.
- [ ] Remove all temporary logging before final verification.

### Task 5: Tests

- [ ] Add a focused regression test for the broken event path.
- [ ] If changing shared click or overlay behavior, add or update tests under
  `shared/canvas-interaction/`.
- [ ] If changing SaaS board-mode dragging, add focused coverage for
  `useInstanceOverlays.ts` behavior where feasible.
- [ ] If changing extension behavior, rebuild the extension and add or update a
  focused E2E/debug check in `/Users/ultra/work/ext-test-projects`.
- [ ] Run focused `bun:test` targets first, then broader checks appropriate to
  the touched package.

### Task 6: Visual and E2E Verification

- [ ] For UI/client changes, capture screenshots before and after the drag fix.
- [ ] Verify drag at default zoom and a non-default zoom.
- [ ] Verify drag with pointer movement crossing over the iframe body.
- [ ] Verify no regression to click selection, double-click design entry, badge
  click editing, and readonly mode.
- [ ] For extension changes, run the VS Code E2E harness with `launchVSCode()` and
  CDP mouse interactions; do not use a plain browser session.

## Deliverables

- [ ] Summary of the confirmed root cause.
- [ ] Minimal code fix with regression coverage.
- [ ] Visual/E2E evidence for the fixed drag workflow.
- [ ] Notes on SaaS and extension parity decisions.
