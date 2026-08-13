/**
 * Tests for useAppPreviewMode — the SaaS "preview as app" state hook.
 *
 * Covers: toggle on rebuilds the preview with appMode=true and fetches route suggestions;
 * toggle off rebuilds with appMode=false and clears suggestions; selecting a different
 * component auto-disables app-mode; onNavigate posts `hypercanvas:navigateRoute` to the
 * same-origin preview iframe and updates the resting route.
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

function setup(componentPath: string | undefined, loadComponent = mock(() => Promise.resolve(true))) {
  const view = renderHook(
    ({ path }: { path: string | undefined }) =>
      useAppPreviewMode({ componentPath: path, loadComponent, currentSampleName: 'default' }),
    { initialProps: { path: componentPath } },
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

  it('marks the component as previewable-as-app from the mount candidacy fetch', async () => {
    const { view } = setup('src/App.tsx');
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.result.current.canPreviewAsApp).toBe(true);
    expect(authFetch).toHaveBeenCalledWith('/api/app-routes?component=src%2FApp.tsx');
  });

  it('does not enter app-mode for a non-candidate component', async () => {
    authFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...APP_ROUTES_BODY, isCandidate: false }),
    } as Response);
    const { view, loadComponent } = setup('src/Button.tsx');
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.result.current.canPreviewAsApp).toBe(false);
    await act(async () => {
      view.result.current.toggleAppMode();
    });
    expect(view.result.current.appMode).toBe(false);
    expect(loadComponent).not.toHaveBeenCalled();
  });

  it('toggle on rebuilds with appMode=true and fetches suggestions', async () => {
    const { view, loadComponent } = setup('src/App.tsx');
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      view.result.current.toggleAppMode();
    });

    expect(view.result.current.appMode).toBe(true);
    expect(loadComponent).toHaveBeenCalledWith('src/App.tsx', 'default', true);
    // Enabling app-mode asks for the dropdown suggestions → suggestions=1 (the expensive scan).
    expect(authFetch).toHaveBeenCalledWith('/api/app-routes?component=src%2FApp.tsx&suggestions=1');
    expect(view.result.current.suggestions).toEqual([{ path: '/x', source: 'link' }]);
  });

  it('PERF: the per-selection candidacy fetch does NOT request suggestions', async () => {
    setup('src/App.tsx');
    await act(async () => {
      await Promise.resolve();
    });
    // Mount candidacy check must use the cheap single-file path (no suggestions=1) so a large
    // repo isn't AST-scanned on every component selection just to gate the toggle.
    expect(authFetch).toHaveBeenCalledWith('/api/app-routes?component=src%2FApp.tsx');
    expect(authFetch).not.toHaveBeenCalledWith('/api/app-routes?component=src%2FApp.tsx&suggestions=1');
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
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      view.result.current.toggleAppMode();
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
    });

    await act(async () => {
      view.result.current.toggleAppMode();
      await Promise.resolve();
    });

    // loadComponent ran but reported failure → no address bar, no app=1.
    expect(loadComponent).toHaveBeenCalledWith('src/App.tsx', 'default', true);
    expect(view.result.current.appMode).toBe(false);
  });

  it('toggle off rebuilds with appMode=false and clears suggestions', async () => {
    const { view, loadComponent } = setup('src/App.tsx');
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      view.result.current.toggleAppMode();
    });
    await act(async () => {
      view.result.current.toggleAppMode();
    });

    expect(view.result.current.appMode).toBe(false);
    expect(view.result.current.suggestions).toEqual([]);
    expect(loadComponent).toHaveBeenLastCalledWith('src/App.tsx', 'default', false);
  });

  it('ignores a stale toggle result when the component switched mid-rebuild', async () => {
    let resolveLoad: (ok: boolean) => void = () => {};
    const loadComponent = mock(
      () =>
        new Promise<boolean>((r) => {
          resolveLoad = r;
        }),
    );
    const { view } = setup('src/App.tsx', loadComponent);
    await act(async () => {
      await Promise.resolve();
    });

    // Start enabling app-mode for App.tsx (rebuild in flight)…
    await act(async () => {
      view.result.current.toggleAppMode();
    });
    // …then the user switches to a different component before the rebuild resolves.
    await act(async () => {
      view.rerender({ path: 'src/Other.tsx' });
      await Promise.resolve();
    });
    // Now the stale App.tsx rebuild resolves — it must NOT turn app-mode on for src/Other.tsx.
    await act(async () => {
      resolveLoad(true);
      await Promise.resolve();
    });
    expect(view.result.current.appMode).toBe(false);
  });

  it('selecting a different component auto-disables app-mode', async () => {
    const { view } = setup('src/App.tsx');
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      view.result.current.toggleAppMode();
    });
    expect(view.result.current.appMode).toBe(true);

    await act(async () => {
      view.rerender({ path: 'src/Other.tsx' });
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

  it('reloadPreservingAppMode forwards appMode=false before app-mode is enabled', async () => {
    const { view, loadComponent } = setup('src/App.tsx');
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await view.result.current.reloadPreservingAppMode('src/App.tsx', 'compact');
    });

    // Not in app-mode → reload rebuilds in component-mode (appMode=false).
    expect(loadComponent).toHaveBeenLastCalledWith('src/App.tsx', 'compact', false);
  });

  it('reloadPreservingAppMode keeps app=1 on a sample switch while app-mode is active (fix #1)', async () => {
    const { view, loadComponent } = setup('src/App.tsx');
    await act(async () => {
      await Promise.resolve();
    });

    // Enable app-mode first.
    await act(async () => {
      view.result.current.toggleAppMode();
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
      view.result.current.toggleAppMode();
    });

    expect(view.result.current.appMode).toBe(false);
    expect(loadComponent).not.toHaveBeenCalled();
  });
});
