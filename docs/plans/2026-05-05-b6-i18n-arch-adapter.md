# Plan: B6 — i18n Architecture Refactor (Adapter Pattern)

## Context

Current i18n inspector code (`I18nTextInspector.tsx`, `StyleReadService.ts`, `getAvailableKeys`) uses
ad-hoc conditional branches per library (react-i18next, custom JSON, translations.ts merged format).
User requires: universal modular code with adapters — one adapter per i18n format.

`onKeyChange` is currently a noop — selecting a different i18n key from the combobox does NOT update JSX.
New i18n key creation is also unimplemented.

## Problem

- `StyleReadService.ts`: `getAvailableKeys()` has 3 different code paths (react-i18next JSON, custom JSON, TS merged)
- `I18nTextInspector.tsx`: library-specific conditions scattered throughout
- `onKeyChange` noop: changing key requires calling `AstService.updateText` to rewrite JSX children
- No extensibility: adding a new i18n format requires touching multiple files

## Goal

1. Extract an `I18nAdapter` interface with methods:
   - `getAvailableKeys(locale: string): Promise<string[]>`
   - `resolveText(key: string, locale: string): Promise<string | null>`
   - `writeText(key: string, locale: string, value: string): Promise<void>`
   - `writeKey(elementId: string, newKey: string): Promise<void>` — calls AstService.updateText

2. Implement concrete adapters:
   - `ReactI18nextAdapter` — reads from JSON locale files via react-i18next
   - `CustomJsonAdapter` — reads from custom `locales/*.json` files
   - `TsMergedAdapter` — reads from `translations.ts` merged `{ ru: {...}, en: {...} }` format (bulka-the-dog)

3. `AdapterFactory.forBinding(binding: I18nTextBinding): I18nAdapter` — picks the right adapter

4. Wire `onKeyChange` in `I18nTextInspector.tsx` to call `adapter.writeKey(elementId, newKey)`

5. Add e2e test: `PI-7-I18N-6` — selecting a different key from combobox updates JSX in source file

## Files to Change

| File | Change |
|------|--------|
| `vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts` | Extract adapter classes |
| `client/components/RightSidebar/sections/I18nTextInspector.tsx` | Wire onKeyChange via adapter |
| `server/services/AstService.ts` | Verify updateText handles i18n key rewrite |
| `ext-test-projects/e2e/tests/project-independent/i18n-inspector.spec.ts` | Add PI-7-I18N-6 test |

## Acceptance Criteria

- [ ] `I18nAdapter` interface defined and all 3 adapters implemented
- [ ] `getAvailableKeys` refactored to use adapters (same behavior, cleaner code)
- [ ] `onKeyChange` calls `adapter.writeKey` and updates JSX source
- [ ] PI-7-I18N-6 e2e test passes: key change persists in file after combobox selection
- [ ] All existing PI-7-I18N-* tests still pass
- [ ] TypeScript strict: no `any`, no `as unknown as`

## Notes

- Keep backwards compatibility: existing tests (PI-7-I18N-1 through PI-7-I18N-5) must not regress
- `AstService.updateText` may need extension to accept JSX attribute path, not just text node content
- Bulka-the-dog format uses `{ ru: { "key": "value" }, en: { "key": "value" } }` — TsMergedAdapter must handle this
