# B5: i18n onKeyChange — selecting a key must update JSX

## Context

The i18n key combobox in the inspector shows available keys from locale files (FIXED).
But selecting a different key does NOT update the JSX source code — `onKeyChange` is a noop.

User requirement: changing the key in the inspector must rewrite `{t("old.key")}` → `{t("new.key")}` 
in the source file via AstService.

## Files

- `client/components/RightSidebar/sections/I18nTextInspector.tsx` — `onKeyChange` prop
- `vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts` — RPC handler
- `server/services/AstService.ts` — `updateText` or similar method
- `ext-test-projects/e2e/tests/project-independent/i18n-inspector.spec.ts` — add PI-7-I18N-6

## Tasks

### Task 1: Trace onKeyChange to find where it's a noop

- [ ] Read `client/components/RightSidebar/sections/I18nTextInspector.tsx` — find `onKeyChange` handler.
- [ ] Read `vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts` — find where `onKeyChange` message is (or isn't) handled.
- [ ] Read `server/services/AstService.ts` — find `updateText` signature and what it rewrites.
- [ ] Document: what RPC call is needed, what parameters.

### Task 2: Write RED e2e test PI-7-I18N-6

- [ ] In `ext-test-projects/e2e/tests/project-independent/i18n-inspector.spec.ts`, add:
  - Select element with `{t('test.greeting')}`.
  - Open key combobox, select a different key.
  - Assert: the source file now contains `{t('new.key')}` (read file content).
- [ ] Run test RED.

### Task 3: Implement onKeyChange → AstService.updateText

- [ ] Add RPC message handler in `StyleReadService.ts` for key change.
- [ ] Call `AstService.updateText` (or equivalent) with the element's source location and new key.
- [ ] Wire `onKeyChange` in `I18nTextInspector.tsx` to send the RPC message.
- [ ] Run `bun run typecheck` — no errors.

### Task 4: Build extension and verify GREEN

- [ ] Run `npm run package` in `vscode-extension/hypercanvas-preview/`.
- [ ] Run PI-7-I18N-6 — GREEN.
- [ ] Run PI-7-I18N-1 through PI-7-I18N-5 — no regressions.
- [ ] Send screenshot to Telegram via `/Users/ultra/xp/codex-tg-bot/scripts/send-tg-report.sh`.
