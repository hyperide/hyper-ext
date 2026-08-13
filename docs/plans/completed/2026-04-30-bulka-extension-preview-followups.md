<!-- markdownlint-disable MD013 -->

# Bulka Extension Preview Follow-ups

> **For agentic workers:** implement this plan task by task. Do not patch
> `../ext-test-projects/bulka-the-dog` as the permanent fix.
> Test-project edits are allowed only as temporary verification; the durable fix
> belongs in `hyperide`.

**Goal:** finish the Bulka VS Code extension preview stabilization after the
black-screen/404 fix. Current progress is real: Bulka components can render, but
the remaining issues are console noise, Inspector style reads, stale component
error overlays, and a raw "Component not found" state during component switches.

**Test project:** `../ext-test-projects/bulka-the-dog`

**Important workflow:** before VS Code extension debugging, use the isolated E2E
harness from `ext-test-projects` with `launchVSCode()` and
`createDiagnosticsSession()`. Do not validate extension behavior in the user's
normal VS Code profile; that profile loads unrelated extensions and pollutes
extension-host logs.

---

## Current Evidence

- `BulkaDay.tsx` renders in the preview and posts `previewLoaded`.
- `previewLoaded` currently means the iframe loaded. It is not proof that the
  selected React component rendered successfully.
- `/test-preview?component=client%2Fcomponents%2FBulkaDay.tsx` is no longer a 404.
- The generated `client/__canvas_preview__.tsx` now includes:
  - `GalleryProvider` / `GalleryLightbox`
  - `MenubarSampleDefault`
  - `Sheet` in `componentRegistry`
- The user-profile console still shows red errors from unrelated extensions:
  - `open.bun-vscode`: `EADDRINUSE` on a temp socket
  - `github.copilot-chat`: `GitHubLoginFailed`
- HyperIDE currently installs a global `process.on('unhandledRejection')`
  handler in `vscode-extension/hypercanvas-preview/src/extension.ts`. Since the
  VS Code extension host is shared, this can relabel unrelated extension
  failures as `[HyperIDE] Unhandled rejection in extension host`.

---

## Executable Tasks

### Task 1: Stop Misattributing Foreign Extension Errors

**Problem:** user screenshots show `[HyperIDE] Unhandled rejection...` for stack
traces under `/Users/ultra/.vscode/extensions/open.bun-vscode-*` and
`github.copilot-chat-*`. These are not HyperIDE preview failures.

**Files to inspect:**

- `vscode-extension/hypercanvas-preview/src/extension.ts`

**Fix direction:**

- Remove the global `process.on('unhandledRejection')` logger, or gate it behind
  an internal diagnostics flag used only by isolated E2E runs.
- Prefer local `.catch()` handling around HyperIDE promises. Do not try to fix
  `open.bun-vscode` or GitHub Copilot from this repo.
- If a global handler is kept, it must not print `[HyperIDE]` for errors whose
  stack points to another extension directory.

- [x] Extract `isForeignExtensionError(reason: unknown): boolean` as an exported
      pure function in `extension-utils.ts`
- [x] Modify the `unhandledRejection` handler to skip `[HyperIDE]` logging for
      foreign extension errors
- [x] Write unit test: stack containing `.vscode/extensions/` (non-HyperIDE) →
      not logged as `[HyperIDE]`
- [x] Write unit test: HyperIDE-owned error (no foreign extension path) → still
      logged normally

**Verification:**

- Run an isolated harness window with only HyperIDE loaded.
- Confirm HyperIDE-owned runtime errors are still reported normally.
- Add a small unit test or helper-level test for the retained logging/filtering
  behavior. A synthetic stack containing `/Users/ultra/.vscode/extensions/`
  must not be logged as `[HyperIDE]`.
- Do not make an isolated harness run assert external user-extension stacks.
  Isolated harnesses intentionally do not load those extensions. A normal user
  profile screenshot can be used as extra observation only, not as the primary
  pass/fail test.

---

### Task 2: Inspector Fill Does Not Show `bg-primary/15`

- [x] Extend iframe interaction to send `computedStyle` snapshot on `hypercanvas:elementClick`
- [x] Add `selectedElementRuntimeStyle` field to `lib/types.ts`
- [x] Forward runtime style snapshot via `useCanvasInteraction.ts` into `state:update` patch
- [x] Merge runtime computed values into `parsedStyles` in `useElementStyleData.ts` for VS Code mode
- [x] Add color normalization for `rgba()` in `shared/utils/color.ts`
- [x] Support request/response path for non-click selections (keyboard nav, goToVisual, HMR restore)
- [x] Clear `selectedElementRuntimeStyle` on component change, empty click, and iframe reload
- [x] Unit test: `bg-primary/15` + computed `rgba(...)` populates `backgroundColor` and `fillOpacity`
- [x] Unit test: `shared/utils/color.ts` handles `rgb()`, `rgba()`, and transparent

**Symptom:** selecting the FAQ banner shows visible background in preview, but
Inspector `Fill` is `none`.

**Root cause found:**

- The selected element has:
  `bg-primary/15 border-primary/40`.
- `client/lib/canvas-engine/utils/tailwindParser.ts` calls `tw-to-css`.
- `tw-to-css` returns `{}` for project semantic tokens such as
  `bg-primary/15`, because `primary` is configured via Tailwind config and CSS
  variables:
  `primary.DEFAULT = hsl(var(--primary))`.
- In VS Code mode, `client/lib/platform/hooks/useElementStyleData.ts` only uses
  `classNameToStyles(response.className)`.
- `StyleReadService` sends `computedStyle: {}` because the extension host cannot
  access the iframe DOM.

**Fix direction: use runtime computed style from the iframe.**

Do not try to fully reimplement Tailwind config + CSS variable resolution in the
extension host. The browser already knows the final computed value.

**Recommended design:**

- Extend the preview iframe interaction path to send a narrow computed-style
  snapshot for the selected DOM node.
- Add a shared state field in `lib/types.ts`, for example:
  `selectedElementRuntimeStyle?: { componentPath: string | null; elementId: string; itemIndex?: number | null; seq: number; computedStyle: Record<string, string> }`.
- In `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`,
  when posting `hypercanvas:elementClick` / `hypercanvas:contextMenu`, include
  computed properties such as:
  - `backgroundColor`
  - `backgroundImage`
  - `color`
  - `borderColor`
  - `borderWidth`
  - `borderStyle`
  - `borderRadius`
  - `opacity`
  - `fontSize`
  - `width`
  - `height`
- In `vscode-extension/hypercanvas-preview/src/webview-preview-panel/useCanvasInteraction.ts`,
  forward that snapshot into the `state:update` patch.
- Clear `selectedElementRuntimeStyle` on empty click, selected element changes
  without a matching snapshot, current component changes, and iframe reload.
  A stale style from the previous component must never populate the Inspector.
- In `client/components/RightSidebar/RightSidebar.tsx` or
  `client/lib/platform/hooks/useElementStyleData.ts`, merge runtime computed
  values into `parsedStyles` for VS Code mode when Tailwind parsing has no value.
- Also support a request/response path from the Inspector to the iframe for
  selections created without a mouse click, for example keyboard navigation,
  `goToVisual`, or restored state after HMR. The click snapshot is the fast path;
  it must not be the only path.
- Add color normalization in `shared/utils/color.ts` so values like
  `rgba(184, 103, 46, 0.15)` become a form the Inspector can display:
  `#b8672e` with opacity `15`, or `#b8672e26` if reusing
  `parseHexWithAlpha`.

**Tests:**

- Unit test `classNameToStyles` or the new merge helper:
  `bg-primary/15` plus computed `rgba(...)` should populate
  `backgroundColor` and `fillOpacity`.
- Unit test `shared/utils/color.ts` for `rgb()`, `rgba()`, and transparent.
- E2E: open `client/components/FAQ.tsx`, select the banner `div`, assert Fill
  is not `none` and opacity is near `15`.

---

### Task 3: `menubar.tsx` Props Overlay Does Not Disappear

- [x] Add `hypercanvas:componentRenderSucceeded` message from generated `CanvasPreview` on success
- [x] Handle `componentRenderSucceeded` in `usePreviewBridge.ts` to clear matching `componentError`
- [x] Improve `ComponentService` to recognize `React.forwardRef(...)` as component declarations
- [x] Prefer exported component matching file basename over internal helpers
- [x] Mark `className`, `children`, `ref`, `asChild`, event handlers as optional for HTMLAttributes/Radix wrappers
- [x] Do not mark destructured `...props` keys as required unless type annotation requires it
- [x] Unit test: `menubar.tsx`-style file → main component `Menubar`, required props none
- [x] Unit test: same-component render-succeeded signal clears `componentError`

**Symptom:** preview shows the component-error overlay:
`This component requires props to render`, with a missing field named
`class_name`. Manually adding `className={"foo"}` to `SampleDefault` does not
clear the overlay.

**What to check first:**

- Generated `client/__canvas_preview__.tsx` already imports
  `SampleDefault as MenubarSampleDefault`.
- `sampleRenderMap` already has:
  `'client/components/ui/menubar.tsx': MenubarSampleDefault`.
- Therefore, if the overlay stays after a valid `SampleDefault`, the likely
  problem is stale `componentError` state in the preview webview, not that the
  generated registry lacks the sample.

**Fix direction A: clear stale component-error overlay.**

- In `vscode-extension/hypercanvas-preview/src/webview-preview-panel/usePreviewBridge.ts`,
  current behavior preserves `componentError` when the same component reloads.
  That is useful while the component is still failing, but wrong after HMR or a
  regenerated sample fixes the render.
- Add a success signal from the iframe after `CanvasPreview` renders the selected
  component successfully. Clear `componentError` when success arrives for the
  same `componentPath`.
- Do not clear `componentError` from iframe `onLoad` / `previewLoaded`.
  `previewLoaded` is a load event, not a render-success signal, and can hide a
  real render failure before `hypercanvas:componentError` arrives.
- Recommended implementation: generated `CanvasPreview` renders a tiny child
  component/effect inside the successful branch. After React commits, it posts
  `hypercanvas:componentRenderSucceeded` with `componentPath` and a monotonic
  render sequence. `usePreviewBridge.ts` clears only the matching
  `componentError`.
- Keep `ComponentErrorBoundary` behavior intact for real render failures. The
  success signal must be emitted only from the branch that actually rendered
  `SampleDefault` or `Component`, never from the missing-component placeholder.

**Fix direction B: fix prop-schema false positives.**

`ComponentService` currently under-detects `React.forwardRef(...)` components and
can infer required props from helper components or destructured object patterns.
For shadcn/Radix primitives, `className` and `children` are almost always
optional.

**Files to inspect:**

- `vscode-extension/hypercanvas-preview/src/services/ComponentService.ts`
- `vscode-extension/hypercanvas-preview/src/webview-preview-panel/PropsForm.tsx`
- `vscode-extension/hypercanvas-preview/src/webview-preview-panel/PreviewPanelApp.tsx`

**Parser improvements:**

- Recognize `const X = React.forwardRef<..., Props>((props, ref) => ...)` and
  `forwardRef(...)` as component declarations.
- Prefer exported components that match the file basename or explicit export
  specifiers. Do not let a helper such as `MenubarShortcut` become the main
  component just because it is a PascalCase arrow function.
- Mark `className`, `children`, `ref`, `key`, `asChild`, and event handlers as
  optional for `React.HTMLAttributes`, `React.ComponentPropsWithoutRef`, and
  Radix-style wrapper components.
- If an object pattern has `...props`, do not treat every destructured key as a
  required prop unless the type annotation explicitly requires it.

**Tests:**

- Add a `ComponentService` regression test using a minimal `menubar.tsx` style
  file:
  - exported `Menubar = React.forwardRef(...)`
  - helper `MenubarShortcut = ({ className, ...props }) => ...`
  - expected main component: `Menubar`
  - expected required props: none
- Add a preview bridge test: after a same-component successful render signal,
  `componentError` is cleared.

---

### Task 4: Raw "Component not found" During Component Switch

- [x] Replace raw `Error: Component not found` branch in generator with standard placeholder markup
- [x] Generated missing-component branch posts `hypercanvas:componentMissing` with `componentPath`
- [x] Handle `componentMissing` in `usePreviewBridge.ts` → forward to extension host
- [x] Extension host handles it via `previewManager.ensureComponent([componentPath])` with retry guard
- [x] `PreviewFileManager._scanAllComponents()`: replace hardcoded `src` with multi-root detection
- [x] Include lowercase files if they export PascalCase components (shadcn pattern)
- [x] Keep explicit `ensureComponent()` paths as authoritative regardless of scan result
- [x] Unit test: `client/components/ui/sheet.tsx` with `export const Sheet` → registered by scan
- [x] Unit test: lowercase non-component helper under `client/` → not registered
- [x] Unit test: explicit `ensureComponent(['client/components/ui/sheet.tsx'])` → registered
- [x] Generator unit test: missing component renders placeholder and posts `componentMissing`

**Symptom:** clicking `client/components/ui/sheet.tsx` can temporarily show:

```text
Error: Component not found
Component "client/components/ui/sheet.tsx" is not available
```

**Important observation:** the current generated
`client/__canvas_preview__.tsx` now contains `Sheet` in `componentRegistry`.
That means the screenshot is likely a stale iframe/bundle state or a race where
the URL changes before the generated preview bundle is compiled and loaded.

**Fix direction A: do not render raw generated errors to users.**

- Replace the generated `Error: Component not found` branch in
  `lib/preview-generator/generator.ts` with a standard preview placeholder.
- Reuse the SaaS placeholder design, but do not import a SaaS React component
  directly into generated user-project code. `__canvas_preview__.tsx` lives in
  the user's app and cannot depend on internal client-only imports.
- If a reusable implementation is needed, extract a generator-level string or
  HTML/JSX builder that can be emitted into the generated preview file. Otherwise
  emit equivalent inline markup from `lib/preview-generator/generator.ts`.
- The placeholder should say the component preview is being prepared or is not
  available yet, not a scary raw error.

**Fix direction B: self-heal missing registry entries.**

- In the generated missing-component branch, post a message to the parent:
  `hypercanvas:componentMissing` with `componentPath` and available registry
  keys.
- In `usePreviewBridge.ts`, forward that to the extension host.
- In `PreviewPanel.ts` / `extension.ts`, handle it by running
  `previewManager.ensureComponent([componentPath])`.
- Add a retry guard so a truly invalid path does not loop forever.
- After ensure completes, refresh or re-send the component to the iframe.

**Fix direction C: cover `client/` roots consistently.**

- `PreviewFileManager._scanAllComponents()` still hardcodes `src`.
- Bulka uses `client/`.
- Replace hardcoded source root scanning with a shared frontend-root detector
  that checks at least `src`, `app`, and `client`, reusing the same logic Claude
  added for mode-manager/provider scanning.
- Do not keep the current "PascalCase filename only" rule as the final filter.
  shadcn files such as `client/components/ui/sheet.tsx` are lowercase filenames
  but export PascalCase components (`Sheet`, `SheetContent`, etc.).
- Do not simply include every lowercase `.tsx` file either. That would pull
  hooks, utils, route helpers, and style modules into the generated registry.
- Safer direction:
  - Scan candidate `.tsx` / `.ts` files under detected frontend roots.
  - Keep existing exclusions for generated files, framework-reserved files,
    platform variants, CSS-in-TS files, tests, stories, and indexes.
  - Parse each candidate and include it only when `extractComponentName()`
    finds a PascalCase export or default component.
  - Keep explicit selected paths as authoritative: `ensureComponent(['client/components/ui/sheet.tsx'])`
    must be able to register `Sheet` even if the full scan would not have
    found the file yet.

**Tests:**

- `PreviewFileManager` unit test: project with `client/components/ui/sheet.tsx`
  and `export const Sheet = ...` gets `Sheet` registered during full scan.
- `PreviewFileManager` unit test: a lowercase non-component helper under
  `client/` is not registered.
- `PreviewFileManager` unit test: explicit selected lowercase component path
  registers even when it was not part of the initial scanned registry.
- Generator unit test: missing component branch renders the shared placeholder
  and posts `hypercanvas:componentMissing`.
- E2E: select `sheet.tsx` in Bulka, assert no raw `Error: Component not found`
  text is visible. The acceptable states are the standard placeholder briefly,
  then real component/sample/fallback UI.

---

### Task 5: Verification Script

- [x] Create `ext-test-projects/debug-bulka-preview-followups.ts` following CLAUDE.md template
- [x] Assert BulkaDay renders and logs `previewLoaded`
- [x] Assert FAQ banner Inspector Fill populated for `bg-primary/15`
- [x] Assert Menubar: `hypercanvas:componentRenderSucceeded` clears props overlay
- [x] Assert Sheet: no raw `Error: Component not found` text visible
- [x] Assert no HyperIDE-owned runtime errors in diagnostics
- [x] Verify Bulka repo clean: no generated files committed (run `git status --short`)

Create or update an ext-test debug script. It must follow
`../ext-test-projects/CLAUDE.md`.

**Required harness shape:**

```ts
import { createDiagnosticsSession } from './e2e/helpers/diagnostics';
import { setupPreviewWithDevServer } from './e2e/helpers/setup-preview';
import { closeVSCode, launchVSCode } from './e2e/setup/electron-app';

const PROJECT = '../ext-test-projects/bulka-the-dog';

const instance = await launchVSCode({ projectPath: PROJECT, workerIndex: 99 });
const diagnostics = await createDiagnosticsSession({
  page: instance.window,
  label: 'bulka-preview-followups',
});

try {
  await setupPreviewWithDevServer(instance.window, 'client/components/BulkaDay.tsx', instance.app);
  // Then switch to FAQ, menubar, and sheet through the actual UI.
} finally {
  await diagnostics.close();
  await closeVSCode(instance);
}
```

**Assertions:**

- BulkaDay renders and logs `previewLoaded`.
- FAQ banner selected: Inspector Fill is populated for `bg-primary/15`.
- Menubar: adding or generating `SampleDefault` clears the props overlay after
  a real `hypercanvas:componentRenderSucceeded` signal for the same component.
- Sheet: no raw `Error: Component not found`; standard placeholder is allowed
  only during preparation.
- Diagnostics have no HyperIDE-owned runtime errors. Ignore errors whose stack
  points to external user extensions. The isolated harness should not load them,
  so external-stack filtering must be covered by a focused unit/helper test.

**Cleanup:**

- Do not commit generated Bulka files unless the test-project repo intentionally
  owns them.
- Before cleanup, run `git status --short` and inspect `git diff` in the nested
  Bulka repo. Do not delete or revert source files such as `client/App.tsx`,
  `client/components/FAQ.tsx`, or `client/components/ui/menubar.tsx` unless the
  diff proves they were temporary verification edits from this task.
- Safe cleanup candidates are generated preview artifacts such as
  `client/__canvas_preview__.tsx`, `.hyperide/`, and temporary debug outputs.
  Remove `bun.lock` only if it was created by this debug run and the test
  project does not intentionally track it.

---

## Done Criteria

- Isolated E2E/debug run passes for BulkaDay, FAQ, menubar, and sheet.
- Normal user VS Code screenshots no longer mislabel external extension
  rejections as HyperIDE failures.
- Inspector can display runtime CSS-variable Tailwind colors.
- Same-component successful React render, not iframe load, clears stale
  component-error overlay.
- Missing registry entries show the standard placeholder and self-heal when
  possible.
- Lowercase shadcn component files under `client/` are registered when they
  export PascalCase components; lowercase non-component helpers are not.
- Unit tests cover every fixed root cause.
