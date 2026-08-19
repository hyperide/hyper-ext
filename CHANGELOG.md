# Changelog

All notable changes to HyperCanvas Preview are documented here.

## [Unreleased]

## [0.1.74] — 2026-08-19

### Bug fixes

- **Preview no longer 502-loops forever after the dev server dies mid-session** — the proxy now detects the terminal backend refusal and the extension does one bounded auto-restart (capped at 3 recoveries per 10 minutes), instead of hanging on a blank iframe indefinitely (HYP-1185, #708)
- **HyperIDE sidebar views (Explorer/Inspector/AI Chat/Logs) no longer get stuck loading forever when no folder is open** — opening a single file with no folder now shows a proper empty state with an "Open Folder" button, and the real views take over automatically once a folder is added (HYP-1237, #721)
- **Hyper Explorer activity-bar icon no longer renders undersized** — fixed the icon's viewBox on both shipped copies of the asset; it was rendering 35-45% smaller than the built-in VS Code icons next to it (HYP-1238, #720)
- **Elements tree now resolves the correct root component for files whose primary export isn't textually first** (e.g. shadcn `ui/*.tsx` files) — root-JSX resolution is now export-aware instead of assuming document order (HYP-1223, #732)
- **Second consecutive Fill color pick no longer gets stuck on a `cn()+concat` className** — picking a second Fill color in a row on an element whose className is built with `cn(...) + ' literal'` used to leave the className on the first color while a duplicate inline style silently carried the second (HYP-1222, #731)
- **Dimensional style edits on non-forwarding custom components are now refused with a warning instead of writing a dead, invisible prop** — padding/margin/border-radius/width edits on a component that doesn't forward that prop to a DOM element no longer produce a silent no-op plus a TypeScript error (HYP-995, #730)
- **Style-write auto-wrap on non-forwarding components now follows the full confidence/verifiability decision matrix** — writes that can't be verified are either kept-and-reported or rolled back per a documented table, never silently kept as if nothing needed attention (HYP-990, #665)
- **Style-read forwarding detection replaced with a real per-channel detector** — className/style forwarding facts are now derived from an AST render-body trace plus shadcn/Radix `asChild`/`Slot` and styled-components recognizers, instead of a hardcoded "always forwards" assumption; this is what makes the HYP-995/HYP-990 fixes above trustworthy (HYP-1229, #719)
- **Frontend-root detection no longer misdetects non-`src/main.tsx` project layouts** (e.g. this repo's own `client/App.tsx` layout), and closes a path-traversal edge case in the same function (HYP-1034, #674)

### Security

- **Closed reflected-XSS in the preview-proxy inline-script payload** — a request-derived proxy path was embedded unescaped inside an inline `<script>` in the dev-server-unreachable error page; a crafted URL could inject script into that page. Fixed by escaping `<`, `>`, `&`, and line-separator characters as JS `\uXXXX` sequences (HYP-1275, #727)

## [0.1.73] — 2026-08-13

### Bug fixes

- **Hardened dev-server bun-install against Windows timeout-orphans and corrupted-cache failures** — on Windows, `killProcessTree` previously sent a bare SIGKILL to the cmd.exe wrapper while the real installer child kept running and wrote to already-closed stdout/stderr; retry now also bypasses a corrupted package-manager cache instead of looping forever on the same broken tarball (HYP-1188, #715)
- **Corrected the DEVELOPMENT.md link path in README** — the link had 404'd since March (HYP-1192, #712)

## [0.1.72] — 2026-08-07

### Features

- **Guided "New component" flow in the Explorer, on both platforms (ext + SaaS)** — the Pages/Components "+" affordance (now also shown in the VS Code extension) opens one dialog with a plain-language type picker (Building block / Section / Page), a name field with live validation and collision detection, and an auto-picked target folder; on success the file is written from a shared Tailwind-first template and the component opens in the canvas preview. Templates, naming validation, target-dir resolution, and the contained exclusive file write live in `shared/component-create/` and run in BOTH hosts — the SaaS `POST /api/create-component` route and the extension host's `component:create` message — so the platforms stay at parity. Monorepo-aware: the page fallback derives from the active sub-project, and the extension honors the scanned monorepo ancestor root for sibling-sub-project writes (HYP-1184, #705)

_Note: this release also carried a large batch of dev-server, style-write, security-hardening, and diagnostics fixes (0.1.71→0.1.72 spans ~45 commits). Unlike the 0.1.73/0.1.74 entries above (fully reconstructed from their PRs while cutting 0.1.74), that full batch isn't reconstructed here — 45 commits is out of scope for a same-PR backfill. Tracked as HYP-1297 for a full backfill._

## [0.1.71] — 2026-07-15

### Bug fixes

- **Inspector style writes no longer fail with "Element not found" on React 19 + Vite dev-server apps (residual leaf-seed path)** — the HYP-970 fix (0.1.70) source-mapped the `_debugStack` _ancestor_ call-site, but the leaf seed on the click path and the `getSourceLocation` fallback still trusted the raw COMPILED `_debugStack` frame, which under React 19 + Vite is the position in the jsxDEV-transformed module (a line past EOF), not the original source. On a cold source map that compiled position was committed and every inspector style write failed. A shared `isUnsymbolicatedReact19Fiber` predicate now treats a React-19 DOM seed with no `_debugSource` up-chain as untrusted on BOTH platforms (extension + SaaS): the cold compiled seed is suppressed and routed through the warm-and-defer branch, and the pending-click warm-retry is now correctly wired (was dead by-value) so it re-resolves to the real mapped position once the map warms. Extends the HYP-970 lineage (HYP-974, #660)

## [0.1.70] — 2026-07-14

### Bug fixes

- **Inspector style writes no longer fail with "Element not found" on React 19 + Vite dev-server apps** — a regression from HYP-897 (shipped ext-v0.1.65 → ext-v0.1.69) committed a `_debugStack` call-site frame verbatim, which under React 19 is the COMPILED position in the jsxDEV-transformed module, not the original source; clicking an element inside an imported component resolved to a nonexistent line and every inspector style write failed. `resolveCallSiteTarget` now threads a source-map mapper so the `_debugStack` ancestor resolves to the mapped original position (HYP-970, #658)

## [0.1.69] — 2026-07-12

### Bug fixes

- **React Router v6.4 data-router preview-route patching** — bun apps with a real (data) router now get router-aware patching so the preview route resolves; entry-file fallback when `patchRouterConfig` no-ops on a data router (HYP-934, #655)
- **Preview crash-path no longer leaves the target repo dirty** — the preview crash/teardown path now reverts the `@hyperide`-managed injection (including the skip-worktree flag) and sweeps on startup, so a crashed preview no longer leaves injected patches dirtying the user's repo (HYP-945, #654)
- **Mode HUD no longer covers app content + quiet dev-server spawn** — the mode HUD overlay no longer obscures app content, and the dev-server spawn no longer emits the Node DEP0190 deprecation warning (HYP-962, #653)
- **Non-compound UI primitives no longer dead-end on "No sample for this component"** — opening a `components/ui/*.tsx` file with no authored `SampleDefault` and no compound sibling exports (a plain `Card`/`Button`/`Badge`-style shadcn primitive) now renders via the existing deterministic per-prop generator instead of landing on the terminal "no sample" screen; registry inclusion only excludes a UI primitive when it BOTH lacks a renderable sample AND has unresolvable `declaredPropNames` (HYP-915) (`daeb50f9`, `94469cb7`, `7968c1bc`)

## [0.1.68] — 2026-07-09

Re-cut of the MCP fixes below, which were built for 0.1.67 but reached neither registry (see "Release plumbing").

### Bug fixes

- **Self-healing MCP startup** — the MCP server now starts on demand via `ensureStarted()` with retry + on-demand restart, fixing the "HyperCanvas MCP server is not running" error shown after "Setup AI agents" (HYP-954, #644).

### Security

- **Loopback MCP HTTP server is now authenticated** — closes a local (loopback-bound) unauthenticated command-execution hole on the MCP endpoint; not remotely reachable (HYP-956, #643).

### Release plumbing

- **Extension publish decoupled from the dead Marketplace token** — the publish workflow previously ran the expired-`VSCE_PAT` Marketplace step first with no `continue-on-error`, so it failed and fail-fast skipped the partner-critical Open VSX publish (Cursor and other forks install from Open VSX, not the MS Marketplace). Open VSX now publishes first and independently; a failed/absent `VSCE_PAT` no longer blocks it. This is why the 0.1.67 MCP fixes are re-cut here as 0.1.68 (HYP-958, #647).

---

## [0.1.56] — 2026-06-01

### New features

- **Monorepo support — HyperIDE Explorer now works with Nx, Turbo, pnpm workspaces, Lerna** — `detectRepoType()` identifies monorepo topology and scans sub-packages under `targets/`, `apps/`, `packages/`, `libs/`, `services/`. CSS frameworks (Tailwind, shadcn) are detected from sub-packages when not present at root (`b4b5d0b4`)
- **Sub-package component scanning** — `ComponentScanner` now recursively discovers React components in monorepo sub-packages, including packages with `pages/` or `components/` at root instead of `src/` (`cde7a406`)
- **Explorer sub-project accordion** — HyperIDE Explorer shows each sub-package as a collapsible accordion section with a color-coded badge. Supported packages (React) expand to show Pages/Atoms/Components. Unsupported packages (Vue, Express, etc.) show a brief reason inline. Shared libraries (react in peerDependencies only) show components instead of pages (`85eecc49`)

### Bug fixes

- **ConlocaCard no longer duplicated in Pages and Components** — `scanPagesDirectory` now skips directories already categorised as composites; `buildSubProject` passes `compositeDirPaths` as `excludeDirs` to the pages build call, mirroring the existing atom→composites exclusion pattern (`c51652e3`)
- **SaaS accordion propagation** — `useComponentsData` now preserves `isMonorepo` and `subProjects` fields returned by the server; previously the hook silently dropped them by reconstructing only `atomGroups/compositeGroups/pageGroups` (`85eecc49`)
- **Monorepo CSS fallback always fires** — removed `if (!packageJson)` guard in `detectCssSystem()` that prevented Tailwind detection in `apps/web/` when root `package.json` was pre-resolved (`85eecc49`)
- **Library sub-packages no longer appear under Pages** — `isLibrarySubPackage()` detects packages with `react` in `peerDependencies` only (not `dependencies`); their root-level `.tsx` components go to the Composites section instead of Pages (`a0a43ea7`)
- **Pages fallback adds individual files, not the whole src/ directory** — `detectProjectStructureInScope` now pushes individual PascalCase `.tsx` file paths instead of the parent directory, matching the root-project behaviour from HYP-397 (`a321bc1e`)

---

## [0.1.55] — 2026-05-29

### Bug fixes

- **Padding arrow key no longer produces bare `px` or resets selection** — `handleNumericKeyDown` now delegates to `computeNumericArrowValue` which clamps non-negative length properties at 0; vertical/horizontal combined padding inputs pass the displayed value (`paddingTop||paddingBottom`, `paddingLeft||paddingRight`) as `currentValue` so ArrowDown always decrements from what the user sees (`834e27ca`)

---

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
