# Auto-sample for shadcn/ui leaf components without SampleDefault

## Context

Selecting a shadcn/ui-style component file like `bulka-the-dog/client/components/ui/carousel.tsx`
in Hyper Canvas leaves the preview stuck on "Loading…" — the file exports
`Carousel`, `CarouselContent`, `CarouselItem`, `CarouselPrevious`,
`CarouselNext` but no `SampleDefault`, so `SampleDefaultMap[componentPath]`
is undefined and the preview has nothing to render.

User says: "у нас есть логика для создания семплов уже, тут не должно быть
никакого отличия". So the existing sample-generation logic must be wired to
this case rather than punting on it.

## Files to investigate

- `client/__canvas_preview__.tsx` — the SampleDefaultMap registration and the
  `<SampleComponent />` render path; this is where the failure surfaces.
- `lib/preview-generator/` — sample generation pipeline (sample-scaffold.ts
  exists). Find what is supposed to register a sample for a component and
  why it skips files that don't export `SampleDefault`.
- The VS Code extension preview-mode patcher: `PreviewModeManager` /
  `_patchEntryFile` rewrites the entry to a synthetic preview app. It may
  be the layer responsible for generating samples on the fly.
- `vscode-extension/hypercanvas-preview/src/bridges/PreviewBridge.ts` and
  related — message types for "open this component path" and how the
  extension responds when no sample is found.

## Goal

When the user opens a component path that has no `SampleDefault`, generate
one automatically using the existing sample-scaffold logic and render it.
For shadcn/ui-style compound components (multiple named exports), produce
a minimal usage example combining the parts (e.g. for carousel: a Carousel
wrapping CarouselContent + CarouselItem + Prev/Next).

## Tasks

### Task 1: Inventory the existing sample generation logic

- [x] Read `lib/preview-generator/sample-scaffold.ts` and understand its
      input/output contract.

      Findings (`lib/preview-generator/sample-scaffold.ts`):
      - `buildSampleScaffold({ sourceCode, componentName, exportName, propEntries })`
        → string. Used for the manual "Create Sample" overlay (PreviewPanel).
        Emits a JSX export. With prop entries → self-closing `<Comp prop={…} />`.
        Without prop entries → tries compound children, then `children`-accepting
        single child, else self-closing.
      - `buildDeterministicContainerSampleScaffold({ sourceCode, componentName,
        exportName })` → string | null. Returns null unless `buildCompoundChildLines`
        finds at least one nested export. Used by `ensureSample` as the deterministic
        path before falling through to AI.
      - `buildCompoundChildLines` greps for exports starting with `componentName`
        and filters them by a hardcoded suffix allow-list:
        `['Header', 'Title', 'Description', 'Content', 'Body', 'Text', 'Footer', 'Label']`.
      - For `carousel.tsx` exports (`Carousel`, `CarouselContent`, `CarouselItem`,
        `CarouselPrevious`, `CarouselNext`) only `CarouselContent` matches.
        Output is `<Carousel><CarouselContent>Sample content</CarouselContent></Carousel>`
        — Item / Previous / Next are dropped. This is the scaffold-side gap.

- [x] Find every callsite — how is it currently invoked when a regular
      component is opened? Document the gap that prevents it from being
      invoked for files without an existing `SampleDefault`.

      Callsites of `buildSampleScaffold`:
      - `vscode-extension/hypercanvas-preview/src/PreviewPanel.ts:17,569` —
        `_handleCreateSampleFromError` writes an explicit `SampleDefault` to the
        component file when the user clicks "Create Sample" on the error overlay.
        Manual entry only — not part of the auto-load flow.

      Callsites of `buildDeterministicContainerSampleScaffold`:
      - `lib/preview-generator/sample-ensurer.ts:69` — only callsite. `ensureSample`
        first tries the deterministic path; if null, falls through to the AI
        generator callback.

      Callsites of `ensureSample`:
      - `server/routes/parseComponent.ts:1086-1097` — SaaS path. Always runs for
        any selected component on the Hyper Canvas SaaS server.
      - `vscode-extension/hypercanvas-preview/src/extension.ts:758-766` —
        extension path. Runs on `stateHub.onChange` when `currentComponent.path`
        changes, with `sampleName: 'SampleDefault'`.

      The gap (extension flow for `client/components/ui/carousel.tsx`):
      1. `extension.ts:743` early-returns for any path matched by
         `isUiPrimitive` (`/(\/|\\|^)components[/\\]ui[/\\]/i` — see
         `lib/preview-generator/generator.ts:168`). The early return:
         ```ts
         if (isUiPrimitive(relativePath)) {
           previewPanel?.setComponentParam(relativePath);
           return;
         }
         ```
         skips `ensureSample` AND `previewManager.ensureComponent` entirely.
         So a shadcn `ui/carousel.tsx` selection never invokes the deterministic
         scaffold at all in the extension.
      2. Even if `ensureSample` did run, `buildDeterministicContainerSampleScaffold`
         would currently return null for any compound that doesn't have at least
         one suffix from the allow-list (carousel only matches `Content`,
         producing a degenerate scaffold).
      3. `generatePreviewContent` (`generator.ts:174-178`) and
         `preview-file-manager.ts:497,518` filter UI primitives out of the
         registry unless `sampleExports.includes('SampleDefault')`. So even if
         the file is registered, the registry omits it until SampleDefault is
         actually written.
      4. The iframe loads `?component=client/components/ui/carousel.tsx`,
         hits `client/__canvas_preview__.tsx:89-104` where
         `SampleDefaultMap[componentPath]` is undefined → renders the
         "Component not found" branch (or stays at "Loading…" before mount,
         which is what the user reported).
      5. `onComponentMissing` self-healing in `extension.ts:512-548` calls
         `previewManager.ensureComponent([relPath])` and re-checks the registry.
         For UI primitives without SampleDefault, the entry is filtered out by
         the `generatePreviewContent` registry filter, so `inRegistry === false`
         → the recovery path shows an information toast and bails. Hence
         "stuck on Loading…".

- [x] Read `vscode-extension/hypercanvas-preview/src/services/PreviewModeManager.ts`
      (or whatever patches the entry file) to see what it does when a
      component has no SampleDefault — does it bail, log, send error?

      Findings (`lib/preview-generator/preview-mode-manager.ts` — the manager
      lives in `lib/`, not the extension `services/` dir; the extension just
      instantiates it via `createPreviewModeManager` in `extension.ts:580`):
      - `PreviewModeManager.onComponentSelected()` only deals with framework
        routing / entry-file patching. It doesn't know or care whether the
        component has `SampleDefault`.
      - `_patchEntryFile()` rewrites the entry file to import `__canvas_preview__`
        for webpack/parcel/bun/jsx-router cases. It returns `'ok'` or
        `'needs-patch'`. No SampleDefault awareness.
      - Sample generation is intentionally orchestrated in `extension.ts`,
        upstream of the mode manager. `PreviewModeManager` is the wrong layer
        to plug the auto-sample fallback into.

      Conclusion: the fix in Task 2 lands in `extension.ts` (drop or refine the
      `isUiPrimitive` early return) and in `lib/preview-generator/sample-scaffold.ts`
      (extend `buildCompoundChildLines` to include all PascalCase named exports
      that start with the component name, not only the suffix allow-list, with
      sensible defaults for `Item` / `Previous` / `Next` / `Trigger` etc.).
      `PreviewModeManager` itself does not need changes for this feature.

### Task 2: Add fallback sample generation in the preview entry path

- [ ] When `SampleDefaultMap[componentPath]` is undefined, do NOT render the
      "Component not found" error. Instead:
      - Inspect the module's named exports (parse the source file or load
        the module dynamically) to find the canonical "root" component.
      - For a single-default-export module: render `<RootComponent />`
        with empty props.
      - For a compound shadcn-style module (e.g. Carousel with subparts):
        invoke sample-scaffold with the parsed exports and use the result.
- [ ] If sample-scaffold cannot produce anything sensible, render a
      structured "no sample for this component" UI (with the file path
      and the list of detected exports) — never an infinite Loading.

### Task 3: Wire it into the VS Code preview path

- [ ] Make sure `PreviewModeManager._patchEntryFile` (or equivalent) writes
      the generated sample alongside (or in place of) the missing
      SampleDefault entry, so HMR picks it up.
- [ ] Confirm the iframe URL with `?component=` for the file shows the
      generated sample, not the bare "Loading…" or "Component not found"
      screen.

### Task 4: Unit test the sample generator for a compound shadcn module

- [ ] Pick `carousel.tsx` from `bulka-the-dog/client/components/ui/` as a
      fixture.
- [ ] `bun test lib/preview-generator/sample-scaffold.test.ts` → assert that
      given the carousel exports, the scaffold produces a renderable JSX
      tree containing Carousel + CarouselContent + at least one CarouselItem
      + CarouselPrevious + CarouselNext.
- [ ] If `sample-scaffold` doesn't currently support compound modules,
      extend it (don't fork — the user said this logic already exists, just
      not used for this case).

### Task 5: Add an E2E test

- [ ] In `../ext-test-projects/e2e/tests/project-independent/component-load.spec.ts`
      (create if absent) add a case that opens
      `bulka-the-dog/client/components/ui/carousel.tsx` and asserts the
      preview iframe renders something other than "Loading…" or "not found".
- [ ] Capture screenshot.

### Task 6: Build, install, screenshot, TG

- [ ] `npm run package`, install, reload.
- [ ] Open carousel.tsx in Hyper Canvas, screenshot proof of render.
- [ ] `send-tg-photo.sh` with critical visual review.
