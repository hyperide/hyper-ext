---
title: i18n Locale Switcher — Inspector
date: 2026-05-08
status: spec
ticket: NEEDS-LINEAR
---

# i18n Locale Switcher in Inspector

## What IS (current state, main @ c5a0c82a)

### UI

`I18nTextInspector` renders locale buttons when `i18nBinding.availableLocales.length > 0`.
Buttons are clickable when `localeEditable = availableLocales.length > 1`. Active locale is
highlighted; inactive buttons call `onLocaleChange?.(locale)` on click.

`client/components/RightSidebar/sections/I18nTextInspector.tsx:307–328`

### Client → Extension RPC chain

1. `RightSidebar` holds `i18nActiveLocale: string | undefined` (line 223).
2. `handleI18nLocaleChange` sets it (line 709). Resets to `undefined` on element change (line 290).
3. `useElementStyleData` receives `activeLocale: i18nActiveLocale` (line 249).
4. `activeLocale` is in the hook's effect dep array — locale change fires a new RPC.
5. RPC event: `styles:readClassName` with `activeLocale?: string`.
6. `PanelRouter` extracts `activeLocale` and passes to `StyleReadService.read()`.
7. `StyleReadService._tryDetectI18n(element, filePath, content, domTextContent, activeLocale)` —
   threading is correct on entry.

### `listFiles` availability

`vscode-file-io.ts` implements `listFiles` — `discoverLayout` returns full
`availableLocales` from `locales/`, `public/locales/`, `src/i18n/`, etc.

---

## What IS NOT (regressions + gaps, anchored at current main)

### Regression — `3bff90dd` reverted `d8874e13`

**`d8874e13 fix(i18n): resolve selected locale after DOM text lookup`** added a private helper
`_createBindingFromDomMatch` that, after a DOM-text key match, **re-resolved the resource
via `resolveI18nResource(activeLocale)`** so the inspector text matched the user-selected
locale instead of the locale the DOM text was found in.

**`3bff90dd fix(i18n): resolve editable custom dictionaries (HYP-000)`** removed that helper
(net `-45/+28`) and inlined the original DOM-match logic that does **not** re-resolve.

`git diff d8874e13 HEAD -- vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts`
shows the rollback explicitly.

The follow-up commit `c5a0c82a` only added `writable: resolved.writable` to the two
non-DOM-text paths — it did **not** restore the locale-aware DOM-text behaviour.

### Gap A — custom + DOM-text shortcut ignores `activeLocale`

`StyleReadService.ts:329–346` (custom branch with `domTextContent`):

```ts
if (library === 'custom' && domTextContent) {
  const domMatch = await resolveI18nByDomText(...);
  if (domMatch) {
    return {
      activeLocale: activeLocale ?? domMatch.locale,    // honoured
      resolvedText: domMatch.resolvedText,              // STALE — locale of DOM match, NOT activeLocale
      availableLocales: domMatch.availableLocales,
      ...
    };
  }
}
```

Switching locale moves the active button highlight but the text input keeps showing the locale
in which the DOM text was actually rendered.

### Gap B — react-i18next + DOM-text fallback hardcodes match locale

`StyleReadService.ts:409–428` (react-i18next `unsupported` fallback with `domTextContent`):

```ts
if (detection.kind === 'unsupported') {
  if (domTextContent) {
    const domMatch = ...;
    return {
      activeLocale: domMatch.locale,                    // overrides activeLocale outright
      resolvedText: domMatch.resolvedText,              // stale, same as Gap A
      ...
    };
  }
}
```

Even worse than Gap A — the user-selected locale is dropped entirely; the inspector pretends the
DOM-discovered locale is the active one.

### Gap C — `resolvedText === null` returns `unsupported` (was Gap 2)

`StyleReadService.ts:385–387` (custom path):

```ts
if (!resolved || resolved.resolvedText === null) {
  return { kind: 'unsupported', reason: 'missing-source-location' };
}
```

When the user switches to a locale whose file is missing the key, the response carries no
`i18nText`. `useElementStyleData` then keeps the **previous** binding (`prev.i18nText`) so the
UI looks frozen on the old locale even though the RPC fired.

The non-custom path (lines 481+) does NOT have this guard, but its DOM-text fallback (Gap B)
defeats the locale switch through a different code path.

### Gap D — SaaS / browser mode has no locale-aware read route

`useElementStyleData` browser path (lines 298+) reads via `engine + styleAdapter`, with no RPC
to a server-side `resolveI18nResource(activeLocale)`. `activeLocale` param is silently ignored.
Tracked as deferred Linear (2026-05-03).

### Gap E — `mergedTS` bindings: locale switch unverified for write

`translations.ts` merged-TS format goes through `TsMergedAdapter`. After commit `c5a0c82a`
`writable` is plumbed through, but **switching locale on a merged-TS binding has not been
exercised end-to-end** with the bulka-the-dog fixture since the regression. Probably works for
read (resolveI18nResource handles `mergedData`) — definitely needs an e2e to lock it in.

---

## Expected behavior (target)

| Scenario                                                                  | Expected                                                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Element with `t('key')`, locales `['en', 'fr', 'de']`, key present in all | Click "fr" → text input shows French within ~200ms                                       |
| Same element, "fr" file missing the key                                   | Click "fr" → button highlights "fr", input shows empty/placeholder, `resolvedText: null` |
| DOM-text-detected binding (no AST key) with locales `['en', 'fr']`        | Click "fr" resolves and shows French text                                                |
| Only one discovered locale                                                | Locale button shown but not clickable (current behaviour, correct)                       |
| Merged-TS (`translations.ts`) with multiple locales                       | Locale switch reads correctly; writable preserved per `c5a0c82a`                         |
| SaaS / browser mode                                                       | Out of scope until server route exists (Gap D)                                           |

---

## Implementation plan

### Task 1 — Restore `_createBindingFromDomMatch`

Re-introduce the helper `d8874e13` added (and `3bff90dd` removed). Both DOM-text branches in
`_tryDetectI18n` must funnel through it:

- Gap A site (custom + DOM-text shortcut)
- Gap B site (i18next unsupported fallback)

Helper contract (verbatim from `d8874e13`):

```ts
private async _createBindingFromDomMatch(
  domMatch: DomTextI18nMatch,
  library: I18nLibrary,
  requestedLocale: string | undefined,
  sourceLocation: { filePath: string; line: number; column: number },
  confidence: I18nTextBinding['confidence'],
): Promise<I18nTextBinding>
```

Inside: re-resolve via `resolveI18nResource({ activeLocale: requestedLocale ?? domMatch.locale, … })`,
prefer `resolved?.activeLocale` and `resolved?.availableLocales` over the DOM-match values, fall
back to `domMatch.resolvedText` only when `requestedLocale === domMatch.locale`.

Add `writable: resolved?.writable ?? true` on the returned binding (parity with `c5a0c82a`).

### Task 2 — Drop the `unsupported` short-circuit on `resolvedText === null`

`StyleReadService.ts:385–387` — replace the early `return { kind: 'unsupported' }` with a real
binding carrying `resolvedText: null`. The inspector already accepts `null` and renders an
empty input.

### Task 3 — E2E test: locale switch in bulka-the-dog

`ext-test-projects/e2e/tests/project-dependent/bulka-i18n-locale-switch.spec.ts`:

1. Select component with i18n key present in `en` and `ru`.
2. Assert active locale is `en`, text matches dictionary.
3. Click `ru` button.
4. Assert `ru` is active, text now Russian, `en` button no longer highlighted.
5. Click a locale where the key is missing — assert active locale switches, text input empty,
   no console error.

Must be **RED** before Tasks 1–2 land.

### Task 4 — E2E test (merged-TS, Gap E)

Same harness against the merged `translations.ts` element in bulka-the-dog. Confirms read works
post-regression-fix; also confirms `writable` stays correct so the user can still edit text.

### Gap D (SaaS) — out of scope, separate Linear ticket already deferred (2026-05-03)

---

## Invariants

- `availableLocales` populated by `discoverLayout` via `listFiles` (VS Code path).
- `localeEditable = availableLocales.length > 1` — correct, do not change.
- Locale state resets to `undefined` on element change — correct, prevents stale locale bleed.
- `activeLocale` in dep array of `useElementStyleData` — correct, triggers re-read.
- `i18nText: response.i18nText ?? prev.i18nText` — DANGEROUS when the response drops the binding
  (Gap C). Either (a) Gap C fix returns binding always, or (b) the hook needs to clear i18nText
  when the response lacks it. (a) is the chosen path because it's where the truth lives.

## History

- `d8874e13` (2026-05-07) added `_createBindingFromDomMatch` + locale re-resolve.
- `3bff90dd` (2026-05-07/08) reverted that helper while fixing custom-dictionary `editable`.
- `c5a0c82a` (2026-05-08) added `writable: resolved.writable` to two non-DOM paths only.
- This spec (2026-05-08) re-frames the unfinished work as Gap A/B/C and reuses the helper.
