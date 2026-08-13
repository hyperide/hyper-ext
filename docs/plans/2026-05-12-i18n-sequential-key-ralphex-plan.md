# I18N-KEY-BUG-4: Sequential Key Change — Second Write Never Lands

## Context

### What the test tests

`I18N-KEY-BUG-4: two sequential key changes both land in source file` (lines 325–381 of
`ext-test-projects/e2e/tests/project-independent/bulka-i18n-key-bugs.spec.ts`).

Steps:

1. Select `i18n-t-fixture` element (`<p>{t('test.greeting')}</p>`).
2. First key change: open combobox → pick `test.farewell`. Poll source file until
   `t('test.farewell')` appears (12s timeout). This reliably passes (~2s).
3. Second key change: wait until `i18n-key-input` is **not disabled** (12s timeout).
   Open combobox again → pick `test.greeting`. Poll source file until `t('test.greeting')`
   appears (12s timeout). **This times out** — source stays at `t('test.farewell')`.

### Fix already applied (e3e38a8a)

Commit `e3e38a8a` added position-forwarding cache in `AstService.updateI18nKey`.
After HMR reformats the source file, the element's numeric byte-offset shifts.
The fix carries the post-write element position forward so the next write can find the
element even if the re-read hasn't completed yet.

That fixes the case where the second write fires but hits the wrong byte range.
The test still fails, so a different mechanism is causing the second write to never
fire at all.

### Why it is still failing (hypothesis chain)

The test polls for `keyInput.not.toBeDisabled()` before the second click (line 353).
`keyBusy` prop controls the disabled state:

```tsx
// RightSidebar.tsx:1439
keyBusy={loading || (!!i18nDispatch && !!writeInProgress)}
```

So `keyBusy` is true while either:

- `loading` is true (useElementStyleData is fetching), OR
- `writeInProgress` is non-null.

`writeInProgress` is cleared in the `finally` block of `handleI18nKeyChange` (line 842),
which also calls `setStyleRefreshKey((k) => k + 1)` to kick off a re-read. The `finally`
fires **before** the re-read completes, so `keyBusy` goes false while `loading` is still
transiently false and the new `i18nText` hasn't arrived yet.

The inspector is mounted with `key={bindingKey}` where `bindingKey = ${library}|${key}`
(line 1426). When the re-read returns `i18nText.key === 'test.farewell'`, `bindingKey`
changes from `…|test.greeting` to `…|test.farewell`. React unmounts the old inspector
and mounts a fresh one. The fresh component has `optimisticKey = null` and `realKey =
'test.farewell'`.

**The guard in `commitKey` (I18nTextInspector.tsx line 195):**

```ts
const commitKey = (key: string) => {
  if (!key || key === realKey) {
    setShowKeyDropdown(false);
    setKeySearch('');
    return;          // <-- ABORTS
  }
  …
};
```

The user clicks `test.greeting` in the dropdown. At that moment `realKey` is
`'test.greeting'` **only if** the re-read already returned the updated binding. But the
race is subtler:

- If the re-read has NOT yet returned: `realKey` is still `'test.farewell'`. So
  `key === realKey` is false (`'test.greeting' !== 'test.farewell'`). `commitKey` fires.
  `handleI18nKeyChange` gets called. But at that point `i18nText.key` in RightSidebar
  is still stale (`test.greeting`, the original value before the first write), OR it
  may already be `test.farewell` — depends on exactly when the re-read resolves.

- If the re-read HAS returned AND the inspector remounted: `realKey = 'test.farewell'`,
  the user picks `test.greeting`, `key !== realKey`, `commitKey` fires. Write goes to
  extension. **This should work.**

So the problem is more likely a **timing issue with `keyBusy`**: the test passes
`not.toBeDisabled` while `writeInProgress = null` AND `loading = false`, but `loading`
may briefly be false between `setStyleRefreshKey` increment and the re-render that sets
`loading = true` in `useElementStyleData`. The test clicks during that brief window,
BEFORE the inspector has remounted with `realKey = 'test.farewell'`. The inspector still
shows `optimisticKey = 'test.farewell'` from the first write. `commitKey` is called with
`'test.greeting'`, `realKey` at that point could be `'test.greeting'` (old binding key,
never updated because re-read hasn't fired yet) — so `key === realKey` aborts the write.

Alternatively: `useElementStyleData` is triggered by `refreshKey = styleRefreshKey +
styleVersion`. The `setStyleRefreshKey` in `finally` increments this, but `loading`
state transitions asynchronously. If the test sees `not.toBeDisabled` (both `loading` and
`writeInProgress` falsy) during the gap between the `finally` callback setting
`writeInProgress = null` and `useElementStyleData` setting `loading = true`, the second
click lands on a stale inspector where `realKey` still equals `'test.greeting'` (the
initial value from before write 1) — and `commitKey` aborts.

**Root cause to confirm**: `keyBusy` clears before the re-read starts, opening a window
where the inspector shows stale `realKey`. The `commitKey` guard `key === realKey`
incorrectly aborts the second write because `realKey` is stale.

---

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` **first** — mandatory.
- Write progress to `.ralphex/progress/progress-2026-05-12-i18n-sequential-key.txt`.
- Telegram heartbeat every 15 min.
- Run E2E tests **only** via `HYPER_E2E_SHARDS=1 bun run test:docker` from
  `/Users/ultra/work/ext-test-projects`. Never `bun run e2e` directly.
- Main worktree: `/Users/ultra/work/hyper-canvas-draft`.
- Build extension with `/ext` skill (or `bun run build` in
  `vscode-extension/hypercanvas-preview`), install with
  `code --install-extension ... --force`, then `vscmd workbench.action.reloadWindow`.

---

## Task 1: Add debug logging to confirm the hypothesis

**Goal**: confirm that `commitKey` aborts because `key === realKey` on the second click,
and determine what `realKey` is at that moment.

### 1a. Add debug log in `I18nTextInspector.tsx`

In `commitKey` (line 194 of `I18nTextInspector.tsx`), add a log before the early-return
guard:

```ts
const commitKey = (key: string) => {
  console.warn('[HC i18n-key debug] commitKey called', {
    key,
    realKey,
    optimisticKey,
    keyBusy,
    willAbort: !key || key === realKey,
  });
  if (!key || key === realKey) {
    …
  }
```

### 1b. Add debug log in `handleI18nKeyChange` in `RightSidebar.tsx`

At the top of `handleI18nKeyChange` callback (line 774), log the full state before
the guard:

```ts
console.warn("[HC i18n-key debug] handleI18nKeyChange called", {
  newKey,
  i18nTextKey: i18nText?.kind === "i18n" ? i18nText.key : null,
  lastWrittenI18nKey: lastWrittenI18nKeyRef.current,
  writeInProgress: useSharedEditorState.getState().writeInProgress,
});
```

### 1c. Run the failing test and collect logs

Build and install extension. Run:

```bash
cd /Users/ultra/work/ext-test-projects
HYPER_E2E_SHARDS=1 bun run test:docker -- --grep "I18N-KEY-BUG-4" 2>&1 | tail -100
```

Collect the `[HC i18n-key debug]` lines from stdout. They will show:

- Whether `commitKey` was called for the second click at all.
- If called, whether it aborted and what `realKey` was at that point.
- If `handleI18nKeyChange` was called and what `i18nText.key` was.

**Expected finding**: `commitKey` is called with `key='test.greeting'`,
`realKey='test.greeting'` (stale — re-read not yet done), so it aborts.

---

## Task 2: Investigate `keyBusy` transition timing

**Goal**: understand whether there is a gap between `writeInProgress` clearing and
`loading` going true.

### 2a. Read the `keyBusy` calculation

```tsx
// RightSidebar.tsx line 1439
keyBusy={loading || (!!i18nDispatch && !!writeInProgress)}
```

`writeInProgress` is cleared in the `finally` block of `handleI18nKeyChange`:

- Line 842–843: `if (i18nDispatch && getState().writeInProgress?.writeId === writeId) { i18nDispatch({ writeInProgress: null }) }`
- Line 845: `setStyleRefreshKey((k) => k + 1)` — triggers re-read.

Both happen synchronously in the same `finally` block. React batches state updates, but
`i18nDispatch({ writeInProgress: null })` is a Zustand dispatch (not `setState`), and
`setStyleRefreshKey` is a React setState. They may or may not batch into the same render.

If they batch: `loading` turns true in the same render that `writeInProgress` becomes
null → `keyBusy` stays true throughout. Window is zero.

If they do NOT batch (async context — `finally` is inside an `async` IIFE): Zustand
dispatch and React setState fire at different times. Between them there is one render
where `writeInProgress = null` AND `loading = false` (not yet incremented by
`setStyleRefreshKey`). `keyBusy = false` for one frame.

The test polls `not.toBeDisabled` and Playwright's polling is 100ms+ intervals. If this
gap is even 1–2ms, it's invisible to Playwright. But the `loading` state from
`useElementStyleData` has its own async nature: `setStyleRefreshKey` triggers a
re-render → `useElementStyleData` re-runs → sets `loading = true` only after the
`useEffect` fires. In React 18, effects run asynchronously. There can be multiple renders
between `setStyleRefreshKey` and the effect that sets `loading = true`.

**This is the race**: `keyBusy` becomes false before `loading` goes true again.

### 2b. Check `useElementStyleData` loading flag

Find `useElementStyleData` in the client:

```bash
grep -n "loading\|setLoading\|isLoading" /Users/ultra/work/hyper-canvas-draft/client/hooks/useElementStyleData.ts | head -30
```

Verify whether `loading` is a synchronous state update or async (effect-driven).

---

## Task 3: Fix — delay `keyBusy` release until re-read confirms new binding

The fix must ensure `keyBusy` stays true until `i18nText.key` has caught up to the
value that was just written.

### Option A (recommended): Keep `keyBusy` true while `pendingTextKeyRef` is set

`pendingTextKeyRef.current` is set to `{ key: newKey, elementId }` before the write
starts (line 780) and cleared when `i18nText.key === pendingTextKeyRef.current.key`
(lines 764–769) or when element changes (line 766–767).

This ref already tracks exactly the "write is in flight but inspector not yet updated"
window. Expose it as derived state and include it in `keyBusy`:

```tsx
// In RightSidebar.tsx render body (after pendingTextKeyRef usage):
const isI18nKeyPending =
  pendingTextKeyRef.current !== null &&
  pendingTextKeyRef.current.elementId === selectedId;

// At the I18nTextInspector call:
keyBusy={loading || (!!i18nDispatch && !!writeInProgress) || isI18nKeyPending}
```

This ensures:

1. `pendingTextKeyRef.current` is set before the write (synchronous, before the async
   IIFE).
2. `keyBusy` stays true until `i18nText.key` has updated to the new key AND the
   inspector has remounted with the fresh `realKey`.
3. No race window: even if `writeInProgress` clears before `loading` rises, the
   `isI18nKeyPending` flag stays true.

**Concern**: `pendingTextKeyRef` is a React ref (not state), so changes to it do not
trigger re-renders. `keyBusy` won't re-evaluate when `pendingTextKeyRef` changes. Need
to convert to state or use a derived state that reacts to `i18nText.key` changes.

**Better approach**: compute `isI18nKeyPending` from state rather than ref. Add a
`useState` for pending key instead of (or alongside) the ref:

```tsx
const [pendingKeyWrite, setPendingKeyWrite] = useState<{ key: string; elementId: string } | null>(null);
```

Set it at the start of `handleI18nKeyChange` (same place as `pendingTextKeyRef`):

```tsx
setPendingKeyWrite({ key: newKey, elementId: effectiveSelectedId });
```

Clear it when `i18nText.key` catches up:

```tsx
// In existing render logic (lines 764-770), also call:
// setPendingKeyWrite(null)
// But this is in render body — use useEffect instead:
useEffect(() => {
  if (pendingKeyWrite === null) return;
  if (pendingKeyWrite.elementId !== selectedId) {
    setPendingKeyWrite(null);
    return;
  }
  if (i18nText?.kind === "i18n" && i18nText.key === pendingKeyWrite.key) {
    setPendingKeyWrite(null);
  }
}, [i18nText, selectedId, pendingKeyWrite]);
```

Then:

```tsx
const isI18nKeyPending = pendingKeyWrite !== null && pendingKeyWrite.elementId === selectedId;
keyBusy={loading || (!!i18nDispatch && !!writeInProgress) || isI18nKeyPending}
```

### Option B (simpler, possibly sufficient): Bump `styleRefreshKey` BEFORE clearing `writeInProgress`

Swap the order in `finally`:

```ts
setStyleRefreshKey((k) => k + 1); // triggers loading=true first
// then:
if (i18nDispatch && …writeId === writeId) { i18nDispatch({ writeInProgress: null }); }
```

If React batches these two state updates together (both in the same sync flush), `loading`
becomes true in the same render that `writeInProgress` becomes null → `keyBusy` never
drops to false. Requires verifying that React actually batches these two updates.

Downside: relies on React 18 automatic batching, which applies to async contexts but is
not explicitly guaranteed here. Less robust than Option A.

**Recommendation**: implement Option A (`pendingKeyWrite` state). It is explicit and
correct regardless of React batching behavior.

### 3a. Implement the fix

In `/Users/ultra/work/hyper-canvas-draft/client/components/RightSidebar/RightSidebar.tsx`:

1. Add `const [pendingKeyWrite, setPendingKeyWrite] = useState<{ key: string; elementId: string } | null>(null);` near the other i18n state (around line 214).
2. At the top of `handleI18nKeyChange`, after `pendingTextKeyRef.current = { key: newKey, ... }`, also call `setPendingKeyWrite({ key: newKey, elementId: effectiveSelectedId })`.
3. In the catch block and the `finally` cleanup, clear `pendingKeyWrite` on failure:
   in the `catch` block add `setPendingKeyWrite(null);`.
4. Add a `useEffect` (after the existing selectedId-reset effect around line 283) that
   clears `pendingKeyWrite` when `i18nText.key` catches up or element changes.
5. Compute `isI18nKeyPending` from `pendingKeyWrite`.
6. Add `|| isI18nKeyPending` to the `keyBusy` prop at line 1439.
7. Also reset `pendingKeyWrite` in the `selectedId` reset `useEffect` (line 283):
   `setPendingKeyWrite(null);`.

Build and install extension.

---

## Task 4: Confirm GREEN in Docker

Run the full Bug 4 test in Docker:

```bash
cd /Users/ultra/work/ext-test-projects
HYPER_E2E_SHARDS=1 bun run test:docker -- --grep "I18N-KEY-BUG-4" 2>&1 | tail -80
```

Expected: `1 passed`.

Also run the full i18n key bugs suite to confirm no regression:

```bash
HYPER_E2E_SHARDS=1 bun run test:docker -- --grep "I18N-KEY-BUG" 2>&1 | tail -120
```

Expected: all 4 bugs (Bug 1–4) GREEN.

Save screenshots:

- `/tmp/i18n-bug4-second-change.png` — captured by the test automatically.
- `/tmp/i18n-key-bugs-all-green.png` — terminal output or Playwright HTML report.

---

## Task 5: TG report

Send via `send-tg-report.sh`:

- Root cause: `keyBusy` dropped false between `writeInProgress` clearing and `loading`
  rising — stale `realKey` in inspector caused `commitKey` to abort second write.
- Fix: `pendingKeyWrite` React state keeps `keyBusy` true until `i18nText.key`
  confirms the new key.
- Test result: I18N-KEY-BUG-4 GREEN, all 4 i18n key bugs still GREEN.
- Before/after screenshot.
