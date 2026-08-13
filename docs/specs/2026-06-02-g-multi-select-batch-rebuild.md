> **ARCHIVED** — historical build plan, superseded by the master styles spec + its migration (Part 14).

# Feature G — Multi-Select Batch Style Editing — Rebuild Spec

**Date:** 2026-06-02
**Linear:** HYP-271 (merged styles + batch write), HYP-301 (transport-error revert baseline)
**Status:** AWAITING CTO REVIEW. A draft implementation PR is being prepared in
parallel (`HYP-271-multi-select-batch`) as the concrete review artifact — it will
NOT be merged until this spec is approved.
**Source:** Phase 1 branch `HYP-phase1-visual-foundation`.

---

## What this feature is

Select multiple elements in the canvas, edit their shared styles at once. Inputs
that differ across the selection show a **"Mixed"** placeholder; editing one
applies the same value to every selected element in a single undo step.

---

## Why this one is mostly already here (≈70%)

Unlike feature F, G's Phase 1 dependency on `data-uniq-id` is **superficial** — the
real element lookup is nodeRef via `resolveElement`/`NodeMapService`, which main
has. And main already plumbs multi-selection through the inspector:

- `useSelectionCompat()` returns `selectedIds: string[]` from engine + shared state.
- `selectedIds` is already threaded into `useStyleSync`.
- `RightSidebar` already detects `selectedIds.length > 1` and renders a
  "Select a single element to edit properties" placeholder.
- State selector for multi-select already merged.

**Missing:** the batch *execution* path + the backend endpoint + the multi-select
inspector UI. Phase 1's `useBatchStyleData` (`mergeStyleData`/`MIXED`) and
`ASTBatchStyleOperation` are substrate-agnostic, drop-in.

---

## Proposed implementation (4 interdependent layers — ship as one feature)

A single layer in isolation is dead code (no trigger / no caller), so this lands
as one cohesive feature, not four separate merges.

1. **Server** — `server/routes/updateComponentStylesBatch.ts`: apply the same
   styles to each element in `updates[]`, one AST write per file, per-element
   results. Adapt Phase 1's `findElementByUuid` → `resolveElement({ nodeRef, ast })`.
   Mirror the **current** `updateComponentStyles.ts` project/security pattern; once
   HYP-401/#255 lands, inherit its `validateFilePath` + `checkedProject` guard.
   Register with the same middleware chain. + route test.
2. **Operation** — `ASTBatchStyleOperation` + `CanvasEngine.executeBatchStyles()`,
   following the existing `ASTStyleOperation`/`BatchDeleteOperation` pattern
   (undo/redo via file snapshots).
3. **Hook** — `useStyleSync.flushQueue`: a batch branch
   `if (selectedIds.length > 1 && engine) { executeBatchStyles(...); finishSync(); return; }`.
   Single-select path untouched. Clear `engine.fastPatch` if present (now exists
   via the FastPatch rebuild PR #260).
4. **UI** — `RightSidebar`: `useBatchStyleData` (`mergeStyleData`/`MIXED`) +
   replace the placeholder with the real inspector sections, showing "Mixed" for
   differing values; disable the text-content input for multi-select.
   **Additive only** — must not clobber the i18n inspector, `StyleSourceTabs`, or
   `AppearanceSection` that main added after Phase 1 (the Phase 1 RightSidebar is
   ~260 LOC divergent; cherry-pick the merge logic into main's structure, do not
   port the whole file).

**Estimate:** ~4.5h, ~650 LOC, no architectural unknowns.

---

## Decisions / notes for review
- **VS Code parity deferred — VERIFIED behaviour (HYP-427):** the batch path AND
  the multi-select *read* (`multiSelectMerged`) both depend on the synchronous
  browser `CanvasEngine`, which the VS Code webview doesn't have (`RightPanelApp`
  has no `CanvasEngineProvider`). Visual verification (launchVSCode against the G
  worktree) confirmed: in the extension, selecting ≥2 elements shows
  **"N elements selected / Multi-select editing is unavailable for this
  selection"** — the Mixed sections do NOT render (not "Mixed but disabled" as an
  earlier draft of this spec wrongly stated). Screenshots:
  `/tmp/hyp271-visual/{before-single,after-multi}.png`. For shared-first parity the
  read must go through the platform adapter (RPC / shared-editor-state batch read)
  — tracked in **HYP-427**. So PR #270 delivers multi-select in **SaaS only**.
- **Props batch** (Tamagui `writeMode==='props'`): main already has
  `updateComponentPropsBatch`; the hook should route props edits there. Confirm.
- **Visual verification:** SaaS screenshots still pending; VS Code behaviour
  verified (unavailable, per above).

---

## Risks
- RightSidebar drift (i18n/StyleSourceTabs/Appearance) — mitigated by additive
  cherry-pick + keeping the single-select render path intact.
- Undo/redo: `ASTBatchStyleOperation` follows the existing snapshot contract; mirror
  its tests.
- Regression safety: single-select path must be byte-for-byte unchanged.
