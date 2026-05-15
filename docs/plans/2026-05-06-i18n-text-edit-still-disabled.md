# i18n text input still disabled in real preview, Create-key disappeared

## User report (2026-05-06 14:30, Index.tsx in bulka-the-dog)

After merging i18n-text-edit-disabled branch into main:
1. ❌ Text input в i18n inspector НЕ редактируется (disabled state).
2. ❌ Создание новых i18n ключей опять пропало (no Create key affordance).

E2E coverage for these cases passed in Docker, but real preview shows the bug.

## Hypotheses

A. **`I18nTextBinding.editable` computation in real bulka StyleReadService is
   different from the path the e2e exercises.** The bulka-the-dog component
   probably uses a translations.ts merged-format adapter (TsMergedAdapter)
   while the e2e covered react-i18next or custom JSON.
B. **`availableI18nKeys` is empty in this case** — without keys, combobox
   trigger renders with no suggestions, and the "Create key" affordance
   only appears inside the popover.
C. **`StyleReadService.getAvailableKeys` is failing for translations.ts merged
   format**, returning empty list. The combobox falls back to plain input
   (no Create key UI), and editable depends on `resolvedText !== null`
   which may also fail for merged format.

## Files

- `vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts`
- `vscode-extension/hypercanvas-preview/src/services/i18n/TsMergedAdapter.ts`
- `vscode-extension/hypercanvas-preview/src/services/i18n/AdapterFactory.ts`
- `client/components/RightSidebar/sections/I18nTextInspector.tsx`
- `bulka-the-dog/client/locales/translations.ts` — actual file we test against
- `bulka-the-dog/client/pages/Index.tsx` — selecting an i18n element here
  must produce editable + Create-key.

## Tasks

### Task 1: Reproduce in bulka-the-dog Index.tsx

- [ ] Install current main VSIX, open Index.tsx in Hyper Canvas
- [ ] Click element with `t('hero.question')` (or similar)
- [ ] Document: is combobox rendered? Are availableKeys populated?
      Is text input disabled? Open DevTools, log the actual i18nBinding shape.

### Task 2: Trace the gap

- [ ] In `StyleReadService.getAvailableKeys`, log adapter type chosen for
      bulka. If TsMergedAdapter, dump what it returns.
- [ ] If it returns `[]`, walk into `TsMergedAdapter.getAvailableKeys` and
      find why. The translations.ts file shape: `{ ru: {...}, en: {...} }`.
- [ ] Same for `resolveText` — confirm a value is returned for hero.question.

### Task 3: Fix the adapter for the actual bulka layout

- [ ] If the adapter has a path bug (e.g. expects flat keys but file has
      nested), fix it. Add a unit test against the real bulka translations.ts
      shape.

### Task 4: Fix editable=true even when resolvedText is empty string

- [ ] If a key exists but value is empty (e.g. `{ "hero.question": "" }`),
      editable should still be true — user wants to TYPE the translation.
      Currently editable is gated on resolvedText !== null. Empty string
      is a valid translation; only undefined / not-in-locale-file should
      be non-editable.

### Task 5: E2E for bulka layout

- [ ] Add `PI-7-I18N-9: bulka translations.ts adapter — text editable + key
      combobox shows keys + Create key affordance works`. Use bulka project,
      not the synthetic test fixture.

### Task 6: Build, install, screenshot, TG

- [ ] `npm run package`, install, reload. Manual reproduction: open Index.tsx,
      select hero.question, verify text editable + Create key visible.
- [ ] E2E run. Open each screenshot via Read; send only when frames show
      the editable input + visible Create key button.
