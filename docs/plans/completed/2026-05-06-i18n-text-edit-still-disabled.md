# i18n text input still disabled in real preview, Create-key disappeared

## Status: PARTIAL — diagnosis only, real fix deferred

User-reported bugs (text input disabled, Create-key hidden in bulka) are
NOT fixed by this branch. Branch contributes:

- root-cause diagnosis (Task 1) — `writable: false` for merged-TS layouts
  in `shared/i18n-text/resolve-i18n-resource.ts` gates `editable`
- regression tests pinning current adapter behavior + empty-string carve-out
  (Tasks 2, 4)
- RED-by-design e2e PI-7-I18N-9 in sibling `ext-test-projects` (Task 5)

Real fix surface — teach `writeI18nResource` to mutate merged-TS exports,
or decouple `I18nTextBinding.editable` from `writable` for read-only-but-resolvable
bindings — is **out of scope** of this plan. See "Follow-up" at end.

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

- [~] Install current main VSIX, open Index.tsx in Hyper Canvas (skipped — not automatable in ralphex loop; diagnosed via code path trace below instead)
- [~] Click element with `t('hero.question')` (or similar) (skipped — not automatable)
- [x] Document: is combobox rendered? Are availableKeys populated?
      Is text input disabled? Diagnosed via static trace (see "Diagnosis" below).

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

- [x] If a key exists but value is empty (e.g. `{ "hero.question": "" }`),
      editable should still be true — user wants to TYPE the translation.
      Currently editable is gated on resolvedText !== null. Empty string
      is a valid translation; only undefined / not-in-locale-file should
      be non-editable.
      → Already implemented by the prior `2026-05-06-i18n-text-edit-disabled`
      plan: `StyleReadService.ts:428-430` switched from `resolvedText !== null`
      to `writable && (unresolvedReason === undefined || === 'missing-key')`.
      For JSON layout `{ habits: { walks: '' } }` → `resolveKey` returns `''`
      (a string, not null), `unresolvedReason` is undefined, `writable: true`,
      so `editable: true`. Pinned by new regression test in
      `StyleReadService.test.ts`: "marks editable=true when key resolves to
      empty string (user can type the translation)" — 24/24 pass.
      Note: this carve-out does NOT fix the bulka regression because the
      bulka root cause is `writable: false` for merged TS layouts (Task 1
      diagnosis). That fix needs either teaching `writeI18nResource` to mutate
      merged TS exports or decoupling `editable` from `writable` — both out
      of scope for this task; tracked separately.

### Task 5: E2E for bulka layout

- [x] Add `PI-7-I18N-9: bulka translations.ts adapter — text editable + key
combobox shows keys + Create key affordance works`. Use bulka project,
      not the synthetic test fixture.
      → Added `e2e/tests/project-dependent/bulka-i18n-pi7-9.spec.ts` in the
      sibling `ext-test-projects` repo. Two tests pin the contract:
      (1) text input not disabled and shows non-empty resolved value from
      translations.ts; (2) combobox populates with keys from merged TS and
      Create key button appears when typing a new key. Located in
      `project-dependent` (not project-independent) because the
      project-independent fixture (react-vite-tw4-twitter) uses JSON locale
      files and would not exercise the merged TS code path the user is
      reporting against. Tests pass typecheck (pre-existing errors in
      `canvas-bugs.spec.ts` unrelated). Tests are expected to be RED until
      the merged TS write fix lands — see Task 4 diagnosis: real fix surface
      is teaching `writeI18nResource` to mutate merged TS exports
      (preferred) or decoupling `editable` from `writable` (stop-gap),
      both tracked separately and out of scope for Task 5.

### Task 6: Build, install, screenshot, TG

- [~] `npm run package`, install, reload. Manual reproduction: open Index.tsx,
  select hero.question, verify text editable + Create key visible.
  (skipped — out of scope, blocked on follow-up fix: per Task 1 diagnosis
  the bulka regression's root cause is `writable: false` for merged-TS
  layouts, and Tasks 4/5 defer the actual fix. Manual reproduction would
  fail until that separate change lands.)
- [~] E2E run. Open each screenshot via Read; send only when frames show
  the editable input + visible Create key button.
  (skipped — `bulka-i18n-pi7-9.spec.ts` added in Task 5 is RED by
  design until the merged-TS write fix is implemented; running it now
  would only re-confirm the known failure. Defer e2e + TG screenshot
  to the follow-up plan that lands the writeI18nResource TS-merged
  mutation or decouples `editable` from `writable`.)

## Follow-up

Real fix tracked as **NEEDS LINEAR**: writeI18nResource merged-TS write
support — bulka-the-dog and any project using merged `translations.ts` export
hits `writable: false` from `resolveI18nResource`, which gates
`I18nTextBinding.editable` AND `showCreateAffordance`. Two paths:

- (a) ts-morph mutate the TS object literal export in `writeI18nResource`
  (preferred — restores full editing).
- (b) decouple `editable` from `writable` so user can at least see resolved
  text and switch keys for read-only TS layouts (stop-gap).

Pinned RED by `e2e/tests/project-dependent/bulka-i18n-pi7-9.spec.ts` in
sibling `ext-test-projects`. Plan reference here.
