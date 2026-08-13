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

- [ ] Inspect margin and padding spacing link buttons.
- [ ] Confirm which button is visually wrong in dark theme.
- [ ] Inspect `StrokeSection.tsx` and confirm it only displays stroke text after a stroke exists.
- [ ] Identify existing RightSidebar tests for spacing and stroke controls.

### Task 2: Fix dark theme for link/unlink button

- [ ] Replace hardcoded active blue text/background with semantic tokens or VS Code-mapped CSS variables.
- [ ] Ensure inactive, hover, active, focus-visible, dark, and high-contrast states are readable.
- [ ] Keep the same compact 24px layout and data-testid values.
- [ ] Add/adjust tests for active/inactive class names where appropriate.

### Task 3: Make stroke editable

- [ ] Replace read-only stroke summary with controls for color, width, and style.
- [ ] Wire edits through `syncStyleChange` using `borderColor`, `borderWidth`, and `borderStyle`.
- [ ] Update local `strokes` state immediately on control changes.
- [ ] Preserve add/remove behavior.
- [ ] Use existing RightSidebar input/control patterns rather than adding a new design system.

### Task 4: Verify style writes

- [ ] Add unit/component tests proving stroke width/style/color controls call `syncStyleChange`.
- [ ] Add a focused style write test if the bug is in `AstService` or style adapters rather than UI.
- [ ] Run focused tests.
- [ ] Run `bunx tsc --noEmit` if source types are affected.
- [ ] Build the VS Code extension if shared client code changed.

### Task 5: Report

- [ ] Summarize root cause for both inspector issues.
- [ ] List exact changed files.
- [ ] Note any remaining e2e/manual verification needed.
