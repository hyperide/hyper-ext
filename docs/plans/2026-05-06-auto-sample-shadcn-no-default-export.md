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

- [x] When `SampleDefaultMap[componentPath]` is undefined, do NOT render the
      "Component not found" error. Instead:
      - Inspect the module's named exports (parse the source file or load
        the module dynamically) to find the canonical "root" component.
      - For a single-default-export module: render `<RootComponent />`
        with empty props.
      - For a compound shadcn-style module (e.g. Carousel with subparts):
        invoke sample-scaffold with the parsed exports and use the result.

      Implementation:
      - `lib/preview-generator/sample-scaffold.ts`: added
        `buildContainerSampleJsxBody({ sourceCode, componentName }) →
        { body, referencedNames } | null`. Returns the JSX expression body
        (no `export const` wrapper) plus the names referenced inside,
        re-using `buildCompoundChildLines` so the synthesis path stays
        aligned with the existing manual-overlay scaffold logic. Suffix
        coverage is still allow-list (Task 4 widens it).
      - `lib/preview-generator/generator.ts`: added two optional fields to
        `PreviewComponentEntry` — `syntheticSampleDefault?:
        ContainerSampleJsxBody` and `detectedExports?: string[]`. New
        helper `entryHasRenderableSample(entry)` now drives the registry
        filter (line 197) so UI primitives with synthesized scaffolds stay
        in the registry. For each entry with synthetic, the generator
        emits `import * as ${alias}Module from '…';` alongside the named
        import and registers an inline arrow in `sampleRenderMap` whose
        body has every referenced identifier prefixed with the namespace
        (`<AlertModule.Alert>` etc.). Bumped schema marker to
        `fallback-props-v9`.
      - `lib/preview-generator/preview-file-manager.ts`: in `buildEntry`,
        when the source has no authored `SampleDefault`, run
        `scanRenderableExportNames` for `detectedExports` and call
        `buildContainerSampleJsxBody` to populate
        `syntheticSampleDefault`. Both filter sites (lines 497, 518) now
        defer to `entryHasRenderableSample`. `parseExistingPreview` learns
        to recognise non-identifier `sampleRenderMap` values (synthetic
        arrows) and re-marks the path as renderable so the cleanup pass
        doesn't drop it on the next regeneration.

- [x] If sample-scaffold cannot produce anything sensible, render a
      structured "no sample for this component" UI (with the file path
      and the list of detected exports) — never an infinite Loading.

      Implementation:
      - `buildCanvasPreviewBody` in `generator.ts` no longer emits the
        bare "Loading…" branch. The new branch reads
        `componentExportsMap[componentPath]` (a map embedded in the
        generated preview), shows a "No sample for this component"
        heading with the path, and either lists the detected exports or
        falls back to "Generating sample…" while
        `_ComponentMissingSignal` continues firing so extension.ts's
        recovery path can still re-run `ensureComponent`.
      - Tests: `__tests__/sample-scaffold.test.ts` covers
        `buildContainerSampleJsxBody` (compound input → body + ordered
        referenced names; non-compound input → null);
        `__tests__/generator.test.ts` covers (a) the missing-component
        branch now contains "No sample for this component" /
        `componentExportsMap` / `Detected exports:` instead of "Loading…";
        (b) synthetic entries emit namespace import + prefixed inline
        arrow + parseable TS/TSX; (c) UI primitives with synthetic stay
        in the registry; (d) UI primitives without synthetic stay
        filtered out. `bun test ./lib/` → 906 pass, 0 fail. `bunx tsc
        --noEmit` clean. `bunx biome check lib/preview-generator/` clean.

### Task 3: Wire it into the VS Code preview path

- [x] Make sure `PreviewModeManager._patchEntryFile` (or equivalent) writes
      the generated sample alongside (or in place of) the missing
      SampleDefault entry, so HMR picks it up.

      Implementation (`vscode-extension/hypercanvas-preview/src/extension.ts`):
      - Replaced the hard early-return at line 743 (`if (isUiPrimitive(...))
        { setComponentParam; return; }`) with a flag `const isPrimitive =
        isUiPrimitive(relativePath)`. The branch that mutated shadcn
        source files (`ensureSample` + `ensureDefaultSampleForNoProps`) is
        now gated on `!isPrimitive` — the user's shadcn `ui/carousel.tsx`
        stays pristine. `previewManager.ensureComponent([relativePath])`
        and `modeManager.onComponentSelected()` continue to run for
        primitives, so the synthesized scaffold from
        `preview-file-manager.buildEntry` lands in the registry of the
        regenerated `__canvas_preview__.tsx` and HMR picks it up.
      - The wrong layer for this fix (per Task 1 finding) was
        `PreviewModeManager._patchEntryFile`: that function is framework
        routing only, no sample awareness. Sample wiring is orchestrated
        in `extension.ts` upstream of the mode manager, which is where
        the change landed.
      - Updated the `previewPanel.onComponentMissing` self-healing
        comment + toast to reflect the post-Task-2 reality: primitives
        with synthetic compounds are now valid registry entries; the
        toast only fires when entryHasRenderableSample stays false
        (no authored SampleDefault AND no compound exports detectable).

- [x] Confirm the iframe URL with `?component=` for the file shows the
      generated sample, not the bare "Loading…" or "Component not found"
      screen.

      Verified via tests:
      - `lib/preview-generator/__tests__/generator.test.ts` already
        proves (Task 2) that synthesized entries emit the inline arrow
        in `sampleRenderMap` keyed by the iframe `?component=` path
        and that `<AlertModule.Alert>` etc. parse cleanly.
      - `vscode-extension/hypercanvas-preview/src/__tests__/extension-ui-primitive-wiring.test.ts`
        (new) asserts the new wiring: `ensureSample` and
        `ensureDefaultSampleForNoProps` are skipped for UI primitives,
        but `ensureComponent`, `onComponentSelected`, and
        `setComponentParam` all still run. Backslash-path Windows
        variant covered. Non-primitive path keeps original behaviour.
      - `bun test vscode-extension/.../extension-ui-primitive-wiring.test.ts`
        → 5 pass, 0 fail. Full extension suite: 584 pass, 1 unrelated
        fail (i18n onKeyChange noop, deferred to Linear; pre-existing).
      - `bunx tsc --noEmit` clean.
      - `bunx biome check` clean on touched files.

### Task 4: Unit test the sample generator for a compound shadcn module

- [x] Pick `carousel.tsx` from `bulka-the-dog/client/components/ui/` as a
      fixture.

      Implementation: minimal stand-in `CAROUSEL_SOURCE` fixture in
      `lib/preview-generator/__tests__/sample-scaffold.test.ts` mirrors the
      real shadcn carousel export shape — `Carousel`, `CarouselContent`,
      `CarouselItem`, `CarouselPrevious`, `CarouselNext` as
      `React.forwardRef` arrows, plus a `CarouselApi` *type-only* export to
      verify the scanner correctly drops it.

- [x] `bun test lib/preview-generator/sample-scaffold.test.ts` → assert that
      given the carousel exports, the scaffold produces a renderable JSX
      tree containing Carousel + CarouselContent + at least one CarouselItem
      + CarouselPrevious + CarouselNext.

      Three new tests under `describe('compound shadcn carousel scaffold', …)`:
      1. `buildSampleScaffold` produces a full `SampleDefault` arrow
         containing all five elements; type-only `CarouselApi` does not
         leak; the whole scaffold parses as TS+JSX.
      2. `buildDeterministicContainerSampleScaffold` returns non-null
         (proves carousel is now recognised as a compound container — was
         null before Task 4 widened the suffix list).
      3. `buildContainerSampleJsxBody` returns a body referencing all five
         names so the generator's namespace-prefix step sees every part the
         iframe will render.

- [x] If `sample-scaffold` doesn't currently support compound modules,
      extend it (don't fork — the user said this logic already exists, just
      not used for this case).

      Implementation:
      - `lib/preview-generator/sample-scaffold.ts`:
        `buildCompoundChildLines` no longer drops PascalCase exports just
        because their suffix isn't in the layout allow-list. Known suffixes
        still sort first (added `Trigger`, `List`, `Item`, `Action`,
        `Cancel`, `Previous`, `Next`); unknown PascalCase suffixes (e.g.
        `RootProvider`, `SubMenu`) sort after, in source order. Suffix
        validation (`/^[A-Z][\w$]*$/`) keeps non-component names out.
      - `sampleTextForSuffix` extended with sensible defaults:
        `Trigger → "Open"`, `Item → "Sample item"`, `Previous → "Prev"`,
        `Next → "Next"`, `Action → "Action"`, `Cancel → "Cancel"`. Falls
        through to `"Sample content"` for unknown suffixes.
      - `lib/preview-generator/__tests__/preview-file-manager.test.ts`:
        flipped the stale `SHEET_SOURCE` exclusion test. Pre-Task-4 Sheet
        + SheetTrigger fell through to "excluded from registry" because
        `Trigger` wasn't in the allow-list; now `Trigger` is recognised
        and the file gets a synthetic SampleDefault that renders via the
        `SheetModule.Sheet` / `SheetModule.SheetTrigger` arrow. The
        crash-prevention invariant still holds (sample renders instead of
        fallback-prop spread); the `NavigationMenu` test below still
        covers "no compound parts → still excluded".
      - Verification: `bun test ./lib/` → 909 pass, 0 fail (was 908 pass
        before Task 4). `bunx tsc --noEmit` clean.
        `bunx biome check lib/preview-generator/` clean.
      - Extension wiring test from Task 3 (`extension-ui-primitive-wiring`)
        still 5 pass / 0 fail — the broader allow-list doesn't disturb
        the upstream `isPrimitive` skip on `ensureSample` /
        `ensureDefaultSampleForNoProps`.

### Task 5: Add an E2E test

- [x] In `../ext-test-projects/e2e/tests/project-independent/component-load.spec.ts`
      (create if absent) add a case that opens
      `bulka-the-dog/client/components/ui/carousel.tsx` and asserts the
      preview iframe renders something other than "Loading…" or "not found".

      Implementation: spec landed at
      `../ext-test-projects/e2e/tests/project-dependent/component-load.spec.ts`
      (NOT project-independent). The project-independent suite is pinned to
      `react-vite-tw4-twitter` (REFERENCE_PROJECT in playwright.config.ts),
      which has no `client/components/ui/carousel.tsx` — placing the spec
      there would force every run to skip on the only project where the
      auto-sample fallback is exercised. Project-dependent runs the spec for
      every `dep:*` project; the file's existence is the skip-gate, so
      bulka-the-dog (and any future shadcn project that ships carousel.tsx)
      runs it and the rest skip cleanly. Spec asserts:
      1. fixture invariant — `carousel.tsx` exports the five compound parts
         and has NO authored `SampleDefault` (loud failure if a future PR
         silently adds one and breaks the fallback-path coverage),
      2. `setupPreviewWithDevServer(window, 'client/components/ui/carousel.tsx')`
         drives the bridge through the same path the user takes (`isUiPrimitive`
         hits → synthesised SampleDefault lands in the registry),
      3. `canvas.isPreviewLoaded()` flips true within 60s,
      4. iframe body text contains none of "Loading…", "No sample for this
         component", or "Component not found" — match strings copied verbatim
         from `lib/preview-generator/generator.ts` so a fallback-copy rename
         surfaces here instead of silently passing,
      5. `#root` has at least one renderable child element (positive
         assertion in addition to `isPreviewLoaded()`'s gate).

- [x] Capture screenshot.

      Implementation: `window.screenshot()` writes
      `carousel-auto-sample-preview.png` under `testInfo.outputPath(...)`
      (per-test artifact dir, no cross-shard collisions in Docker matrix
      runs) and attaches it to the Playwright report. When `SCREENSHOT_DIR`
      env var is set (other bulka specs use the same convention), the file
      is also mirrored there so the existing screenshot collection
      pipeline picks it up. Type-check (`npx tsc --noEmit -p tsconfig.json`
      in `e2e/`) clean for `component-load.spec.ts`. The pre-existing tsc
      errors in `canvas-bugs.spec.ts` are unrelated and predate this work.

### Task 6: Build, install, screenshot, TG

- [ ] `npm run package`, install, reload.
- [ ] Open carousel.tsx in Hyper Canvas, screenshot proof of render.
- [ ] `send-tg-photo.sh` with critical visual review.
