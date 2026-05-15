# i18n Merged-TS Write Support — `writeTsLocaleValue` for new keys

## Context

`bulka-the-dog/client/lib/translations.ts` is the canonical merged-TS i18n format:

```ts
export const translations: Translations = {
  ru: { brand: { name: "..." }, nav: { ... }, ... },
  rs: { ... },
  en: { ... },
};
```

When the user creates a new key via the i18n inspector key combobox, the JSX rewrite
**lands** (`{t("q")}` appears in `client/pages/Index.tsx`), but the resource write does
**NOT** add `q` to `translations.ts`. `grep '"q"' client/lib/translations.ts` returns nothing.

This is the deferred ticket logged in `MEMORY.md` (2026-05-06):
> writeI18nResource merged-TS write support. bulka-the-dog and any project using a merged
> `translations.ts` export hits `writable: false` from `resolveI18nResource` … decouple
> `editable` from `writable` … pinned RED by `e2e/tests/project-dependent/bulka-i18n-pi7-9.spec.ts`.

`c5a0c82a` (2026-05-08) lifted `writable: true` for merged-TS in **resolve**. The deferred
write side, however, is still unverified end-to-end. The actual code path:
- `client → ast:writeI18nResource RPC → PanelRouter → AstService.writeI18nResource → shared/i18n-text/write-i18n-resource.ts`
- For a `.ts` layout: `writeTsLocaleValue(content, activeLocale, key, value)` from `shared/i18n-text/ts-locale-ast.ts`.
- For merged-TS: helper picks `localeProp = ru/en/rs`, recurses into the locale object, calls
  `setStringProperty(targetObject, key, value)`.

Hypothesis (verify in Task 1): `setStringProperty` succeeds for **existing** flat keys but
silently fails to **create** a new property at top level when the merged sub-object is large
or uses nested convention. Or `getObjectProperty` returns the wrong prop value type.
**Investigate before fixing.**

## Scope

Make `writeI18nResource` actually write a new key into a merged-TS file, end-to-end. Failure
modes that already work — single-locale TS, single-locale JSON, namespaced JSON — must keep
working. Existing tests in `shared/i18n-text/__tests__/write-i18n-resource.test.ts` and
`ts-locale-ast.test.ts` must stay green.

Do **not** touch:
- The locale-aware read path (`StyleReadService._tryDetectI18n`) — covered by
  `2026-05-08-i18n-inspector-consistency-ralphex-plan.md`.
- JSON, namespaced, or single-file-per-locale TS write paths unless the unit test demands it.
- `I18nTextInspector` UI / `RightSidebar.handleI18nKeyChange`.
- `bulka-the-dog/client/pages/Index.tsx` — clean up any stray `t("q")` left from manual
  testing only at the END of the run, in a separate cleanup commit (or leave it; user can
  remove).

### Task 1 — Reproduce + isolate

Add a unit test in `shared/i18n-text/__tests__/write-i18n-resource.test.ts`:
- Input: a small merged-TS string mirroring bulka’s shape:
  ```ts
  export const translations: Translations = {
    ru: { brand: { name: "Булка" } },
    en: { brand: { name: "Bun" } },
  };
  ```
- Call `writeI18nResource({ library: 'custom', key: 'q', activeLocale: 'ru', newText: 'Q!', … })`
  using an in-memory `fileIO`.
- Expect: `success: true`, file content now includes `q: "Q!"` inside the `ru` object.
- Test must be **RED on current main**.

Also reproduce at the AST helper level: a unit test in
`shared/i18n-text/__tests__/ts-locale-ast.test.ts` calling `writeTsLocaleValue(content, 'ru', 'q', 'Q!')`
on the same input. Confirms whether the bug is in `writeTsLocaleValue` directly or higher up.

### Task 2 — Fix `writeTsLocaleValue` for merged-TS new keys

Likely culprits inside `setStringProperty`:
- May only mutate existing properties; new-property branch may not insert into the object
  literal at all.
- May call `t.objectProperty` wrong, or fail to push into `properties` array.
- May not handle the case where the locale value is identifier (`ru: ruDict`) vs inline
  literal — `objectFromExpression` should be probed.

Diagnose, fix, keep `retainLines: true` so line numbers don't drift. Verify the generated TS
parses again (write a parse step in the test).

For nested keys (`a.b.c`), `setStringProperty` should create intermediate object properties
the same way the JSON path does in `setKey` (see `write-i18n-resource.ts:74–84`). If it
doesn’t, mirror that behaviour.

### Task 3 — E2E: bulka new-key creation writes resource

Add `ext-test-projects/e2e/tests/project-dependent/bulka-i18n-create-key-merged-ts.spec.ts`
(distinct from the visibility e2e in the consistency plan — that one tests the **inspector
update**, this one tests the **on-disk write**):

1. Launch bulka, select element with an existing `t(...)` binding.
2. Type `e2e.merged.newkey` into the key combobox, set text "MERGED NEW", commit.
3. Wait up to 5s for `client/lib/translations.ts` to contain `"e2e.merged.newkey": "MERGED NEW"`
   inside the active-locale sub-object.
4. Assert the file is still valid TypeScript (parse via ts-morph, `Project.addSourceFileAtPath`,
   and check no diagnostics).
5. Cleanup: revert the file at the end of the test.

Must be **RED before Task 2 lands**, **GREEN after**.

### Task 4 — Coordinate with consistency plan

If the consistency plan (Gap C) has already landed when this lands, the bulka new-key
visibility e2e from `2026-05-08-i18n-inspector-consistency-ralphex-plan.md` Task 4 should
now also show the resolved text (not just the key). Tighten the assertion in that test
**only if** the consistency plan is already merged; otherwise leave a follow-up note.

### Task 5 — Telegram handoff

- TG report listing: write-path file changes, both new tests + verdicts, e2e screenshot.
- E2E screenshot proving `q`-equivalent key + value appear inside the resource. Visual check
  before sending.
- Update `MEMORY.md` to remove the "writeI18nResource merged-TS write support" deferred line
  (or mark it resolved with the commit hash).

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD mandatory: unit tests in Task 1 + e2e in Task 3 must be RED first.
- Use the local `ralphex` CLI only. Never use `RemoteTrigger` / claude.ai cloud API.
- This ralphex run is isolated. Use the worktree `--worktree` provisions; do not touch other
  worktrees, do not kill unrelated ralphex processes.
- Never delete a function/file because grep finds no callers — investigate first
  (CLAUDE.md "Dead code").
- Run e2e tests ONLY through `HYPER_E2E_SHARDS=1 bun run test:docker`.
- Telegram heartbeat every 15 minutes (short summaries, not logs).

## Progress tracking

Append incremental updates to `.ralphex/progress/2026-05-08-i18n-merged-ts-write.txt`
in the worktree.
