# Padding down-arrow bug — twice produces invalid "px" + deselects element

## Context

Reproduction (from `~/.claude/projects/-Users-ultra-work-hyper-canvas-draft/memory/project_bug_padding_down_arrow.md`):

1. Select element `<div className="flex flex-wrap gap-3 py-[2px]">`.
2. In the inspector, find the padding-vertical input (current value `2px`).
3. Press the down-arrow key TWICE.
4. Expected: value clamps at `0` (or `-1px` shown but selection retained).
5. Actual:
   - First arrow: parses `2` → 1px (or 1)
   - Second arrow: somewhere in the path the value becomes empty and the
     input renders just `px` with no number — invalid.
   - As a side effect, the canvas element loses selection (likely because
     the Delete keybinding fires on the empty/invalid state and deletes the
     "selection token" rather than the element itself).

## Files

- The padding inspector input is in
  `client/components/RightSidebar/sections/MarginSection.tsx` (or PaddingSection
  if separate). Find the down-arrow handler that decrements.
- The keybinding logic that ties Delete to canvas-element deletion lives in
  `vscode-extension/hypercanvas-preview/package.json` `contributes.keybindings`
  with the `hypercanvas.rightPanelInputFocused` `when`-clause and matching
  context-set / clear handlers.

## Goal

1. Down-arrow on a padding input must clamp at `0` and never produce an
   empty / "px" string.
2. The down-arrow must not implicitly trigger any canvas selection change
   or Delete binding.

## Tasks

### Task 1: Locate the padding decrement logic

- [ ] Find the input that handles padding-vertical down-arrow. Is it a
      shared `LengthInput` or per-section?
- [ ] Identify the parser that turns `'2px'` into a number, and the formatter
      that writes back. Find where the empty branch leaks through.

### Task 2: Add a unit test for the decrement

- [ ] Create `client/components/RightSidebar/sections/__tests__/length-input-decrement.test.tsx`
      (or extend an existing test).
- [ ] Cases: `2px` → down → `1px`; `1px` → down → `0px`; `0px` → down →
      `0px` (stays); `''` → down → `0px`.
- [ ] Run RED before fix, GREEN after.

### Task 3: Fix the decrement

- [ ] Clamp at 0 in the decrement handler. Treat empty / NaN as 0 before
      decrementing.
- [ ] Always write a fully-formed string (`Npx`), never bare `px`.

### Task 4: Verify selection is not lost

- [ ] Confirm that the Delete binding's `when` clause uses
      `hypercanvas.rightPanelInputFocused` AND that the inspector input
      sets that context on focus. If down-arrow on an input fires Delete-
      like behaviour, the binding is wrong.
- [ ] Add an E2E case: focus padding-vertical input on a selected card,
      press down twice, assert (a) input shows `0px`, (b) canvas selection
      is still on the same card.

### Task 5: Build, install, E2E screenshot, TG

- [ ] `npm run package`, install, reload.
- [ ] Run the new E2E case → before/after screenshot.
- [ ] `send-tg-photo.sh` with critical visual review.
