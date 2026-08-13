# Drop indicator — vertical line missing during horizontal-row drags

## Context

User reports that when dragging cards inside a horizontal row (flex-row /
grid-cols-N), the blue drop indicator does NOT always appear where it
should — specifically the vertical variant between two side-by-side cards
(e.g. "22 kg" and "50 cm" in the bulka-the-dog Appearance section).

Screenshot reference: `/Users/ultra/Documents/Screenshots/Screenshot 2026-05-06 at 10.16.17.png`

## Files

- `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`
  — `_dragPointerMove` updates `_dragIndicatorEl` based on `_isHorizontalLayout`
- `shared/canvas-interaction/style-injector.ts` — `.hyper-drop-indicator` CSS;
  currently uses fixed `left: 4px; right: 4px; height: 2px` which is a
  HORIZONTAL line (top/bottom edge of target). Vertical variant requires
  `width: 2px; top: 0; bottom: 0` instead.

## Goal

When dragging an element whose parent layout is horizontal (flex-row /
grid-cols-\* / inline-flex row), the drop indicator must render as a vertical
2px line at the LEFT edge (drop before) or RIGHT edge (drop after) of the
target element. Currently the indicator class is fixed for a horizontal
line — vertical drops still get a horizontal indicator that visually
disappears (or overlaps the wrong axis).

## Tasks

### Task 1: Add vertical-indicator class

- [ ] In `shared/canvas-interaction/style-injector.ts`, add
      `.hyper-drop-indicator.vertical { width: 2px !important; height: auto !important; top: 4px !important; bottom: 4px !important; }`
      and clear the horizontal `left/right/height` rules in the vertical state
- [ ] Existing horizontal rule continues to apply by default

### Task 2: Switch indicator orientation in `_dragPointerMove`

- [ ] In `iframe-interaction.ts`, when `_isHorizontalLayout(dropEl)` is true: - Toggle `_dragIndicatorEl.classList.add('vertical')` - Position with `left = isBefore ? rect.left - 1 : rect.right - 1` - Clear `top` and use `top: rect.top, height: rect.height` overrides via
      inline style
- [ ] When vertical (default flow): keep existing top/bottom logic, ensure
      `vertical` class is removed

### Task 3: Unit test — orientation selection

- [ ] Add `shared/canvas-interaction/drop-indicator-orientation.test.ts`
      with `chooseIndicatorOrientation(layout, mouseX, mouseY, rect)` returning
      `{ axis: 'h' | 'v', edge: 'start' | 'end' }`. Extract that pure function
      from `_dragPointerMove` to make it testable
- [ ] Cases: - vertical layout (block / flex-col), mouse above midpoint → h, start - vertical layout, below midpoint → h, end - horizontal layout, mouse left of midpoint → v, start - horizontal layout, right of midpoint → v, end

### Task 4: Verify in real preview

- [ ] Build + install extension
- [ ] Open bulka-the-dog Appearance, drag "22 kg" toward "50 cm"
      → vertical line appears between them
- [ ] Drag "Soft ears" toward "Face like an Akita Inu" (vertical layout)
      → horizontal line appears between them (regression check)
- [ ] Send screenshots to Telegram via `tg --photo <path> "caption"`
