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

- [ ] Read `vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts` — find `detectElementStyle` signature, `_tryDetectI18n`, how locale is used
- [ ] Read `vscode-extension/hypercanvas-preview/src/PanelRouter.ts` — find `styles:read` handler, what message body fields it reads
- [ ] Read `client/hooks/useElementStyleData.ts` — find how it triggers re-read, what params it sends
- [ ] Read `client/components/RightSidebar/RightSidebar.tsx` — find `handleLocaleChange` (or absence), `styleRefreshKey`, state vars
- [ ] Read `client/components/RightSidebar/sections/I18nTextInspector.tsx` — `onLocaleChange` prop shape, `localeEditable` condition, locale buttons rendering
- [ ] Document exact: what changes are needed, where `activeLocale` must be threaded

### Task 2: RED — write failing E2E test: locale switch → text updates

- [ ] Create `../ext-test-projects/e2e/tests/project-independent/bulka-i18n-locale-switch.spec.ts`
- [ ] Open bulka-the-dog project → select i18n element with locale buttons visible
- [ ] Assert initial locale (e.g. 'en') text is shown in TEXT field
- [ ] Click 'IU' locale button → assert TEXT field updates to IU translation
- [ ] Click 'EN' back → assert TEXT field returns to EN translation
- [ ] Run test → confirm RED (locale switch does nothing currently)
- [ ] Note: bulka-the-dog must have at least 2 locales in `locales/` directory; verify or add IU locale fixture if missing

### Task 3: Add activeLocale state to RightSidebar, implement handleLocaleChange

- [ ] In `RightSidebar.tsx`: add `const [activeLocale, setActiveLocale] = useState<string | undefined>(undefined)`
- [ ] Implement `handleLocaleChange(locale: string)`: sets `activeLocale`, then calls `setStyleRefreshKey(k => k + 1)` (or equivalent re-read trigger)
- [ ] Pass `onLocaleChange={handleLocaleChange}` to `I18nTextInspector`

### Task 4: Thread activeLocale through useElementStyleData → PanelRouter message

- [ ] In `useElementStyleData.ts` (or wherever `styles:read` is sent): add `activeLocale` to the message body when set
- [ ] In `PanelRouter.ts` `styles:read` handler: extract `activeLocale` from message body
- [ ] Pass `activeLocale` to `StyleReadService.detectElementStyle(...)` call

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
