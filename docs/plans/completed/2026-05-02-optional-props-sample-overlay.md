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

- [x] Read `vscode-extension/hypercanvas-preview/src/PreviewPanel.ts`.
- [x] Read `vscode-extension/hypercanvas-preview/src/webview-preview-panel/PreviewPanelApp.tsx`.
- [x] Read `vscode-extension/hypercanvas-preview/src/webview-preview-panel/PropsForm.tsx`.
- [x] Compare `alert.tsx` and `BulkaDay.tsx` in the Bulka project.
- [x] Write down whether the overlay is caused by required props, empty render output, stale sample registration, or AI unavailable state.

<!-- Findings: NOT required props (all optional via hasRest). Primary causes: (1) stale sample
registration — _handleCreateSampleFromError writes SampleDefault but never calls
previewManager.ensureComponent, so sampleRenderMap stays empty; (2) empty render output —
Alert is a container that renders blank without children; (3) AI unavailable — ensureSample
returns {generated:false,exists:false}, shouldCreateNoPropsSample returns false (props has
className+variant). Full analysis in .ralphex/progress/. -->

### Task 2: Make disabled generation explicit and discoverable

- [x] Find the user-facing `Generate values` control in `PropsForm.tsx`.
- [x] Disable the button when there are no fields or deterministic generation cannot produce values.
- [x] Add a tooltip explaining why generation is unavailable.
- [x] Ensure the tooltip still appears while the button is disabled by using a non-disabled wrapper trigger.
- [x] Add unit tests or component tests for the disabled state and tooltip trigger wrapper.

### Task 3: Make deterministic sample generation work more often

- [x] Add a deterministic sample builder for optional-prop container components that render empty without children.
- [x] Cover common same-file exported compound pieces, especially `AlertTitle` and `AlertDescription`.
- [x] Avoid AI dependency for this case.
- [x] Avoid per-project artifact patches; fix the generator/source path.
- [x] Add regression tests using an `Alert`-style fixture.

### Task 4: Ensure Create Sample activates the sample

- [x] After creating or updating `SampleDefault`, refresh sample/component registration if needed.
- [x] Ensure preview selects the new sample instead of keeping the placeholder open.
- [x] Preserve editor reveal behavior for manual sample editing.
- [x] Add a regression test that verifies created `SampleDefault` is imported into preview registration.

### Task 5: Verify

- [x] Run focused unit tests for changed files.
- [x] Run `bunx tsc --noEmit` in the main repo if scope touches shared/client extension code.
- [x] Build the VS Code extension with `cd vscode-extension/hypercanvas-preview && bun run build`.
- [x] If practical, run a focused extension debug/e2e check against `bulka-the-dog/client/components/ui/alert.tsx`. (manual test — skipped, not automatable in this context)
- [x] Report exact changed files and remaining risks.

<!-- Verification results:
  - 218 unit tests across 5 test files — all pass (0 fail)
  - bunx tsc --noEmit — clean, no errors
  - Extension build — clean (475ms, production)
  - E2E against bulka: skipped, requires manual VS Code session with extension installed
  Changed files (tasks 1–4):
    lib/preview-generator/scanner.ts — isCompound detection, container sample builder
    lib/preview-generator/sample-ensurer.ts — deterministic container sample path
    lib/preview-generator/preview-file-manager.ts — SampleDefault registration after create
    vscode-extension/hypercanvas-preview/src/PreviewPanel.ts — activate sample after Create Sample
    vscode-extension/hypercanvas-preview/src/extension.ts — wire previewManager into _handleCreateSampleFromError
    vscode-extension/hypercanvas-preview/src/webview-preview-panel/PropsForm.tsx — disabled Generate values + tooltip
  Remaining risks:
    1. Container sample renders <Alert><AlertTitle>Title</AlertTitle><AlertDescription>Description</AlertDescription></Alert>
       — visible only if Alert CSS is loaded. If the dev server isn't serving the component's CSS, the output may look unstyled but not broken.
    2. _handleCreateSampleFromError now calls previewManager.ensureComponent() — this adds a network+FS round trip on
       every Create Sample click. If ensureComponent is slow, the UX may feel sluggish. Acceptable for now.
    3. E2E test coverage for the full Create Sample → preview activation flow is manual only. -->
