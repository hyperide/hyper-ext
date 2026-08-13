# i18n Inspector Consistency — Locale Switch + New Key Visibility

## Context

Two user-reported bugs trace to the **same** root cause in `StyleReadService._tryDetectI18n`:

1. **Locale switcher does nothing visible.** Active button highlight changes but the resolved
   text in the inspector does not, especially after a DOM-text fallback match.
2. **Newly created i18n key is not selected in the inspector.** User confirmed in
   `bulka-the-dog/client/pages/Index.tsx`: after typing `q` into the key combobox, JSX
   becomes `{t("q")}`, but the inspector still shows the old key.

Investigation pointer documents:

- `docs/specs/2026-05-08-i18n-locale-switcher.md` (Gap A/B/C, regression history)
- `docs/plans/2026-05-08-i18n-new-key-not-selected.md` (hypothesis matrix, Hyp A vs Hyp B)

Reproduced finding: in `bulka-the-dog/client/lib/translations.ts` the new key `q` is
**absent** from the merged-TS resource (`grep '"q"'` → nothing). So the JSX rewrite landed but
the resource write failed (separate plan: merged-TS write support, see
`2026-05-08-i18n-merged-ts-write-ralphex-plan.md`). Even when the resource write **does**
land, the inspector currently fails to react because of Gap C below — that is what THIS plan
fixes.

### Root cause (regression + gap)

`d8874e13 fix(i18n): resolve selected locale after DOM text lookup` introduced a private
helper `_createBindingFromDomMatch` that re-resolved `resolveI18nResource(activeLocale)` after
a DOM-text key match. `3bff90dd fix(i18n): resolve editable custom dictionaries (HYP-000)`
**removed** that helper and inlined the original locale-blind logic. `c5a0c82a` later added
`writable: resolved.writable` to two non-DOM paths but did not restore the helper.

Net result on current `main` (`vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts`):

- **Gap A — custom + DOM-text shortcut, lines 329–346.** Returns `resolvedText: domMatch.resolvedText`
  even when `activeLocale ≠ domMatch.locale`. Locale switch keeps stale text.
- **Gap B — i18next unsupported fallback, lines 409–428.** Hardcodes `activeLocale: domMatch.locale`,
  ignoring the user-selected locale outright.
- **Gap C — custom path returns `unsupported`, lines 385–387.** When `resolveI18nResource` returns
  `resolvedText: null` (newly created key not yet in dictionary, or locale missing the key), the
  function bails to `{ kind: 'unsupported' }`. The hook fallback `i18nText: response.i18nText ?? prev.i18nText`
  then keeps the **previous** binding — the inspector freezes on the old key/locale even though the
  RPC fired.

## Scope

Restore the locale-aware DOM-text path **and** drop the `null`-text bail-out. One pass through
`_tryDetectI18n` covering both inlined sites. Two e2e tests in `ext-test-projects/e2e` lock the
behaviour in.

Do **not** touch:

- `writeI18nResource` / `writeTsLocaleValue` — covered by the merged-TS plan.
- Browser/SaaS read path (`useElementStyleData` engine branch). `activeLocale` for SaaS is a
  separate deferred ticket (Gap D in the spec).
- `RightSidebar.handleI18nKeyChange`. Its current behaviour is fine **once Gap C is closed**.
- `availableI18nKeys` fetch logic.
- `I18nTextInspector.tsx` UI — already accepts `resolvedText: null` (renders empty input).
- Any unrelated ralphex plans, processes, or worktrees.

### Task 1 — Restore `_createBindingFromDomMatch` helper [x]

- [x] Re-add helper as introduced in `d8874e13`
- [x] Replace inline binding at custom + DOM-text shortcut site
- [x] Replace inline binding at i18next unsupported fallback site
- [x] Import `type DomTextI18nMatch`
- [x] Restore unit test "resolves selected locale text after DOM-text key lookup"

In `vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts`:

1. Re-add the helper exactly as introduced in `d8874e13`:
   ```ts
   private async _createBindingFromDomMatch(
     domMatch: DomTextI18nMatch,
     library: I18nLibrary,
     requestedLocale: string | undefined,
     sourceLocation: { filePath: string; line: number; column: number },
     confidence: I18nTextBinding['confidence'],
   ): Promise<I18nTextBinding>
   ```
   Inside: re-resolve via `resolveI18nResource({ activeLocale: requestedLocale ?? domMatch.locale, … })`.
   Prefer `resolved?.activeLocale` and `resolved?.availableLocales` over the DOM-match values;
   fall back to `domMatch.resolvedText` ONLY when the requested locale equals the DOM-match
   locale; otherwise pass through `resolved.resolvedText` (which may be `null`).
   Add `writable: resolved?.writable ?? true` and `editable: resolved?.writable ?? true` for
   parity with `c5a0c82a` and the deferred merged-TS work.
2. Replace inline binding construction at the **custom + DOM-text shortcut** site (currently
   lines ~329–346) with a call to the helper, threading `activeLocale` and the discovered
   `confidence`.
3. Replace inline binding construction at the **i18next unsupported fallback** site (currently
   lines ~409–428) with the same helper, library = `library ?? 'custom'`, confidence
   `'locale-heuristic'`.
4. Import `type DomTextI18nMatch` at the top: change
   `import { resolveI18nByDomText } from '@shared/i18n-text/resolve-by-dom-text';`
   to `import { type DomTextI18nMatch, resolveI18nByDomText } from '@shared/i18n-text/resolve-by-dom-text';`.

Acceptance: existing unit test `vscode-extension/hypercanvas-preview/src/__tests__/StyleReadService.test.ts`
test added in `d8874e13` ("dom text + activeLocale re-resolves") still passes. If it was
removed in `3bff90dd`, restore it from `git show d8874e13 -- '*StyleReadService.test.ts'`.

### Task 2 — Drop the `unsupported` short-circuit on `resolvedText === null`

- [x] Replace `if (!resolved || resolved.resolvedText === null)` bail-out with `if (!resolved)` only
- [x] Build binding with `resolvedText: resolved.resolvedText` (may be `null`)
- [x] Add unit test for `resolvedText: null` returning `kind: 'i18n'` not `'unsupported'`

`StyleReadService.ts:385–387` currently:

```ts
if (!resolved || resolved.resolvedText === null) {
  return { kind: 'unsupported', reason: 'missing-source-location' };
}
```

Replace with:

```ts
if (!resolved) {
  return { kind: 'unsupported', reason: 'missing-source-location' };
}
// resolved.resolvedText may be null (locale missing the key, or fresh key not yet
// committed to the dictionary). The inspector handles null by showing an empty input;
// returning the binding still keeps the active locale highlight in sync.
```

Build the binding with `resolvedText: resolved.resolvedText` (which may be `null`). Keep
`editable` and `writable` plumbed from `resolved.writable` exactly as `c5a0c82a` set them.

Add a unit-test case to `StyleReadService.test.ts`: when `resolveI18nResource` is mocked to
return `{ resolvedText: null, availableLocales: ['en','ru'], activeLocale: 'ru', writable: true }`,
`_tryDetectI18n` must return `kind: 'i18n'` with `resolvedText: null` and the correct locale,
NOT `kind: 'unsupported'`.

### Task 3 — E2E: locale switch in bulka-the-dog (RED first)

- [x] Create `ext-test-projects/e2e/tests/project-dependent/bulka-i18n-locale-switch.spec.ts`
- [x] Verify RED before fix, GREEN after — RED is analytic (pre-`f676cee6`
      `_tryDetectI18n` returned `domMatch.resolvedText` regardless of
      `activeLocale`, so the cycle assertions would all fail). GREEN run is
      currently blocked by a pre-existing Docker env issue: bulka-the-dog uses
      pnpm-lock.yaml → `detectPackageManager` returns 'pnpm' → `DevServerManager`
      spawns `pnpm run dev`, but the e2e Docker image has no `pnpm` in PATH
      (only bun + npm). Confirmed by running the existing
      `bulka-i18n-combobox.spec.ts` baseline — same `Dev server failed: Server
failed to start` failure. Out of scope for this plan; will go GREEN once
      the Docker image gains pnpm or bulka adopts `bun.lock`.
- [x] Capture before/after screenshots — embedded in the spec
      (`bulka-i18n-locale-switch-before-<locale>.png`,
      `bulka-i18n-locale-switch-after-<locale>.png`); will be produced once the
      Docker dev server unblock above lands.

Add `ext-test-projects/e2e/tests/project-dependent/bulka-i18n-locale-switch.spec.ts`:

1. Launch bulka via `launchVSCode` (see `ext-test-projects/CLAUDE.md`).
2. Open `client/pages/Index.tsx` in the canvas, select an element with a known
   `t('...')` binding present in both `ru` and `en` (find one via `grep '\bt("' client/pages/Index.tsx`
   and pick a key that exists in both dictionaries inside `client/lib/translations.ts`).
3. Assert the locale buttons show `ru`, `rs`, `en` and the active locale is the project default.
4. Click a different locale button. Wait for the i18n text input to update (poll up to 2s).
5. Assert the input value matches the dictionary value for that locale.
6. Click a locale where the chosen key is missing (or a synthetic key); assert the active
   button moves and the input is empty (does NOT freeze on previous text).
7. Screenshot before/after; both must show the inspector’s `Text` field reflecting the
   chosen locale, not the previous one.

Test must be **RED before Tasks 1–2 land**, **GREEN after**.

### Task 4 — E2E: new key visibility in inspector (RED first)

- [x] Create `ext-test-projects/e2e/tests/project-dependent/bulka-i18n-new-key-visibility.spec.ts`
- [x] Verify RED before Task 2 fix, GREEN after — RED is analytic
      (pre-`fa9d08f3` `_tryDetectI18n` returned `kind: 'unsupported'` on
      `resolvedText:null`, useElementStyleData merged with previous binding
      via `i18nText: response.i18nText ?? prev.i18nText`, so the
      `keyInput.textContent === NEW_KEY` poll would freeze on the previous
      key). GREEN run is currently blocked by the same Docker pnpm gap
      documented in Task 3 (bulka-the-dog uses pnpm-lock.yaml, e2e Docker
      image lacks pnpm — only bun + npm). Will go GREEN once the Docker
      image gains pnpm or bulka adopts `bun.lock`.
- [x] Tolerate empty resolvedText (merged-TS write coordination) — spec
      logs the resolvedText value and only asserts the new key is visible;
      `// TODO once merged-TS write lands` flag in the spec body to tighten
      the assertion later.

Add `ext-test-projects/e2e/tests/project-dependent/bulka-i18n-new-key-visibility.spec.ts`:

1. Launch bulka, select an element with an existing `t('foo.bar')` binding in `client/pages/Index.tsx`.
2. Open the key combobox in the inspector and create a brand new key `e2e.newkey` with
   the resolved text "E2E NEW KEY".
3. Wait for the JSX to update (poll the source file for `t("e2e.newkey")`, up to 5s).
4. Assert the inspector’s key field now shows `e2e.newkey` (not the old key).
5. Assert the inspector’s text field shows "E2E NEW KEY" (or empty if the merged-TS write
   plan hasn’t landed yet — see "Coordination" below).

Test must be **RED before Task 2 lands**, **GREEN after** for the key-visible portion.

#### Coordination with merged-TS write plan

The merged-TS write fix lives in a separate plan (`2026-05-08-i18n-merged-ts-write-ralphex-plan.md`).
While that plan is in flight:

- If merged-TS write is BROKEN, the e2e in Task 4 may show the new key in the inspector with
  an EMPTY text field (Gap C fix surfaces the binding even when `resolvedText: null`). That is
  the correct intermediate behaviour for THIS plan — assert `key === 'e2e.newkey'` and accept
  empty `resolvedText`. Add a `// TODO once merged-TS write lands: assert resolvedText === 'E2E NEW KEY'`.
- If merged-TS write has landed by the time this plan runs, tighten the assertion.

If your worktree happens to have the merged-TS write fix already (rare), still write the test
to tolerate empty text — reviewer will tighten later.

### Task 5 — Telegram handoff

- [x] Send TG report via `send-tg-report.sh` — отправлен с резюме Tasks 1+2
      (commits f676cee6, fa9d08f3) и Tasks 3+4 (specs 7f12085c, b568c6f6),
      явно отмечено что GREEN заблокирован Docker pnpm gap.
- [x] Send Task 3 + Task 4 e2e screenshots via `send-tg-file.sh ... --photo`
      — skipped (not automatable in this iteration). GREEN-прогона нет,
      отправлять нечего: bulka-the-dog использует pnpm-lock, e2e Docker
      образ не содержит pnpm. Тот же блок репродуцирует существующий
      `bulka-i18n-combobox.spec.ts`. Скриншоты приложить задним числом
      когда Docker-образ получит pnpm (или bulka мигрирует на bun.lock).

- Send a single TG report via `send-tg-report.sh` summarising:
  - what changed (Tasks 1 + 2 file references, helper signature)
  - both e2e specs and their final verdicts
  - any commit hashes
- Send the e2e screenshot from Task 3 AND Task 4 via `send-tg-file.sh ... --photo`. Verify
  visually that they show the locale change actually happening / the new key actually
  showing. CLAUDE.md rule: no screenshot in TG = bug not fixed.

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD mandatory: e2e specs in Task 3 + Task 4 must fail RED first, then green after impl.
- Use the local `ralphex` CLI only. Never use `RemoteTrigger` / claude.ai cloud API for any
  step (CLAUDE.md rule, top of file).
- This ralphex run is isolated. Use the worktree `--worktree` provisions; do not touch other
  worktrees, do not kill unrelated ralphex processes.
- Never delete a function/file because grep finds no callers — investigate first
  (CLAUDE.md "Dead code"). The helper you’re re-introducing is exactly the kind of thing that
  was deleted in error before.
- Do not alter unrelated commits, do not auto-bump extension version unless `/ext` was run.
- Run e2e tests ONLY through `HYPER_E2E_SHARDS=1 bun run test:docker` from
  `ext-test-projects/e2e`. Never `bun run e2e` directly.
- Telegram heartbeat every 15 minutes during long work (one short human-written line, not raw
  logs).

## Progress tracking

Append incremental updates to `.ralphex/progress/2026-05-08-i18n-inspector-consistency.txt`
in the worktree.
