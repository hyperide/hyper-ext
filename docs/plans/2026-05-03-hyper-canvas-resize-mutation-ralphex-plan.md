# Hyper Canvas Resize Mutation Plan

## Context

The previous resize lane only proved that explicit Tailwind sizes such as
`w-12 h-12` and `size-12` render resize handle dots in the VS Code Hyper Canvas
overlay. That is not enough: the user needs proof that dragging a resize handle
actually changes the selected element's width and/or height.

Current evidence says resize mutation is not implemented yet:

- `resize-handles.spec.ts` only asserts `[data-resize-handle]` visibility.
- The completed size-handles review explicitly treated non-interactive dots as
  deferred drag-mutation work.
- Screenshots showing visible handles are not valid completion proof for actual
  resizing.

## Scope

Implement the smallest working resize mutation for VS Code Hyper Canvas:

- Select an element with explicit width/height (`w-12 h-12` and `size-12`).
- Drag width/height handle(s).
- Persist the resize into source code through the existing AST/style mutation
  pipeline.
- Prove the element changed size in preview and the source changed accordingly.

Do not claim completion until there are before/after screenshots showing a
changed size, plus a test proving the source update.

### Task 1: Reproduce The Missing Mutation

- [x] Read `/Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/resize-mutation/ext-test-projects/CLAUDE.md` before extension E2E.
- [x] Run the existing resize handle E2E/debug flow and confirm handles are
  visible.
- [x] Attempt a real drag on `[data-resize-handle="width"]` and/or
  `[data-resize-handle="height"]`.
- [x] Confirm the current behavior: no source change or no size change.
- [x] Capture a failing screenshot/log proving visible handles are not enough.

### Task 2: Add A Failing Test First

- [x] Add a focused E2E test in ext-test-projects that selects the
  `size-handle-fixture`, drags a width handle, and asserts the source file or
  inline style/class changes.
- [x] Add height coverage or a second assertion if width and height are handled
  independently.
- [x] The test must fail for the right reason before implementation: handle drag
  does not mutate size.
- [x] Do not assert only handle visibility or no-crash behavior.

### Task 3: Implement Resize Mutation

- [ ] Wire resize handle pointer events in the shared/preview overlay layer used
  by both SaaS and VS Code where applicable.
- [ ] Convert drag delta to a concrete width/height update using existing
  style/AST update APIs.
- [ ] For Tailwind explicit classes, prefer the existing style write conventions
  already used by Hyper Canvas. If exact Tailwind scale conversion is not
  available, use the smallest existing production-supported representation and
  document it in the test name.
- [ ] Keep iframe pointer-events handling safe during drag.
- [ ] Preserve normal element selection and drag behavior.

### Task 4: Visual Proof

- [ ] Capture `/tmp/hyper-resize-before.png` before dragging.
- [ ] Capture `/tmp/hyper-resize-after.png` after dragging.
- [ ] The screenshots must visibly show a changed element size, not just visible
  handles.
- [ ] Capture or log the source diff proving the change persisted.

### Task 5: Verification

- [ ] Run the new failing-then-passing E2E test.
- [ ] Run focused unit tests for any shared overlay/style-write code touched.
- [ ] Run lint/typecheck for touched packages.
- [ ] Inspect test output for console/page errors.

### Task 6: Telegram Handoff

- [ ] Send concise Telegram summary with:
  - what changed,
  - test commands and results,
  - before/after screenshot paths,
  - any remaining risk.
- [ ] Send the before/after screenshots to Telegram.
- [ ] Do not repeat this task in status messages after screenshots are sent and
  tests are green.


## Worktree Isolation Note

This ralphex run is isolated. Use this Hyper Canvas worktree:

- /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/resize-mutation/hyper-canvas-draft

Use this ext-test-projects worktree instead of /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/resize-mutation/ext-test-projects:

- /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/resize-mutation/ext-test-projects

Do not write to the original main worktree or the original ext-test-projects checkout.
Existing logs and dirty changes from the original worktrees were snapshotted at:
/Users/ultra/work/hyper-canvas-draft-worktrees/snapshots/20260503-2135-before-worktrees
