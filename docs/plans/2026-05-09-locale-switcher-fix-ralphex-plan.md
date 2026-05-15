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

## TDD approach

Test in `../ext-test-projects/e2e/tests/project-independent/`:
- Select i18n element → inspector shows locale buttons
- Click 'IU' locale button → TEXT field updates to IU translation
- Click 'EN' back → TEXT field updates to EN translation
- Test project: bulka-the-dog (has `en.json`, check for other locales in locales/)

## Tasks

- [ ] Task 1: Read locale detection in StyleReadService + PanelRouter to understand full flow
- [ ] Task 2: RED — write failing E2E test: locale switch → text updates
- [ ] Task 3: Add `activeLocale` state to RightSidebar, implement handleLocaleChange
  (set state, call setStyleRefreshKey)
- [ ] Task 4: Thread activeLocale through useElementStyleData call or i18n read trigger
- [ ] Task 5: In PanelRouter `styles:read` handler, pass activeLocale from message body
  to StyleReadService
- [ ] Task 6: Verify `localeEditable` is true when multiple locales exist
- [ ] Task 7: Build + install ext, run E2E → GREEN
- [ ] Task 8: Codex review, fix findings
- [ ] Task 9: Send screenshot showing locale switch working to TG
