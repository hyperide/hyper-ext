# Selection still flickers / drops on certain elements after i18n write

## User report (2026-05-06 14:30)

After selsurv merge user confirmed selsurv works for some cases. But:
- `<p className="text-xl font-semibold text-primary italic">{t("hero.question")}</p>`
  → flicker + selection LOST after i18n write.
- Other elements just flicker but stay selected at the end.

So the grace-cache + mergeInitState fix is partial. Some path still wipes
the selection without recovery.

## Hypotheses

A. **Grace cache miss for this specific element** — its bounding box is
   captured but pruned too aggressively. Inspect `selection-grace-cache.ts`:
   what triggers prune for an ID still in `state.selectedIds`?
B. **HMR full-page reload (not fast refresh) for this element** — the entire
   iframe document reloads, the cache is wiped along with it. Fast refresh
   keeps the cache; full reload doesn't. Need cache persistence across
   iframe reload (e.g. session storage or webview state).
C. **`<p>` with multiple inline children** (italic + semibold) generates
   intermediate React fibers that don't carry source maps; after HMR,
   `findElementById` walks past them and returns null. The grace cache
   replays for ≤800ms then expires. If HMR settle takes >800ms for this
   path, the recovery times out.

## Tasks

### Task 1: Reproduce + measure HMR timing

- [ ] Open bulka Index.tsx, select `t('hero.question')` `<p>`.
- [ ] Change key. Capture timestamps of:
      - selection state change events
      - vite:beforeUpdate / vite:afterUpdate
      - findElementById return value (null vs element)
      - grace-cache prune events
- [ ] Find the moment selection is dropped without recovery.

### Task 2: Extend grace TTL or persist across reload

- [ ] If HMR full reload exceeds 800ms, raise to 2500ms.
- [ ] If HMR fully unloads the iframe (proven by document.readyState
      transition), persist the last known rect to webview storage and replay
      after the new iframe boots.

### Task 3: Survive nested-fiber resolution miss

- [ ] If `findElementById(id)` returns null but a child element under the
      same fiber path matches, use that child. Walk from any same-fileName
      DOM node toward the closest source.

### Task 4: E2E frame-by-frame for this exact case

- [ ] Use `bulka-the-dog/client/pages/Index.tsx` as fixture. Select the
      `<p>` with `t('hero.question')`. Trigger key change. Capture frames at
      0/100/300/500/800/1200/1800ms. Assert outline visible in EVERY frame
      and on the same source location.

### Task 5: Build, install, screenshot, TG

- [ ] Run E2E against bulka-the-dog. Open every passed frame via Read.
- [ ] Send only when outline is present in the LAST frame; otherwise the
      fix is not done.
