# HYP-369 — PreviewPanel component-selection FSM

**Date:** 2026-06-03
**Author:** Alex Ultra + Claude
**Status:** Draft
**Linear:** HYP-369

## Context

`PreviewPanel` (the VS Code extension host class that owns the Hyper Canvas
webview) tracks "which component the preview is showing" across a spread of
seven independent fields plus the shared `StateHub`:

- `vscode-extension/hypercanvas-preview/src/PreviewPanel.ts:64` `_navigableComponent`
- `:74` `_previewComponent`
- `:75` `_requiresPreviewRegeneration`
- `:76` `_defaultComponent`
- `:103`/`:146` `_devServerRunning`
- `:140` `_currentComponent`
- `StateHub.state.currentComponent` (the cross-panel source of truth)

These are mutated independently from at least nine call sites
(`createOrShow` :186, `restorePanel` :246, `_setupPanel` :257, `onDidDispose`
:323, `setWorkspaceRoot` :136, `_initializeComponent` :1144,
`_updateComponentFromEditor` :1269, `_setCurrentComponent` :1285,
`setComponentParam` :1432, `dispose` :1415). Each mutation carries a
hand-written guard to avoid re-entrancy and feedback loops, e.g.:

- `_initializeComponent` (`:1144-1178`) has three early-return branches to
  decide whether to re-derive from the editor, adopt `StateHub` intent, or
  re-push existing state — and an explicit comment that it must NOT call
  `_setCurrentComponent` to avoid re-triggering `onChange` listeners.
- `_setCurrentComponent` (`:1285-1304`) compares both `_currentComponent` and
  `StateHub.state.currentComponent` before emitting `applyUpdate`, again to
  break a loop.
- `_pushFullStateToWebview` (`:1189-1216`) gates the `setComponent` message on
  `_navigableComponent === _currentComponent` — the "navigability" invariant
  that lives only as a derived boolean (`canNavigateCurrentComponent` :1208).
- The `StateHub.onChange` listener in `_setupPanel` (`:308-318`) writes back
  into `_currentComponent`/`_navigableComponent`, closing the loop the guards
  exist to prevent.

The three commits the ticket cites — `94077019` ("keep preview webview
visible"), `e514c6f1` ("resolve selection navigation by source location"),
`f33e5ff0` ("keep preview iframe on selected component") — are all tagged
**HYP-363** and all patch this same component-lifecycle tangle. `f33e5ff0`
alone added `_resolveComponentPath`/`_resolveComponentEditor` and the
`_setCurrentComponent` extraction (PreviewPanel.ts +79/-26). Each fix added a
new guard or a new field rather than a state model — the classic per-symptom
accretion.

The goal: replace the ad-hoc shadow state with one explicit, testable
lifecycle so the "navigable", "needs-regeneration", and "devserver-running"
conditions become named states/transitions instead of scattered booleans.

## Reality check — assumed vs actual

| Ticket assumes                                              | Actual code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One subsystem: "currentComponent/selection state"           | **Two unrelated subsystems.** Component selection (which file the iframe renders) lives in `PreviewPanel.ts`. Element selection (`selectedIds`, the highlighted node) lives in the client/iframe layer and `StateHub`.                                                                                                                                                                                                                                                                                                                                             |
| The 3 commits fixed "selection"                             | All 3 are HYP-363 and touch **only** `_currentComponent` lifecycle. `git show` confirms none touch `selectedIds`.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| FSM shape is `idle → selecting → selected → disposing`      | There is no async "selecting" phase for component selection (`_setCurrentComponent` is synchronous). The real axes are: panel attached?, devserver running?, component navigable (registry-ready)?, regeneration pending? The right model is a small product of those, not a linear 4-state path.                                                                                                                                                                                                                                                                  |
| Element-selection logic is "per-symptom patches" to replace | Element selection already has **deliberate, tested** machines: `mergeInitState` (`client/lib/platform/shared-editor-state.ts:50`), `selection-freeze` cache (`shared/canvas-interaction/selection-freeze.ts`, with `.test.ts`), `TracingSyncStateMachine` (`client/lib/element-tracing/sync-state-machine.ts`, with `.test.ts`), and grace-cache rect replay (`shared/element-tracing/fiber-source-index.ts:199`). These shipped under the selection-survives-i18n-write plan (`docs/plans/2026-05-06-selection-survives-i18n-write.md`). They are not the target. |
| A `disposing` state is needed                               | Disposal is already a clean teardown in `onDidDispose` (`:323-339`) that nulls `_panel` and disposes child services. The bug class is not "disposing" — it is the _resurrection_ path (`_requiresPreviewRegeneration` + re-`createOrShow`), where shadow state must be re-derived correctly. The FSM should model "detached-but-state-retained" vs "fresh", which is where `_requiresPreviewRegeneration` and the `_initializeComponent` branching actually live.                                                                                                  |

**Conclusion: the epic is mis-scoped and must be split.** Folding element
selection into this ticket would mean rewriting four already-tested subsystems
to chase a problem that does not exist there. The defensible, code-grounded
work is consolidating `PreviewPanel`'s component-lifecycle shadow fields into
one explicit machine. Element selection gets, at most, a separate audit
ticket — not a rewrite.

## Scope / Decomposition

### Sub-ticket A — Extract a `PreviewComponentState` value object (no behavior change)

Collapse the four component-identity fields into one immutable record so every
read/write goes through one place. This is pure refactor; behavior must be
byte-identical.

- **Key files:** `vscode-extension/hypercanvas-preview/src/PreviewPanel.ts`
  (fields `:64,:74,:75,:76,:140`; consumers `_setCurrentComponent` :1285,
  `setComponentParam` :1432, `_updatePreviewUrl` :1309, `_pushFullStateToWebview`
  :1189). New file `src/PreviewComponentState.ts`.
- **State shape:** `{ repoPath?: string; previewPath?: string; navigable: boolean; needsRegeneration: boolean }` — `repoPath` = old `_currentComponent`, `previewPath` = old `_previewComponent`, `navigable` replaces the `_navigableComponent === _currentComponent` derived check, `needsRegeneration` replaces `_requiresPreviewRegeneration`.
- **Acceptance (TDD):** new `PreviewComponentState.test.ts` covers the derived
  `navigable` invariant (was line 1208) and `needsRegeneration` reset rules
  (were lines 1147, 1166, 1436). Existing `PreviewPanel.test.ts` and
  `usePreviewBridge.test.ts` stay green unchanged. `bun run test` for
  `vscode-extension` scope passes.

### Sub-ticket B — Introduce the explicit lifecycle FSM

Model the panel/devserver/component readiness as named states and route all
transitions through one reducer. Concrete states grounded in current code:

- `Detached` — `_panel === undefined` (post-dispose or pre-first-show).
  `_requiresPreviewRegeneration` true after a `dispose()` (`:1418`).
- `Attached_NoComponent` — panel exists, no `repoPath` resolved yet
  (`_updatePreviewUrl` → `showNoComponentHint`, `:1318-1321`).
- `Attached_ComponentPending` — component chosen but iframe not yet navigable
  (`navigable === false`; `setComponent` message withheld, `:1209`,
  `:1324-1326`). This is the state the HYP-363 guards were protecting by hand.
- `Attached_Live` — devserver running + component navigable; iframe URL is
  driven by `_updatePreviewUrl` (`:1309-1340`).

Transitions: `createOrShow`/`restorePanel` (→Attached), `onDidDispose`
(→Detached, retain component record), `setComponentParam` (Pending→Live once
navigable), `devserver:statusChanged` (`_devServerRunning` flips at `:1347`/`:1363`),
`setWorkspaceRoot` (full reset, `:136-164`).

- **Key files:** `PreviewPanel.ts` (all nine call sites above);
  `StateHub.ts` (the `currentComponent` round-trip at `:308-318`). New
  `src/PreviewLifecycle.ts` (pure reducer) + test.
- **Acceptance (TDD):** `PreviewLifecycle.test.ts` asserts each transition,
  especially the resurrection path: `Attached_Live → dispose → Detached →
createOrShow` must restore the same `repoPath` and re-emit `setComponent`
  exactly once (regression test for `f33e5ff0`). The `StateHub.onChange`
  feedback loop (`:308`) must NOT re-fire `applyUpdate` for a no-op change
  (regression for the guard at `:1296`).

### Sub-ticket C (audit-only, low priority) — Element-selection state inventory

Do NOT rewrite. Produce a one-page map of the four existing element-selection
subsystems (`mergeInitState`, `selection-freeze`, `TracingSyncStateMachine`,
grace-cache) and confirm whether any genuine per-symptom patch remains
un-consolidated. Only if the audit surfaces a real duplicated guard does a
follow-up ticket get filed.

- **Key files (read-only):** `client/lib/platform/shared-editor-state.ts:50`,
  `shared/canvas-interaction/selection-freeze.ts`,
  `client/lib/element-tracing/sync-state-machine.ts`,
  `shared/element-tracing/fiber-source-index.ts:199`.
- **Acceptance:** a markdown inventory in `docs/specs/`; no code change.

## Risks & prerequisites

- **Shared-code touch.** `StateHub.ts` is the cross-panel source of truth read
  by Left/Right panels and the iframe. The `onChange` feedback loop at
  PreviewPanel.ts:308-318 is the riskiest seam — changing emission semantics
  can ripple into Inspector sync. Per repo rule, ask before changing
  `StateHub` broadcast behavior; prefer keeping `StateHub` untouched and
  consolidating only the PreviewPanel-side shadow fields (A before B).
- **Ordering.** A (value object, no behavior change) must land and bake before
  B (FSM). B must not start until A's tests pin the current `navigable` /
  `needsRegeneration` semantics, otherwise the FSM will encode an
  accidentally-different behavior.
- **Monorepo path coupling.** `setComponentParam` carries the repo-relative vs
  preview-relative path distinction and `deriveSubProjectPrefix` (`:1444`,
  HYP-430/435). The FSM must keep `repoPath`/`previewPath` distinct — collapsing
  them would reintroduce the sub-project suffix-collision bug.
- **No e2e infra change.** `ext-test-projects/` e2e must pass unchanged; this is
  a host-side refactor with no new UI. Visual proof per development.md Этап 4
  still required (component switching, dispose+reopen survive).

## Out of scope

- Any rewrite of element-selection (`selectedIds`) survival logic —
  `mergeInitState`, `selection-freeze`, `TracingSyncStateMachine`, grace-cache.
  These are deliberate and tested; the ticket's framing of them as
  "per-symptom patches" is incorrect.
- Changing `StateHub` broadcast/diff semantics.
- The `_waitForSelectedIds` 500ms race helper (`:1471`) and the element AST
  commands (`deleteSelected`, `duplicateSelected`, etc., `:1497+`) — those are
  element-selection, not component-selection.
- Devserver lifecycle FSM — that is HYP-370, a separate Linear ticket.
