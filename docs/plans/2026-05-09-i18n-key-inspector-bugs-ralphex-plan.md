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
   rect becomes section-sized). Screenshot confirms: "Appearance" h1 selected, rect covers
   h1 + photo + paragraph. Root cause: after JSX edit + HMR, FiberSourceIndex rebuild
   shifts source locations. `findElements(oldId)` misses → grace cache replays stale rects.
   But the stale rects may have been accumulated from a parent container paint (e.g. when
   grace cache was last written, the overlay was briefly painting the parent).
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

## Tasks

- [ ] Task 1: RED — write 4 failing E2E tests to establish baseline
- [ ] Task 2: Fix `canCreateKey` — separate from `keyEditable`, true when layout.writable
- [ ] Task 3: Fix grace cache invalidation on write — call `clearSelectionGraceCache` (or
  per-elementId prune) in success path of `handleI18nKeyChange` before restoreIfCurrent
- [ ] Task 4: Fix `writeInProgress` not clearing — ensure dispatch fires even when
  restoreIfCurrent returns early (navigationAway case)
- [ ] Task 5: Fix repeated key change guard — identify and fix what blocks second write
- [ ] Task 6: Build + install ext, run E2E → GREEN
- [ ] Task 7: Codex review, fix findings
- [ ] Task 8: Send before/after screenshots to TG
