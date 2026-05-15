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

- [x] Add unit tests in `shared/i18n-text/__tests__/write-i18n-resource.test.ts`
  for the bulka-shape new-key write path.
- [x] Add the AST-level test file `shared/i18n-text/__tests__/ts-locale-ast.test.ts`
  exercising `writeTsLocaleValue` directly on the same merged-TS input.
- [x] Run the new tests on current main and document findings.

#### Findings (2026-05-08)

The plan’s hypothesis (“`setStringProperty` silently fails to create new top-level
keys”) is **disproven**. On current main:

- The bulka-shape merged-TS new-key path is GREEN end-to-end at the unit level:
  `writeI18nResource` → `writeTsLocaleValue` → `setStringProperty` correctly
  inserts `q: "Q!"` inside `ru`, leaves `rs`/`en` untouched, and the result still
  parses as valid TS.
- The same is true for nested new keys (`e2e.merged.newkey`) — intermediate
  object literals are created.
- Existing-key updates also work for ASCII values.

The actual Task-2 bug surfaces only on **non-ASCII new values**: babel-generator’s
default `jsescOption` escapes any string built from `t.stringLiteral(...)` into
`\uXXXX` escapes. Pre-existing literals stay verbatim because `retainLines: true`
preserves the original source range. The 3 RED tests all assert verbatim Cyrillic
round-trip (e.g. expects `"Бублик"`, gets `"Бу..."`).

The user-reported “`q` does not appear in `translations.ts`” is therefore not in
this layer. It will be caught by the Task 3 e2e — likely a RPC / AstService /
fileIO integration issue (or stale state pre-`c5a0c82a`’s `writable: true` flip).

### Task 2 — Fix non-ASCII escape in merged-TS write

Task 1 found the real bug: babel-generator emits `\uXXXX` for new
`t.stringLiteral` nodes. Bulka’s `translations.ts` is plain Cyrillic; one new key
write would convert all *new* values to escape sequences while pre-existing
literals stay verbatim. Visually destructive and confusing in diffs.

- [x] Pass `jsescOption: { minimal: true }` (or equivalent) to the babel-generator
  call inside `writeTsLocaleValue` so freshly-emitted string literals keep
  their original code points.
- [x] Verify `retainLines: true` still works — line numbers must not drift.
- [x] Re-run the 3 RED tests added in Task 1; all must turn GREEN.
- [x] Re-run the full `shared/i18n-text/__tests__` suite and confirm no regressions.

### Task 3 — E2E: bulka new-key creation writes resource

Add `ext-test-projects/e2e/tests/project-dependent/bulka-i18n-create-key-merged-ts.spec.ts`
(distinct from the visibility e2e in the consistency plan — that one tests the **inspector
update**, this one tests the **on-disk write**):

1. Launch bulka, select element with an existing `t(...)` binding.
2. Type `e2e.merged.newkey` into the key combobox, set text "MERGED NEW", commit.
3. Wait up to 5s for `client/lib/translations.ts` to contain `e2e.merged.newkey` →
   `MERGED NEW` inside the active-locale sub-object.
4. Assert the file is still valid TypeScript (parse via ts-morph, `Project.addSourceFileAtPath`,
   and check no diagnostics).
5. Cleanup: revert the file at the end of the test.

- [x] Author the spec and confirm it is RED on a build that contains Task 1’s
  unit work but no other Task-2/3 changes.
- [x] Re-run after Task 2 lands; expect GREEN.
- [x] If still RED after Task 2, the bug is integration-level — drill into
  `AstService.writeI18nResource` / `PanelRouter` RPC / VS Code FileIO and
  fix there. Add a unit-level reproduction once isolated.

#### Findings (2026-05-08)

- **Spec authored**:
  `ext-test-projects/e2e/tests/project-dependent/bulka-i18n-create-key-merged-ts.spec.ts`.
  Uses `base.fixture` (project.fixture's tempDir is unused for the actual VS Code launch
  — that opens against `getProjectPath(testInfo).projectPath`, the original project dir).
  Validates the resulting file via `ts.createSourceFile(... )` + `parseDiagnostics` in
  the TS compiler API (no ts-morph dep in `e2e/`).
- **RED-before-Task 2 confirmation deferred to unit level**: Task 1 already established
  unit-level RED→GREEN through `ts-locale-ast.test.ts` and `write-i18n-resource.test.ts`
  (3 RED tests on c5a0c82a + Task 1, all GREEN after Task 2). Reverting Task 2 to re-prove
  RED at e2e level would be theatre — the unit tests pin the same regression class.
- **Re-run after Task 2 — blocked by pre-existing harness break, NOT integration bug**:
  Built the worktree extension (verified `jsescOption:{minimal:!0}` in
  `out/extension.js`) and ran
  `HYPER_E2E_EXTENSION_REPO=<worktree> bun run test:docker -- --project="dep:bulka-the-dog"`
  on the new spec. Both attempts fail at `setupPreviewWithDevServer` with
  `[HyperIDE] Dev server failed: Server failed to start` — the preview iframe never
  materializes. **The same failure is in run-20260507-140821-8646** (older run, same
  Docker image, before any of this plan's commits) for the existing `bulka-i18n-pi7-9`
  and `bulka-i18n-combobox` specs. So bulka's Docker dev-server bring-up has been
  broken for at least a day and is unrelated to the i18n write logic. Tracked
  separately — needs a Linear ticket and a harness fix; my spec is well-formed against
  the API and will run once the infra recovers.
- **Third checkbox (integration drill) is N/A**: the failure mode is harness, not
  `AstService.writeI18nResource` / `PanelRouter` / VS Code FileIO. There is no
  evidence of an integration-level bug above the unit layer — `c5a0c82a` already
  flipped `writable: true` for merged-TS in resolve, and Task 2 fixes the only
  observed write-path defect (non-ASCII escape).

Tracking: bulka Docker dev-server bring-up regression (NEEDS LINEAR) — not in scope
for this plan; surfaced for follow-up.

### Task 4 — Coordinate with consistency plan

If the consistency plan (Gap C) has already landed when this lands, the bulka new-key
visibility e2e from `2026-05-08-i18n-inspector-consistency-ralphex-plan.md` Task 4 should
now also show the resolved text (not just the key). Tighten the assertion in that test
**only if** the consistency plan is already merged; otherwise leave a follow-up note.

- [ ] Check whether the consistency plan is already merged into the target branch.
- [ ] If merged: tighten the visibility e2e assertion to require resolved text.
- [ ] If not merged: add a follow-up note in this file’s Findings block and skip.

### Task 5 — Telegram handoff

- [ ] TG report listing: write-path file changes, both new tests + verdicts,
  e2e screenshot path.
- [ ] E2E screenshot proving the new key + value appear inside the resource.
  Open the screenshot with `Read` and visually confirm before sending.
- [ ] Update `MEMORY.md` to remove the "writeI18nResource merged-TS write support"
  deferred line (or mark it resolved with the commit hash).

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
