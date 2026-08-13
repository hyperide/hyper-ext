# Optional Props Sample Overlay Fix

## Context

Manual VS Code extension session on project:
`/Users/ultra/work/ext-test-projects/bulka-the-dog`

Problem component:
`client/components/ui/alert.tsx`

Working comparison:
`client/components/BulkaDay.tsx`

Observed behavior:
- `Alert` props are optional, but preview shows the component error overlay.
- `Generate values` does nothing useful when generation is unavailable.
- `Create Sample` appends `SampleDefault`, but the preview still stays on the placeholder.
- Current generated sample is empty:
  `<Alert />`, which has no visible children.

Important distinction:
- Optional props do not guarantee visible render output.
- `Alert` is a primitive/container and needs children, while `BulkaDay` renders complete UI without props.

### Task 1: Reproduce and classify the placeholder path

- [ ] Read `vscode-extension/hypercanvas-preview/src/PreviewPanel.ts`.
- [ ] Read `vscode-extension/hypercanvas-preview/src/webview-preview-panel/PreviewPanelApp.tsx`.
- [ ] Read `vscode-extension/hypercanvas-preview/src/webview-preview-panel/PropsForm.tsx`.
- [ ] Compare `alert.tsx` and `BulkaDay.tsx` in the Bulka project.
- [ ] Write down whether the overlay is caused by required props, empty render output, stale sample registration, or AI unavailable state.

### Task 2: Make disabled generation explicit and discoverable

- [ ] Find the user-facing `Generate values` control in `PropsForm.tsx`.
- [ ] Disable the button when there are no fields or deterministic generation cannot produce values.
- [ ] Add a tooltip explaining why generation is unavailable.
- [ ] Ensure the tooltip still appears while the button is disabled by using a non-disabled wrapper trigger.
- [ ] Add unit tests or component tests for the disabled state and tooltip trigger wrapper.

### Task 3: Make deterministic sample generation work more often

- [ ] Add a deterministic sample builder for optional-prop container components that render empty without children.
- [ ] Cover common same-file exported compound pieces, especially `AlertTitle` and `AlertDescription`.
- [ ] Avoid AI dependency for this case.
- [ ] Avoid per-project artifact patches; fix the generator/source path.
- [ ] Add regression tests using an `Alert`-style fixture.

### Task 4: Ensure Create Sample activates the sample

- [ ] After creating or updating `SampleDefault`, refresh sample/component registration if needed.
- [ ] Ensure preview selects the new sample instead of keeping the placeholder open.
- [ ] Preserve editor reveal behavior for manual sample editing.
- [ ] Add a regression test that verifies created `SampleDefault` is imported into preview registration.

### Task 5: Verify

- [ ] Run focused unit tests for changed files.
- [ ] Run `bunx tsc --noEmit` in the main repo if scope touches shared/client extension code.
- [ ] Build the VS Code extension with `cd vscode-extension/hypercanvas-preview && bun run build`.
- [ ] If practical, run a focused extension debug/e2e check against `bulka-the-dog/client/components/ui/alert.tsx`.
- [ ] Report exact changed files and remaining risks.
