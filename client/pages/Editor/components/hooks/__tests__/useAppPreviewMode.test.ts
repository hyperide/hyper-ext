/**
 * Tests for useAppPreviewMode — the SaaS "preview as app" state hook.
 *
 * App-mode is a render-failure FALLBACK (NOT proactive): selecting an app-entry candidate does
 * NOT engage it; only a `hypercanvas:componentMissing` / `componentError` signal from the preview
 * iframe does — and only after a candidacy check, once per path. Covers: no upfront engage on
 * candidacy; a failure signal candidacy-gates then engages (rebuild with appMode=true + suggestions);
 * a non-candidate failure stays in component-mode; the once-only latch; the disabled gate; teardown
 * on switch; onNavigate posts `hypercanvas:navigateRoute` to the same-origin iframe.
 *
 * happy-dom note: a dispatched MessageEvent has `source === null` (it can't set a non-MessagePort
 * source). The hook's sender guard is `e.source === getPreviewIframe().contentWindow`, so we make
 * the mocked iframe's contentWindow `null` to ACCEPT a dispatched event, or a distinct object to
 * REJECT it (same trick the appRouteChanged test uses).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';

// ── Mocks (must precede the hook import so the mocked module is bound) ──────────
const postMessage = mock((_msg: unknown, _origin: string) => {});
const getPreviewIframe = mock(() => ({ contentWindow: { postMessage } }) as unknown as HTMLIFrameElement);
mock.module('@/lib/dom-utils', () => ({ getPreviewIframe }));

const APP_ROUTES_BODY = {
  candidates: ['src/App'],
  suggestions: [{ path: '/x', source: 'link' }],
  isCandidate: true,
};
const authFetch = mock(
  (_url: string): Promise<Response> =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(APP_ROUTES_BODY) } as Response),
);
mock.module('@/utils/authFetch', () => ({ authFetch }));

import { useAppPreviewMode } from '../useAppPreviewMode';

function setup(componentPath: string | undefined, loadComponent = mock(() => Promise.resolve(true)), enabled = true) {
  const view = renderHook(
    ({ path, en }: { path: string | undefined; en: boolean }) =>
      useAppPreviewMode({ componentPath: path, loadComponent, currentSampleName: 'default', enabled: en }),
    { initialProps: { path: componentPath, en: enabled } },
  );
  return { view, loadComponent };
}

/** Let microtasks (the candidacy fetch + the rebuild promise) settle. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Dispatch a render-failure message FROM the preview iframe. Sets the mocked iframe's contentWindow
 * to `null` so it equals the dispatched event's `source` (null in happy-dom) → the sender guard
 * accepts it. Returns after the synchronous dispatch; callers `flush()` for the async engage.
 */
function fireRenderFailure(
  type: 'hypercanvas:componentMissing' | 'hypercanvas:componentError',
  componentPath = 'src/App.tsx',
) {
  getPreviewIframe.mockReturnValue({ contentWindow: null } as unknown as HTMLIFrameElement);
  const WinMessageEvent = (window as unknown as { MessageEvent: typeof MessageEvent }).MessageEvent;
  act(() => {
    window.dispatchEvent(new WinMessageEvent('message', { data: { type, componentPath } }));
  });
}

describe('useAppPreviewMode', () => {
  beforeEach(() => {
    postMessage.mockReset();
    getPreviewIframe.mockReset().mockReturnValue({ contentWindow: { postMessage } } as unknown as HTMLIFrameElement);
    authFetch.mockReset().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(APP_ROUTES_BODY),
    } as Response);
  });

  afterEach(() => {
    mock.restore();
  });

  it('starts disabled with no suggestions and a root route', () => {
    const { view } = setup('src/App.tsx');
    expect(view.result.current.appMode).toBe(false);
    expect(view.result.current.suggestions).toEqual([]);
    expect(view.result.current.currentRoute).toBe('/');
  });

  it('does NOT auto-enter app-mode on candidacy alone — a candidate that renders fine stays in component-mode', async () => {
    // The killed behavior (PR #491): selecting an app-entry candidate must NOT engage app-mode and
    // must NOT fetch routes or rebuild. App-mode is now purely failure-driven.
    const { view, loadComponent } = setup('src/App.tsx');
    await flush();
    expect(view.result.current.appMode).toBe(false);
    expect(loadComponent).not.toHaveBeenCalled();
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('engages app-mode when the preview reports componentMissing for an app-entry candidate', async () => {
    const { view, loadComponent } = setup('src/App.tsx');
    await flush(); // selection: no engage

    fireRenderFailure('hypercanvas:componentMissing');
    await flush();

    expect(view.result.current.appMode).toBe(true);
    // Candidacy uses the cheap single-file path; entering app-mode rebuilds with appMode=true…
    expect(authFetch).toHaveBeenCalledWith('/api/app-routes?component=src%2FApp.tsx');
    expect(loadComponent).toHaveBeenCalledWith('src/App.tsx', 'default', true);
    // …then fetches the dropdown suggestions (the expensive whole-project scan).
    expect(authFetch).toHaveBeenCalledWith('/api/app-routes?component=src%2FApp.tsx&suggestions=1');
    expect(view.result.current.suggestions).toEqual([{ path: '/x', source: 'link' }]);
  });

  it('engages app-mode when the preview reports componentError for an app-entry candidate', async () => {
    const { view, loadComponent } = setup('src/App.tsx');
    await flush();

    fireRenderFailure('hypercanvas:componentError');
    await flush();

    expect(view.result.current.appMode).toBe(true);
    expect(loadComponent).toHaveBeenCalledWith('src/App.tsx', 'default', true);
  });

  it('does NOT engage on a render failure for a NON-candidate component', async () => {
    authFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...APP_ROUTES_BODY, isCandidate: false }),
    } as Response);
    const { view, loadComponent } = setup('src/App.tsx');
    await flush();

    fireRenderFailure('hypercanvas:componentMissing');
    await flush();

    // Candidacy was checked but the file is not an app entry → never rebuilt, stays component-mode.
    expect(authFetch).toHaveBeenCalledWith('/api/app-routes?component=src%2FApp.tsx');
    expect(loadComponent).not.toHaveBeenCalled();
    expect(view.result.current.appMode).toBe(false);
  });

  it('engages only ONCE per path — a re-fired failure signal does not re-engage (latch)', async () => {
    const { view, loadComponent } = setup('src/App.tsx');
    await flush();

    fireRenderFailure('hypercanvas:componentMissing');
    await flush();
    expect(view.result.current.appMode).toBe(true);
    const callsAfterFirst = loadComponent.mock.calls.length;

    // A second failure signal for the SAME path (e.g. the wrapped render also reporting) must not
    // re-trigger the candidacy/rebuild — the latch short-circuits it so the real error can surface.
    fireRenderFailure('hypercanvas:componentError');
    await flush();
    expect(loadComponent.mock.calls.length).toBe(callsAfterFirst);
  });

  it('ignores a render-failure message whose reported componentPath is STALE (≠ current selection)', async () => {
    // codex P1-A: a late failure from the OLD iframe during an A→B switch can still pass the sender
    // guard. Its payload carries the OLD path (src/Other.tsx) while the current selection is
    // src/App.tsx — engaging app-mode for App.tsx off Other's crash would be wrong. The path-bind
    // gate must drop it: no candidacy fetch, no rebuild, stays component-mode.
    const { view, loadComponent } = setup('src/App.tsx');
    await flush();

    fireRenderFailure('hypercanvas:componentMissing', 'src/Other.tsx'); // stale reported path
    await flush();

    expect(authFetch).not.toHaveBeenCalled();
    expect(loadComponent).not.toHaveBeenCalled();
    expect(view.result.current.appMode).toBe(false);

    // A failure carrying the CURRENT path does engage — proving the gate isn't just rejecting all.
    fireRenderFailure('hypercanvas:componentMissing', 'src/App.tsx');
    await flush();
    expect(loadComponent).toHaveBeenCalledWith('src/App.tsx', 'default', true);
    expect(view.result.current.appMode).toBe(true);
  });

  it('does NOT permanently latch on a transient candidacy miss — a later failure can still engage (P2-C)', async () => {
    // codex P2-C: the latch must be added only AFTER we commit to a wrapper retry, never on
    // "attempt started". A transient /api/app-routes failure (empty payload → isCandidate=false)
    // must NOT stick the path; a subsequent failure (candidacy now true) must still engage.
    authFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ candidates: [], suggestions: [], isCandidate: false }),
    } as Response);
    const { view, loadComponent } = setup('src/App.tsx');
    await flush();

    // First failure: candidacy comes back NOT a candidate (transient miss) → no engage, no latch.
    fireRenderFailure('hypercanvas:componentMissing');
    await flush();
    expect(view.result.current.appMode).toBe(false);
    expect(loadComponent).not.toHaveBeenCalled();

    // Second failure for the SAME path: candidacy now returns isCandidate=true (default mock) →
    // app-mode MUST engage (the path was not permanently latched by the transient miss).
    fireRenderFailure('hypercanvas:componentMissing');
    await flush();
    expect(loadComponent).toHaveBeenCalledWith('src/App.tsx', 'default', true);
    expect(view.result.current.appMode).toBe(true);
  });

  it('does NOT raise the bar when an A→B→A occupancy switch resolves a STALE A rebuild (P1-B)', async () => {
    // codex P1-B: fallback for A starts a rebuild (in flight). User switches A→B, then B→A (a FRESH
    // occupancy of the path string "A") before the original rebuild resolves. Plain path-equality
    // would match "current path A" and flip app-mode on for the fresh A that never failed. The
    // per-occupancy token must invalidate the stale rebuild.
    let resolveLoad: (ok: boolean) => void = () => {};
    const loadComponent = mock(
      () =>
        new Promise<boolean>((r) => {
          resolveLoad = r;
        }),
    );
    const view = renderHook(
      ({ path }: { path: string }) =>
        useAppPreviewMode({ componentPath: path, loadComponent, currentSampleName: 'default', enabled: true }),
      { initialProps: { path: 'src/App.tsx' } },
    );
    await flush();

    // A fails → candidacy passes → rebuild for A issued (in flight, token captured = T0).
    fireRenderFailure('hypercanvas:componentMissing', 'src/App.tsx');
    await flush();
    expect(loadComponent).toHaveBeenCalledWith('src/App.tsx', 'default', true);

    // Switch A→B then B→A — each reset bumps the occupancy token, so the in-flight A rebuild's
    // captured token is now stale even though the path string is "A" again.
    await act(async () => {
      view.rerender({ path: 'src/Other.tsx' });
      await Promise.resolve();
    });
    await act(async () => {
      view.rerender({ path: 'src/App.tsx' });
      await Promise.resolve();
    });

    // The original (stale-occupancy) A rebuild finally resolves true — it must NOT raise the bar for
    // the FRESH A selection that never reported a failure.
    await act(async () => {
      resolveLoad(true);
      await Promise.resolve();
    });
    expect(view.result.current.appMode).toBe(false);
  });

  it('does NOT latch/engage when an A→B→A switch resolves a STALE A candidacy (P1 — stale candidacy)', async () => {
    // codex P1 (stale candidacy): A fails, the /api/app-routes candidacy fetch is in flight, the user
    // churns A→B→A (a FRESH occupancy of "A") BEFORE candidacy resolves. The stale A result must not
    // latch triedAppWrapperPathsRef nor issue a rebuild for the fresh A that never failed — the
    // captured occupancy token guards it. (The earlier P1-B test covers the stale REBUILD; this covers
    // the earlier hop: a stale CANDIDACY resolution.)
    let resolveRoutes: (body: typeof APP_ROUTES_BODY) => void = () => {};
    authFetch.mockReturnValueOnce(
      new Promise<Response>(
        (r) => (resolveRoutes = (body) => r({ ok: true, json: () => Promise.resolve(body) } as Response)),
      ),
    );
    const loadComponent = mock(() => Promise.resolve(true));
    const view = renderHook(
      ({ path }: { path: string }) =>
        useAppPreviewMode({ componentPath: path, loadComponent, currentSampleName: 'default', enabled: true }),
      { initialProps: { path: 'src/App.tsx' } },
    );
    await flush();

    // A fails → candidacy fetch issued (in flight, token T0 captured).
    fireRenderFailure('hypercanvas:componentMissing', 'src/App.tsx');
    await flush();

    // Churn A→B→A before candidacy resolves — each reset bumps the occupancy token (now stale for T0).
    await act(async () => {
      view.rerender({ path: 'src/Other.tsx' });
      await Promise.resolve();
    });
    await act(async () => {
      view.rerender({ path: 'src/App.tsx' });
      await Promise.resolve();
    });

    // The stale A candidacy resolves as a candidate — it must NOT latch or issue a rebuild for the
    // fresh A occupancy (which never reported a failure).
    await act(async () => {
      resolveRoutes(APP_ROUTES_BODY);
      await Promise.resolve();
    });
    expect(loadComponent).not.toHaveBeenCalled();
    expect(view.result.current.appMode).toBe(false);
  });

  it('ignores a render-failure message whose source is NOT the preview iframe', async () => {
    const { view, loadComponent } = setup('src/App.tsx');
    await flush();

    // contentWindow is a distinct object → the dispatched event's source (null) != it → REJECTED.
    getPreviewIframe.mockReturnValue({ contentWindow: {} } as unknown as HTMLIFrameElement);
    const WinMessageEvent = (window as unknown as { MessageEvent: typeof MessageEvent }).MessageEvent;
    act(() => {
      window.dispatchEvent(
        new WinMessageEvent('message', {
          data: { type: 'hypercanvas:componentMissing', componentPath: 'src/App.tsx' },
        }),
      );
    });
    await flush();

    expect(loadComponent).not.toHaveBeenCalled();
    expect(view.result.current.appMode).toBe(false);
  });

  it('does NOT engage on a render failure when disabled (NodePod / readonly viewer)', async () => {
    // enabled=false models NodePod (overrideSrc bypasses app=1) and readonly viewers (parse-component
    // skips the app-entry rebuild): the failure signal must be ignored — no candidacy check, no engage.
    const { view, loadComponent } = setup(
      'src/App.tsx',
      mock(() => Promise.resolve(true)),
      false,
    );
    await flush();

    fireRenderFailure('hypercanvas:componentMissing');
    await flush();

    expect(view.result.current.appMode).toBe(false);
    expect(loadComponent).not.toHaveBeenCalled();
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('does not flip appMode until the preview rebuild (loadComponent) resolves', async () => {
    let resolveLoad: (ok: boolean) => void = () => {};
    const loadComponent = mock(
      () =>
        new Promise<boolean>((r) => {
          resolveLoad = r;
        }),
    );
    const { view } = setup('src/App.tsx', loadComponent);
    await flush();

    fireRenderFailure('hypercanvas:componentMissing');
    await flush();
    // Candidacy resolved → rebuild issued but in flight → app-mode must NOT be on yet.
    expect(loadComponent).toHaveBeenCalledWith('src/App.tsx', 'default', true);
    expect(view.result.current.appMode).toBe(false);

    await act(async () => {
      resolveLoad(true);
      await Promise.resolve();
    });
    expect(view.result.current.appMode).toBe(true);
  });

  it('does NOT enter app-mode when the rebuild resolves with failure (success=false)', async () => {
    const loadComponent = mock(() => Promise.resolve(false));
    const { view } = setup('src/App.tsx', loadComponent);
    await flush();

    fireRenderFailure('hypercanvas:componentMissing');
    await flush();

    expect(loadComponent).toHaveBeenCalledWith('src/App.tsx', 'default', true);
    expect(view.result.current.appMode).toBe(false);
  });

  it('ignores a stale rebuild result when the component switched mid-rebuild', async () => {
    let resolveLoad: (ok: boolean) => void = () => {};
    const loadComponent = mock(
      () =>
        new Promise<boolean>((r) => {
          resolveLoad = r;
        }),
    );
    const { view } = setup('src/App.tsx', loadComponent);
    await flush();

    // A render failure on App.tsx kicks off the rebuild (in flight)…
    fireRenderFailure('hypercanvas:componentMissing');
    await flush();
    expect(loadComponent).toHaveBeenCalledWith('src/App.tsx', 'default', true);

    // …then the user switches to a different component before the rebuild resolves.
    await act(async () => {
      view.rerender({ path: 'src/Other.tsx', en: true });
      await Promise.resolve();
    });
    // Now the stale App.tsx rebuild resolves — it must NOT turn app-mode on for src/Other.tsx.
    await act(async () => {
      resolveLoad(true);
      await Promise.resolve();
    });
    expect(view.result.current.appMode).toBe(false);
  });

  it('selecting a different component tears down app-mode and lets the new path retry', async () => {
    const { view, loadComponent } = setup('src/App.tsx');
    await flush();
    fireRenderFailure('hypercanvas:componentMissing');
    await flush();
    expect(view.result.current.appMode).toBe(true);

    // Switch component: app-mode tears down (bar hides, route resets) and the latch clears.
    await act(async () => {
      view.rerender({ path: 'src/Other.tsx', en: true });
      await Promise.resolve();
    });
    expect(view.result.current.appMode).toBe(false);
    expect(view.result.current.suggestions).toEqual([]);
    expect(view.result.current.currentRoute).toBe('/');

    // A failure on the NEW path engages again (latch was cleared by the switch).
    const callsBefore = loadComponent.mock.calls.length;
    getPreviewIframe.mockReturnValue({ contentWindow: null } as unknown as HTMLIFrameElement);
    const WinMessageEvent = (window as unknown as { MessageEvent: typeof MessageEvent }).MessageEvent;
    act(() => {
      window.dispatchEvent(
        new WinMessageEvent('message', {
          data: { type: 'hypercanvas:componentMissing', componentPath: 'src/Other.tsx' },
        }),
      );
    });
    await flush();
    expect(loadComponent.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(loadComponent).toHaveBeenLastCalledWith('src/Other.tsx', 'default', true);
  });

  it('tears app-mode down AND rebuilds in component-mode when `enabled` flips false mid-session', async () => {
    const loadComponent = mock(() => Promise.resolve(true));
    const view = renderHook(
      ({ en }: { en: boolean }) =>
        useAppPreviewMode({
          componentPath: 'src/App.tsx',
          loadComponent,
          currentSampleName: 'default',
          enabled: en,
        }),
      { initialProps: { en: true } },
    );
    await flush();
    fireRenderFailure('hypercanvas:componentMissing');
    await flush();
    expect(view.result.current.appMode).toBe(true);
    expect(loadComponent).toHaveBeenLastCalledWith('src/App.tsx', 'default', true);

    // Disable mid-session (e.g. role → viewer): the bar hides AND the preview is rebuilt in
    // component-mode so the server drops the app entry — not just a local state flip (codex P2).
    await act(async () => {
      view.rerender({ en: false });
      await Promise.resolve();
    });
    expect(view.result.current.appMode).toBe(false);
    expect(loadComponent).toHaveBeenLastCalledWith('src/App.tsx', 'default', false);
  });

  it('onNavigate posts navigateRoute to the same-origin iframe and updates the route', async () => {
    const { view } = setup('src/App.tsx');

    await act(async () => {
      view.result.current.onNavigate('/settings');
    });

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'hypercanvas:navigateRoute', route: '/settings' },
      window.location.origin,
    );
    expect(view.result.current.currentRoute).toBe('/settings');
  });

  it('onNavigate normalizes a path that lacks a leading slash', async () => {
    const { view } = setup('src/App.tsx');

    await act(async () => {
      view.result.current.onNavigate('settings');
    });

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'hypercanvas:navigateRoute', route: '/settings' },
      window.location.origin,
    );
  });

  it('updates currentRoute when the app navigates inside the preview (hypercanvas:appRouteChanged)', () => {
    // happy-dom can't set a non-MessagePort `source` on a dispatched MessageEvent, so a normally
    // dispatched event has `source === null`. We exercise the hook's source check by controlling
    // what `getPreviewIframe().contentWindow` is: when it equals the event source (null) the message
    // is accepted; when it differs the message is rejected.
    const view = renderHook(() =>
      useAppPreviewMode({
        componentPath: 'src/App.tsx',
        loadComponent: mock(() => Promise.resolve(true)),
        currentSampleName: 'default',
      }),
    );
    expect(view.result.current.currentRoute).toBe('/');

    const WinMessageEvent = (window as unknown as { MessageEvent: typeof MessageEvent }).MessageEvent;
    const fire = (route: string) => {
      act(() => {
        window.dispatchEvent(new WinMessageEvent('message', { data: { type: 'hypercanvas:appRouteChanged', route } }));
      });
    };

    // contentWindow === event.source (both null) → ACCEPTED, the bar follows the in-preview nav.
    getPreviewIframe.mockReturnValue({ contentWindow: null } as unknown as HTMLIFrameElement);
    fire('/settings');
    expect(view.result.current.currentRoute).toBe('/settings');

    // A message whose source isn't the preview iframe (contentWindow is a different object) → IGNORED.
    getPreviewIframe.mockReturnValue({ contentWindow: {} } as unknown as HTMLIFrameElement);
    fire('/evil');
    expect(view.result.current.currentRoute).toBe('/settings');
  });

  it('src-swap navigates via currentRoute only (single mechanism — no postMessage, no imperative src)', () => {
    // src-swap navigation is driven by the DECLARATIVE iframe src in IframeCanvas (which carries
    // route=<currentRoute> only for src-swap). The hook must NOT also post a navigate message or set
    // iframe.src imperatively — that would double-reload. So onNavigate only updates currentRoute,
    // and the IframeCanvas re-render reassigns the src ONCE.
    const postMessageSpy = mock((_msg: unknown, _origin: string) => {});
    getPreviewIframe.mockReturnValue({
      contentWindow: { postMessage: postMessageSpy },
    } as unknown as HTMLIFrameElement);

    const view = renderHook(() =>
      useAppPreviewMode({
        componentPath: 'src/App.tsx',
        loadComponent: mock(() => Promise.resolve(true)),
        currentSampleName: 'default',
        navStrategy: 'src-swap',
      }),
    );

    act(() => {
      view.result.current.onNavigate('/dashboard');
    });

    expect(view.result.current.currentRoute).toBe('/dashboard'); // drives the declarative src
    expect(postMessageSpy).not.toHaveBeenCalled(); // NOT history-bridge — no message posted
    expect(view.result.current.navStrategy).toBe('src-swap');
  });

  it('reloadPreservingAppMode forwards appMode=false when not in app-mode (component-mode)', async () => {
    const { view, loadComponent } = setup('src/Button.tsx');
    await flush();

    await act(async () => {
      await view.result.current.reloadPreservingAppMode('src/Button.tsx', 'compact');
    });

    // Not in app-mode (no failure signal engaged it) → reload rebuilds in component-mode.
    expect(loadComponent).toHaveBeenLastCalledWith('src/Button.tsx', 'compact', false);
  });

  it('reloadPreservingAppMode keeps app=1 on a sample switch while app-mode is active (fix #1)', async () => {
    const { view, loadComponent } = setup('src/App.tsx');
    await flush();
    // A render failure engages app-mode.
    fireRenderFailure('hypercanvas:componentMissing');
    await flush();
    expect(view.result.current.appMode).toBe(true);

    // Now switch sample on the SAME component — the rebuild must carry appMode=true so the
    // iframe's app=1 preview keeps an entry root and never strands on "Loading app…".
    await act(async () => {
      await view.result.current.reloadPreservingAppMode('src/App.tsx', 'compact');
    });

    expect(loadComponent).toHaveBeenLastCalledWith('src/App.tsx', 'compact', true);
    expect(view.result.current.appMode).toBe(true);
  });

  it('does not act when there is no component path', async () => {
    const { view, loadComponent } = setup(undefined);
    await flush();

    // Even a failure signal can't engage without a current path.
    fireRenderFailure('hypercanvas:componentMissing');
    await flush();

    expect(view.result.current.appMode).toBe(false);
    expect(loadComponent).not.toHaveBeenCalled();
  });
});
