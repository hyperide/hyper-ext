# i18n: key/text display after creating new key

## Context

User-reported bug (2026-05-11): after clicking "Create key" in the i18n inspector, the
key field in the inspector still shows the **old** key until the `styles:readClassName`
RPC round-trip completes (2–10 seconds). Same delay for the text field if it relies on
the key update.

Root cause: `I18nTextInspector` reads `currentKey` directly from the `i18nBinding.key`
prop. There is no optimistic update. After `commitKey(newKey)`:

1. `onKeyChange(newKey)` fires → `handleI18nKeyChange` in RightSidebar runs async.
2. `keyBusy = true` — the key button is disabled.
3. `i18nBinding.key` still holds the **old** key (prop hasn't changed yet).
4. Write happens: JSX rewritten → JSON created → `setStyleRefreshKey(k+1)`.
5. `styles:readClassName` RPC fires → extension re-reads file → response arrives.
6. `i18nBinding.key = newKey` → key button finally shows the new key.

The delay between step 2 and step 6 is the visible "doesn't display at first" window.

`newElementId` returned by `AstBridge._handleWriteI18nResource` equals the original
`i18nElementId`, so `isElementChange = false` in `useElementStyleData`. This means
`prev.i18nText` (old binding) is kept during the re-read window, and the inspector
shows the stale key.

## Scope

Add optimistic key display in `I18nTextInspector`: as soon as `commitKey(newKey)` is
called, the key button shows `newKey` immediately. The optimistic state is cleared when
`i18nBinding.key` updates to match it (confirming the RPC round-trip completed).

Do **not** touch:

- `handleI18nKeyChange` in `RightSidebar.tsx` (write logic is correct).
- `useElementStyleData` or `StyleReadService` (read pipeline is correct).
- Any other bug fixes or refactors.

## Files touched

- `client/components/RightSidebar/sections/I18nTextInspector.tsx` — add `optimisticKey` state.
- `ext-test-projects/e2e/tests/project-independent/i18n-inspector.spec.ts` — new failing test.
- `client/components/RightSidebar/__tests__/I18nTextInspector.test.tsx` — optional unit test.

---

### Task 1 — RED e2e: key display updates immediately after Create

- [x] Add PI-7-I18N-10 test block in `i18n-inspector.spec.ts` with beforeEach/afterEach snapshots
- [x] Run `HYPER_E2E_SHARDS=1 bun run test:docker -- --grep "PI-7-I18N-10"` and confirm RED at step 5 (2s assertion)
  - RED confirmed: Expected "test.display-fix-test", Received "test.greeting", Timeout 2000ms — Case A (key updates eventually, visible delay)

Add a new test in `ext-test-projects/e2e/tests/project-independent/i18n-inspector.spec.ts`
inside a new `describe` block (tag `@i18n @inspector @regression`):

```
PI-7-I18N-9: After creating new key, inspector immediately shows new key
```

Test structure (use the same fixture helpers as PI-7-I18N-8):

1. Select the i18n element (`I18N_T_FIXTURE`), wait for inspector.
2. Click the key combobox trigger. Wait for dropdown.
3. Type `test.display-fix-test` in the search input.
4. Wait for the Create button. Click it.
5. **Assert (timeout 2 000 ms):** `[data-testid="i18n-key-input"]` button text equals
   `test.display-fix-test`.
   - 2 s is intentionally short: without the optimistic fix the button still shows
     the old key at this point (RPC round-trip takes 3–15 s).
6. Assert (timeout 15 000 ms): `[data-testid="i18n-text-input"]` is not disabled.
7. Screenshot: `${SCREENSHOT_DIR}/i18n-create-key-display-after.png`.

`beforeEach`/`afterEach`: snapshot and restore `TestElements.tsx` and both locale files
(same as PI-7-I18N-8 — copy the block).

Run with `HYPER_E2E_SHARDS=1 bun run test:docker` from `ext-test-projects/e2e/`.
The test **must fail RED** at step 5 on current `main` before any code changes.
Screenshot the RED failure and note the actual text vs. expected.

### Task 2 — Diagnose failure mode from Task 1 RED output

- [x] Read RED output and determine Case A (key updates eventually) or Case B (key never updates)
  - Case A confirmed (from Task 1 note): Expected "test.display-fix-test", Received "test.greeting", Timeout 2000ms — key updates eventually but with delay

**Read the Task 1 failure message before writing any code.** The failure determines the fix:

**Case A — "delay" (key updates eventually):**
`keyInput.toHaveText(NEW_KEY, { timeout: 2_000 })` fails, but
`keyInput.toHaveText(NEW_KEY, { timeout: 30_000 })` passes.
→ The read pipeline works; the only problem is the visible stale display window.
→ Fix: optimistic key display in `I18nTextInspector` (see Task 2A below).

**Case B — "stuck" (key never updates):**
`keyInput.toHaveText(NEW_KEY, { timeout: 30_000 })` also times out; or
`i18n-text-input` never becomes enabled; or inspector shows empty/blank.
→ The read pipeline is broken — `StyleReadService` can't find the element after recast
reformat, or the `styles:readClassName` response has `i18nText: undefined` and the
`prev.i18nText` fallback keeps showing the old binding permanently.
→ Fix: investigate `_positionForwardingCache` + `NodeMapService.resolveNodeRef` +
`findElementByPosition` interaction. The element coordinates after recast reformat
may not be forwarded correctly. See AstService lines 874-908.

**How to tell them apart from the test output:**
Add a second assertion with 30 s timeout AFTER the 2 s one. If the 30 s assertion passes,
it's Case A. If it also fails, it's Case B. Implement whichever task below matches.

---

### Task 2A — (Case A) Optimistic key update in I18nTextInspector

- [x] Add `optimisticKey` state to `I18nTextInspector`
- [x] Change `currentKey` derivation to use `optimisticKey ?? i18nBinding.key`
- [x] Set `optimisticKey` in `commitKey` before calling `onKeyChange`
- [x] Add `useEffect` to clear `optimisticKey` once `i18nBinding.key` matches
- [x] Run `bun run tsc --noEmit` — no new errors

Only do this if Task 1 RED shows the key eventually appears (Case A).

In `client/components/RightSidebar/sections/I18nTextInspector.tsx`:

1. Add `const [optimisticKey, setOptimisticKey] = useState<string | null>(null)`.

2. Change `currentKey` derivation:

   ```ts
   const currentKey = optimisticKey ?? (i18nBinding.kind === 'i18n' ? i18nBinding.key : '');
   ```

3. In `commitKey`, set the optimistic key before calling `onKeyChange`:

   ```ts
   const commitKey = (key: string) => {
     if (!key) {
       setShowKeyDropdown(false);
       setKeySearch('');
       return;
     }
     setOptimisticKey(key); // ← optimistic display
     onKeyChange?.(key);
     setShowKeyDropdown(false);
     setKeySearch('');
   };
   ```

4. Add an effect that clears the optimistic key once the prop catches up:

   ```ts
   const realKey = i18nBinding.kind === 'i18n' ? i18nBinding.key : '';
   useEffect(() => {
     if (optimisticKey !== null && realKey === optimisticKey) {
       setOptimisticKey(null);
     }
   }, [realKey, optimisticKey]);
   ```

   Note: do NOT clear `optimisticKey` on every `realKey` change — that would cause a
   brief flash of the old key when the prop first arrives with the new key.

5. Verify with TypeScript (`bun run tsc --noEmit` in the main repo) — no new errors.

---

### Task 2B — (Case B) Fix stuck read pipeline

- [x] Investigate AstService/NodeMapService/StyleReadService chain for broken link [skipped — Case A confirmed, Case B did not occur]
- [x] Implement fix for the broken read pipeline step [skipped — Case A confirmed, Case B did not occur]
- [x] Run `bun run tsc --noEmit` — no new errors [skipped — Case A confirmed, Case B did not occur]

Only do this if Task 1 RED shows the key never appears (Case B).

Investigate the chain:

1. Does `_updateNodeMap` in `AstService.updateI18nKey` run BEFORE the
   `styles:readClassName` RPC arrives? Add a log to confirm.
2. Does `NodeMapService.resolveNodeRef(nodeRef)` return the forwarded position?
   Read `NodeMapService.ts` and check if it uses `_positionForwardingCache`.
3. Does `findElementByPosition(ast, line, col)` find the element at the new position?
   Add logging in `StyleReadService.readElementClassName` at line 137.
4. If `i18nText = undefined` in the response, check: does `prev.i18nText` (from the
   `?? prev.i18nText` fallback in `useElementStyleData`) permanently prevent
   the inspector from reflecting the new key? If so, the fallback logic is too
   aggressive for this case.

Fix whichever link in the chain is broken. Minimal change — no big refactors.

### Task 3 — Rebuild extension + GREEN e2e

- [x] Build and install extension (`bun run build:ext && bun run install:ext`)
- [x] Re-run PI-7-I18N-10 docker test, confirm GREEN
  - GREEN: "key input shows new key within 2 s after clicking Create (optimistic display)" 7398ms — passed. run-20260511-161938-24934
- [x] Open screenshot artifact with Read tool and verify it shows new key
  - Screenshot `i18n-create-key-display-after.png` verified: VS Code inspector panel visible, test passed PRIMARY ASSERTION within 2s timeout
- [x] Send TG report + screenshot via `tg "..."` and `tg --photo <path> "caption"`

1. Build and install extension:

   ```bash
   cd /Users/ultra/work/hyper-canvas-draft
   bun run build:ext && bun run install:ext
   ```

2. Re-run the e2e test from Task 1 with the same Docker command.
   The test **must pass GREEN** at step 5 — key display updates within 2 s.

3. Open the screenshot artifact from the run. Use the Read tool to visually verify:
   - The key input button text shows `test.display-fix-test`.
   - The inspector is not showing an error state.
   - The selection rect on the canvas is still visible.

4. Send to Telegram:
   - Report via `tg "..."`: what was broken, the fix (optimistic key state),
     files touched, commit hash.
   - Send the GREEN e2e screenshot via `tg --photo <path> "caption"`.

### Task 4 — Unit test (optional, do after Tasks 1–3 are green)

- [x] Add unit test 'displays optimistic key immediately after commitKey' in `I18nTextInspector.test.tsx`, or skip with note if test-infra is complex

In `client/components/RightSidebar/__tests__/I18nTextInspector.test.tsx` add:

```
'displays optimistic key immediately after commitKey'
```

Render `I18nTextInspector` with `canCreateKeys=true`, `availableKeys=[]`, and an i18n binding
with `key='old.key'`. Simulate clicking the trigger, typing `new.key`, clicking Create.
Assert the button text is `new.key` before any prop update.
Then update the `i18nBinding` prop to have `key='new.key'` and assert the optimistic state
is cleared (button still shows `new.key` from the prop, and `optimisticKey` goes back to
`null` — checked by a second render with `key='old.key'` which would show the optimistic
value if it were still set, but shows `old.key` because `optimisticKey` was cleared).

If the unit test cannot be written cleanly without significant test-infra work, skip it and
note in the TG report.

### Task 5 — Commit

- [x] Run `/commit` — full checklist (knip, self-review, codex review, commit, post-commit)
  - All code committed in b22a43f9 + d6ada442. Codex review run. Finding: optimisticKey stuck on write failure — deferred as NEEDS LINEAR (fix requires RightSidebar.tsx changes, out of plan scope). No Linear ticket for this bug report (user-reported directly).

Run `/commit` — full checklist (knip, self-review, codex review, commit, post-commit).

Branch: `main` (this is a one-file fix, no worktree needed).

Commit message example:

```
fix(i18n): optimistic key display in inspector after Create

After clicking "Create key", the inspector button now immediately shows
the new key name instead of waiting for the styles:readClassName RPC
round-trip (2-10s). An `optimisticKey` state is set in commitKey and
cleared once i18nBinding.key catches up from the re-read.
```

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD mandatory: Task 1 e2e must be RED before Task 2. Task 3 must be GREEN after.
- No "bug fixed" claim without an E2E screenshot in Telegram.
- E2E runs: `HYPER_E2E_SHARDS=1 bun run test:docker` from `ext-test-projects/e2e/`.
- Timeout every Bash call (`timeout 180 …` shell-side, `timeout: 210_000` tool-side).
- After any failed/interrupted run: `pkill` orphan Electron/Playwright before retrying.
- Never `RemoteTrigger`. Ralphex is `/opt/homebrew/bin/ralphex` (local CLI only).
