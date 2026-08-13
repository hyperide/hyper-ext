# Salvage Adapter-First Rework — C / D / G / E

**Date:** 2026-06-02
**Status:** AWAITING CTO REVIEW — implementation gated on approval (per dev framework).
**Decision:** CTO 2026-06-02 — both surfaces (SaaS web + VS Code extension) are equal
priority; features must be **adapter-first** (work on both). The current salvage drafts
(#260 C, #258 D, #270 G, #257 E) are **SaaS-only** and must NOT be merged as-is.
**Related:** `docs/specs/2026-06-02-phase1-visual-foundation-salvage.md`, AGENTS.md
"Architecture — shared-first via platform adapters", HYP-427.

---

## The shared problem

All four salvaged features render/work in the SaaS web app but **not** in the VS Code
extension, because the salvage reinstated Phase 1's coupling to surfaces the extension
doesn't use:

1. **SaaS-shell mounting** — UI mounted in `client/pages/Editor/CanvasEditor.tsx` (the
   SaaS web shell). The extension renders `webview-right/RightPanelApp` +
   `webview-preview-panel/PreviewPanelApp`, which mount the shared `RightSidebar` but
   NOT `CanvasEditor`'s overlays. → NudgeHUD (D), spacing-guides (E) never appear.
2. **Synchronous-engine coupling** — logic gated on the in-browser `CanvasEngine`
   (`if (engine)`, `useCanvasEngineOptional()`), which the extension webview doesn't have
   (it drives `astOps` RPC). → fast-patch (C), multi-select read (G) never fire.

**Adapter-first fix (general):** move platform-specific access behind the existing
`PlatformAdapters` interfaces (`CanvasAdapter`, `AstOperations`, …) and mount UI in the
shared components both surfaces render — never in the SaaS shell, never gated on a raw
`engine`. Implement once; both `BrowserAdapter` and `VSCodeAdapter` satisfy it.

---

## C — FastPatchService (HYP-403, draft #260)

- **Now:** `CanvasEngine.fastPatch` field + `useStyleSync` calls it only in the
  `if (engine)` (SaaS) branch. Element resolution is already engine-independent (tracer
  bridge, HYP-411) — only the _call site_ is engine-gated.
- **Adapter-first:** make fast-patch a platform-agnostic service that operates on the
  preview iframe (both surfaces have one — `getPreviewIframe`). Invoke it in BOTH
  `useStyleSync` branches (engine AND astOps), or expose `applyPatch/clearPatch` via the
  `CanvasAdapter` so the hook calls `canvas.fastPatch...` regardless of platform. Drop
  the `if (engine)` gate around the patch call.
- **Verify:** instant CSS feedback on a style edit in BOTH SaaS and the extension preview.

## D — NudgeHUD (HYP-404, draft #258)

- **Now:** `<NudgeHUD/>` + `useNudgeSetup` mounted only in `CanvasEditor.tsx`
  (SaaS shell). `nudgeStore` (shared) IS driven from the shared `RightSidebar`, but the
  HUD overlay has no mount in the extension webviews.
- **Adapter-first:** mount `NudgeHUD` in a location both surfaces render — either inside
  the shared `RightSidebar`/a shared canvas-overlay component, or add the mount to
  `PreviewPanelApp`/`RightPanelApp` (the extension shells) mirroring the SaaS mount.
  `useNudgeSetup`'s hotkey wiring must attach via the shared hotkeys path, not a
  SaaS-only host. No engine dependency (nudgeStore is plain Zustand).
- **Verify:** arrow-nudge a value → HUD appears in BOTH surfaces.

## G — Multi-select batch (HYP-271/301, draft #270)

- **Now:** `multiSelectMerged` read gated `if (selectedIds.length <= 1 || !engine …)`;
  the batch write uses `engine.executeBatchStyles`. Extension shows "Multi-select editing
  is unavailable" (verified, HYP-427).
- **Adapter-first:** route the multi-element style **read** through the platform
  (`AstOperations`/`CanvasAdapter` batch read via RPC, or shared-editor-state) so
  `RightSidebar` can compute `multiSelectMerged` without a synchronous engine; route the
  batch **write** through `astOps.updateStylesBatch` (the server endpoint from #270
  already exists) when there's no engine. The Mixed sections then render in both.
- **Tracked:** HYP-427 (read). Write endpoint already built (#270 server layer is reusable).
- **Verify:** select ≥2 elements → Mixed sections + batch edit in BOTH surfaces.

## E — resize snap + spacing-guides (HYP-405/HYP-402, draft #257)

- **Now:** `spacing-guides` (`calculateSpacingGuides`/`renderSpacingGuides`) + 4px snap
  salvaged but **unwired** — no live consumer. Resize in main lives in the extension
  overlay layer (`overlay-renderer` + `useCanvasInteraction`); SaaS disables handles.
- **Adapter-first:** wire spacing-guides into the **shared** overlay path both surfaces
  use during drag/resize (`shared/canvas-interaction/overlay-renderer.ts`), driven by
  platform events, with the zoom/offset model that renderer already has. Snap-to-grid
  opt-in is consumed by the shared `computeResizeStyles` caller. This is the largest
  unknown — resize is currently extension-only; confirm SaaS will also expose resize, or
  scope spacing-guides to wherever resize actually runs.
- **Open question for review:** does SaaS get resize handles at all? If resize stays
  extension-only, spacing-guides belongs in the extension overlay path, and the "shared"
  framing for E is narrower than C/D/G.

---

## Sequencing

1. C and D are the cleanest adapter-first moves (no new server work) — do first.
2. G read via adapter (HYP-427) — write layer already exists.
3. E — resolve the resize-surface open question before wiring.

Each lands as its own PR replacing the SaaS-only draft (close the draft or convert it).
Per framework: this spec reviewed → per-feature TDD impl → visual proof in BOTH surfaces
→ codex+advisor → /commit → PR.

## Do NOT

- Merge the SaaS-only drafts (#260/#258/#270/#257) as-is.
- Mount feature UI in `client/pages/Editor/CanvasEditor.tsx` expecting it in the extension.
- Gate feature logic on a raw `engine` — go through the adapter.
