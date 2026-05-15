# i18n Key Inspector Bugs

## Context

User-reported (2026-05-09) after manual testing of ext v0.1.44. Four related bugs in
the i18n key inspector:

1. **New key not suggested for creation** — when typing a key that doesn't exist in
   `availableI18nKeys`, there is no "Create new key" option. Root cause:
   `keyEditable={availableI18nKeys !== undefined && availableI18nKeys.length > 0}` gates
   BOTH key editing AND key creation. An empty locale file → `keyEditable=false` → no
   create option. Fix: separate `canCreateKey` prop that is true whenever a writable i18n
   layout exists, even if available keys list is empty.

2. **Selection rect wrong/too large after key change** — after writing a new i18n key,
   the overlay rect covers the parent container instead of the specific element (e.g., h1
   rect becomes section-sized). Root cause: after JSX edit + HMR, FiberSourceIndex rebuild
   shifts source locations. `findElements(oldId)` misses → grace cache replays stale rects.
   Fix: after `writeI18nResource` completes (success path in RightSidebar), explicitly
   clear grace cache for the written elementId so the overlay forces a fresh DOM lookup
   after HMR instead of replaying stale rects.

3. **Selection of other elements breaks after key change** — after a key change, clicking
   other elements no longer shows selection overlay. Root cause: likely `writeInProgress`
   state not properly cleared after 800ms timeout (e.g. if `i18nDispatch` is null, the
   timeout runs but `i18nDispatch({ writeInProgress: null })` is a no-op). The iframe
   overlay continues to receive `writeInProgress=true` via grace cache frozen state.
   Fix: ensure `writeInProgress: null` is broadcast unconditionally, and that
   `needsOverlayUpdate=true` is forced after write completes.

4. **Repeated key changes stop working** — second+ key change has no effect. Root cause:
   `debouncedI18nWriteRef.current` may be leaking across writes, or `writeInProgress` from
   the first write blocks the second (the guard `if (state.writeInProgress)` in a handler
   might reject the new write). Fix: identify the guard, ensure it uses `writeId` comparison
   not just presence of `writeInProgress`.

## Files to read first

- `client/components/RightSidebar/RightSidebar.tsx` — `handleI18nKeyChange`, `writeInProgress` dispatch
- `client/components/RightSidebar/sections/I18nTextInspector.tsx` — `keyEditable`, `canCreateKey`, combobox
- `shared/canvas-interaction/selection-grace-cache.ts` — exports for clearing/invalidating
- `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts` — grace cache usage, `sendOverlayRects`
- `vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts` — `getAvailableKeys`

## TDD approach

All fixes must have E2E tests in `../ext-test-projects/e2e/tests/project-independent/`.
Tests use bulka-the-dog project (has i18n with react-i18next, locales/en.json).

- Test 1 (RED): type a nonexistent key → expect "create" option visible in combobox
- Test 2 (RED): change key → wait 1500ms → expect selection rect is TIGHT around h1 only
  (not parent section). Assert rect height < 100px (h1 is ~80px tall, section is 800px+).
- Test 3 (RED): change key → click different element → expect selection moves correctly
- Test 4 (RED): change key twice in sequence → expect second change takes effect

### Task 1: Read all relevant files, understand current data flow

- [x] Read `client/components/RightSidebar/RightSidebar.tsx` focusing on `handleI18nKeyChange`, `writeInProgress`, `writeId`, `restoreIfCurrent`
- [x] Read `client/components/RightSidebar/sections/I18nTextInspector.tsx` focusing on `keyEditable`, combobox render, `onKeyChange` prop
- [x] Read `shared/canvas-interaction/selection-grace-cache.ts` — understand full API, find per-elementId invalidation or add one
- [x] Read `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts` lines around `writeInProgress` state update and grace cache apply
- [x] Document findings: what blocks `canCreateKey`, what guard blocks repeated writes, where `writeInProgress` fails to clear

**Findings:**
- Bug 1: `canCreateKeys` prop exists in I18nTextInspector (default false) but RightSidebar.tsx:1419 never passes it. Also `keyEditable={availableI18nKeys !== undefined && availableI18nKeys.length > 0}` is false when locale is empty, blocking combobox entirely. Fix: pass `canCreateKeys={i18nText.writable}` (from `I18nTextBinding.writable`). Change `showCombobox` to show when `canCreateKeys` even with `keyEditable=false`.
- Bug 2: Grace cache lives in iframe-interaction.ts. `invalidateSelectionGraceCacheForFile` is called for drag ops (line 1813) but NOT after i18n write. Need to send postMessage to iframe after successful write.
- Bug 3: `writeInProgress` is NOT used in iframe-interaction.ts at all. Real issue: `restoreIfCurrent` sees transient `selectedIds=[]` (during HMR rebuild) and dispatches `selectedIds:[previousSelectedId]`, overriding user's click to element B. Need to track whether user explicitly clicked something new, separate from HMR-induced empty state.
- Bug 4: No explicit `writeInProgress` guard blocks second write. Potential issue: concurrent writes use same `previousKey` → second write may conflict or be a no-op if AST already changed. Also `setStyleRefreshKey` in `finally` triggers re-read/remount — second write typed before remount uses stale `i18nText.key` as `previousKey`.

### Task 2: RED — write 4 failing E2E tests

- [ ] Create `../ext-test-projects/e2e/tests/project-independent/bulka-i18n-key-bugs.spec.ts`
- [ ] Test 1: select i18n element → type new nonexistent key → expect combobox shows "Create" option
- [ ] Test 2: select i18n element → change key → wait 1500ms → screenshot selection rect → assert rect height < 100px
- [ ] Test 3: select i18n element → change key → click different element → assert new element selected (rect moves)
- [ ] Test 4: select i18n element → change key twice → assert second value persisted in locale file
- [ ] Run tests — confirm all 4 RED (fail on current build)

### Task 3: Fix canCreateKey — separate from keyEditable

- [ ] In `I18nTextInspector.tsx`: add `canCreateKey` prop (boolean)
- [ ] `canCreateKey` = true when i18n layout exists and is writable, regardless of available keys count
- [ ] Pass `canCreateKey` from `RightSidebar.tsx` — derive from `styleData.i18nText?.layout?.writable ?? false`
- [ ] In combobox: show "Create" option when `canCreateKey && inputValue && !availableI18nKeys.includes(inputValue)`
- [ ] Run typecheck: `bun run typecheck` (or equivalent)

### Task 4: Fix grace cache invalidation on write

- [ ] In `selection-grace-cache.ts`: add `clearGraceCacheForElement(elementId: string)` export (or clear all if per-id not feasible)
- [ ] In `RightSidebar.tsx` success path of `handleI18nKeyChange`: call `clearGraceCacheForElement(elementId)` before `restoreIfCurrent()`
- [ ] This forces fresh DOM lookup after HMR instead of replaying stale rects
- [ ] Message `clearGraceCacheForElement` to iframe via postMessage if grace cache lives in iframe context

### Task 5: Fix writeInProgress not clearing + repeated write guard

- [ ] Trace what happens when `writeInProgress` fails to clear: find the guard that blocks second write
- [ ] Ensure `writeInProgress: null` dispatch fires unconditionally at end of success path (not gated on `navigationAway` check)
- [ ] If guard uses `if (state.writeInProgress)` flat check: change to `if (state.writeInProgress && state.writeInProgress.writeId === currentWriteId)`
- [ ] Ensure `needsOverlayUpdate=true` is sent to iframe after write completes

### Task 6: Build + install ext, run E2E → GREEN

- [ ] Run `./vscode-extension/hypercanvas-preview/build-and-install.sh` in hyper-canvas-draft root
- [ ] Wait for build to complete
- [ ] Run E2E: `cd /Users/ultra/work/ext-test-projects/e2e && HYPER_E2E_SHARDS=1 bun run test:docker --grep "bulka-i18n-key-bugs"`
- [ ] All 4 tests must be GREEN
- [ ] Screenshot artifacts in `docker-artifacts/run-*/shard-*/`

### Task 7: Take E2E screenshots and send to Telegram

- [ ] Find screenshot artifacts from the E2E run
- [ ] Read each screenshot with Read tool, visually verify it shows the bug is fixed
- [ ] Send passing screenshots to Telegram: `cd /Users/ultra/work/hyper-canvas-draft && ./send-tg-photo.sh <screenshot> "i18n key bugs fixed: <description>"`
- [ ] One screenshot per bug fixed (4 total)
- [ ] Commit any remaining uncommitted changes with descriptive message
