# HYP-369 Sub-ticket C — Element-selection state inventory (audit)

**Date:** 2026-06-03
**Author:** Alex Ultra + Claude
**Status:** Audit complete
**Parent:** HYP-369 · **This ticket:** HYP-504
**Scope:** AUDIT ONLY. No code changed. Every claim is grounded in file:line on
`origin/main` (`412baade`).

## Why this audit exists

The parent spec
(`docs/specs/2026-06-03-hyp369-preview-selection-fsm-design.md:122-134`)
asked: are the four element-selection subsystems a pile of un-consolidated
per-symptom patches that the FSM work should fold together, or are they
deliberate and non-overlapping? The instruction was explicit: **do not
rewrite**, only inventory, and file a follow-up _only if_ a genuine
duplicated/un-consolidated guard remains.

## The four subsystems

### 1. `mergeInitState` — `client/lib/platform/shared-editor-state.ts:50-64`

- **Owns:** the merge rule applied when a `state:init` snapshot arrives from
  the extension host (initial load + HMR full-reload), `:98-101`.
- **States/transitions:** none — it is a pure function `(incoming, local) →
merged`. One branch (`:54-61`): if local has a non-empty selection and the
  incoming snapshot has an empty one, keep `local.selectedIds` +
  `local.selectedItemIndices`; otherwise take `incoming` wholesale (`:63`).
- **Guards:** "an incoming EMPTY selection never wipes a non-empty local one"
  (`:42-44` docblock). Protects against the host broadcasting the pre-action
  default `selectedIds: []` _after_ the user's own selection already landed in
  the local store, which would clear the rect for one frame.
- **Layer:** client/iframe Zustand store. Cross-panel, cross-platform
  (browser + VS Code). Fires once per reconnect.

### 2. `selection-freeze` — `shared/canvas-interaction/selection-freeze.ts`

- **Owns:** a small in-iframe cache (`SelectionFreezeCache`, `:18-23`) that
  retains the last live _selection_ rect and replays it into `overlayRects`
  while an i18n write window is open and the live resolver finds no DOM match.
- **States/transitions:** none formal — a 2-field cache (`frozenId`,
  `frozenRects`) mutated by `applySelectionFreeze` (`:73-93`):
  - live selection rects present → refresh cache, return unchanged (`:78-82`);
  - none live **and** `writeInProgress` **and** non-empty cache → absorb a
    Path-A id remap (`cache.frozenId = currentSelectionId`, `:88`) and push the
    cached rect (`:89`);
  - `clearSelectionFreezeCache` (`:34-37`) resets when the write window closes.
- **Guards:** the i18n-write flicker window (Path B of the selection-survives
  plan, `docs/plans/2026-05-06-selection-survives-i18n-write.md`). Its
  distinctive job is absorbing the **Path-A id remap** — `selectedIds[0]` flips
  OLD→NEW mid-write before HMR repaints (`:60-68` docblock).
- **Layer:** authored as a `shared/` module so it could be unit-tested
  (`selection-freeze.test.ts`, 9 cases). **See the finding below — it has no
  production consumer on `origin/main`.**

### 3. `TracingSyncStateMachine` — `client/lib/element-tracing/sync-state-machine.ts:20-105`

- **Owns:** click availability during the HMR↔map-update race. The only true
  FSM of the four.
- **States/transitions:** `synced → awaiting-both` on `fileChanged` (`:36-40`);
  `awaiting-both → awaiting-hmr` / `awaiting-map` depending on which signal
  lands first (`:42-56`); either → `synced` once both arrive
  (`syncCompleted`, `:76-80`); a `timeoutMs` (default 3000) force-syncs
  (`:90-97`). Clicks during a non-`synced` state are queued (`:58-64`) and
  replayed FIFO on sync (`:82-88`). Fully covered by
  `sync-state-machine.test.ts` (12 cases).
- **Guards:** prevents a click from resolving against a stale source→DOM map
  while a file edit's HMR commit and the new node map are still in flight.
- **Layer:** client `ElementTracer`. Orthogonal to rect painting — it gates
  _click resolution_, not _overlay geometry_.

### 4. grace-cache — live impl `vscode-extension/hypercanvas-preview/src/services/scripts/selection-grace-cache.ts`

The parent spec cites `shared/element-tracing/fiber-source-index.ts:199` as
"grace-cache rect replay." That line is only a **comment** — the last rung of
the resolver ladder (`findClosestSourceDOMElements`, `:200-249`) returns `[]`
"and lets grace-cache replay the old rect" (`:196-199`). The actual grace-cache
is `selection-grace-cache.ts`.

- **Owns:** keeping the selection overlay visible during the window between a
  React commit (HMR after an i18n/AST change) and the moment `FiberSourceIndex`
  is rebuilt against the new fiber tree (`:1-16` docblock).
- **States/transitions:** none formal — two `Map`s keyed by `elementId`
  (`rectsByElementId`, `deadlineByElementId`, `:40-43`). `applySelectionGraceCache`
  (`:270-338`) runs each overlay frame: (1) evict ids no longer in `selectedIds`
  (`:273-285`); (2) snapshot every fresh visible selection rect + reset its
  deadline `now + gracePeriodMs` (`:287-307`); (3) for a selected id with no
  fresh rect, replay the cached snapshot if before deadline, else prune
  (`:309-335`). Plus `clearGraceCacheForElement` (`:97-101`) and
  `invalidateSelectionGraceCacheForFile` (`:120+`) for post-write/post-AST
  invalidation, and serialize/hydrate across full-reload (`:157+`, `:199+`).
- **Guards:** the post-HMR / post-reload flicker window. Keyed by `selectedIds`
  with explicit deadlines + per-`.map()`-item-index restore (`:36`, `:293`).
- **Layer:** extension-host iframe IIFE — wired into `iframe-interaction.ts`
  (`:46-52`, `:2119`, `:2255`).

## Duplicated-guard check

Three of the four are unambiguously **deliberate and non-overlapping**:

| Subsystem                 | Layer           | Triggers on                          | Protects                                           |
| ------------------------- | --------------- | ------------------------------------ | -------------------------------------------------- |
| `mergeInitState`          | client store    | `state:init` reconnect               | empty host snapshot wiping local selectedIds       |
| `TracingSyncStateMachine` | client tracer   | file change + HMR/map race           | click resolving against a stale node map           |
| grace-cache               | ext iframe IIFE | every overlay frame, post-HMR/reload | selection rect blanking until fiber index rebuilds |

They act at different layers, key off different inputs, and one (the FSM) gates
clicks while the others gate rect painting. No live duplication. The FSM work
(Sub-tickets A/B) correctly leaves them alone.

The fourth — `selection-freeze` — and grace-cache _do_ overlap conceptually:
both replay a cached `type:'selection'` rect into `overlayRects` when no live
selection rect is present during a write/reload window. That is exactly the
overlap this audit was told to look for. But it is **not a live duplication**,
because only one of them runs.

## Finding: `selection-freeze` is an orphaned module superseded by grace-cache

On `origin/main` HEAD, `applySelectionFreeze` / `createSelectionFreezeCache` /
`SelectionFreezeCache` are referenced by **exactly one file — their own test**
(`shared/canvas-interaction/selection-freeze.test.ts`). Zero production callers.
`iframe-interaction.ts` imports and runs the grace-cache family instead
(`applySelectionGraceCache` import `:46`, callsite `:2255`; plus
`makeSelectionGraceCacheState` `:2119`, `invalidateSelectionGraceCacheForFile`,
`clearGraceCacheForElement`, serialize/hydrate — 26 `GraceCache` references in
that one file). Verified by repo-wide grep.

Git history explains it (orphaned-by-migration, not abandoned-on-purpose):

- `4e335f0f` — "Path B — freeze selection rect during i18n write window":
  freeze logic shipped **inline** in `iframe-interaction.ts`.
- `7e0295b1` (May 6, 13:10) — "Task 5 — extract selection freeze + unit tests":
  pulled the inline logic into `shared/canvas-interaction/selection-freeze.ts`
  **and** kept it wired (`applySelectionFreeze` callsite + import in
  `iframe-interaction.ts`, freeze_callsites=2).
- `36c69568` (May 6, 13:45, 35 min later) — "HMR source-cache rebuild +
  selection-rect grace cache (selsurv Task 3)": introduced the grace-cache as a
  more general replacement (deadlines, `.map()`-item-index restore,
  serialize/hydrate across reload). The freeze callsite did **not** survive into
  the grace-cache-based overlay block (freeze_callsites=0 at `36c69568`).

So the freeze module was extracted _for testability_ and then immediately
out-evolved by the grace-cache in a parallel commit on the same plan. The
module + its 11-case test were left behind. Its test still passes — it exercises
the module against itself with no production wiring — which is precisely why CI
never flagged it.

### Does grace-cache cover what freeze covered? (Path-A id remap)

`selection-freeze`'s distinctive job was absorbing the **Path-A id remap**:
`selectedIds[0]` flips OLD→NEW mid-write, and freeze repainted under the new id
(`selection-freeze.ts:60-68`, `:84-90`). grace-cache step 1 _prunes_ any id not
in `selectedIds` (`selection-grace-cache.ts:273-285`), so on a remap it drops
OLD's snapshot and has nothing cached under NEW — on its face it does **not**
replicate freeze's in-iframe absorption.

That niche moved **up to the i18n write handler in the inspector**: after
`astOps.writeI18nResource` resolves, the bridge returns the canonical
post-write id (`AstBridge.ts:682,712-713,720` `newElementId`) and
`RightSidebar.tsx:821-826` re-attaches selection with a single dispatch —
`const targetId = writeResult.newElementId ?? previousSelectedId;
i18nDispatch({ selectedIds: [targetId] })` — where `i18nDispatch` is a
`createSharedDispatch(canvas)` (`RightSidebar.tsx:739`,
`shared-editor-state.ts:145-153`) that updates the local store and broadcasts
`state:update` to all panels. The remap is now resolved by re-keying selection
state from the write handler, not by in-iframe rect absorption.

(Note: the same handler still _brackets_ the write with the Path-B freeze
signal — `iframe:writeI18nResource` `phase:'start'`/`'done'`,
`RightSidebar.tsx:804,841`, comment `:802-803` — but that signal now only
gates the **grace-cache** in `iframe-interaction.ts`; the `selection-freeze`
module it was originally written for is no longer on the receiving end. The
`PreviewPanel.ts` `result.newId` re-selects at `:618-619,1044-1047,1110-1112,
1655-1656` are the _duplicate / paste / keyboard-duplicate_ handlers — a
different selection-reattach path, not the i18n Path-A remap.)

**Whether grace-cache then paints the rect continuously across the remap
frame** (OLD pruned, NEW not yet cached) is a timing nuance that cannot be
proven by static reading. The audit does **not** assert "safe to delete."
Conservative conclusion: freeze is orphaned; its Path-A coverage appears
relocated to the inspector's i18n write handler (`RightSidebar.tsx:821-826`
re-keying selection via `createSharedDispatch`) but is not frame-by-frame
verified.

### Scope caveat

The grep is **this-repo-only**. `selection-freeze.ts` lives under `shared/`,
and history contains `sync: from hyper-ext` syncs, so a cross-repo consumer
(hyper-ext / SaaS) cannot be ruled out from here. Hence: "no consumer in this
repo," not "dead." This independently argues for an _investigate-then-decide_
follow-up over an immediate delete — consistent with the repo's dead-code rule
(investigate before removing; fix-or-migrate if the concept is still useful).

## Conclusion

- **No live duplicated/un-consolidated guard exists among the active
  subsystems.** `mergeInitState`, `TracingSyncStateMachine`, and grace-cache are
  deliberate, tested, and non-overlapping. The HYP-369 FSM work correctly
  treats them as out of scope.
- **One real finding:** `shared/canvas-interaction/selection-freeze.ts` (+ its
  test) is an **orphaned module superseded by grace-cache** — referenced only by
  its own test, no production caller in this repo. This is a dead-code /
  orphaned-by-migration result, **not** a consolidation-needed result.
- **Recommendation:** do **not** delete in this audit (audit-only, and the
  dead-code rule requires investigation first — including a cross-repo consumer
  check and a Path-A id-remap coverage check). File a follow-up to
  investigate-then-remove-or-rewire. → **HYP-506** (filed; see below).

## Follow-up ticket

**HYP-506** — Investigate-then-decide: `selection-freeze.ts` orphaned by
grace-cache. Tasks: (1) confirm no cross-repo (hyper-ext / SaaS) consumer;
(2) confirm grace-cache + host re-broadcast cover the Path-A id-remap frame
that freeze handled; (3) if both clear → remove module + test + plan reference;
if Path-A has a gap → re-wire freeze or fold its remap absorption into
grace-cache. No code changed under HYP-504.
