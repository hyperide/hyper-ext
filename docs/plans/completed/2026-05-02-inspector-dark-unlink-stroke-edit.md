# Inspector Dark Unlink and Stroke Editing Fix

## Context

Manual VS Code extension screenshot shows two inspector issues:

- The unlink/link spacing control does not follow the dark VS Code theme.
- Stroke is displayed but not editable.

Likely source areas:

- `client/components/RightSidebar/sections/MarginSection.tsx`
- `client/components/RightSidebar/sections/LayoutSection.tsx`
- `client/components/RightSidebar/sections/StrokeSection.tsx`
- `client/components/RightSidebar/hooks/useStyleSync.ts`
- VS Code host wrapper: `vscode-extension/hypercanvas-preview/src/webview-right/RightPanelApp.tsx`

### Task 1: Reproduce and locate the controls

- [x] Inspect margin and padding spacing link buttons.
- [x] Confirm which button is visually wrong in dark theme.
- [x] Inspect `StrokeSection.tsx` and confirm it only displays stroke text after a stroke exists.
- [x] Identify existing RightSidebar tests for spacing and stroke controls.

### Task 2: Fix dark theme for link/unlink button

- [x] Replace hardcoded active blue text/background with semantic tokens or VS Code-mapped CSS variables.
- [x] Ensure inactive, hover, active, focus-visible, dark, and high-contrast states are readable.
- [x] Keep the same compact 24px layout and data-testid values.
- [x] Add/adjust tests for active/inactive class names where appropriate.

### Task 3: Make stroke editable

- [x] Replace read-only stroke summary with controls for color, width, and style.
- [x] Wire edits through `syncStyleChange` using `borderColor`, `borderWidth`, and `borderStyle`.
- [x] Update local `strokes` state immediately on control changes.
- [x] Preserve add/remove behavior.
- [x] Use existing RightSidebar input/control patterns rather than adding a new design system.

### Task 4: Verify style writes

- [x] Add unit/component tests proving stroke width/style/color controls call `syncStyleChange`.
- [x] Add a focused style write test if the bug is in `AstService` or style adapters rather than UI.
- [x] Run focused tests.
- [x] Run `bunx tsc --noEmit` if source types are affected.
- [x] Build the VS Code extension if shared client code changed.

### Task 5: Report

- [x] Summarize root cause for both inspector issues.
- [x] List exact changed files.
- [x] Note any remaining e2e/manual verification needed.

#### Root causes

**Dark theme issue (unlink/link, aspect-ratio toggle):**
Tailwind's `dark:` modifier is inactive in VS Code webviews — the webview body
receives `vscode-dark` (not `dark`), so `bg-blue-100 dark:bg-blue-900/30` always
rendered the light-mode blue tint regardless of the active VS Code theme.

Fix: added `.inspector-btn-active` CSS class keyed off the `vscode-dark` body
class in `styles.css` (VS Code context, using `--vscode-button-background` token +
high-contrast overrides) and off `.dark` in `global.css` (standalone client).
All five affected buttons in `MarginSection` and `LayoutSection` now use this class.

**Stroke not editable:**
`StrokeSection.tsx` only rendered a read-only text summary of the stroke object
(e.g. "1px solid #000") with no input controls. There was no way to change any
stroke property from the inspector.

Fix: replaced the static display with three interactive controls — a native color
picker (`<input type="color">`), a text width input, and a Radix Select for style
(solid/dashed/dotted). Each control calls `syncStyleChange` with the corresponding
CSS property (`borderColor`, `borderWidth`, `borderStyle`) and updates local state
immediately.

#### Changed files

- `client/components/RightSidebar/sections/LayoutSection.tsx` — aspect-ratio toggle: hardcoded Tailwind blue → `.inspector-btn-active`
- `client/components/RightSidebar/sections/MarginSection.tsx` — margin/padding link button: same
- `client/components/RightSidebar/sections/StrokeSection.tsx` — read-only summary → color/width/style controls
- `client/global.css` — added `.inspector-btn-active` with `.dark` variant
- `vscode-extension/hypercanvas-preview/src/webview/styles.css` — added `.inspector-btn-active` with `vscode-dark` + high-contrast variants
- `client/components/RightSidebar/sections/__tests__/LayoutSection.test.tsx` — active/inactive class assertions
- `client/components/RightSidebar/sections/__tests__/MarginSection.test.tsx` — new: active/inactive class coverage
- `client/components/RightSidebar/sections/__tests__/StrokeSection.test.tsx` — new: color/width/style controls + syncStyleChange calls
- `.gitignore` — exclude VS Code extension `bun.lock` artifact

#### Remaining e2e / manual verification

- Open an element in the VS Code extension inspector → confirm the link/unlink button
  and aspect-ratio toggle now match the VS Code dark theme (no bright blue tint).
- Check the same buttons in the VS Code high-contrast theme.
- Open a stroked element in the inspector → verify color swatch, width input, and
  style dropdown are interactive and that changes persist to the canvas.
- No AstService or StyleAdapter changes were needed — the bug was UI-only.
