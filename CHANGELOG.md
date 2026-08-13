# Changelog

All notable changes to HyperCanvas Preview are documented here.

## [0.1.54] — 2026-05-29

### Bug fixes

- **Astro projects no longer stuck in readonly mode** — `detectProjectType()` now maps `astro` dep and `astro.config.{ts,mjs,js,cjs}` config file to `'vite'`; previously Astro projects showed bundler as `unknown` which disabled the full edit pipeline (`c7879324`, `9a48a443`)
- **Astro Tailwind CSS detected correctly** — `detectCssSystem()` now recognises `@astrojs/tailwind` and `@tailwindcss/vite` as the Tailwind CSS system, not only bare `tailwindcss` dep (`5480bbb5`, `95fb75e9`)
- **Extension installable on VS Code 1.105.x** — `engines.vscode` minimum restored to `^1.99.0`; was bumped to `^1.106.0` in a previous commit and blocked users on 1.105.1 (`63607931`)

---

## [0.1.53] — 2026-05-29

### Bug fixes

- **No broken scaffold for required-prop components** — `_handleCreateSampleFromError` now returns `false` instead of writing a propless scaffold when a component has required props and no AI key is configured; this prevents a permanent `existingRegex` short-circuit that blocked subsequent AI attempts (`f8cae681`)
- **Reveal cursor after AI-generated sample** — finalization block (editor reveal + file watcher) is now shared between AI-written and scaffold-written samples; previously AI success exited early and skipped the reveal (`f8cae681`)

---

## [0.1.52] — 2026-05-28

### Bug fixes

- **Explorer shows components in src/app/** — `detectProjectStructure` now handles `src/app/` (non-Next.js) by delegating to `categorizeComponentsDir`; previously the Explorer showed all categories empty for projects with this layout (`b53d8b0f`)
- **Git excludes on first component switch** — `ensureGitExclude` is now called from `_initPreviewFile` and `ensureStandaloneEntry`, so generated files are hidden from `git status` as soon as they are created rather than only after `ensurePreviewFiles` is invoked (`8e1beddc`)
- **`.samples.tsx` and `__canvas_samples__.tsx` hidden from git** — `ensureGitExclude` now includes `__canvas_samples__.tsx` (legacy global samples file); `isPreviewIneligibleByName` excludes `*.samples.tsx` siblings so they never appear as previewable components or cause HMR churn (`a39a7288`)
- **Try render without props before showing "requires props" overlay** — `shouldCreateNoPropsSample` now creates a minimal scaffold for every unsampled component regardless of declared props; if the component renders without props the preview just works; only if it crashes does `ComponentErrorOverlay` appear (`64a05bd2`)
- **AI sample generation as fallback for required-prop components** — `_handleCreateSampleFromError` now checks component prop types before attempting AI generation; AI is only invoked when the component has required props and an API key is configured; for simple no-prop components the deterministic scaffold is used directly; when API key is missing and required props are detected, a notification prompts the user to configure one (`06d0d753`)

---

## [0.1.51] — 2026-05-28

### Bug fixes

- **Git exclude in monorepos** — `ensureGitExclude` now walks up to find the actual `.git/` root instead of only checking `projectRoot`; fixes generated preview files showing up in `git status` for packages nested inside a monorepo; also adds `.hyperide/` and `*.samples.tsx` to the exclude list (`6b830ae2`)

---

## [0.1.50] — 2026-05-28

### Bug fixes

- **Colored logs in Hyper panel** — dev server output (Vite colors, webpack errors, etc.) now renders with ANSI colors in the Hyper logs panel; previously ANSI codes were stripped before reaching the webview (`c5d9cdf4`)

---

## [0.1.49] — 2026-05-28

### Features

- **Bun bundler support** — extension detects Bun as a bundler type and includes it in `FULL_EDIT_BUNDLERS`; Bun chunk frames are extracted in `extractClientChunkFrames` for source map warmup (`472ba2b7`, `16a81f08`)
- **ReadonlyStubScreen project type** — stub screen now displays the detected project type; log output strips ANSI escape codes before writing to the output channel; port correction is logged explicitly (`5fa1d1cf`)

### Bug fixes

- **HMR-safe createRoot** — standalone preview entry now uses `root.render()` on existing root instead of calling `createRoot` again after HMR; cross-bundler type declarations included (`b321d77f`)
- **Isolated mode race** — pending isolated mode is stored before the proxy is created so it is not lost if proxy creation completes synchronously (`b289cc74`)

### Internal

- oxfmt scope narrowed — YAML, k8s, and ops dirs excluded from formatter; `.worktrees/` added to `.gitignore` (`49370dc5`, `d5beac0b`)

---

## [0.1.46] — 2026-05-12

### Features

- **Entry file watcher** — extension now watches the router/entry file (`App.tsx`, `main.tsx`, etc.) for git-discard; auto-repatches `/test-preview` route after SCM "Discard Changes" so the preview iframe no longer gets a 404 until the panel is manually closed/reopened (`f898bcdd`)

### Bug fixes

#### i18n key inspector (4 bugs)

- **Sequential key changes** — second key change no longer finds the wrong JSX element after recast/reformat; stale `previousKey` resolved; file-wide fallback added (`df18049f`, `e3e38a8a`, `3c8a620f`, `1b37aed4`)
- **Repeated key change after HMR** — element binding is re-read after every HMR cycle; stale `i18nText` cleared on re-read instead of carrying over the previous binding (`ebb0b6c9`, `d4c4b2c5`)
- **Key button disabled while loading** — prevents a second key write being dispatched before the first one completes (`eea3620b`)
- **Optimistic key display after Create** — inspector shows the newly created key immediately; `commitKey` guarded against no-op when re-selecting the current key; `optimisticKey` rolls back on write failure; `pendingKey` used in text write that follows a Create (`b22a43f9`, `e7e55345`, `48770c80`, `f4bdfa1d`, `cf9e1b13`, `e4cd099b`)
- **canCreateKey** — combobox and "Create" option are now shown even when the element already has a key (`1e3b201c`)
- **Grace cache** — cleared on i18n key write so the selection rect does not stay frozen at the old element position (`e3862428`)

#### Drag & drop

- **Escape cancels drag** — pressing Escape during a drag gesture cleanly aborts the operation (`9c2f54aa`)
- **Ghost background** — transparent elements now pick up background colour from the nearest opaque ancestor, not the element itself (`375599b1`)
- **Selection preserved after drag write** — grace cache is seeded with the dropped element's ref so the overlay rect does not vanish (`a8f97198`)
- **Overlay update during drag** — rect updates on every `pointermove`, not only at drag start/end (`57cb192c`)
- **Flex/grid parent resolution** — element itself is checked for `display:flex/grid` before walking up to the parent; fixes drop-target detection for elements that are themselves flex containers (`f079cf2e`)

#### Locale switcher

- Locale switcher was a no-op — `activeLocale` is now correctly threaded through `StyleReadService` and `useElementStyleData`; switching locale updates the displayed translation immediately (`ac0586c9`, `5b5d3ee0`)

#### Canvas / overlay

- **Selection rect after Fast Refresh** — overlay re-measures on every React Fast Refresh commit, not only on the initial render (`2b4109db`)
- **Shift+Enter parent rect** — `selectParent()` now propagates `itemIndex` so the overlay anchors to the correct instance in repeated-component hosts (`5812c60d`)

### Internal

- `previewPanel.refresh()` removed from `scheduleRepatch()` — was resetting the iframe on every `App.tsx` write including the extension's own entry-file patches, causing E2E hangs (`7e98658a`)

---

## [0.1.45] — 2026-05-09

### Features

- **Shift+Enter parent selection** — `getState()` extended with `selectedItemIndices`; `onSelectElement` callback propagates `itemIndex` so Shift+Enter anchors the overlay to the correct parent instance in repeated components
- **Drag level fix** — `aria-hidden` walk-up and drag source resolution corrected; drag now lifts to the right JSX ancestor

### Bug fixes

- i18n key combobox (b5): available keys shown; key selection writes to the correct locale file
- Selection survives i18n write — grace cache + `mergeInitState` + Vite HMR hook prevent selection loss after key/text change
- Tree ↔ canvas scroll sync (B8): clicking a tree item scrolls the canvas to it and vice versa

---

## [0.1.44] — 2026-05-05

- Inline text editing: double-click on canvas text opens edit mode in place
- i18n text inspector: read and write translation strings from the inspector panel
- Overlay rect anchoring for mapped/repeated components (`shouldSkipNestedMappedSource`)

---

## [0.1.43] — 2026-04-26

- SaaS: browser-based canvas UI connected to Hono server routes
- PreviewProxy: exponential-backoff retry budget (30 s) after dev-server restart

---

## [0.1.42] — 2026-04-20

- Keyboard navigation: `postMessage` to iframe; fuzzy source-cache lookup
- 63 TypeScript errors fixed in extension host

---

## [0.1.41] — 2026-04-14

- `react-vite-tw4-twitter` reference project baseline
- Smoke suite: 12 project-independent specs green
