# Preview-as-app in-preview navigation — approach comparison

> Created: 2026-06-20
> Status: implemented (all three strategies selectable; `history-bridge` is the default)
> Scope: SaaS canvas "preview as app" mode. The VS Code extension is unaffected (it serves the
> preview without a path prefix, so every strategy degrades to plain history navigation there).

---

## The problem

The SaaS serves the previewed user app in an iframe under a **path prefix**:

```
/project-preview/<projectId>/test-preview?component=src/App.tsx&app=1
```

`server/proxy-path-bridge.js` is injected into the served HTML `<head>` (before any user code) and
monkey-patches `fetch` / `XHR` / `WebSocket` / `EventSource` / `history.pushState` / `Image.src` /
`script.getAttribute` to **prefix every absolute path** with `/project-preview/<id>`. That is what
makes assets, HMR and API calls work transparently for an app that thinks it lives at `/`.

A single-component preview never exercises the app's router, so this was invisible. **App-mode runs
the real router for the first time.** The previewed app's router is a `<BrowserRouter>` with **no
`basename`**. It reads `window.location.pathname`, which under the proxy is
`/project-preview/<id>/settings`, and matches it against its own route table (`/settings`):

```
router sees:   /project-preview/abc123/settings
route table:   /  /settings  /users/:id
match:         none  →  catch-all / blank
```

The preview boots at `…/test-preview`, which matches nothing either, so the raw app shows its
catch-all. **In-preview navigation must make the app's router see the UNPREFIXED path.**

The naive fix — `history.pushState({}, '', '/settings')` — does **not** work: the proxy bridge's
patched `pushState` re-prefixes it to `/project-preview/<id>/settings`, so the router still sees the
prefix. (This exact failure is reproduced as a passing test: see Verification below.)

---

## Comparison at a glance

| Dimension                                      | A. basename-injection                                                    | B. history-bridge (DEFAULT)                                                                                                                                                | C. iframe src-swap                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mechanism                                      | router runs with `basename=<prefix>`; it strips the prefix internally    | drive the router to the UNPREFIXED path via the bridge's original (non-prefixing) `pushState`                                                                              | reset `iframe.src` to the proxied route; app boots fresh                                                                                                                                                               |
| Address bar shows                              | unprefixed (`/settings`)                                                 | unprefixed (`/settings`)                                                                                                                                                   | unprefixed (`/settings`)                                                                                                                                                                                               |
| Browser URL (`location.pathname`)              | prefixed (`/project-preview/<id>/settings`)                              | unprefixed (`/settings`)                                                                                                                                                   | prefixed (boots at `…/test-preview?route=/settings`)                                                                                                                                                                   |
| Full reload per nav                            | no                                                                       | **no**                                                                                                                                                                     | **yes** (state loss, slower)                                                                                                                                                                                           |
| Relative `fetch('api/x')` after nav            | works (URL prefixed)                                                     | works — bridge re-roots relative/absolute same-origin URLs under the prefix when location is unprefixed                                                                    | works — same bridge re-rooting (src-swap also runs the router unprefixed)                                                                                                                                              |
| **Reload-safe after nav**                      | **yes** (URL stays prefixed)                                             | **NO** — app-internal `location.reload()` requests the unprefixed path off the proxy                                                                                       | **partial** — the canonical `iframe.src` stays proxied so HOST re-navigation re-boots cleanly, but an app-internal `location.reload()` lands unprefixed too (src-swap runs the router unprefixed, like history-bridge) |
| Back / forward                                 | works                                                                    | works                                                                                                                                                                      | works (each nav is a real history entry)                                                                                                                                                                               |
| Framework coverage                             | per-framework (RR `basename`, Next `basePath`, Remix differ)             | **framework-agnostic** (any history router)                                                                                                                                | **framework-agnostic** (any router boot-matches)                                                                                                                                                                       |
| Hash routers (`createHashRouter`/`HashRouter`) | n/a                                                                      | not navigable (driver writes pathname, not `location.hash`)                                                                                                                | not deep-linkable                                                                                                                                                                                                      |
| Couples to user's router                       | **yes** — we must own the router instantiation (wrapper or code-rewrite) | no                                                                                                                                                                         | no                                                                                                                                                                                                                     |
| Where it breaks                                | raw render of the user's own `<BrowserRouter>` — we don't own it         | a FULL reload after navigation (URL is unprefixed → off the proxy; relative `fetch` is re-rooted by the bridge so it's fine); apps that bypass History (`location.assign`) | every nav reloads (HMR-like flash, loses in-app state)                                                                                                                                                                 |
| Code added                                     | shared prefix detection + a basename the host can't always inject        | original-`pushState` exposure in the bridge + strategy-aware driver                                                                                                        | `route=` boot param + imperative `iframe.src` reset                                                                                                                                                                    |

Default: **B (`history-bridge`)**. Reasoning under "Recommendation".

---

## A. basename-injection

### Mechanism

React Router (v6) `<BrowserRouter basename="/project-preview/abc123">` (or the data-router
`createBrowserRouter(routes, { basename })`) reads `window.location.pathname`, **strips the
basename**, and matches the remainder. So under the proxy the prefixed `location` is exactly what a
basename router wants: it sees `/project-preview/abc123/settings`, strips `/project-preview/abc123`,
matches `/settings`. To navigate, `navigate('/settings')` writes the prefixed path back — which is
precisely what the proxy's already-patched `pushState` does for us. So the `basename` strategy's
navigation primitive uses the **normal (patched) pushState**.

### Why it works

The prefix is detected the same way the bridge detects it
(`detectPreviewPrefix(window.location.pathname)` in
`shared/components/preview-chrome/nav-strategy.ts`, mirroring the bridge regex), and handed to the
router as its basename. The address bar shows the stripped path; the browser URL stays prefixed; the
router matches.

### Where it breaks — the honest part

**We do not own the user's router instantiation.** In app-mode A we render the user's `App.tsx`
**raw**, and its `<BrowserRouter>` lives inside their code with no `basename`. There is no global
"ambient basename" in React Router that a wrapper can set without rewriting the user's JSX. So A is
only _cleanly_ implementable when **we** create the router:

- **Wrapper injection** — works only for routers the preview generator instantiates itself (e.g. the
  Remix memory-router mock in `generator.ts`). Not applicable to the raw `App.tsx` case, which is the
  whole point of app-mode.
- **Code-rewrite at generation time** — rewrite the detected `<BrowserRouter>` /
  `createBrowserRouter(...)` in the user's source to inject `basename`. Invasive (mutates user code),
  fragile (must recognize every router shape and the call site), and per-framework.

Framework coverage is also **per-framework**: React Router uses `basename`, Next.js uses
`basePath` (a build-time config, not a runtime prop — essentially un-injectable at preview time),
Remix uses its own conventions. A generic injector cannot cover them.

This is why A is implemented as the **navigation half** (the basename branch of `applyPreviewRoute`,
faithfully tested with a real `<BrowserRouter basename>`), with the **injection half documented as a
limitation**: for the raw-render case it would require a code rewrite we deliberately do not ship.

---

## B. history-bridge (recommended, default)

### Mechanism

The host (canvas) posts `hypercanvas:navigateRoute` into the iframe. The generated in-iframe driver
moves the app router to the **UNPREFIXED** path — but to beat the proxy's prefixing `pushState`, it
uses the **original, un-patched `pushState`** that the bridge now exposes.

`server/proxy-path-bridge.js` captures the real `history.pushState` _before_ patching it and, in
addition to the existing patches, exposes:

```js
window.__hyperPreviewProxyPrefix; // the frozen "/project-preview/<id>" prefix
window.__hyperOriginalPushState; // the un-patched, non-prefixing pushState
window.__hyperOriginalReplaceState;
```

The driver (`buildNavPrimitive` in `lib/preview-generator/generator.ts`, an inline mirror of
`applyPreviewRoute` in the shared module) does:

```
push = window.__hyperOriginalPushState ?? window.history.pushState   // ext fallback: no bridge
push({}, '', '/settings')            // UNPREFIXED → router sees /settings → matches
dispatchEvent(new PopStateEvent('popstate'))   // routers re-read location
```

### Why it works

- The router reads `window.location.pathname` = `/settings` (unprefixed) → it matches, no basename
  needed, **no framework knowledge** required.
- **Assets keep working.** Every asset/HMR patch in the bridge prefixes against the **frozen**
  `PREFIX` captured at load, _not_ against `window.location`. So navigating `location` to an
  unprefixed `/settings` does not break a single `fetch`/`import`/`ws` — they still resolve against
  `/project-preview/<id>/…`.
- `popstate` is the universal signal: React Router, Next (client), and any other History router
  re-read `location` on it. It is a no-op for an app with no history router.

### Failure modes

- **Relative `fetch`/script/style URLs after navigation (FIXED in the bridge).** The proxy bridge
  prefixes ABSOLUTE paths (`/api/x` → `<prefix>/api/x`). RELATIVE paths (`api/x`) used to be left to
  the browser, which resolves them against `window.location`; once history-bridge moves `location` to
  the unprefixed `/settings`, a relative `fetch('api/todos')` would resolve to `/api/todos` on the
  SaaS origin. **`proxy-path-bridge.js`'s `prefixUrl` now closes this for fetch/XHR/WS/EventSource and
  dynamic `Image.src`:** when `location` is OFF the prefix (only the navigated case), it resolves the
  relative URL to an absolute path and re-roots it under the frozen `PREFIX`. Single-component mode
  (location prefixed) is untouched. A faithful test (executing the real bridge) pins the hazard + fix.
- **Relative URLs in static HTML ATTRIBUTES after navigation (residual, narrow).** A relative
  `<img src="logo.png">` / `srcset` / `<link href>` / inline `url(...)` rendered AFTER a navigation
  resolves against the unprefixed location, same class as the fetch case but not covered by the
  bridge's API patches (it would need a MutationObserver rewriting URL attributes — heavy + risky to
  the shared bridge). In practice these are rare: most apps use absolute (`/logo.png`, prefixed by the
  bridge) or bundler-resolved (Vite → absolute) asset URLs. Deferred; documented honestly.
- **Reload after navigation (residual con).** After navigating, `location.pathname` is the unprefixed
  `/settings`. A FULL page reload then issues `GET https://saas/settings`, which is not under
  `/project-preview/<id>` and misses the proxy (the SaaS host answers, not the container) → a
  broken/blank frame until re-navigation. Triggers: app `location.reload()`, a Vite full reload
  (config change), the proxy-bridge's own Fast-Refresh-failure recovery (now MITIGATED — it
  re-boots the canonical proxied URL with `route=<current>`+`component=`), AND the SaaS host's own
  iframe reload helpers (`useIframeCanvas` gateway-retry / server-back-online call
  `contentWindow.location.reload()` — general preview infra, not app-mode-aware; a follow-up should
  thread app-mode/currentRoute through them to re-boot the proxied URL). Fast Refresh itself (the
  common HMR path) does NOT full-reload, so it is unaffected — the fragility window is a genuine full
  reload while parked on a navigated route. `basename` keeps the URL
  prefixed and is fully reload-safe; `src-swap` is only partially safer (its canonical iframe.src
  stays proxied, so host re-navigation recovers, but an app-internal `location.reload()` lands
  unprefixed too). Mitigating it for history-bridge (intercept `reload` to re-boot at the prefixed
  route) is a deferred follow-up.
- **An app that bypasses the History API** — a hard `<a href="/x">` (no `<Link>`) or
  `window.location.assign` — performs a real browser navigation that the proxy bridge re-prefixes;
  the driver isn't involved. Same class as the reload case (a real document navigation).
- **Hash routers** (`createHashRouter` / `HashRouter`) — the driver writes `location.pathname`, not
  `location.hash`, so it cannot drive a hash router. Such roots are NOT offered "preview as app"
  (`detectRouterShell` excludes `createHashRouter` from the data-router signal); hash navigation is
  a deferred follow-up.
- **popstate edge cases** — apps that debounce/ignore popstate, or routers mid-transition. Covered by
  the no-op guard (skip when already on target) and by firing a real `PopStateEvent`.
- **Off-proxy (VS Code ext)** — no bridge globals, no prefix; the driver falls back to plain
  `history.pushState` and the router matches directly. Same code path, zero special-casing.

### Why it's the default (despite the reload con)

Framework-agnostic, clean unprefixed address bar, **no full reload per nav** (no preview/app state
loss), and **zero coupling** to how the user instantiated their router. It needs one small, well-
contained addition to the bridge (expose the originals) and a shared, unit-tested navigation
primitive. The reload-after-nav fragility is real but narrow (only a genuine FULL reload while
parked on a navigated route — not Fast Refresh), and the strategy stays selectable so a
reload-heavy app can be pinned to `src-swap` (reload-safe). The alternatives each lose more: A is
un-injectable for the raw-render case; C reloads on every navigation.

---

## C. iframe src-swap (hard-nav baseline)

### Mechanism

The host rewrites the `route=` query on the preview URL and reassigns `iframe.src`
(`srcSwapNavigate` in `useAppPreviewMode.ts`). The iframe reloads at
`/project-preview/<id>/test-preview?app=1&nav=src-swap&route=/settings`; the app boots fresh and the
**boot driver** (`_driveInitialAppRoute`) reads `route=` and applies it.

### Why it works — and the boot-matching catch

Booting alone is **not** enough: the app boots at the prefixed `…/test-preview`, so its router
matches nothing until the boot driver runs. The boot driver therefore uses **the same
history-bridge unprefixing** to move the router to the requested unprefixed `route` — i.e. C reuses
B's primitive at boot (`applyPreviewRoute(route, 'src-swap')` is the history-bridge path). Without
that, C would need A's basename at boot. We make boot matching work via the history-bridge boot,
and the faithful test proves it.

### Cons

- **Full reload per navigation.** Every address-bar entry tears down and re-mounts the entire app:
  in-app state is lost, it is visibly slower, and it flashes. This is the defining drawback.
- **Only partial reload-safety.** Because the boot driver runs the no-basename router in unprefixed
  space (like history-bridge), an app-internal `location.reload()` after a navigation lands off the
  proxy. src-swap's edge is that the canonical `iframe.src` stays proxied, so a HOST-driven
  re-navigation always re-boots cleanly — it recovers from the reload on the next address-bar entry.
- Pro: dead simple, host re-navigation always works, zero router coupling — a reliable fallback.

---

## Recommendation

**Default to B (`history-bridge`).** It is the only approach that is simultaneously
framework-agnostic, reload-free per navigation, and decoupled from the user's router instantiation —
the best **navigation UX** and the only one that needs no per-framework injection:

- **Code quality** — a small bridge addition (expose the original history methods + re-root relative
  URLs in the unprefixed case, alongside patches that already exist) plus a single shared navigation
  primitive (`applyPreviewRoute`) the generator mirrors with a SYNC contract. No per-framework
  branches, no user-code rewriting.
- **Framework coverage** — any history-based (pathname) router (React Router class + data routers,
  Next client navigation). Hash routers are out of scope (can't drive `location.hash`).
- **UX / perf** — clean unprefixed address bar, instant navigation, no reload, no state loss.
- **Correctness** — relative `fetch` is handled (the bridge re-roots it under the prefix when
  location is unprefixed). The one residual con is **reload-after-nav**: a genuine FULL reload while
  parked on a navigated route requests the unprefixed path off the proxy (not Fast Refresh — narrow).

A is "more correct on paper" (prefixed URL, fully reload-safe) but **un-injectable for the
raw-render case** app-mode targets. C reloads per navigation and is only _partially_ reload-safe
(see below).

**On the residual reload-after-nav fragility:** history-bridge and src-swap BOTH run the no-basename
router in unprefixed path space, so after a navigation an app-internal `location.reload()` lands off
the proxy for either. `src-swap` is only partially safer — its canonical `iframe.src` stays proxied,
so HOST-driven re-navigation re-boots cleanly, but app-internal reloads still break. The only fully
reload-safe strategy is `basename` (URL stays prefixed), which is un-injectable for the raw-render
case. So the practical mitigation is to pin a reload-heavy app to `src-swap` (host re-navigation
recovers it) via the `nav=` URL param, rather than flip the default. A real history-bridge fix
(intercept `reload` to re-boot at the prefixed route) is a deferred follow-up.

All three are **selectable** (`nav=basename | history-bridge | src-swap`, threaded from
`useAppPreviewMode` → `IframeCanvas` → the generated driver). The default constant is
`DEFAULT_NAV_STRATEGY` in `shared/components/preview-chrome/nav-strategy.ts`.

---

## Where each piece lives

| Piece                                                                                 | File                                                                               |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Strategy types, default, prefix helpers, `applyPreviewRoute` (single source of truth) | `shared/components/preview-chrome/nav-strategy.ts`                                 |
| Bridge: expose original `pushState`/`replaceState` + frozen prefix                    | `server/proxy-path-bridge.js`                                                      |
| Generated in-iframe driver (inline mirror of `applyPreviewRoute`)                     | `lib/preview-generator/generator.ts` (`buildNavPrimitive` / `buildAppRouteDriver`) |
| Host dispatch (postMessage vs src-swap) + strategy plumbing                           | `client/pages/Editor/components/hooks/useAppPreviewMode.ts`                        |
| Iframe URL: `nav=` + (src-swap) `route=`                                              | `client/components/IframeCanvas.tsx`                                               |

---

## Verification (no live Docker required)

`shared/components/preview-chrome/__tests__/nav-route-matching.test.tsx` mounts a **real**
`react-router-dom` `<BrowserRouter>` app under a simulated `/project-preview/abc123/test-preview`
pathname, with the proxy bridge faithfully reproduced (prefixing `pushState`, exposed originals,
frozen prefix), and asserts:

1. **The bug** — naive prefixing `pushState` leaves a no-basename router on the catch-all.
2. **history-bridge** — navigates to `/settings` (and the `/users/:id` param route); router matches,
   `location` stays unprefixed.
3. **basename** — `<BrowserRouter basename={prefix}>` matches `/settings` while `location` stays
   prefixed (router strips the basename).
4. **src-swap boot** — the boot driver (history-bridge semantics) matches the requested route.

`shared/components/preview-chrome/__tests__/nav-strategy.test.ts` pins the prefix detect/strip math
and the default. The generator emits a parseable driver that delegates both navigation paths to the
shared primitive (`lib/preview-generator/__tests__/generator.test.ts`).
