# i18n Locale Switcher — wire onLocaleChange

## Context

User-reported (2026-05-09): i18n locale switcher buttons (IU / IS / EN) in the
RightSidebar inspector are visible but clicking them does nothing — `onLocaleChange`
is a noop.

From MEMORY deferred ticket (2026-05-03):
> i18n locale switcher in RightSidebar — `onLocaleChange` is a noop; requires
> `activeLocale` state threaded through `useElementStyleData` hook param and
> server-side read route

## Root cause

`I18nTextInspector` receives `onLocaleChange` prop from RightSidebar, but
`handleLocaleChange` in RightSidebar is not implemented (just an empty callback or
doesn't exist). To change locale we need to:

1. Track `activeLocale` in local state (RightSidebar)
2. On locale switch: re-trigger style read with the new locale (`setStyleRefreshKey`)
3. Pass `activeLocale` to `useElementStyleData` / StyleReadService so it reads the
   correct locale's translation instead of defaulting to 'en'
4. In VS Code: `StyleReadService.detectElementStyle` accepts `activeLocale` param —
   thread it through `PanelRouter` → `StyleReadService._tryDetectI18n`

## Files to read first

- `client/components/RightSidebar/RightSidebar.tsx` — locale state, handleLocaleChange
- `client/components/RightSidebar/sections/I18nTextInspector.tsx` — onLocaleChange prop, localeEditable
- `client/hooks/useElementStyleData.ts` — activeLocale param (if any)
- `vscode-extension/hypercanvas-preview/src/PanelRouter.ts` — styles:read handler, activeLocale threading
- `vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts` — activeLocale param in detectElementStyle

### Task 1: Read locale detection in StyleReadService + PanelRouter, understand full flow

- [x] Read `vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts` — find `detectElementStyle` signature, `_tryDetectI18n`, how locale is used
- [x] Read `vscode-extension/hypercanvas-preview/src/PanelRouter.ts` — find `styles:read` handler, what message body fields it reads
- [x] Read `client/lib/platform/hooks/useElementStyleData.ts` — find how it triggers re-read, what params it sends
- [x] Read `client/components/RightSidebar/RightSidebar.tsx` — find `handleLocaleChange` (or absence), `styleRefreshKey`, state vars
- [x] Read `client/components/RightSidebar/sections/I18nTextInspector.tsx` — `onLocaleChange` prop shape, `localeEditable` condition, locale buttons rendering
- [x] Document exact: IMPLEMENTATION ALREADY COMPLETE in commit 20fe6ed6 (2026-05-05). handleI18nLocaleChange at RightSidebar.tsx:736, i18nActiveLocale state at :216, activeLocale passed to useElementStyleData at :242, PanelRouter extracts activeLocale from styles:readClassName at :264, StyleReadService.readElementClassName accepts activeLocale at :85. E2E test exists at ext-test-projects/e2e/tests/project-dependent/bulka-i18n-locale-switch.spec.ts. No code changes needed in Tasks 3-5.

### Task 2: RED — write failing E2E test: locale switch → text updates

- [x] Create `../ext-test-projects/e2e/tests/project-independent/bulka-i18n-locale-switch.spec.ts` — test already exists at project-dependent/bulka-i18n-locale-switch.spec.ts (confirmed in Task 1); no duplicate needed
- [x] Open bulka-the-dog project → select i18n element with locale buttons visible — covered by existing test (h1#hero-title selection with `canvas.waitForAnySelection`)
- [x] Assert initial locale (e.g. 'en') text is shown in TEXT field — covered: dynamic initialLocale detection against HERO_TITLE_BY_LOCALE map
- [x] Click 'IU' locale button → assert TEXT field updates to IU translation — covered: test cycles ru/rs/en locale buttons and asserts text matches dictionary value
- [x] Click 'EN' back → assert TEXT field returns to EN translation — covered: final sanity cycle back to initialLocale
- [x] Run test → confirm RED (locale switch does nothing currently) — skipped: implementation was already complete in commit 20fe6ed6 (discovered in Task 1); test goes GREEN directly
- [x] Note: bulka-the-dog must have at least 2 locales in `locales/` directory; verify or add IU locale fixture if missing — bulka uses translations.ts (ru/rs/en) not a `locales/` dir; existing test already accounts for this

### Task 3: Add activeLocale state to RightSidebar, implement handleLocaleChange

- [x] In `RightSidebar.tsx`: add `const [activeLocale, setActiveLocale] = useState<string | undefined>(undefined)` — already exists as `i18nActiveLocale` at :216 (commit 20fe6ed6)
- [x] Implement `handleLocaleChange(locale: string)`: sets `activeLocale`, then calls `setStyleRefreshKey(k => k + 1)` (or equivalent re-read trigger) — `handleI18nLocaleChange` at :736, re-read triggered automatically via `activeLocale` in `useElementStyleData` deps
- [x] Pass `onLocaleChange={handleLocaleChange}` to `I18nTextInspector` — `onLocaleChange={handleI18nLocaleChange}` at :1415

### Task 4: Thread activeLocale through useElementStyleData → PanelRouter message

- [x] In `useElementStyleData.ts` (or wherever `styles:read` is sent): add `activeLocale` to the message body when set — already done: activeLocale sent in styles:readClassName at useElementStyleData.ts:455 (commit 20fe6ed6)
- [x] In `PanelRouter.ts` `styles:read` handler: extract `activeLocale` from message body — already done: extracted at PanelRouter.ts:264 in styles:readClassName handler (commit 20fe6ed6)
- [x] Pass `activeLocale` to `StyleReadService.detectElementStyle(...)` call — already done: passed as 4th arg to readElementClassName at PanelRouter.ts:279 (commit 20fe6ed6)

### Task 5: Thread activeLocale into StyleReadService._tryDetectI18n

- [ ] In `StyleReadService.ts`: update `detectElementStyle` signature to accept optional `activeLocale: string`
- [ ] In `_tryDetectI18n` (or wherever locale is resolved): use `activeLocale` if provided, otherwise default to `'en'` or project default
- [ ] Ensure translated text returned matches the requested locale

### Task 6: Build + install ext, run E2E → GREEN

- [ ] Run `./vscode-extension/hypercanvas-preview/build-and-install.sh`
- [ ] Run E2E: `cd /Users/ultra/work/ext-test-projects/e2e && HYPER_E2E_SHARDS=1 bun run test:docker --grep "bulka-i18n-locale-switch"`
- [ ] Test must be GREEN
- [ ] Screenshot artifacts in `docker-artifacts/run-*/shard-*/`

### Task 7: Take E2E screenshot and send to Telegram

- [ ] Find screenshot from E2E run showing locale switcher working (text changed after click)
- [ ] Read screenshot with Read tool, verify it shows locale text update
- [ ] Send to Telegram: `./send-tg-photo.sh <screenshot> "locale switcher fixed: clicking IU/EN now updates translation in inspector"`
- [ ] Commit remaining uncommitted changes
