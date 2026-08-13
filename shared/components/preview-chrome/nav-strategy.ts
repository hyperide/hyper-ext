/**
 * @file In-preview navigation strategy for "preview as app" mode (SaaS proxy case).
 *
 * Accessed via: the SaaS canvas app-mode hook (client/.../useAppPreviewMode.ts), the iframe URL
 *   builder (client/components/IframeCanvas.tsx), and — as a generated-string contract — the
 *   preview generator's app-route driver (lib/preview-generator/generator.ts). The VS Code ext
 *   serves the preview without a path prefix, so the strategy is inert there (no prefix → the
 *   helpers below no-op) and the ext keeps using plain history navigation.
 *
 * THE PROBLEM this solves. The SaaS serves the previewed app in an iframe under a path prefix
 *   `/project-preview/<id>/…`. `server/proxy-path-bridge.js` monkey-patches fetch/XHR/WS/history
 *   to PREFIX every absolute path, so assets + HMR work. But the previewed app's own router
 *   (`<BrowserRouter>` with no basename) reads `window.location.pathname` =
 *   `/project-preview/<id>/settings` and matches it against its routes (`/settings`) → NO MATCH →
 *   blank. In-preview navigation must make the router see the UNPREFIXED path.
 *
 * THREE STRATEGIES (selectable; see docs/specs/2026-06-20-app-preview-nav-approaches.md):
 *   - 'history-bridge' (DEFAULT, recommended): the host posts a navigate message; the in-iframe
 *     driver moves the app router to the UNPREFIXED path using the ORIGINAL (pre-bridge-patch)
 *     history.pushState — so the router matches — while the bridge's frozen PREFIX still prefixes
 *     assets/HMR. Framework-agnostic, clean address bar, no full reload, no router coupling.
 *   - 'basename': the address bar reflects unprefixed paths and the host supplies the detected
 *     prefix as the router basename. Correct + URL-synced, but per-framework and requires owning
 *     the router instantiation (a wrapper or a code rewrite) — see the spec for where it breaks.
 *   - 'src-swap': the host sets iframe.src to the proxied route; the app boots fresh and the boot
 *     driver matches the requested route. Simplest, always works, but full reload per nav.
 */

export const NAV_STRATEGIES = ['history-bridge', 'basename', 'src-swap'] as const;

export type NavStrategy = (typeof NAV_STRATEGIES)[number];

/**
 * The default in-preview navigation strategy. `history-bridge` wins the comparison: it is
 * framework-agnostic (drives any history-based router via popstate), keeps a clean unprefixed
 * address bar, never full-reloads (no preview state loss), and does not couple to the user's
 * router instantiation. See the spec for the full reasoning.
 */
export const DEFAULT_NAV_STRATEGY: NavStrategy = 'history-bridge';

/** Narrow an arbitrary string (e.g. a URL query value) to a NavStrategy, or `null` if unknown. */
export function parseNavStrategy(value: string | null | undefined): NavStrategy | null {
  return value != null && (NAV_STRATEGIES as readonly string[]).includes(value) ? (value as NavStrategy) : null;
}

/**
 * The proxy path prefix the SaaS serves the preview under, derived from a pathname like
 * `/project-preview/<id>/test-preview`. Returns `''` when there is no prefix (the VS Code ext, or
 * any non-proxied host) — callers treat `''` as "no prefix, navigate plainly". Mirrors the regex
 * in server/proxy-path-bridge.js so the basename strategy and the bridge agree on the prefix.
 */
export function detectPreviewPrefix(pathname: string): string {
  const match = pathname.match(/^(\/project-preview\/[a-fA-F0-9-]+)/);
  return match ? match[1] : '';
}

/**
 * Strip the proxy prefix off a pathname so a router with no basename can match it. Idempotent and
 * prefix-less-safe: returns the path unchanged when it does not start with `prefix`, and never
 * returns an empty string (a bare prefix collapses to '/'). Pure string math — no DOM.
 */
export function stripPreviewPrefix(pathname: string, prefix: string): string {
  if (!prefix || !pathname.startsWith(prefix)) return pathname || '/';
  const rest = pathname.slice(prefix.length);
  if (!rest) return '/';
  return rest.startsWith('/') ? rest : `/${rest}`;
}

/** The bridge globals the generated preview reads to navigate under the proxy (see proxy-path-bridge.js). */
export interface PreviewNavWindow {
  location: { pathname: string; search: string; hash: string };
  history: { pushState: (state: unknown, title: string, url: string) => void };
  dispatchEvent: (event: Event) => boolean;
  /** Original (un-patched) pushState exposed by the bridge — un-prefixed navigation. Absent off-proxy. */
  __hyperOriginalPushState?: (state: unknown, title: string, url: string) => void;
  /** Frozen proxy prefix exposed by the bridge (e.g. `/project-preview/<id>`). Absent off-proxy. */
  __hyperPreviewProxyPrefix?: string;
}

/**
 * Apply an UNPREFIXED in-app `route` to the previewed app's router under the SaaS proxy, per the
 * selected strategy. This is the SINGLE SOURCE OF TRUTH for the navigation semantics; the preview
 * generator emits an inline JS mirror of this exact logic into `__canvas_preview__` (it cannot
 * import shared code at runtime in the iframe). SYNC: keep `buildNavPrimitive()` in
 * lib/preview-generator/generator.ts in lockstep with this function.
 *
 * - basename: the router runs WITH `basename=<prefix>`, so it expects the PREFIXED path in
 *   location. Use the NORMAL (proxy-patched, prefixing) pushState; the router strips the basename.
 * - history-bridge / src-swap boot: put the UNPREFIXED path into location using the bridge's
 *   ORIGINAL (non-prefixing) pushState when present (else plain), so a no-basename router matches.
 *
 * Fires `popstate` so any history router re-reads location. A no-op when the path already matches.
 * Returns true if it navigated, false if it was already on the target (or had nothing to do).
 */
export function applyPreviewRoute(win: PreviewNavWindow, route: string, strategy: NavStrategy): boolean {
  const target = route.startsWith('/') ? route : `/${route}`;
  // Routers listen for `popstate` to re-read location. Use the real PopStateEvent when available
  // (every browser), falling back to a generic Event so the helper also runs in a minimal jsdom.
  const PopState = (globalThis as { PopStateEvent?: typeof PopStateEvent }).PopStateEvent;
  const firePopstate = () => win.dispatchEvent(PopState ? new PopState('popstate') : new Event('popstate'));

  if (strategy === 'basename') {
    const prefix = win.__hyperPreviewProxyPrefix ?? '';
    // Compare the unprefixed path AND query AND hash — otherwise `/settings?tab=1` → `/settings` or
    // `/settings#billing` → `/settings` is wrongly a no-op and the stale query/hash lingers.
    const current = stripPreviewPrefix(win.location.pathname, prefix) + win.location.search + win.location.hash;
    if (current === target) return false;
    // Patched pushState prefixes `target` → location becomes `<prefix><target>`; basename strips it.
    win.history.pushState({}, '', target);
    firePopstate();
    return true;
  }

  if (win.location.pathname + win.location.search + win.location.hash === target) return false;
  const push = win.__hyperOriginalPushState ?? win.history.pushState.bind(win.history);
  push({}, '', target);
  firePopstate();
  return true;
}
