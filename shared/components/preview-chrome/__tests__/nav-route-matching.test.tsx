/**
 * @file FAITHFUL in-preview route-matching tests for the three navigation strategies.
 *
 * These prove each strategy actually navigates a REAL `react-router-dom` <BrowserRouter> to the
 * right route UNDER the SaaS proxy prefix — without a live Docker SaaS. We reproduce the proxy
 * environment exactly:
 *   - window.location.pathname = `/project-preview/<id>/test-preview` (where the iframe boots),
 *   - history.pushState PATCHED to re-prefix absolute paths (what server/proxy-path-bridge.js does),
 *   - the bridge globals `__hyperOriginalPushState` + `__hyperPreviewProxyPrefix` exposed.
 * Then we drive `applyPreviewRoute` (the single source of truth the generator mirrors) and assert
 * the rendered page. The first test PROVES THE BUG the feature exists to fix; the rest prove each
 * strategy's fix.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { applyPreviewRoute, type NavStrategy } from '../nav-strategy';

const PROJECT_ID = 'abc123';
const PREFIX = `/project-preview/${PROJECT_ID}`;
const BOOT_PATH = `${PREFIX}/test-preview`;

interface HappyWin {
  happyDOM?: { setURL?: (u: string) => void };
  history: History & { __patched?: boolean };
  location: Location;
  __hyperOriginalPushState?: History['pushState'];
  __hyperPreviewProxyPrefix?: string;
}

function win(): HappyWin {
  return window as unknown as HappyWin;
}

// The pristine (never-patched) pushState, captured ONCE at module load before any test patches it.
const PRISTINE_PUSH_STATE = window.history.pushState.bind(window.history);

/**
 * Reproduce server/proxy-path-bridge.js: prefix absolute pushState URLs, expose the originals.
 * `appHistoryBridge=true` simulates `app=1&nav=history-bridge`, where the bridge does NOT prefix
 * history (the app router runs in unprefixed space — its own <Link>/navigate must land unprefixed).
 */
function installProxyBridge(appHistoryBridge = false): void {
  const w = win();
  w.happyDOM?.setURL?.(`http://localhost${BOOT_PATH}`);
  // Always wrap the PRISTINE pushState, never the (possibly already-patched) current one — wrapping
  // a wrapper from a prior test would double-prefix and corrupt the "original" the bridge exposes.
  const needsPrefix = (url: string) => typeof url === 'string' && url.startsWith('/') && !url.startsWith(PREFIX);
  window.history.pushState = function patched(state: unknown, title: string, url?: string | URL | null) {
    // app-history-bridge mode: pass through unprefixed (the real bridge skips prefixing here).
    const u = !appHistoryBridge && typeof url === 'string' && needsPrefix(url) ? PREFIX + url : url;
    return PRISTINE_PUSH_STATE(state, title, u as string);
  } as History['pushState'];
  w.__hyperOriginalPushState = PRISTINE_PUSH_STATE;
  w.__hyperPreviewProxyPrefix = PREFIX;
}

/**
 * Restore the pristine pushState AND drop the bridge globals so this file never leaks a patched
 * history or a stale `__hyper*` global into another test file (the happy-dom window is shared across
 * the whole `bun test` process).
 */
function uninstallProxyBridge(): void {
  window.history.pushState = PRISTINE_PUSH_STATE as History['pushState'];
  const w = win();
  w.__hyperOriginalPushState = undefined;
  w.__hyperPreviewProxyPrefix = undefined;
}

/** A previewed app whose <BrowserRouter> owns the routing — exactly the real SaaS scenario. */
function PreviewedApp({ basename }: { basename?: string }) {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<Page name="home" />} />
        <Route path="/settings" element={<Page name="settings" />} />
        <Route path="/users/:id" element={<UserPage />} />
        <Route path="*" element={<Page name="nomatch" />} />
      </Routes>
    </BrowserRouter>
  );
}

function Page({ name }: { name: string }) {
  const loc = useLocation();
  return (
    <div>
      <span data-testid="page">{name}</span>
      <span data-testid="loc">{loc.pathname}</span>
      <Link to="/settings">go-settings</Link>
    </div>
  );
}

function UserPage() {
  const loc = useLocation();
  return (
    <div>
      <span data-testid="page">user</span>
      <span data-testid="loc">{loc.pathname}</span>
    </div>
  );
}

function navigate(route: string, strategy: NavStrategy) {
  act(() => {
    applyPreviewRoute(win() as never, route, strategy);
  });
}

describe('faithful in-preview route matching under the SaaS proxy prefix', () => {
  beforeEach(() => {
    installProxyBridge();
  });

  afterEach(() => {
    cleanup();
    // Restore a clean URL + unpatched history so tests don't bleed into each other.
    uninstallProxyBridge();
    win().happyDOM?.setURL?.('http://localhost/');
  });

  it('PROVES THE BUG: a naive prefixing pushState leaves a no-basename router unmatched', () => {
    // Boot the raw app router at the prefixed path — it sees `/project-preview/abc123/test-preview`
    // and matches the catch-all, not a real route.
    render(<PreviewedApp />);
    expect(screen.getByTestId('page').textContent).toBe('nomatch');

    // Naive navigation: the PATCHED pushState re-prefixes `/settings` → the router still sees the
    // prefix and matches the catch-all. This is the exact failure the feature fixes.
    act(() => {
      window.history.pushState({}, '', '/settings');
      window.dispatchEvent(new window.PopStateEvent('popstate'));
    });
    expect(window.location.pathname).toBe(`${PREFIX}/settings`);
    expect(screen.getByTestId('page').textContent).toBe('nomatch');
  });

  it('history-bridge: navigates a no-basename router to /settings and matches', () => {
    render(<PreviewedApp />);
    // Boot to "/" first (the app-route driver does this off the test-preview mount path).
    navigate('/', 'history-bridge');
    expect(screen.getByTestId('page').textContent).toBe('home');

    navigate('/settings', 'history-bridge');
    expect(screen.getByTestId('page').textContent).toBe('settings');
    // The router saw the UNPREFIXED path…
    expect(screen.getByTestId('loc').textContent).toBe('/settings');
    // …while the browser URL stays unprefixed too (assets keep working via the frozen prefix).
    expect(window.location.pathname).toBe('/settings');
  });

  it('history-bridge: matches a param route /users/:id', () => {
    render(<PreviewedApp />);
    navigate('/users/42', 'history-bridge');
    expect(screen.getByTestId('page').textContent).toBe('user');
    expect(screen.getByTestId('loc').textContent).toBe('/users/42');
  });

  it('basename: a <BrowserRouter basename={prefix}> matches /settings while location stays prefixed', () => {
    render(<PreviewedApp basename={PREFIX} />);
    // The router with basename strips the prefix from the boot path → it sees `/test-preview` → catch-all.
    expect(screen.getByTestId('page').textContent).toBe('nomatch');

    navigate('/settings', 'basename');
    expect(screen.getByTestId('page').textContent).toBe('settings');
    // basename router matched /settings…
    expect(screen.getByTestId('loc').textContent).toBe('/settings');
    // …and the browser URL is the PREFIXED path (the patched pushState prefixed it; basename strips).
    expect(window.location.pathname).toBe(`${PREFIX}/settings`);
  });

  it('src-swap boot: the boot driver (history-bridge semantics) matches the requested route', () => {
    // src-swap reloads the iframe to `…/test-preview?route=/settings`; on boot the driver applies
    // the requested route. We simulate the post-reload boot: location at the prefixed mount path,
    // driver applies the unprefixed `/settings`.
    render(<PreviewedApp />);
    navigate('/settings', 'src-swap');
    expect(screen.getByTestId('page').textContent).toBe('settings');
    expect(screen.getByTestId('loc').textContent).toBe('/settings');
  });

  it("history-bridge: the app's OWN <Link> navigation lands on an unprefixed path the router matches", () => {
    // In app-mode history-bridge the bridge does NOT prefix history.pushState, so a click on the
    // app's own <Link to="/settings"> (which calls the patched global pushState via React Router)
    // writes the UNPREFIXED `/settings` — the no-basename router matches, no re-prefix mismatch.
    uninstallProxyBridge();
    installProxyBridge(/* appHistoryBridge */ true);
    render(<PreviewedApp />);
    // Boot to "/" (home renders the <Link>).
    navigate('/', 'history-bridge');
    expect(screen.getByTestId('page').textContent).toBe('home');

    act(() => {
      fireEvent.click(screen.getByText('go-settings'));
    });
    expect(screen.getByTestId('page').textContent).toBe('settings');
    expect(screen.getByTestId('loc').textContent).toBe('/settings');
    // Crucially the browser URL is UNPREFIXED (the bridge did not re-prefix the app's own pushState).
    expect(window.location.pathname).toBe('/settings');
  });

  it('history-bridge: the relative-fetch hazard the bridge re-roots (router-side view)', () => {
    // After history-bridge navigates to the UNPREFIXED `/settings`, the BROWSER would natively
    // resolve a relative `fetch('api/todos')` to `/api/todos` — off the proxy. This documents the
    // hazard from the router test's vantage; the ACTUAL re-rooting fix is verified end-to-end by
    // executing the real bridge in server/__tests__/proxy-path-bridge.test.ts (not mirrored here).
    render(<PreviewedApp />);
    navigate('/settings', 'history-bridge');
    expect(new URL('api/todos', window.location.href).pathname).toBe('/api/todos'); // off-proxy hazard
  });
});
