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

- [x] Read StyleReadService production of i18nBinding. Find every place that sets `editable: false`.
- [x] Add console diagnostics in iframe-interaction (or temporarily in I18nTextInspector) to log the actual binding when the user clicks an i18n element. Reproduce against bulka-the-dog. (Diagnostic added to I18nTextInspector; live reproduction deferred to Task 5 build+install.)
- [x] Document the exact branch that produces editable=false for what should be an editable case.

Findings:

Three places set `editable` in StyleReadService:
- `StyleReadService.ts:228` — stub binding inside `getAvailableKeys()`. Used only to drive
  `AdapterFactory.forBinding()`, never returned to the inspector. Not the bug.
- `StyleReadService.ts:351` — `domTextContent` fallback path (after `resolveI18nByDomText`
  succeeds). Hardcodes `editable: true`. Not the bug.
- `StyleReadService.ts:411` — main detection path: `editable: resolved.resolvedText !== null`.
  This is the source of the disabled input.

`resolveI18nResource` returns `resolvedText: null` whenever the active locale file is
missing the key (`unresolvedReason: 'missing-key'`), the file is missing
(`'missing-locale-file'`), or parse fails (`'parse-error' | 'unsupported-format'`).

The bug case for "regular existing keys": project has the key in some locale (e.g. `en-US`,
`ru`) but NOT in the requested `activeLocale` (defaults to `en`). The retry block at
lines 383-401 only fires when `availableLocales` does NOT include `'en'`. If `'en'` is
present but the specific key is missing in `en` while present in `ru`, retry is skipped,
`resolvedText` stays `null`, and `editable` is `false` even though the key is editable
(user just needs an empty `en` translation slot to type into).

Fix direction (Task 2): drop the `resolvedText !== null` requirement. As long as the
library is supported and we have a sourceLocation, the inspector should let the user
type — typing creates the missing translation entry under the active locale.

### Task 2: Fix the editable computation

- [x] If `resolvedText` is non-null and `library` is supported, editable must be true.
- [x] Fix the logic.

Resolution: changed `StyleReadService.ts:411` from
`editable: resolved.resolvedText !== null` to
`editable: resolved.unresolvedReason === undefined || resolved.unresolvedReason === 'missing-key'`.
This keeps editable=true for the happy path and additionally allows editing when the
active locale file exists but the key is missing — typing creates the entry. Still
blocks editing for `missing-locale-file`, `parse-error`, and `unsupported-format`
because the underlying file cannot be safely written. The catch-fallback (when
`resolveI18nResource` throws) now sets `unresolvedReason: 'missing-locale-file'` so it
preserves the prior editable=false behaviour. Added unit test covering the missing-key
case in `StyleReadService.test.ts`.

### Task 3: Trace why "Create key" does nothing

- [x] In I18nTextInspector, the Create key button calls `commitKey(trimmedSearch)`. Verify it actually fires onKeyChange. Add logging.
- [x] In RightSidebar handleI18nKeyChange, verify the writeI18nResource RPC is invoked with skipResourceWrite=false for unknown keys.
- [x] In AstBridge's writeI18nResource handler, verify the JSX rewrite + JSON write happens.

Findings (code-trace, live reproduction deferred to Task 5 build+install):

Wiring chain verified by reading every hop end-to-end:

1. `I18nTextInspector.tsx:158-176` — `commitKey(trimmedSearch)` early-returns only when
   `!key || key === currentKey`. Otherwise it unconditionally calls `onKeyChange?.(key)`.
   The Create button (`data-testid="i18n-key-create"`) hits `commitKey(trimmedSearch)`
   directly. No silent guard. ✅
2. `RightSidebar.tsx:744-783` — `handleI18nKeyChange` early-returns on
   `!i18nText`, `kind !== 'i18n'`, `newKey === i18nText.key`, or missing
   `selectedId`/`componentPath`. For an unknown new key it computes
   `isNewKey = !(availableI18nKeys ?? []).includes(newKey)` → `true`, sets
   `skipResourceWrite: !isNewKey` = `false`, and calls `astOps.writeI18nResource`
   with `previousKey: i18nText.key`, `filePath: i18nText.sourceLocation.filePath`,
   `elementId: selectedId`. ✅
3. `AstBridge.ts:_handleWriteI18nResource` — when `skipResourceWrite === false`, runs
   `writeI18nResource()` (writes locale JSON via `setKey`). When
   `previousKey !== key && filePath && elementId` it then calls
   `_astService.updateText(filePath, elementId, "{t('newKey')}")` which routes to
   `updateElementChildren` → `parseMixedContent` (currentChildrenType is
   `expression-complex` because `t('oldKey')` is a CallExpression). ✅

Diagnostic logs added at three layers (`[I18nTextInspector] commitKey`,
`[RightSidebar] handleI18nKeyChange*`, `[AstBridge.writeI18nResource]`) so the
remaining "nothing happens" symptom can be pinpointed at runtime in Task 5.

Suspected runtime causes (to confirm via the new logs in Task 5):

- `availableI18nKeys` may be `undefined` when the dropdown is open (it is fetched
  lazily). If `undefined`, `isNewKey = !(undefined ?? []).includes(newKey)` is `true`,
  which is correct — but the combobox itself is hidden in that state because
  `showCombobox = keyEditable && availableKeys && availableKeys.length > 0`. So
  the user actually sees the *plain* key input, not a combobox with a Create button.
  In that branch the "Create key" affordance does not exist; the user just types
  and presses Enter. Still wired through `onKeyChange?.(v)` on Enter/Blur, so the
  call still fires.
- Selection-loss after HMR: the JSX rewrite triggers a Vite/webpack reload, which
  drops the iframe selection. The current code already re-broadcasts
  `selectedIds: [previousSelectedId]` at 0/250/800 ms. If the new key is then
  resolved with `editable: false` (because the new translation is empty and the
  pre-Task-2 logic gated on `resolvedText !== null`), typing into the text box was
  a no-op. Task 2 already fixed that by allowing `unresolvedReason === 'missing-key'`
  to remain editable.
- `i18nText.sourceLocation.filePath` could be relative (e.g. starts with `src/`),
  and `AstService.updateText` calls `resolveWorkspacePath` which is workspace-
  relative-safe — so this should succeed. Logged for confirmation.

### Task 4: Add E2E coverage

- [ ] Extend `../ext-test-projects/e2e/tests/project-independent/i18n-inspector.spec.ts`:
      - PI-7-I18N-7: type into text input on existing key, value persists after blur + 2s.
      - PI-7-I18N-8: open combobox, type new key, click Create key, assert JSX rewritten and JSON has new entry, assert text input becomes editable for typing the translation.

### Task 5: Build, install, E2E screenshots, TG

- [ ] `npm run package`, install, reload.
- [ ] Run new E2E cases. Send before/after screenshots with critical visual review.
