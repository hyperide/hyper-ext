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

- [x] Install current main VSIX, open Index.tsx in Hyper Canvas (skipped — not automatable in ralphex loop; diagnosed via code path trace below)
- [x] Click element with `t('hero.question')` (or similar) (skipped — not automatable)
- [x] Document: is combobox rendered? Are availableKeys populated?
      Is text input disabled? Open DevTools, log the actual i18nBinding shape.

#### Diagnosis (static trace, no live VS Code)

bulka-the-dog uses `client/lib/translations.ts`:
`export const translations = { ru: {...}, rs: {...}, en: {...} }`. Each
`t(key)` call goes through a custom `useLanguage` hook returning a `t`
helper that does `getTranslation(language, key)`.

Code path through StyleReadService for an element like
`<h2>{t('faq.title')}</h2>`:

1. `discoverLayout(workspaceRoot, undefined, 'en', fileIO)`:
   - flat dirs (`locales/`, `public/locales/`, `src/i18n/`, `src/locales/`,
     `messages/`) — none exist in bulka.
   - app router probe — no.
   - `discoverMergedLayout` finds `client/lib/translations.ts` (matches
     `MERGED_FILE_CANDIDATES[2]`), parses, returns `Layout` with
     `mergedData = { ru: {...}, rs: {...}, en: {...} }`,
     `availableLocales = ['ru','rs','en']`.

2. `resolveI18nResource` enters the `mergedData` branch
   (`resolve-i18n-resource.ts:334`). For any key — resolved, missing, or
   empty string — it returns **`writable: false`** unconditionally
   because the backing file is `.ts` and `writeI18nResource` refuses TS.

3. `StyleReadService._tryDetectI18n` builds the binding with
   `editable: resolved.writable && (...)` → `false && X` → **`editable:
   false`**. Text input is rendered with `disabled` (`I18nTextInspector.tsx:295`).

4. `getAvailableKeys`: `AdapterFactory.forBinding` sees
   `layout.mergedData` and returns `TsMergedAdapter`, which extracts dot-path
   leaf keys (e.g. `nav.appearance`, `cta.adopt`, …). `availableKeys` is
   populated and combobox renders (`showCombobox = keyEditable && availableKeys.length>0`,
   and `keyEditable` is true via `RightSidebar.tsx:1275-1277` because keys
   are non-empty).

5. `canCreateKeys = i18nText.writable = false` →
   `showCreateAffordance = false` → "+ Create key" branch
   (`I18nTextInspector.tsx:232`) is hidden even when typing a brand-new
   string into the search box.

#### Effective shape of `i18nBinding` for bulka

```
{
  kind: 'i18n',
  library: 'custom',
  key: 'faq.title',
  namespace: undefined,
  activeLocale: 'en',
  availableLocales: ['ru','rs','en'],
  resolvedText: '<value from translations.ts>',
  editable: false,    ← BUG #1: text input disabled
  writable: false,    ← BUG #2: Create-key hidden
  confidence: 'package-json' | 'import-chain' | 'locale-heuristic',
  sourceLocation: { filePath, line, column },
}
```

#### Conclusion

Both reported regressions trace to a single root cause: `resolveI18nResource`
returns `writable: false` for the merged TS layout. Hypotheses A and B from
the plan header are partially correct (TsMergedAdapter is involved); C is
wrong — `getAvailableKeys` and `resolveText` both work fine for bulka.

Real fix surface for Tasks 2–5: either teach `writeI18nResource` to mutate
the merged TS export (preferred — restores full editing), or — if we accept
read-only merged TS — decouple `editable` from `writable` so the user at
least sees the resolved text and can switch keys (but cannot author new
translations). Task 4's empty-string carve-out is a non-fix: with
`writable: false`, `editable` stays `false` regardless of `resolvedText`.

### Task 2: Trace the gap

- [x] In `StyleReadService.getAvailableKeys`, log adapter type chosen for
      bulka. If TsMergedAdapter, dump what it returns.
      → Confirmed: `AdapterFactory.forBinding` selects `TsMergedAdapter` when
      `discoverLayout` returns `mergedData` (bulka path). New unit test
      `TsMergedAdapter.test.ts` "selects TsMergedAdapter when project has
      merged translations.ts" pins this behavior with an in-memory FileIO
      against a bulka-shape translations.ts.
- [x] If it returns `[]`, walk into `TsMergedAdapter.getAvailableKeys` and
      find why. The translations.ts file shape: `{ ru: {...}, en: {...} }`.
      → It does NOT return `[]`. Hypothesis C is wrong. Tests confirm
      `getAvailableKeys('en')` for bulka returns `['hero.question',
      'faq.title', 'brand.name', 'nav.appearance', ...]`. Parallel keysets
      across `ru`/`rs`/`en`. Falls back to first available locale when
      requested locale is missing. Combobox is populated.
- [x] Same for `resolveText` — confirm a value is returned for hero.question.
      → Confirmed: `resolveText('hero.question', 'en')` returns
      `'Did you lose a dog?'`; `'ru'` returns `'Вы потеряли собаку?'`.
      Returns `null` only for truly missing keys or non-leaf paths.

#### Task 2 conclusion

Both `getAvailableKeys` and `resolveText` work correctly on the bulka shape.
Hypothesis C is ruled out. The remaining root cause is `writable: false`
returned by `resolveI18nResource` for any merged TS layout — already pinned
by `resolve-i18n-resource.test.ts:532-555`. Tasks 3-4 should focus on
decoupling `editable` from `writable` (or on enabling TS merged-file
writes), not on adapter behavior.

### Task 3: Fix the adapter for the actual bulka layout

- [x] If the adapter has a path bug (e.g. expects flat keys but file has
      nested), fix it. Add a unit test against the real bulka translations.ts
      shape.
      → No path bug. Task 2 already ruled out hypothesis C. TsMergedAdapter
      handles nested objects correctly (recursively walks into `{ ru: {...},
      rs: {...}, en: {...} }`, emits dot-path leaf keys like `hero.question`,
      `faq.title`, `brand.name`, `nav.appearance`). `resolveText` returns the
      correct value for `hero.question` in every locale. Unit tests against
      the bulka shape already exist
      (`vscode-extension/hypercanvas-preview/src/services/i18n/__tests__/TsMergedAdapter.test.ts`,
      9 tests, 14 assertions, all green) and pin: factory selects
      `TsMergedAdapter` for merged TS, `getAvailableKeys` returns non-empty
      dot-path keys, parallel keysets across locales, fallback to first
      locale, `resolveText` returns translated value for present keys, `null`
      for missing keys / non-leaf paths. No code change needed in this task.
      Real fix surface stays in Tasks 4 (decouple `editable` from `writable`)
      and possibly a separate write-supporting change for merged TS.

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
