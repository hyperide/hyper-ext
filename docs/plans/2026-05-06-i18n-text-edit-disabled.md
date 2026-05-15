# i18n text input disabled — even on existing keys / after key change

## Symptoms

User reports that i18n text input refuses to accept typing even on regular
existing keys. Also after picking "Create key" for a new key, nothing happens.

## Files

- `client/components/RightSidebar/sections/I18nTextInspector.tsx` — `disabled={!i18nBinding.editable}`
- `client/components/RightSidebar/RightSidebar.tsx` — handleI18nKeyChange + handleI18nResolvedTextChange
- `vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts` — i18nBinding production, where `editable` is computed
- `vscode-extension/hypercanvas-preview/src/services/i18n/*Adapter.ts`

## Goal

1. Existing key with valid resolvedText → text input editable, typing persists.
2. New key (Create key) → JSX rewritten to t(newKey), JSON entry created with empty/old text, text input editable, user can type translation.
3. Selection on the canvas element survives the round-trip.

## Tasks

### Task 1: Trace why editable=false on existing keys

- [ ] Read StyleReadService production of i18nBinding. Find every place that sets `editable: false`.
- [ ] Add console diagnostics in iframe-interaction (or temporarily in I18nTextInspector) to log the actual binding when the user clicks an i18n element. Reproduce against bulka-the-dog.
- [ ] Document the exact branch that produces editable=false for what should be an editable case.

### Task 2: Fix the editable computation

- [ ] If `resolvedText` is non-null and `library` is supported, editable must be true.
- [ ] Fix the logic.

### Task 3: Trace why "Create key" does nothing

- [ ] In I18nTextInspector, the Create key button calls `commitKey(trimmedSearch)`. Verify it actually fires onKeyChange. Add logging.
- [ ] In RightSidebar handleI18nKeyChange, verify the writeI18nResource RPC is invoked with skipResourceWrite=false for unknown keys.
- [ ] In AstBridge's writeI18nResource handler, verify the JSX rewrite + JSON write happens.

### Task 3.5: Replace polling with event-based wait (no race in production)

If the test that asserts "JSX rewrite landed" needs polling to pass, that
means the production write is fire-and-forget — the user sees a flicker /
delay too. **Polling masks a real race; do NOT add polling, fix the race.**

- [ ] Make `writeI18nResource` RPC reply ONLY after the AST mutation has been
      flushed to disk and the dev server has acknowledged the change (or
      the file watcher has produced a settled re-read).
- [ ] If full settle is not feasible, return a `writeId` and emit a
      `ast:writeI18nResource:done` event when settle completes. The webview
      awaits the matching event before considering the write finished.
- [ ] `handleI18nKeyChange` `await`s until done (not just RPC ack). Test
      waits for the same signal — never polls state.

### Task 4: Add E2E coverage

- [ ] Extend `../ext-test-projects/e2e/tests/project-independent/i18n-inspector.spec.ts`:
      - PI-7-I18N-7: type into text input on existing key, value persists after blur + 2s.
      - PI-7-I18N-8: open combobox, type new key, click Create key, assert JSX rewritten and JSON has new entry, assert text input becomes editable for typing the translation.

### Task 5: Build, install, E2E screenshots, TG

- [ ] `npm run package`, install, reload.
- [ ] Run new E2E cases. Send before/after screenshots with critical visual review.
