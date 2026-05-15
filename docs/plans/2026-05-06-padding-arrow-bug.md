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

- [x] Find the input that handles padding-vertical down-arrow. Is it a
      shared `LengthInput` or per-section?

      Findings: NOT a shared `LengthInput`. Each section composes a raw
      `<Input>` from `client/components/ui/input.tsx` and wires its
      `onKeyDown` to a shared keyboard handler `handleNumericKeyDown` in
      `client/components/RightSidebar/RightSidebar.tsx:449-504`. The handler
      is passed down to sections as the `onNumericKeyDown` prop.
      The vertical-padding input lives in
      `client/components/RightSidebar/sections/LayoutSection.tsx:602-613`
      (and again at the expanded variants on lines 1029-1037 and
      1163-1171), where each call site does
      `onNumericKeyDown(e, paddingTop, (v) => handleVerticalPaddingChange(v), 'paddingTop')`.
      The input renders `value={paddingTop || paddingBottom}` and
      writes via `handleVerticalPaddingChange` which fans out to both
      `paddingTop` and `paddingBottom` through `onPaddingChange` +
      `syncStyleChange`.

- [x] Identify the parser that turns `'2px'` into a number, and the formatter
      that writes back. Find where the empty branch leaks through.

      Parser: `trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/)` at
      `RightSidebar.tsx:466`. Number = `Number.parseFloat(match[1])`,
      unit = `match[2] || (isUnitless ? '' : 'px')`. Formatter:
      `` `${newNum}${unit}` `` at line 499.

      Empty-branch leak (the `if (!match)` block, lines 468-486):
      hit when `currentValue` is `''`, whitespace, or a non-numeric
      string. There is no clamp; for ArrowDown it produces
      `newNum = 0 + (-1)*1 = -1`, formatted as `'-1px'`.

      No clamp anywhere in the handler — only `opacity` is clamped to
      [0, 100] (lines 477-479 and 495-497). Padding can therefore go
      negative; CSS rejects negative padding, so the round-trip through
      `syncStyleChange` writes nothing back, the parsed style becomes
      missing, and `setPaddingTop('')` is invoked at line 879 with
      `ep.paddingTop || ''`. On the next ArrowDown, `currentValue` is
      `''` and we fall through the empty-leak branch again. The
      bare-`px` rendering reported in the memory note is reachable
      because nothing in this code path enforces `newNum >= 0` for
      length properties (paddings, margins-on-some-engines, gaps,
      border-radius, font-size, dimensions).

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
