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

- [ ] Launch bulka, open `client/pages/Index.tsx` in Hyper Canvas.
- [ ] Find a `<GalleryImage src={images.…}` element on the canvas (via
      `frame.getByText(...)` against the surrounding section, then walk up to the gallery
      container, then click the `<img>` rendered inside GalleryImage).
- [ ] Confirm a selection rectangle is rendered (poll the overlay element with the
      `data-testid` for the selection rect, e.g. `selection-rect-active` — verify the actual
      testid/class via `grep` first).
- [ ] Press **Shift+Enter** via `window.keyboard.press('Shift+Enter')` (drive through the
      webview's iframe, NOT VS Code keyboard — see existing `bulka-shift-enter-*` tests for
      the canonical pattern).
- [ ] Assert the inspector now shows the *inner* element (read the right-pane element type).
- [ ] Assert the selection rect **still renders** AND its bounding box has changed
      (the rect now wraps the inner element, not the gallery wrapper).
- [ ] Screenshot before+after Shift+Enter. Visual check: rect visible on the inner element.
- [ ] Commit the spec on its own (RED). Ralphex's review pass needs to see real diff before
      Task 2 starts; do not bundle it with later commits.

Test must be **RED on current main** (rect disappears).

### Task 2: Diagnose the divergence

Compare the selection-rect path and the inspector-update path for the same Shift+Enter
event. Likely sites (probe each):

- [ ] `shared/canvas-interaction/iframe-interaction.ts` — keyboard handler that dispatches
      to the iframe DOM handler (per `dc9f7c5b`).
- [ ] `shared/canvas-interaction/keyboard-handler.ts` (and its test) —
      `findTraceableParent` / child traversal.
- [ ] `shared/canvas-interaction/selection-utils.ts` — `getSourceKey`, `computeEffectiveRef`.
- [ ] `client/components/LeftSidebar/hooks/useElementSelection.ts` — nodeRef ↔ uuid mapping
      (line 50 onwards). Inspector path uses this; rect overlay may not.
- [ ] `client/lib/element-tracing/id-bridge` — bridge between element id and source location.

- [ ] Add tracing `console.debug` at the divergence candidate. Run the e2e from Task 1 once
      locally (NOT through Docker — diagnosis loop only) to capture which key the rect path
      computes vs the inspector path. Capture the dump in the commit message.
- [ ] Commit the diagnosis (notes file under `docs/notes/2026-05-08-shift-enter-divergence.md`)
      so the review pass sees real progress between Task 1 and Task 3.

You'll likely find that the rect path uses one of the old/non-uniform key derivations that
`355321c5` already fixed for one direction but not the other.

### Task 3: Apply minimal fix

- [ ] Restore consistency: both paths use the **same** key derivation
      (`resolveSourceIndexFiberSource` or `computeEffectiveRef`, depending on where
      `355321c5` / `06913a91` landed).
- [ ] Add a unit test into `shared/canvas-interaction/keyboard-handler.test.ts`
      (or the closest `__tests__/`) covering the GalleryImage-style nested-component case
      so regressions surface before e2e next time.
- [ ] Re-run the Task 1 e2e through Docker (`HYPER_E2E_SHARDS=1 bun run test:docker`).
      Confirm GREEN.
- [ ] If the cause is missing `_debugSource` on the host element (the React 19
      `_debugStack` finding from `project_ext_click_debug.md`), fall back to `_debugStack`
      for that lookup the same way `06913a91` aligned the inspector path.

### Task 4: Telegram handoff

- [ ] TG report listing: divergence found, file changes, e2e/unit verdicts, commit hashes.
- [ ] E2E before/after screenshots from Task 1, **manually inspected** before sending.
      The AFTER screenshot must show the rect on the inner element, not nothing.
- [ ] CLAUDE.md rule: no screenshot in TG = bug not fixed.

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` before any extension E2E.
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
