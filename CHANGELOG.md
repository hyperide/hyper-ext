# Changelog

All notable changes to HyperCanvas Preview are documented here.

## [0.1.46] — 2026-05-12

### Features

- **Entry file watcher** — extension now watches the router/entry file (`App.tsx`, `main.tsx`, etc.) for git-discard; auto-repatches `/test-preview` route after SCM "Discard Changes" so the preview iframe no longer gets a 404 until the panel is manually closed/reopened (`f898bcdd`)

### Bug fixes

#### i18n key inspector (4 bugs)

- **Sequential key changes** — second key change no longer finds the wrong JSX element after recast/reformat; stale `previousKey` resolved; file-wide fallback added (`df18049f`, `e3e38a8a`, `3c8a620f`, `1b37aed4`)
- **Repeated key change after HMR** — element binding is re-read after every HMR cycle; stale `i18nText` cleared on re-read instead of carrying over the previous binding (`ebb0b6c9`, `d4c4b2c5`)
- **Key button disabled while loading** — prevents a second key write being dispatched before the first one completes (`eea3620b`)
- **Optimistic key display after Create** — inspector shows the newly created key immediately; `commitKey` guarded against no-op when re-selecting the current key; `optimisticKey` rolls back on write failure; `pendingKey` used in text write that follows a Create (`b22a43f9`, `e7e55345`, `48770c80`, `f4bdfa1d`, `cf9e1b13`, `e4cd099b`)
- **canCreateKey** — combobox and "Create" option are now shown even when the element already has a key (`1e3b201c`)
- **Grace cache** — cleared on i18n key write so the selection rect does not stay frozen at the old element position (`e3862428`)

#### Drag & drop

- **Escape cancels drag** — pressing Escape during a drag gesture cleanly aborts the operation (`9c2f54aa`)
- **Ghost background** — transparent elements now pick up background colour from the nearest opaque ancestor, not the element itself (`375599b1`)
- **Selection preserved after drag write** — grace cache is seeded with the dropped element's ref so the overlay rect does not vanish (`a8f97198`)
- **Overlay update during drag** — rect updates on every `pointermove`, not only at drag start/end (`57cb192c`)
- **Flex/grid parent resolution** — element itself is checked for `display:flex/grid` before walking up to the parent; fixes drop-target detection for elements that are themselves flex containers (`f079cf2e`)

#### Locale switcher

- Locale switcher was a no-op — `activeLocale` is now correctly threaded through `StyleReadService` and `useElementStyleData`; switching locale updates the displayed translation immediately (`ac0586c9`, `5b5d3ee0`)

#### Canvas / overlay

- **Selection rect after Fast Refresh** — overlay re-measures on every React Fast Refresh commit, not only on the initial render (`2b4109db`)
- **Shift+Enter parent rect** — `selectParent()` now propagates `itemIndex` so the overlay anchors to the correct instance in repeated-component hosts (`5812c60d`)

### Internal

- `previewPanel.refresh()` removed from `scheduleRepatch()` — was resetting the iframe on every `App.tsx` write including the extension's own entry-file patches, causing E2E hangs (`7e98658a`)

---

## [0.1.45] — 2026-05-09

### Features

- **Shift+Enter parent selection** — `getState()` extended with `selectedItemIndices`; `onSelectElement` callback propagates `itemIndex` so Shift+Enter anchors the overlay to the correct parent instance in repeated components
- **Drag level fix** — `aria-hidden` walk-up and drag source resolution corrected; drag now lifts to the right JSX ancestor

### Bug fixes

- i18n key combobox (b5): available keys shown; key selection writes to the correct locale file
- Selection survives i18n write — grace cache + `mergeInitState` + Vite HMR hook prevent selection loss after key/text change
- Tree ↔ canvas scroll sync (B8): clicking a tree item scrolls the canvas to it and vice versa

---

## [0.1.44] — 2026-05-05

- Inline text editing: double-click on canvas text opens edit mode in place
- i18n text inspector: read and write translation strings from the inspector panel
- Overlay rect anchoring for mapped/repeated components (`shouldSkipNestedMappedSource`)

---

## [0.1.43] — 2026-04-26

- SaaS: browser-based canvas UI connected to Hono server routes
- PreviewProxy: exponential-backoff retry budget (30 s) after dev-server restart

---

## [0.1.42] — 2026-04-20

- Keyboard navigation: `postMessage` to iframe; fuzzy source-cache lookup
- 63 TypeScript errors fixed in extension host

---

## [0.1.41] — 2026-04-14

- `react-vite-tw4-twitter` reference project baseline
- Smoke suite: 12 project-independent specs green
