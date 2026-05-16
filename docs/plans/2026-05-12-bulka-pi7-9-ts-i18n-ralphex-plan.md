# bulka-i18n-pi7-9: TypeScript translations.ts i18n read/write E2E

## Context

`bulka-i18n-pi7-9.spec.ts` contains three tests for PI-7 Task 9 (TypeScript merged format):

1. `text input shows translation from translations.ts and accepts typed input` — **SKIPPED** in Docker (h1#hero-title not found in canvas).
2. `editing hero.title updates translations.ts and the preview h1 text` — **FAILED** both retries in shards 2 and 3, run-20260512-002106-89890, ~19s per attempt.
3. `key combobox on h1#hero-title shows keys from translations.ts (TS merged format)` — not yet observed.

### What was done

- Branch `i18n-merged-ts-write-ralphex-plan` (commits `2bcd20a9`, `c7806d06`, `7b1ebfa4`) **is on main** — confirmed via `git rev-list main | grep 7b1ebfa4`.
- Unit tests for merged-TS write pass (Task 1 of that plan).
- `BULKA-I18N-CREATE-KEY-MERGED-TS` E2E spec passes (run-20260511-172117-72708).
- `bulka-i18n-pi7-9.spec.ts` was authored in Task 3 of that plan but the RED-RUN was explicitly deferred (`d7e878d8 feat(i18n-merged-ts-write): Task 3 — e2e spec authored, RED-RUN deferred`).

### Current failure pattern

From Docker run-20260512-002106-89890 shard-2:
- "text input shows translation..." → **skipped** (3189ms). The spec's skip guard fires because `h1#hero-title` is not found in the canvas. This means the canvas preview either failed to load bulka-the-dog or loaded a different project.
- "editing hero.title updates translations.ts..." → **failed** (19646ms). Runs ~19s and fails. The spec comment says "expected to fail at `not.toBeDisabled()` assertion", meaning `i18n-text-input` stays disabled.

### Root cause hypothesis

Two separate issues may stack:

1. **Canvas not loading bulka project** — some workers have the wrong project in VS Code when `setupPreviewWithDevServer(window)` auto-detects. This is the same issue as `bulka-canvas-discard-no-crash.spec.ts`. If the canvas loads `react-vite-tw4-twitter` instead of `bulka-the-dog`, the i18n section for translations.ts is never shown (wrong elements, no `h1#hero-title`).

2. **`i18nText.editable = false` for translations.ts** — even when the correct project loads, the inspector might mark the text as non-editable because `StyleReadService.getI18nText()` returns `writable: false` for TypeScript-format locale files. Commit `c5a0c82a fix(StyleReadService): pass writable through to I18nTextBinding` was supposed to fix this.

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD: tests exist, goal is GREEN.
- Write progress to `.ralphex/progress/progress-2026-05-12-bulka-pi7-9.txt`.
- TG heartbeat every 15 min.
- E2E ONLY via `HYPER_E2E_SHARDS=1 bun run test:docker -- --grep "PI-7-9\|hero.title\|translations.ts"`.
- Main worktree: `/Users/ultra/work/hyper-canvas-draft`.

### Task 1: Isolate: does the test load the right project?

Run the three pi7-9 tests in isolation with extra diagnostics:

```bash
cd /Users/ultra/work/ext-test-projects/e2e
HYPER_E2E_SHARDS=1 bun run test:docker -- \
  --project="dep:bulka-the-dog" \
  tests/project-dependent/bulka-i18n-pi7-9.spec.ts 2>&1 | tail -60
```

Check:
- `[setupPreview +*ms] entry:auto-detected` — does it show `projectDir="bulka-the-dog"`?
- Does `h1#hero-title` check pass or skip?
- If it skips: the project loading is wrong → fix is same as bulka-discard plan Task 1 (pass component path explicitly to `setupPreviewWithDevServer`).

### Task 2: If canvas loads bulka: check editability

If the canvas correctly loads bulka but the i18n text input is disabled:

- [ ] In extension source: `grep -n "writable\|editable\|translations\.ts" lib/style-read-service/` — find where `writable` is determined for TypeScript locale files.
- [ ] Check `StyleReadService.getI18nText()` return value for bulka's `translations.ts`. Does it set `writable: true`?
- [ ] If `writable: false`: the merged-TS write adapter returns `readonly` for the file. Find the `isFileWritable()` check in `writeI18nResource` or the read path and fix.
- [ ] After fix: run test in isolation, confirm input is enabled.

### Task 3: If canvas loads bulka and input is enabled: check write path

If the test gets past "not.toBeDisabled()" but `translations.ts` doesn't update:

- [ ] Read the write adapter for merged-TS format (`writeI18nResource` in `lib/i18n-write-service/`).
- [ ] Verify the update is targeting the right key (`hero.title`).
- [ ] Check if HMR re-reads the updated file and updates the preview h1.
- [ ] Add `console.log` diagnostics in the write path, run again, read output.

### Task 4: Confirm GREEN

Run `HYPER_E2E_SHARDS=1 bun run test:docker -- --project="dep:bulka-the-dog" tests/project-dependent/bulka-i18n-pi7-9.spec.ts` and confirm all three tests PASS (not skip, not fail).

Screenshot the GREEN result.

### Task 5: TG report

Send via `cd /Users/ultra/xp/codex-tg-bot && bash scripts/send-tg-report.sh`:
- Which task fixed it (project load or editability or write path)
- Files changed, commits
- Screenshot of all 3 pi7-9 tests GREEN
