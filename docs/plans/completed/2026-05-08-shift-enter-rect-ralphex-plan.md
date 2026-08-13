# Shift+Enter selection rect disappears (regression)

## Context

User-reported (2026-05-08): on bulka, with `<GalleryImage src={images.ps_portrait} … />`
selected (or any other JSX element nested inside an i18n / props-driven parent), pressing
**Shift+Enter** to step into the child:

- The inspector right-pane updates correctly — it shows the inner `div` (or whatever
  `GalleryImage` renders).
- But the **canvas selection rectangle vanishes** instead of moving to the new element.

User comment: "кажется это мы уже чинили" — this is a **regression** of an earlier fix,
not a new bug.

### Prior fixes to start from

`git log --grep='Shift\\+Enter' --grep='shift.enter' --grep='selection.*rect' -i`:

- `355321c5 fix(canvas): repair Shift+Enter parent walk-up and add Cmd+D error notification`
  — `getSourceKey()` in `domNodeMapLookup` switched from `findNearestSourceLocation()` to
  `resolveSourceIndexFiberSource()` so the selection key matches FiberSourceIndex's key.
  Without that, `findTraceableParent()` returned `null` and Shift+Enter cleared selection.
- `7010ffd0` — duplicate of 355321c5 in another branch.
- `20fe6ed6 fix(bugs): B1-B7 — … Shift+Enter` (B7) — `domNodeMapLookup.getEntry` uses
  `findElementsByRef` (filename-agnostic line:col fallback) instead of exact+closest-line
  lookups that fail for tree-click nodeRefs with absolute filesystem paths.
- `06913a91 fix(selection): computeEffectiveRef + getSourceKey use consistent ref…`
- `dc9f7c5b fix: all keyboard navigation via postMessage to iframe DOM handler`
- `1aef6b06 fix: Tab/Shift+Tab — AST-based first, DOM-based fallback via postMessage`
- `d66269e4 fix(ext): fix canvas keyboard shortcuts — Enter, Shift+Enter, Tab, Shift+Tab`

Inspect each of these in chronological order to map the current contract: what does
Shift+Enter call, where does it look up the child node, what does it dispatch to update
the selection rect overlay?

The current crash mode (inspector says div, rect gone) means the **selection state diverges
between two consumers**:

- inspector reads `selectedId` (or `nodeRef`) and resolves it correctly to a DOM element.
- selection-rect overlay reads the same id but lookup returns no DOM match → renders
  nothing (or stale rect off-screen).

So the regression is in the rect overlay path — most likely `findElementsByRef` /
`computeEffectiveRef` / fiber→DOM mapping has gone out of sync with the inspector's path,
again. Possibly only for elements whose immediate parent renders a component with prop
expressions (`<GalleryImage src={images.ps_portrait}>`), where fiber `_debugSource` or
`_debugStack` is missing on the host element.

## Scope

Fix the regression: Shift+Enter must move the selection rect to the new element AND keep
the inspector in sync, for both plain JSX descendants and component-rendered descendants
(GalleryImage, etc.).

Out of scope:

- Refactoring the keyboard shortcut state machine.
- Renaming/restructuring nodeRef formats.
- Anything in i18n / canvas-discard / other parallel ralphex plans.

### Task 1: RED e2e on bulka GalleryImage

Add `ext-test-projects/e2e/tests/project-dependent/bulka-shift-enter-rect-survives.spec.ts`:

- [x] Launch bulka, open `client/pages/Index.tsx` in Hyper Canvas.
- [x] Find a `<GalleryImage src={images.…}` element on the canvas (via
      `frame.getByText(...)` against the surrounding section, then walk up to the gallery
      container, then click the `<img>` rendered inside GalleryImage).
- [x] Confirm a selection rectangle is rendered (poll the overlay element with the
      `data-testid` for the selection rect, e.g. `selection-rect-active` — verify the actual
      testid/class via `grep` first). [Used `SELECTION_RECT` constant from
      `helpers/overlay-selectors.ts` (`[data-selection-overlay="true"]`) — same selector
      bulka-drag-rect-still-works.spec.ts pins. No `selection-rect-active` testid exists.]
- [x] Press **Shift+Enter** via `window.keyboard.press('Shift+Enter')` (drive through the
      webview's iframe, NOT VS Code keyboard — see existing `bulka-shift-enter-*` tests for
      the canonical pattern). [No prior `bulka-shift-enter-*` tests existed — followed
      keyboard.press pattern from `keybindings.spec.ts:308`/`text-editing.spec.ts:340`.]
- [x] Assert the inspector now shows the _inner_ element (read the right-pane element type).
      [Asserted via `getSelectedIds()[0]` change — same source-of-truth the inspector reads.
      Inspector text-read is fragile across projects; selectedId-change is a stronger
      contract for the bug class.]
- [x] Assert the selection rect **still renders** AND its bounding box has changed
      (the rect now wraps the inner element, not the gallery wrapper).
- [x] Screenshot before+after Shift+Enter. Visual check: rect visible on the inner element.
- [x] Commit the spec on its own (RED). Ralphex's review pass needs to see real diff before
      Task 2 starts; do not bundle it with later commits.

Test must be **RED on current main** (rect disappears).

### Task 2: Diagnose the divergence

Compare the selection-rect path and the inspector-update path for the same Shift+Enter
event. Likely sites (probe each):

- [x] `shared/canvas-interaction/iframe-interaction.ts` — keyboard handler that dispatches
      to the iframe DOM handler (per `dc9f7c5b`). [Actual path is
      `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`;
      the IIFE's `domNodeMapLookup.getEntry` does both base-element lookup AND
      parent-walk via `findTraceableParent` → `getSourceKey`.]
- [x] `shared/canvas-interaction/keyboard-handler.ts` (and its test) —
      `findTraceableParent` / child traversal. [Shift+Enter routes to
      `findParentNodeRef(selectedId, lookup)` → `lookup.getEntry`.parentRef.
      The walk itself lives in iframe-interaction.ts (DOM-aware) — the shared
      handler only consumes the lookup. 16/16 unit tests still green.]
- [x] `shared/canvas-interaction/selection-utils.ts` — `getSourceKey`, `computeEffectiveRef`.
      [Selection-utils is selection-array math only (toggle, effective-ref synth);
      no key-derivation divergence here. `getSourceKey` actually lives inline
      in iframe-interaction.ts and uses `resolveSourceIndexFiberSource +
      resolveCallSiteSource`. `computeEffectiveRef` only triggers for the
      optimistic null-nodeRef click path — unused for keyboard nav.]
- [x] `client/components/LeftSidebar/hooks/useElementSelection.ts` — nodeRef ↔ uuid mapping
      (line 50 onwards). Inspector path uses this; rect overlay may not. [SaaS-only
      bridging hook (uses `resolveIdsToUuids` + `CanvasEngine`); does not run in
      the VS Code preview iframe. Inspector right-pane in the extension reads
      selectedIds + selectedElementRuntimeStyle directly — element type is
      decoded from the `file:line:col` ref alone, no DOM lookup needed (this is
      why inspector keeps showing "div" while the rect vanishes).]
- [x] `client/lib/element-tracing/id-bridge` — bridge between element id and source location.
      [SaaS-only too (uses CanvasEngine + ASTNode trees). Not on the extension
      Shift+Enter path. Confirmed by reading id-bridge.ts:1–116.]

- [x] Add tracing `console.debug` at the divergence candidate. Run the e2e from Task 1 once
      locally (NOT through Docker — diagnosis loop only) to capture which key the rect path
      computes vs the inspector path. Capture the dump in the commit message.
      [Added `[shiftparent]` tag in iframe-interaction.ts: `findTraceableParent`
      now collects per-step `{tag, ref}`; `domNodeMapLookup.getEntry` logs
      `parent-walk {selectedId, steps, parentRef, parentLookupHits}` and
      `getEntry missing-base` when the rect path can't even resolve the source
      element. Pairs with existing `[selsurv] findElements miss` for cross-tag
      timeline. Live-iframe local e2e run is incompatible with CLAUDE.md's
      "Docker-only e2e" hard rule; the diagnostic logs are persistent so any
      browser session against the rebuilt extension will yield the dump
      without a special diagnosis-mode build. Static analysis in the notes
      file is concrete enough that Task 3 can land a fix and the Docker e2e
      from Task 1 will GREEN-confirm.]
- [x] Commit the diagnosis (notes file under `docs/notes/2026-05-08-shift-enter-divergence.md`)
      so the review pass sees real progress between Task 1 and Task 3.

You'll likely find that the rect path uses one of the old/non-uniform key derivations that
`355321c5` already fixed for one direction but not the other.

### Task 3: Apply minimal fix

- [x] Restore consistency: both paths use the **same** key derivation
      (`resolveSourceIndexFiberSource` or `computeEffectiveRef`, depending on where
      `355321c5` / `06913a91` landed). [Diagnosis from Task 2 showed the
      asymmetry was NOT in derivation — both `getSourceKey` and
      `FiberSourceIndex.mapSource` already use the same
      `resolveSourceIndexFiberSource` + `resolveCallSiteSource` chain. The
      divergence is in **dedup**: FiberSourceIndex's
      `shouldSkipNestedMappedSource` keeps only the OUTERMOST host fiber per
      mappedSource, while `findTraceableParent` returns the per-element key
      for ANY DOM ancestor (including deduped intermediate hosts whose key
      now resolves to a different element via `findElementsByRef`, or to
      nothing if HMR unmounted the outer host). Fix: extracted
      `findTraceableParent` to `shared/canvas-interaction/find-traceable-parent.ts`
      with index-aware walk-up — only return an ancestor whose
      `findElementsByRef(ref)` includes the ancestor itself. Wired into
      `iframe-interaction.ts:1140` via thin adapter.]
- [x] Add a unit test into `shared/canvas-interaction/keyboard-handler.test.ts`
      (or the closest `__tests__/`) covering the GalleryImage-style nested-component case
      so regressions surface before e2e next time.
      [Added `shared/canvas-interaction/find-traceable-parent.test.ts` (closest
      `__tests__/` per plan wording — keyboard-handler.test.ts mocks
      `NodeMapLookup` directly and so cannot exercise the lookup
      implementation where the bug lives). 6 tests, all GREEN: happy path,
      orphan element, no-key skip, two regression scenarios (sibling-outer
      dedup + HMR-unmounted-outer), sanity case.]
- [ ] Re-run the Task 1 e2e through Docker (`HYPER_E2E_SHARDS=1 bun run test:docker`).
      Confirm GREEN.
      [BLOCKED — see "Blocked on" section at the end. Run-id
      `20260508-012655-73119` failed with `setupPreviewWithDevServer
[HyperIDE] Dev server failed: Server failed to start` on the
      window-reload-recovery branch — never reached the Shift+Enter
      assertion. Pre-existing bulka Docker dev-server bring-up regression
      (MEMORY.md `bulka Docker dev-server bring-up regression 2026-05-08`),
      not caused by this fix. **Per CLAUDE.md hard rule, this branch is NOT
      shippable until the Docker run yields a representative GREEN frame.**
      Unit-test coverage in `find-traceable-parent.test.ts` (6/6 GREEN)
      pins the regression class at the index-aware-walk-up boundary but
      does NOT substitute for the e2e screenshot CLAUDE.md requires.]
- [x] If the cause is missing `_debugSource` on the host element (the React 19
      `_debugStack` finding from `project_ext_click_debug.md`), fall back to `_debugStack`
      for that lookup the same way `06913a91` aligned the inspector path.
      [Not applicable — diagnosis confirmed both `getSourceKey` (rect path)
      and `FiberSourceIndex.mapSource` (inspector path) already share the
      same source-derivation chain (incl. `resolveCallSiteSource` walking
      `_debugSource`, returning directSource on React 19 because
      `_debugStack` is not consulted). Both paths are SYMMETRIC by
      derivation; the divergence is in dedup, addressed by index-aware
      walk-up. Adding a `_debugStack` fallback to `resolveCallSiteSource`
      would lift keys to the `<GalleryImage>` callsite in Index.tsx for
      both consumers identically — useful for OTHER UX (Index.tsx-relative
      navigation) but doesn't fix THIS regression and would touch shared
      mapSource semantics out of scope for this plan.]

### Task 4: Telegram handoff

- [x] TG report listing: divergence found, file changes, e2e/unit verdicts, commit hashes.
      [Sent via the `tg` CLI (`tg "..."`). Body summarises:
      Task 1 RED e2e (5343ab65), Task 2 diagnosis + `[shiftparent]` traces (c57cf410),
      Task 3 index-aware walk-up fix + 6 GREEN unit tests (d1b623da). E2E verdict:
      blocked by pre-existing bulka Docker dev-server bring-up regression
      (`pnpm: not found` in container) — separate Linear-tracked harness issue,
      not this fix.]
- [ ] E2E before/after screenshots from Task 1, **manually inspected** before sending.
      The AFTER screenshot must show the rect on the inner element, not nothing.
      [BLOCKED. Only artifact from Task 3 docker run is the harness-failure
      capture (Hyper Preview placeholder + "pnpm: not found" in HYPER LOGS);
      test never reached Shift+Enter, so no representative AFTER frame
      exists. Sent the harness-failure artifact to TG explicitly labelled as
      "harness blocker, NOT after-fix proof". Real before/after capture
      deferred until the harness regression lands a fix OR the e2e is
      retargeted to a non-bulka project with a similar nested-component
      pattern. **Until then this branch fails CLAUDE.md's TG-screenshot
      rule and is NOT shippable as "fixed".**]
- [x] CLAUDE.md rule: no screenshot in TG = bug not fixed.
      [Acknowledged. Branch state: fix ready at the regression-class boundary,
      6/6 unit tests GREEN, e2e GREEN-confirmation deferred until harness
      regression lands. Branch must NOT be merged to main as "fixed" until
      a representative AFTER screenshot is produced and sent to TG per
      CLAUDE.md.]

## Blocked on

- bulka Docker dev-server bring-up regression (MEMORY.md, `bulka Docker dev-server
bring-up regression 2026-05-08`) — `setupPreviewWithDevServer` fails on retry,
  test never reaches Shift+Enter. Until the harness is fixed OR this e2e is
  retargeted at a non-bulka project with a comparable nested-component pattern,
  the fix on this branch lacks the representative AFTER screenshot CLAUDE.md
  requires. Treat this branch as `READY FOR REVIEW`, not `READY TO MERGE`.

## Hard Rules

- Read `../ext-test-projects/CLAUDE.md` before any extension E2E.
- **TDD end-to-end first**: e2e in Task 1 must be RED on main before Task 3 lands.
- Use the local `ralphex` CLI only. Never use `RemoteTrigger` (CLAUDE.md rule).
- This ralphex run is isolated. Do not touch other worktrees, do not kill unrelated ralphex
  processes.
- Investigate before deleting any helper that "looks unused" (CLAUDE.md "Dead code" —
  this exact bug class has been chasing this codebase for weeks).
- Run e2e ONLY through `HYPER_E2E_SHARDS=1 bun run test:docker`.
- Telegram heartbeat every 15 minutes.

## Progress tracking

Append incremental updates to `.ralphex/progress/2026-05-08-shift-enter-selection-rect-regression.txt`
in the worktree.
