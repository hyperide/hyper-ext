# HANDOFF — wiring the SaaS-only salvage features into the VS Code extension

**For a fresh session.** Consolidates everything learned about #258 (NudgeHUD), #270
(multi-select), #260 (FastPatch) and the cross-realm/style architecture. Read this first,
then the linked specs/files. Ticket: **HYP-535**. Design PR: **#371**.

---

## 0. TL;DR / where to start

1. Read the design spec: **`docs/specs/2026-06-04-crossrealm-webview-bridge.md`** (HYP-535) — root
   cause, the reusable seam, per-feature wiring, the "так не надо" anti-patterns, decisions D1/D2.
2. Read the new **`AGENTS.md` → "Webview realms & cross-realm state"** subsection (added on the
   HYP-535 branch / PR #371).
3. Follow **`docs/rules/development.md`** for process (TDD red-first, `bun run test`, `bun run knip`,
   advisor()+codex before commit, `/commit`, NO `--no-verify`, no sed/perl, worktree in `-worktrees/`,
   visual proof → CTO TG acceptance = "done").
4. Before building **#270**, do the deep study flagged in §4 below (the 158 KB unification plan).

---

## 1. The one root cause (all three features)

SaaS editor = **one JS realm** (`client/pages/Editor/CanvasEditor.tsx` mounts canvas + inspector +
overlays in one React tree → a module-level `zustand` store and one `CanvasEngine` are shared).

VS Code extension = **separate webview realms**, each its own JS bundle, **no shared module state**:

- `webview-preview-panel` → `PreviewPanelApp` (canvas + preview iframe).
- `webview-right` → `RightPanelApp` (inspector / `RightSidebar`).

A feature that works in SaaS is **NOT** automatically functional in the extension. Verified by Docker
e2e (primary source) that #258/#270/#260 are all **dead in the extension**. The earlier
"still-relevant" staleness assessment was wrong because it read code REFERENCES, not runtime mounting.
**Always Docker-verify extension-functionality, never grep.**

### 1a. SYSTEMIC finding — the ext webviews don't mount the providers SaaS has

The single mechanical cause across ALL these features: the extension webviews mount the leaf
components but **NOT the React context providers** that SaaS's `CanvasEditor` mounts. Confirmed cases:

- `webview-right/RightPanelApp.tsx` has **no `CanvasEngineProvider`** → `useCanvasEngineOptional()`
  null → multi-select batch (#270) gated off.
- `webview-preview-panel/PreviewPanelApp.tsx` mounts `CanvasElementContextMenu` **without
  `ComponentMetaProvider`** → `meta`/`sampleName` null → the dual-mode map-op toast (290c/#364) never
  arms (plain delete) — **HYP-556**.
- NudgeHUD (#258) wasn't mounted at all (fixed by D1-A).

So the cross-realm bridge is, in large part, **systematically mounting the missing providers**
(`ComponentMetaProvider`, `CanvasEngineProvider`, `NudgeStateProvider`, …) in the right ext webview —
backed by the cross-realm transport (StateHub/RPC) where the provider needs host data. Treat
"mount the provider + back it cross-realm" as the repeating unit, not N bespoke fixes.

**290h is DONE** (branch `HYP-522-dom-mode-toast`, commit `6177738c`): classifier-driven routing fixes
#364's destructive template-wide-delete (hook-derived/generator → toggle disabled; props-from-sample
→ sample op; literal-array → literal op) + sample-file resolution. Proven at the server-route level
(data delete `[a,b,c]→[a,c]`, `.map()` JSX byte-identical). 2391 tests green, codex/advisor clean. But
the toast is still SaaS-only in the ext (the `ComponentMetaProvider` gap above → HYP-556). Follow-ups:
HYP-555 (DOM copy), HYP-556 (provider/realm gap), HYP-558 (classifier function-scoping for inline props).

## 2. The sanctioned cross-realm mechanisms (reuse these, don't invent transport)

- **Durable cross-realm state** → `SharedEditorState`, synced by **`StateHub.applyUpdate(patch)`**
  (host-side, merges + broadcasts `state:update` to all panels).
  File: `vscode-extension/hypercanvas-preview/src/StateHub.ts`. Type: `SharedEditorState` (`@lib/types`).
- **Transient cross-realm signal** (no durable state) → **`StateHub.broadcast(message)`** (already used
  for `element-tracing:*`). Prefer over a SharedEditorState slice for high-frequency events.
- **Host capability (engine / AST / files)** → the **`astOps` RPC** on the platform `CanvasAdapter`
  (`client/lib/platform/{PlatformContext.tsx,BrowserAdapter.ts,VSCodeAdapter.ts}`, injected via
  `PlatformContext`). Single-select style writes already use it.

**Rule:** never put cross-surface state in a module-level singleton; route it through the platform
adapter (DI) so Browser backs it in-process and VS Code via StateHub/RPC, with the SAME component code.

## 3. The unified style engine (CRITICAL for #270 — CTO directive: generalize, don't parallelize)

There is a deep, framework-aware, SaaS/ext-shared style read/write stack. A **multi-selection is the
N>1 case of this ONE engine, NOT a second subsystem.**

- **READ:** `lib/style-read/` — `StyleReadManager.read(ctx: StyleReadContext): Promise<StyleReadResult>`
  (`types.ts`, `default-style-read-manager.ts`, `style-read-manager.ts`). Per-`elementRef`. Returns
  `{ sourceTabs, properties: PropertySource[], surfaceDecision, activeConditions, ... }` — framework /
  condition / theme aware. This is the **source-based editing read** the inspector uses.
- **WRITE:** `lib/style-write/` — `StyleWriteManager.plan(...) → StyleWritePlan`,
  `execute(plan) → StyleWriteResult` (`types.ts`, `style-write-{manager,planner,executor}.ts`,
  `default-style-write-manager.ts`). Per-`elementRef`.
- **Per-framework adapters:** `lib/style-adapters/{tailwind-v4,tamagui,css-modules,inline-style,...}/`
  each `{reader,writer}.ts`. CSS systems enumerated in `lib/style-read/types.ts` (`CssSystemId`:
  tailwind-v3/v4, css-modules, plain-css, inline-style, emotion, styled-components, vanilla-extract,
  mui-system, chakra-ui, mantine, tamagui).
- **Runtime vs source — KEY distinction:** `selectedElementRuntimeStyle` (pushed from the canvas
  webview via SharedEditorState, `useCanvasInteraction.ts:221/254`) is the **runtime/computed** style =
  a DISPLAY HINT. The inspector EDITS the **source** read (`StyleReadManager` / `sourceTabs` /
  `PropertySource`). Multi-select must merge the SOURCE read (to preserve sourceTab identity needed to
  write), not the runtime computed values.

### Multi-select design (#270)

- **READ merge:** run the SAME `StyleReadManager.read` per selected `elementRef`, then
  `mergeStyleReadResults(results): StyleReadResult` — per `PropertySource.property`: value if all N
  agree (same value + same `sourceTabId`), else a `mixed` marker. Inspector renders the identical
  `StyleReadResult` for N=1 and N>1 (N=1 = degenerate merge). **This `mergeStyleReadResults` + a
  `mixed` flag is the only new read code.**
- **WRITE batch:** **DELETE** the #270 PR's parallel path (`ASTBatchStyleOperation`,
  `updateComponentStylesBatch`, `useBatchStyleData`). A batch = build the SAME `StyleWriteManager.plan`
  per `elementRef` and `execute` each (or one executor running N plans transactionally) + ONE undo
  grouping. All framework/condition/theme correctness reused.
- **Reject** the #270 `multiSelectMerged` SharedEditorState snapshot AND the runtime-DOM merge.

### DEEP STUDY TODO before building #270 (the user's "изучи детальнее")

Trace exactly how a single element's `StyleReadResult` reaches the **ext** inspector today
(host-computed? which message? cached where? does it go through `astOps`/parseComponent or
SharedEditorState?). The merge slots into that SAME transport. Required reading:

- **`docs/specs/2026-04-14-style-write-unification-plan.md`** (158 KB — the unified write architecture).
- `docs/specs/2026-04-14-style-write-unification-workprocess.md` (63 KB).
- `docs/specs/2026-04-03-inspector-visual-hierarchy-design.md` (the inspector surface).
- `docs/specs/2026-03-10-universal-styling-adapters{,-plan}.md`,
  `docs/specs/2026-03-11-phase2-all-css-frameworks-design.md` (the adapter system).
- `docs/specs/2026-04-14-style-source-owner.md`, `…-style-source-confidence.md`,
  `2026-04-15-style-theme-resolution.md`, `2026-04-17-style-write-foundation-plan.md`,
  `2026-04-18-style-adapters-phase3-4-plan.md`.

## 4. Per-feature state

### #258 NudgeHUD — decision **D1-A (inspector realm)**, ✅ COMPLETE (awaiting CTO accept + merge)

- Branch **`HYP-404-nudge-hud-extension`**, final commit **`1dd3567f`**, pushed, NOT merged. Proof
  sent to CTO TG for acceptance; CI restored so merge via normal `gh ship` on green CI.
- **Done:** a `NudgeStatePort` DI seam (`client/lib/nudge/{NudgeStatePort.ts,NudgeStateProvider.tsx}`)
  — all 5 consumers (`numeric-input.tsx`, `NudgeHUD.tsx`, `NumericMode.tsx`, `TokenMode.tsx`,
  `EditNudgeInput.tsx`) depend on the port, NOT `import { nudgeStore }` (kills the singleton
  anti-pattern). `nudgeStore.ts` got a `createNudgeStore()` factory. `<NudgeHUD>` mounted in
  `webview-right/RightPanelApp.tsx` (inspector realm), confirmed not tree-shaken. TDD red-first done.
  Trigger: `StrokeSection.tsx` border-width field `styleKey="borderWidth"`.
- **CSS** fixed via a per-mount `className` override at `RightPanelApp.tsx:161` (`absolute bottom-3
  left-2 max-w-[calc(100%-1rem)] flex-wrap bg-neutral-900 [&>div]:flex-wrap`); shared `SAAS_LAYOUT`
  const (`NudgeHUD.tsx:37`) untouched. **Interactivity** via `useNudgeKeyboard(adapter)`
  (`NudgeStateProvider.tsx:94`, realm-agnostic DI): t/n/Escape; arrow-step uses `getStepForModifiers`
  when `styleKey` set (`numeric-input.tsx:43`). **SaaS mount** restored in `CanvasEditor.tsx:~1346`.
- **Gates:** `bun run test` 4760 pass/0 fail; knip baseline-clean; tsgo clean; hooks passed (no
  `--no-verify`). Codex+advisor found+fixed 4 keyboard-isolation bugs via TDD. Docker proof
  `review-screenshots.sh` **exit 0**. **Deferred → HYP-536** (token-toggle display-desync, pre-existing).
- Files: `client/components/NudgeHUD/NudgeHUD.tsx`, `client/stores/nudgeStore.ts`,
  `client/lib/nudge/*`, `vscode-extension/.../webview-right/RightPanelApp.tsx`.

### #270 multi-select — REDESIGN per §3 (generalize the style engine), NOT YET BUILT

- Old PR #270 (branch `HYP-271-multi-select-batch`) is SaaS-only + wrong architecture
  (`ASTBatchStyleOperation`). Supersede it. Do the §3 deep study first.
- D2 reframed: NOT a new channel (neither `multiSelectMerged` nor `readMergedStyles`) — reuse the
  existing single read N times + merge, same transport.

### #260 FastPatch — design ready, NOT BUILT

- `client/lib/fast-patch-service.ts`; `engine.fastPatch` called in
  `client/components/RightSidebar/hooks/useStyleSync.ts`. Cross-realm: the inspector can't touch the
  canvas iframe DOM. Wire via **`StateHub.broadcast('fastpatch:apply', {selector, delta})`** → the
  canvas webview subscribes and applies the patch locally. Browser adapter keeps the direct path.
  Define a `FastPatchPort` (Browser = direct, VS Code = broadcast).

## 5. "Так не надо" (anti-patterns found — full list in the design spec §2)

1. Module-level cross-surface singleton (`export const nudgeStore = create(...)`) imported directly by
   components — encodes "one JS realm", dies across webviews.
2. Direct store import in components = no DI / untestable across realms.
3. Half-wired `if (engine) {…}` with no `else` + author comment "SaaS only — not wired yet" (#270
   `useStyleSync` batch branch). If you write "X only on Y", you owe an adapter method, not a dead branch.
4. Platform-specific mount point (`<NudgeHUD>` only in SaaS `CanvasEditor`).

## 6. Infra / process context (don't trip on these)

- **GitHub Actions billing-blocked** (org-wide, since 2026-06-04) — CI can't run. Merge locally-verified
  PRs with **`gh ship <PR#> --skip-ci`** (admin-merge + cleanup in one step; added in #370). Raw
  `gh pr merge --admin` leaves dangling branches.
- **Local `launchVSCode`/Playwright `_electron.launch` BROKEN** (VS Code auto-updated to 1.123.0 /
  Electron 42.2.0 vs Playwright 1.60). Use the **DOCKER** e2e harness for visual proofs:
  `cd ext-test-projects/e2e && HYPER_E2E_SHARDS=1 HYPER_E2E_EXTENSION_REPO=<worktree> HYPER_E2E_BUILD_IMAGE=0 bun run test:docker`
  (bind-mounts the worktree's built `out/`). `review-screenshots.sh <png> --context "<feature>"` from a
  git dir, must exit 0.
- Tests: `bun run test` (NOT `bun test`). knip: `bun run knip` (NOT `bunx knip`).

## 7. Broader campaign state (awaiting CTO — not part of #258/#260/#270 but live)

- **Ready to merge on CTO "влей":** **#257** (resize snap — Docker-proven, review-screenshots exit 0),
  **#288** (monorepo P1 fix — unit+codex proven; visual N/A because the race isn't e2e-reproducible).
- **Awaiting CTO decisions:** #265/#304 (touch AGENTS — governance), #346 (OAuth — auth sign-off),
  #364 (290c — needs 290h classifier routing), #363 (proxy — needs e2e).
- **Closed:** #144 (stale), #300 (was merged; flagged: it may have re-added HYP-392 skipDirs reverting
  HYP-397 + an open P2 — verify on main).
- Full ledger: `.claude/projects/.../memory/MEMORY.md` (campaign rounds + SaaS-only findings + blockers).

## 8. Recommended build order (per design spec §5, TDD per docs/rules)

1. **#258** — finish D1-A (completion subagent in flight). Lowest risk; no cross-realm seam.
2. **#270** — AFTER the §3 deep study. Generalize `StyleReadManager`/`StyleWriteManager`; delete the
   batch parallel path. Highest architectural value.
3. **#260** — FastPatch via `StateHub.broadcast`.

Each: TDD red-first → knip → advisor()+codex → `/commit` → Docker visual proof → CTO TG accept →
`gh ship --skip-ci`. Each feature is its own PR/ticket. The salvage PRs (#258/#270/#260) are superseded
by this wiring — close them referencing HYP-535 once the replacement merges.
