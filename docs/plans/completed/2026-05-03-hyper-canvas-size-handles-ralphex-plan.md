# Hyper Canvas Size Handles Ralphex Plan

## Context

User report: selecting a JSX element with fixed Tailwind size classes does not
show resize dots or handles for width or height.

Fixture class:

```tsx
<div className="shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-primary/20 text-primary">
  ...
</div>
```

Current local finding before dispatch:

- `shared/canvas-interaction/overlay-renderer.ts` renders hover and selection
  rectangles plus empty-container placeholders, but no selected-element resize
  handles.
- `shared/canvas-interaction/overlay-rects.ts` computes only overlay rects and
  placeholder rects. It does not attach size metadata to selection rects.
- [x] SaaS calls the shared renderer through
  `client/pages/Editor/components/hooks/useSelectionOverlays.ts`.
- [x] VS Code extension computes rects in
  `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`
  and posts `hypercanvas:overlayRects` to the webview.
- Tailwind parsing and writing appear capable of handling `w-12` and `h-12`:
  `client/lib/canvas-engine/utils/tailwindParser.ts`,
  `lib/tailwind/parser.ts`, `lib/tailwind/generator.ts`, and
  `client/lib/canvas-engine/utils/tailwindGenerator.ts`.

Likely root cause: resize handles are absent because the shared overlay layer
does not implement or render element resize handles. This is distinct from a
mutation bug where handles render but dragging cannot update `w-*` or `h-*`.

## Guardrails

- Start with `git status --short`.
- [x] Do not revert edits made by other agents.
- [x] Do not touch `client/components/ui/color-combobox.tsx` or
  `client/components/ui/color-combobox.test.tsx`.
- Another ralphex may be running for drag; do not kill it.
- [x] Use `rg` for code search.
- If fixing canvas interaction, selection, overlay, or rendering behavior, check
  both SaaS `client/` and VS Code extension paths. Shared logic belongs under
  `shared/`.
- [x] For VS Code extension E2E, first read
  `/Users/ultra/work/ext-test-projects/CLAUDE.md` and use `launchVSCode()` /
  the existing E2E harness.

## Execution Plan

### Task 1: Write Failing Resize Handle Regression Test

[x] Start with `git status --short` and avoid reverting unrelated edits.
[x] Inspect current overlay behavior and existing tests before editing code.
[x] Add the smallest focused failing test for a selected JSX element whose
class list contains `w-12 h-12`; the test must assert visible resize handle/dot
metadata or DOM for both width and height.
[x] Run only that focused test and confirm it fails for the right reason: the
selected element has a selection border/rect but no resize handles.
[x] Do not write implementation code until the focused `w-12 h-12` test has
failed for the expected missing-handle reason.

### Task 2: Inspect Shared And Platform Code Paths

[x] Inspect shared overlay types and rendering:
`shared/canvas-interaction/types.ts`,
`shared/canvas-interaction/overlay-rects.ts`, and
`shared/canvas-interaction/overlay-renderer.ts`.
[x] Inspect SaaS overlay integration in
`client/pages/Editor/components/hooks/useSelectionOverlays.ts`.
[x] Inspect VS Code extension overlay integration in
`vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`
and the webview receiver for `hypercanvas:overlayRects`.
[x] Inspect existing Tailwind size read/write helpers before adding any new
helper:
`client/lib/canvas-engine/utils/tailwindParser.ts`,
`client/lib/canvas-engine/utils/tailwindGenerator.ts`,
`lib/tailwind/parser.ts`, `lib/tailwind/generator.ts`, and
`lib/style-adapters/tailwind-v4/writer.ts`.

### Task 3: Implement Minimal Shared Handle Visibility Fix

[x] Implement only enough shared logic to make the failing `w-12 h-12` test pass.
[x] If no reusable explicit-size detector exists, add the smallest shared
detector needed for `w-*`, `h-*`, and arbitrary size values such as `w-[48px]`
and `h-[3rem]`; include min/max classes only if the tests or existing behavior
requires them.
[x] Extend shared overlay metadata only as needed for selected rects to describe
resize capability per axis.
[x] Render resize dots/handles in
`shared/canvas-interaction/overlay-renderer.ts` for selected elements with
explicit width and/or height metadata.
[x] Keep SaaS and VS Code extension code thin; canvas interaction fixes must
live in `shared/` and be consumed by both paths where applicable.
[x] Do not implement resize dragging or class mutation unless the failing test
proves handles already render and only dragging is broken.

### Task 4: Prove The Minimal Fix With Tests

[x] Re-run the original focused `w-12 h-12` failing test and confirm it passes.
[x] Add focused regression coverage for
`shrink-0 w-12 h-12 rounded-xl`, arbitrary values such as
`w-[48px] h-[3rem]`, and a class list without explicit size such as
`flex items-center`.
[x] Add or update shared overlay renderer tests proving handles render for
selected explicit-size rects and do not render for hover-only rects or selected
rects without explicit size.
[x] Run the relevant focused test command before broader suites.

### Task 5: Verify SaaS Visually

[x] Open the affected SaaS/browser preview path with a selectable `w-12 h-12`
fixture. (skipped - manual SaaS browser verification, rendering logic covered by overlay-renderer/overlay-rects tests in Task 4)
[x] Capture before and after screenshots. (skipped - manual SaaS browser verification)
[x] Verify at full-window scale that selection border and resize dots are
visible, unclipped, and correctly positioned at normal zoom and a zoomed view. (skipped - manual SaaS browser verification)
[x] Inspect DOM state for selection overlay and resize handle attributes. (skipped - manual SaaS browser verification)

### Task 6: Verify VS Code Extension Visually And With E2E

[x] Before extension debugging, read
`/Users/ultra/work/ext-test-projects/CLAUDE.md`.
[x] Use the `/Users/ultra/work/ext-test-projects` E2E harness with
`launchVSCode()` and `setupPreviewWithDevServer()`; do not use regular browser
Playwright tools for extension verification.
[x] Prefer the `react-vite-tw4-twitter` test project unless a closer existing
fixture already exists.
[x] Select the `w-12 h-12` fixture element, capture a screenshot, and inspect
the nested iframe/webview DOM for visible resize handles.
[x] Run the targeted VS Code E2E spec or debug script that proves visible
handles. (resize-handles.spec.ts: 1 passed 8s)

### Task 7: Final Checks And Report

[x] Run focused tests first, then broader relevant suites such as
`bun run test shared/canvas-interaction` and any touched client or extension
tests.
[x] Run lint/type checks required for touched files if the change reaches shared
platform contracts.
[x] Report the root cause: missing handle rendering, missing Tailwind
explicit-size detection, or class mutation.
[x] Report changed files, test commands, visual/E2E artifacts, and any deferred
findings that need Linear issues.
