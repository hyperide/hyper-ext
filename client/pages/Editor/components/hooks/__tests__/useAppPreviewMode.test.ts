/**
 * Tests for useAppPreviewMode — the SaaS "preview as app" state hook.
 *
 * Covers: selecting an app-entry candidate AUTO-enters app-mode (rebuilds with appMode=true and
 * fetches route suggestions) — there is no manual toggle; a non-candidate stays in component-mode;
 * selecting a different component tears down app-mode and re-evaluates; onNavigate posts
 * `hypercanvas:navigateRoute` to the same-origin preview iframe and updates the resting route.
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

  it('AUTO-enters app-mode for an app-entry candidate (no manual toggle)', async () => {
    const { view, loadComponent } = setup('src/App.tsx');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.result.current.appMode).toBe(true);
    // The candidacy fetch must use the cheap single-file path…
    expect(authFetch).toHaveBeenCalledWith('/api/app-routes?component=src%2FApp.tsx');
    // …and entering app-mode rebuilds with appMode=true and fetches the dropdown suggestions.
    expect(loadComponent).toHaveBeenCalledWith('src/App.tsx', 'default', true);
    expect(authFetch).toHaveBeenCalledWith('/api/app-routes?component=src%2FApp.tsx&suggestions=1');
    expect(view.result.current.suggestions).toEqual([{ path: '/x', source: 'link' }]);
  });

  it('does NOT enter app-mode for a non-candidate component', async () => {
    authFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...APP_ROUTES_BODY, isCandidate: false }),
    } as Response);
    const { view, loadComponent } = setup('src/Button.tsx');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.result.current.appMode).toBe(false);
    // A non-candidate never triggers a rebuild from the candidacy path.
    expect(loadComponent).not.toHaveBeenCalled();
  });

  it('does NOT auto-enter app-mode for a candidate when disabled (NodePod / readonly viewer)', async () => {
    // enabled=false models NodePod (overrideSrc bypasses app=1) and readonly viewers (parse-component
    // skips the app-entry rebuild): app-mode must never raise the bar there even for an App.tsx.
    const { view, loadComponent } = setup(
      'src/App.tsx',
      mock(() => Promise.resolve(true)),
      false,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.result.current.appMode).toBe(false);
    expect(loadComponent).not.toHaveBeenCalled();
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
    // App.tsx is a candidate and enabled → app-mode engages (rebuild with appMode=true).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
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

  it('compensates with a component-mode rebuild when disabled WHILE the app-mode rebuild is in flight', async () => {
    // The deeper edge (final review P2): `enabled` flips false BEFORE the auto loadComponent(true)
    // resolves, so appMode is still false (wasAppMode=false) — but the server already ran/began
    // enableAppEntry. The disable must still send a compensating loadComponent(…, false), and the
    // later-resolving true rebuild must NOT raise the bar.
    let resolveLoad: (ok: boolean) => void = () => {};
    const loadComponent = mock(
      () =>
        new Promise<boolean>((r) => {
          resolveLoad = r;
        }),
    );
    const view = renderHook(
      ({ en }: { en: boolean }) =>
        useAppPreviewMode({ componentPath: 'src/App.tsx', loadComponent, currentSampleName: 'default', enabled: en }),
      { initialProps: { en: true } },
    );
    // Candidate + enabled → the app-mode rebuild is ISSUED (loadComponent(true)) but left in flight.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadComponent).toHaveBeenLastCalledWith('src/App.tsx', 'default', true);
    expect(view.result.current.appMode).toBe(false); // not resolved yet

    // Disable while the true rebuild is still pending — must send a compensating component-mode rebuild.
    await act(async () => {
      view.rerender({ en: false });
      await Promise.resolve();
    });
    expect(loadComponent).toHaveBeenLastCalledWith('src/App.tsx', 'default', false);

    // Now the stale true rebuild resolves — it must NOT raise the bar (disabled).
    await act(async () => {
      resolveLoad(true);
      await Promise.resolve();
    });
    expect(view.result.current.appMode).toBe(false);
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
    // Let the candidacy fetch resolve (kicks off the rebuild) but keep the rebuild in flight.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Rebuild still in flight — appMode must NOT be on yet (would race `app=1` ahead of regen).
    expect(view.result.current.appMode).toBe(false);
    expect(loadComponent).toHaveBeenCalledWith('src/App.tsx', 'default', true);

    await act(async () => {
      resolveLoad(true);
      await Promise.resolve();
    });
    expect(view.result.current.appMode).toBe(true);
  });

  it('does NOT enter app-mode when the rebuild resolves with failure (success=false)', async () => {
    const loadComponent = mock(() => Promise.resolve(false));
    const { view } = setup('src/App.tsx', loadComponent);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The candidate triggered a rebuild, but it reported failure → no address bar, no app=1.
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
    // App.tsx is a candidate (auto-enters); the component we switch TO is NOT, so its own
    // candidacy check does not auto-enter — isolating the stale-guard under test.
    authFetch.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...APP_ROUTES_BODY, isCandidate: !url.includes('Other') }),
      } as Response),
    );
    const { view } = setup('src/App.tsx', loadComponent);
    // Auto-entry kicks off the rebuild for App.tsx (in flight)…
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // …then the user switches to a different (non-candidate) component before the rebuild resolves.
    await act(async () => {
      view.rerender({ path: 'src/Other.tsx', en: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    // Now the stale App.tsx rebuild resolves — it must NOT turn app-mode on for src/Other.tsx.
    await act(async () => {
      resolveLoad(true);
      await Promise.resolve();
    });
    expect(view.result.current.appMode).toBe(false);
  });

  it('selecting a different (non-candidate) component auto-disables app-mode', async () => {
    const { view } = setup('src/App.tsx');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.result.current.appMode).toBe(true);

    // The next component is not an app entry.
    authFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...APP_ROUTES_BODY, isCandidate: false }),
    } as Response);
    await act(async () => {
      view.rerender({ path: 'src/Other.tsx', en: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.result.current.appMode).toBe(false);
    expect(view.result.current.suggestions).toEqual([]);
    expect(view.result.current.currentRoute).toBe('/');
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

  it('reloadPreservingAppMode forwards appMode=false for a non-candidate (component-mode)', async () => {
    authFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...APP_ROUTES_BODY, isCandidate: false }),
    } as Response);
    const { view, loadComponent } = setup('src/Button.tsx');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await view.result.current.reloadPreservingAppMode('src/Button.tsx', 'compact');
    });

    // Not in app-mode → reload rebuilds in component-mode (appMode=false).
    expect(loadComponent).toHaveBeenLastCalledWith('src/Button.tsx', 'compact', false);
  });

  it('reloadPreservingAppMode keeps app=1 on a sample switch while app-mode is active (fix #1)', async () => {
    const { view, loadComponent } = setup('src/App.tsx');
    // App.tsx is a candidate → app-mode auto-engages.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.result.current.appMode).toBe(true);

    // Now switch sample on the SAME component — the rebuild must carry appMode=true so the
    // iframe's app=1 preview keeps an entry root and never strands on "Loading app…".
    await act(async () => {
      await view.result.current.reloadPreservingAppMode('src/App.tsx', 'compact');
    });

    expect(loadComponent).toHaveBeenLastCalledWith('src/App.tsx', 'compact', true);
    // app-mode must NOT have been dropped by the reload.
    expect(view.result.current.appMode).toBe(true);
  });

  it('does not act when there is no component path', async () => {
    const { view, loadComponent } = setup(undefined);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.result.current.appMode).toBe(false);
    expect(loadComponent).not.toHaveBeenCalled();
  });
});
