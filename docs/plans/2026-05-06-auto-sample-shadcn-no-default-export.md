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

- [ ] Read `lib/preview-generator/sample-scaffold.ts` and understand its
      input/output contract.
- [ ] Find every callsite — how is it currently invoked when a regular
      component is opened? Document the gap that prevents it from being
      invoked for files without an existing `SampleDefault`.
- [ ] Read `vscode-extension/hypercanvas-preview/src/services/PreviewModeManager.ts`
      (or whatever patches the entry file) to see what it does when a
      component has no SampleDefault — does it bail, log, send error?

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
