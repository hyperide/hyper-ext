# ET-17: tree item click doesn't scroll canvas (partial fix from v0.1.45)

<!-- commission: wc-20260513-3d8c0793 | decision: dec-20260513-class-f-et17-tree-scroll -->

## Context

### Failure observed

CLASS F — `"ET-17: clicking a small leaf tree item from scrolled-down viewport scrolls canvas to it"` in `elements-tree-selection.spec.ts:431`.

- S1 only: 2 failures (1 run + 1 retry), `[independent]` project
- Classified as B8 bug — supposedly fixed in v0.1.45 but test still failing

The test (`[independent]` = runs on the default reference project):

1. Opens preview with element tree
2. Gets tree item labels, picks a "leaf" (short label ≤2 chars or last item)
3. Forces iframe `scrollTop` to maximum (scrolls to bottom)
4. If `scrollTop === 0` after scroll attempt, skips (document not scrollable)
5. Stubs `Element.prototype.scrollIntoView` to force `behavior: 'instant'`
6. Calls `explorer.clickTreeItemByLabel(leafLabel)`
7. Polls for 8s: asserts `document.scrollTop !== initialScrollY`

The test FAILS (not skips), which means `initialScrollY > 0` but after clicking the leaf, `scrollTop` does NOT change within 8s.

### The v0.1.45 fix (b8-tree-scroll plan)

The fix (commit in v0.1.45): dispatched `hypercanvas:treeSelect` CustomEvent in `useElementSelection.ts`, forwarded to iframe as `hypercanvas:goToVisual` in `usePreviewBridge.ts`. The `goToVisual` handler calls `element.scrollIntoView()`.

The fix was verified to work for ET-16 (the earlier tree scroll test added in the plan). ET-17 was added specifically to catch cases the ET-16 fix might miss — it uses a deep leaf and a forced bottom scroll position.

### Root cause hypotheses for ET-17 still failing

**H1: `data-uniq-id` not present on leaf elements**
The `hypercanvas:goToVisual` handler finds the DOM element by its `data-uniq-id` attribute. If the leafLabel selected by the test doesn't correspond to any element that has `data-uniq-id` in the rendered preview, `scrollIntoView` is never called. This can happen if:

- The leaf is a text node / icon without a wrapping element that has the attribute
- The project doesn't render the element deeply enough for the attribute to be injected

**H2: The `scrollIntoView` stub is set on a different frame origin**
`appFrame.evaluate()` patches `Element.prototype.scrollIntoView` in the iframe context. But if `scrollIntoView` is called on an element in a different nested frame, the stub doesn't intercept it and smooth scrolling causes a race with the 8s poll.

**H3: `goToVisual` finds the element but it's already in the viewport**
If the "leaf" picked by the heuristic is near the top of the document (despite the scroll to bottom), `scrollIntoView('center')` would move `scrollTop` to ~0. The assertion `scrollTop !== initialScrollY` would pass. But if the element IS already visible at the scrolled-to-bottom viewport, `scrollIntoView` may not change `scrollTop` at all.

**H4: The bridge message is dropped**
`hypercanvas:treeSelect` fires, gets forwarded to the preview iframe via `usePreviewBridge.ts`, but the iframe message handler is not registered at this point (e.g., the preview iframe reloaded and lost the listener).

## Scope

**Allowed:**

- `ext-test-projects/e2e/tests/project-independent/elements-tree-selection.spec.ts` — diagnostic improvements to ET-17
- `client/components/LeftSidebar/ElementsTree.tsx` or `useElementSelection.ts` — if bridge message not fired for leaf elements
- `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts` — if goToVisual handler misses some elements

**Forbidden:**

- Changes to ET-16 (different test, already green)

## Tasks

### Task 1: Add diagnostics to confirm which hypothesis is correct

- [ ] Read `ext-test-projects/e2e/tests/project-independent/elements-tree-selection.spec.ts:431-521` (ET-17 test body)
- [ ] Read `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts` — find `goToVisual` or `hypercanvas:goToVisual` handler, see how it finds the DOM element
- [ ] Read `client/components/LeftSidebar/ElementsTree.tsx` (or equivalent) — find `clickTreeItemByLabel` handler, see what event it fires
- [ ] Add a console.log in `goToVisual` handler: log the element it finds (if any) and whether `scrollIntoView` is called
- [ ] Run ET-17 in isolation to capture the console log output in docker.log

### Task 2: Fix based on Task 1 findings

**If H1 (no data-uniq-id on leaf):**

- In the ET-17 test, before clicking: evaluate the iframe to find which tree items have corresponding DOM elements with `data-uniq-id`. Pick only a leaf that has one.
- OR: in the `goToVisual` handler, if the exact element isn't found by uniq-id, fall back to finding the closest parent that has one.

**If H2 (stub doesn't apply to nested frame):**

- Remove the `scrollIntoView` stub from ET-17 — it's adding complexity without fixing the underlying issue
- Instead, poll for scroll change with a longer 15s timeout, accounting for animation

**If H3 (element already in viewport):**

- In ET-17, pick a leaf that's guaranteed to be off-screen: instead of heuristic, pick the last tree item (deepest in tree = likely deepest in DOM = furthest from top)

**If H4 (bridge message dropped):**

- In `usePreviewBridge.ts`, ensure the `hypercanvas:goToVisual` listener is re-registered after iframe reloads (add to the `useEffect` cleanup/reattach cycle)

- [ ] Implement fix
- [ ] `bun run typecheck`
- [ ] `/ext` skill to rebuild

### Task 3: Verify GREEN

- [ ] `HYPER_E2E_SHARDS=1 bun run test:docker` with `--grep "ET-17"`
- [ ] ET-17-before-click.png and ET-17-after-click.png show clear scroll position change
- [ ] Send both screenshots to TG via `tg --photo <path> "caption"`

## Acceptance criteria

1. ET-17 passes GREEN with retry rate 0 (not just first-attempt pass)
2. `ET-17-before-click.png`: iframe scrolled to bottom (content cut off at top)
3. `ET-17-after-click.png`: leaf element visible, scroll position clearly different
4. ET-16 continues to pass (no regression)
