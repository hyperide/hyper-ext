# Cross-realm webview bridge — wiring SaaS-only features into the VS Code extension

**Ticket:** HYP-535. **Covers:** #258 NudgeHUD, #270 multi-select batch, #260 FastPatch.
**Status:** design (Этап 0 per docs/rules/development.md). TDD + per-feature visual proof + CTO
acceptance required before each merge.

## 1. Problem — one root cause, three symptoms

The SaaS editor runs in a **single JS realm**: `client/pages/Editor/CanvasEditor.tsx` mounts
the canvas, the inspector (`RightSidebar`), and overlays in one React tree, so a module-level
store (`zustand`) and a single `CanvasEngine` instance are shared by everyone.

The VS Code extension does **not**. It splits the UI across **separate webviews**, each its own
JS realm / bundle:

- `webview-preview-panel` (`PreviewPanelApp`) — the canvas + preview iframe.
- `webview-right` (`RightPanelApp`) — the inspector (`RightSidebar`).

There is **no shared module state** between them. The only sanctioned cross-realm channel is the
host-side **`StateHub`** (`vscode-extension/.../StateHub.ts`): it owns `SharedEditorState`, and on
any panel's `state:update` it merges the patch and **broadcasts to all panels**. It also exposes
`broadcast(message)` for transient cross-panel signals that should NOT live in `SharedEditorState`
(already used for `element-tracing:*`).

Three "salvage" PRs were authored against the SaaS single-realm assumption and are therefore
**dead in the extension** (verified by Docker e2e, primary source):

| PR   | Feature            | Why it's dead in the extension                                                                                                                                                                                                                                                         |
| ---- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #258 | NudgeHUD           | `nudgeStore` is a module-level singleton; `<NudgeHUD>` is mounted only in SaaS `CanvasEditor`. esbuild tree-shakes it out of all 5 webview bundles. Even if mounted, inspector & canvas realms hold **separate** store instances → no sync.                                            |
| #270 | multi-select batch | `webview-right` has no `CanvasEngineProvider` → `useCanvasEngineOptional()` is null → batch UI is engine-gated off ("Multi-select editing is unavailable"). `useStyleSync` batch branch is `if (engine) {…}` with **no RPC `else`** (single-select has one — that's why single works). |
| #260 | FastPatch          | `engine.fastPatch` is reachable from `webview-right` (RightSidebar→useStyleSync) but it mutates the **canvas iframe DOM**, which lives in a different webview realm → cross-realm DOM write no-ops.                                                                                    |

## 2. "Так не надо" — anti-patterns to call out (and not repeat)

1. **Module-level cross-surface singleton.** `export const nudgeStore = create(...)` (nudgeStore.ts)
   directly imported and mutated by `numeric-input.tsx` / `NudgeHUD.tsx`. A singleton encodes
   "there is exactly one JS realm" — false in a multi-webview product. Cross-surface state must
   flow through a transport seam (the platform adapter), not a shared module.
2. **Direct store import in components = no DI.** Components import `nudgeStore` concretely instead
   of receiving a capability through the platform layer. Untestable across realms, impossible to
   swap transports.
3. **Half-wired feature gated on a missing dependency.** #270's `useStyleSync` batch branch is
   `if (selectedIds.length > 1 && engine)` with no `else`, plus an author comment "SaaS only — VS
   Code … not wired yet". Landing a branch that silently no-ops on one platform — with a comment
   admitting it — instead of an adapter method that both platforms implement. The comment is the
   tell: if you're writing "X only / not wired on Y", you owe an interface, not a dead branch.
4. **Platform-specific mount point.** `<NudgeHUD>` mounted only in SaaS `CanvasEditor` rather than a
   shared surface both platforms render. Mounting decisions leaked into one platform's tree.

## 3. Design — one reusable seam over StateHub + the platform adapter

Reuse, don't invent. Two existing mechanisms cover everything:

- **Durable cross-realm state** → `SharedEditorState` synced by `StateHub.applyUpdate` (merge +
  broadcast). Use for state that any panel must read consistently (nudge HUD state, multi-select
  merged-style snapshot).
- **Transient cross-realm signal** → `StateHub.broadcast(message)`. Use for fire-and-forget events
  with no durable state (a fast-patch DOM instruction destined for the canvas realm).
- **Request/response to host capability (engine/AST)** → the existing `astOps` RPC on the platform
  `CanvasAdapter` (single-select style writes already use it). Extend with `updateStylesBatch`.

The **DI seam is the platform `CanvasAdapter`** (`client/lib/platform/*Adapter.ts`, injected via
`PlatformContext`). Client components depend on a capability INTERFACE; the Browser adapter backs it
in-process, the VS Code adapter backs it via StateHub messages / RPC. Same component code, two
realizations.

### 3a. NudgeHUD (#258) — **OPEN DECISION D1: which realm renders the HUD?**

The HUD's trigger (the numeric input) lives in the **inspector realm** (`webview-right`), and the
HUD shows the Alt/Shift step config **for that input**. So the realm question decides how much
machinery #258 needs:

- **D1-A (recommended): render the HUD in the inspector realm (`RightPanelApp`).** Then it shares
  the trigger's realm — `nudgeStore` works as-is within that single webview, and #258 collapses to
  "mount `<NudgeHUD>` in `RightPanelApp` + keep the store local to that realm." **No
  SharedEditorState slice, no broadcast, no cross-realm machinery.** Arguably more correct (the HUD
  is about the field being edited, which is in the inspector). Still fix the anti-pattern: components
  read via a `NudgeStatePort` (Browser & VS Code both back it with the in-realm store), not a direct
  `import { nudgeStore }`.
- **D1-B: the HUD must visually overlay the CANVAS** (spans beyond the inspector panel). Only then do
  we need the cross-realm seam: a `NudgeStatePort` whose VS Code adapter syncs state across realms.
  In that case **split by frequency to avoid a broadcast storm** (advisor): durable config
  (`visible`, `mode`, `altStep`, `shiftStep`, `highlightedTarget`) → a `nudge` slice of
  `SharedEditorState` via `StateHub.applyUpdate`; the high-frequency `currentValue` (fires on every
  keystroke/nudge) → a point-to-point `StateHub.broadcast`, NOT merged shared state. Persisted step
  prefs (`_savedSteps`) move host-side (workspaceState), not per-webview localStorage.

In both cases the numeric input calls `nudge.show(...)` on the port, never `nudgeStore.show(...)`.
**Resolve D1 before building** — D1-A deletes ~⅔ of #258's work.

### 3b. Multi-select (#270) — **GENERALIZE the unified style engine, do NOT build a separate batch system** (CTO 2026-06-04)

CTO directive: a multi-selection is **not a second styling subsystem** — it is the N>1 case of the
ONE unified style engine the project already has. We have a deep, framework-aware, SaaS/ext-shared
read/write stack (`lib/style-read/` `StyleReadManager.read(ctx) → StyleReadResult`; `lib/style-write/`
`StyleWriteManager.plan(...) → StyleWritePlan` + `execute(plan) → StyleWriteResult`; per-framework
`lib/style-adapters/{tailwind-v4,tamagui,css-modules,inline-style,...}`). Both managers are already
**per-`elementRef`**. Multi-select must reuse them, not parallel them.

- **READ (the merge layer):** run the SAME `StyleReadManager.read` per selected `elementRef`, then
  **merge the N `StyleReadResult`s** into one of the same shape — per `PropertySource.property`, the
  value if all N agree (same value + same `sourceTabId`), else a `mixed` marker. The inspector renders
  the identical `StyleReadResult` interface for N=1 and N>1 (N=1 = degenerate merge). This is the only
  new code: a `mergeStyleReadResults(results: StyleReadResult[]): StyleReadResult` (+ a `mixed` flag on
  `PropertySource`). It inherits framework/condition/theme awareness for free.
  - **Reject** the #270 PR's `multiSelectMerged` snapshot AND the runtime-computed-DOM merge: the
    inspector edits the framework-aware **source** read (`StyleReadManager`/`sourceTabs`/`PropertySource`),
    not the runtime computed style (`selectedElementRuntimeStyle` is a display hint, a different read).
    Merging runtime values would lose source/sourceTab identity needed to WRITE.
- **WRITE (the batch):** **delete** the #270 `ASTBatchStyleOperation`/`updateComponentStylesBatch`
  parallel path. A batch = build the SAME `StyleWriteManager.plan(...)` per `elementRef` and `execute`
  each (or one executor that runs N plans transactionally). All framework/condition/theme correctness
  is reused; "batch" adds only fan-out + a single undo grouping.
- **D2 reframed (was "where does the merged read come from"):** it's wherever single-select's
  `StyleReadManager` read already runs (that read is source/AST/config-based → host-side, not the
  canvas DOM). For N>1, run it per element in that same place and merge. So D2 is **not** a new channel
  (neither `multiSelectMerged` nor `readMergedStyles`) — it's "call the existing read N times + merge",
  transported the same way the single read's `StyleReadResult` already reaches the inspector.
  **TODO (deeper study, the user's "изучи детальнее"):** trace exactly how a single element's
  `StyleReadResult` reaches the ext inspector today (host-computed → which message? cached where?), then
  the merge slots into that same transport. Read `2026-04-14-style-write-unification-plan.md` and
  `2026-04-03-inspector-visual-hierarchy-design.md` before implementing.

### 3c. FastPatch (#260) — broadcast a patch instruction to the canvas realm

- FastPatch's value is instant preview DOM updates without a round-trip. In the extension the
  inspector can't touch the canvas DOM, so the inspector adapter **broadcasts** a
  `fastpatch:apply` message (selector + style delta) via `StateHub.broadcast`; the canvas webview
  subscribes and applies the patch to its iframe locally (the realm that owns the DOM).
- Browser adapter keeps the direct in-process `engine.fastPatch.applyPatch` path.
- Define `interface FastPatchPort { apply(patch) }`; Browser = direct, VS Code = broadcast→canvas.

## 4. What goes in AGENTS.md (currently undocumented)

A new "Webview realms & cross-realm state" subsection under Architecture Context, stating:

- The extension splits UI into separate webview realms (preview-panel, right) — **no shared module
  state**; SaaS is single-realm. A feature that works in SaaS is NOT automatically functional in the
  extension.
- Cross-realm state → `SharedEditorState` via `StateHub.applyUpdate`. Transient cross-realm signal →
  `StateHub.broadcast`. Host capability (engine/AST) → `astOps` RPC on `CanvasAdapter`.
- **Rule:** never put cross-surface state in a module-level singleton; route it through the platform
  adapter. If you write "X only / not wired on VS Code", you owe an adapter method, not a dead branch.
- Verify extension-functionality with the DOCKER e2e harness (local launchVSCode is the wrong proof
  and currently broken), not by grepping for code references (which gives false "wired" positives —
  this is exactly how #258/#260/#270 were mis-assessed as "still-relevant").

## 5. Sequencing (TDD per docs/rules, one feature per PR)

1. **Shared seam first**: `NudgeStatePort`/`FastPatchPort`/`updateStylesBatch` interfaces +
   Browser adapter impls (in-process, behavior-preserving) + VS Code adapter impls (StateHub/RPC) +
   the `nudge` slice on `SharedEditorState`. Unit tests for each adapter (red→green).
2. **#270 batch** (lowest visual risk; assertable via source-level batch write) → Docker e2e proof.
3. **#258 NudgeHUD** → Docker e2e proof (inspector input → HUD visible across realms).
4. **#260 FastPatch** → Docker e2e proof (style edit → instant canvas DOM change).

Each: TDD red-first, knip, advisor()+codex, `/commit`, Docker visual proof series → CTO TG accept →
`gh ship --skip-ci`. The existing PRs (#258/#260/#270) are superseded by this wiring; close them
referencing HYP-535, or repurpose one branch as the carrier.
