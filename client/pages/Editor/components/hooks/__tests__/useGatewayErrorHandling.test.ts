/**
 * @file useGatewayErrorHandling — the gateway-retry loader contract.
 *
 * handleRetryLoad reloads the current component through the injected `loadComponent`. CanvasEditor
 * now injects the app-mode-preserving reloader, so a retry while in app preview keeps `app=1`
 * instead of rebuilding in component-mode and stranding the iframe on "Loading app…". This test
 * pins that handleRetryLoad calls the injected loader with the component path (so whatever loader is
 * passed — the appMode-preserving one — is the one that runs).
 */

import { mock } from 'bun:test';
import { describe, expect, test } from 'bun:test';
import { act, renderHook } from '@testing-library/react';

mock.module('@/lib/platform/PlatformContext', () => ({ useOpenAIChat: () => () => {} }));

const { useGatewayErrorHandling } = await import('../useGatewayErrorHandling');

describe('useGatewayErrorHandling.handleRetryLoad', () => {
  test('retries through the injected loadComponent with the current component path', () => {
    const loadComponent = mock((_path: string) => {});
    const view = renderHook(() =>
      useGatewayErrorHandling({
        projectConfigError: null,
        componentPath: 'src/App.tsx',
        loadComponent,
      }),
    );
    act(() => {
      view.result.current.handleRetryLoad();
    });
    // The retry uses the injected loader (CanvasEditor injects the appMode-preserving reloader).
    expect(loadComponent).toHaveBeenCalledWith('src/App.tsx');
  });

  test('falls back to a full window reload when there is no component path', () => {
    const loadComponent = mock((_path: string) => {});
    const reload = mock(() => {});
    const realReload = window.location.reload;
    Object.defineProperty(window.location, 'reload', { value: reload, configurable: true });
    const view = renderHook(() =>
      useGatewayErrorHandling({ projectConfigError: null, componentPath: undefined, loadComponent }),
    );
    act(() => {
      view.result.current.handleRetryLoad();
    });
    expect(loadComponent).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    Object.defineProperty(window.location, 'reload', { value: realReload, configurable: true });
  });
});
