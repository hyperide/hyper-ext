/**
 * @file useBrowserI18nText tests: the design-critical NO-OP-when-canvas invariant (the VS Code RPC
 *   path must stay untouched), and the browser-mode scan that surfaces the bound key + the
 *   retargetable candidate set.
 */
import { describe, expect, mock, test } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { CanvasAdapter } from '../types';

const HERO_BINDINGS = [
  { bindingLoc: { line: 4, column: 14 }, key: 'hero.title', retargetable: true },
  { bindingLoc: { line: 5, column: 10 }, key: 'hero.subtitle', retargetable: true },
  { key: 't', retargetable: false, unretargetableReason: 'dynamic-key' },
];

const authFetch = mock<(url: string, init?: RequestInit) => Promise<Response>>(
  async () => ({ ok: true, json: async () => ({ success: true, bindings: HERO_BINDINGS }) }) as unknown as Response,
);
mock.module('@/utils/authFetch', () => ({ authFetch }));

// The NodePod scan transport — mocked so the runtime-subscription test exercises the routing
// (which transport the active runtime selects) without a real OPFS tree.
const scanNodePodBindings = mock<(...args: unknown[]) => Promise<unknown>>(async () => ({
  success: true,
  bindings: [{ bindingLoc: { line: 4, column: 14 }, key: 'pod.key', retargetable: true }],
  library: 'react-i18next',
}));
mock.module('../nodepod/nodepodRetargetTransport', () => ({ scanNodePodBindings }));

const { useBrowserI18nText } = await import('./useBrowserI18nText');
const { useNodePodRuntimeStore } = await import('../nodepod/nodepodRuntimeStore');

describe('useBrowserI18nText', () => {
  test('NO-OP when a canvas adapter exists (VS Code mode) — never fetches', async () => {
    authFetch.mockClear();
    const fakeCanvas = {} as CanvasAdapter;
    const { result } = renderHook(() =>
      useBrowserI18nText({
        canvas: fakeCanvas,
        filePath: 'src/Hero.tsx',
        sourceLocation: { line: 4, column: 14 },
        library: 'react-i18next',
      }),
    );
    expect(result.current.binding).toBeNull();
    expect(result.current.retargetableKeys).toEqual([]);
    expect(authFetch).not.toHaveBeenCalled();
  });

  test('browser mode: scans and returns the bound key + retargetable candidate set', async () => {
    authFetch.mockClear();
    const { result } = renderHook(() =>
      useBrowserI18nText({
        canvas: null,
        filePath: 'src/Hero.tsx',
        sourceLocation: { line: 4, column: 14 },
        library: 'react-i18next',
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(result.current.binding?.key).toBe('hero.title');
    expect(result.current.retargetableKeys).toEqual(['hero.title', 'hero.subtitle']);
  });

  test('browser mode but no sourceLocation → no fetch, empty result', async () => {
    authFetch.mockClear();
    const { result } = renderHook(() =>
      useBrowserI18nText({ canvas: null, filePath: 'src/Hero.tsx', sourceLocation: null, library: 'react-i18next' }),
    );
    expect(result.current.binding).toBeNull();
    expect(authFetch).not.toHaveBeenCalled();
  });

  test('a failed scan surfaces an error (distinct from "no binding found")', async () => {
    authFetch.mockClear();
    authFetch.mockImplementationOnce(async () => ({ ok: false, statusText: 'Internal Server Error' }) as Response);
    const { result } = renderHook(() =>
      useBrowserI18nText({
        canvas: null,
        filePath: 'src/Broken.tsx',
        sourceLocation: { line: 4, column: 14 },
        library: 'react-i18next',
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.binding).toBeNull();
    // The error-state shape carries the empty collections + null library (consumers spread it).
    expect(result.current.retargetableBindings).toEqual([]);
    expect(result.current.retargetableKeys).toEqual([]);
    expect(result.current.library).toBeNull();
  });

  test('surfaces the server-detected library; falls back to the caller hint when absent', async () => {
    authFetch.mockClear();
    // Server echoes the library it detected — overrides the caller's (here null) hint.
    authFetch.mockImplementationOnce(
      async () =>
        ({
          ok: true,
          json: async () => ({ success: true, bindings: HERO_BINDINGS, library: 'react-i18next' }),
        }) as unknown as Response,
    );
    const { result } = renderHook(() =>
      useBrowserI18nText({
        canvas: null,
        filePath: 'src/Hero.tsx',
        sourceLocation: { line: 4, column: 14 },
        library: null,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.library).toBe('react-i18next');

    // When the server omits library, the caller's hint is the fallback.
    authFetch.mockImplementationOnce(
      async () => ({ ok: true, json: async () => ({ success: true, bindings: [] }) }) as unknown as Response,
    );
    const { result: r2 } = renderHook(() =>
      useBrowserI18nText({
        canvas: null,
        filePath: 'src/Other.tsx',
        sourceLocation: { line: 4, column: 14 },
        library: 'i18next',
      }),
    );
    await waitFor(() => expect(r2.current.loading).toBe(false));
    expect(r2.current.library).toBe('i18next');
  });

  test('bumping refreshKey re-scans the SAME target (post-retarget re-read)', async () => {
    authFetch.mockClear();
    let calls = 0;
    authFetch.mockImplementation(async () => {
      calls += 1;
      // First scan reports the old key; after the retarget (refreshKey bump) report the new key.
      const key = calls === 1 ? 'hero.title' : 'hero.heading';
      return {
        ok: true,
        json: async () => ({
          success: true,
          bindings: [{ bindingLoc: { line: 4, column: 14 }, key, retargetable: true }],
          library: 'react-i18next',
        }),
      } as unknown as Response;
    });

    const { result, rerender } = renderHook(
      ({ refreshKey }) =>
        useBrowserI18nText({
          canvas: null,
          filePath: 'src/Hero.tsx',
          sourceLocation: { line: 4, column: 14 },
          library: 'react-i18next',
          refreshKey,
        }),
      { initialProps: { refreshKey: 0 } },
    );

    await waitFor(() => expect(result.current.binding?.key).toBe('hero.title'));
    expect(calls).toBe(1);

    rerender({ refreshKey: 1 });
    // Same target + new refreshKey → re-fetch; meanwhile the prior binding stays (no clear).
    await waitFor(() => expect(result.current.binding?.key).toBe('hero.heading'));
    expect(calls).toBe(2);

    authFetch.mockReset();
    authFetch.mockImplementation(
      async () => ({ ok: true, json: async () => ({ success: true, bindings: HERO_BINDINGS }) }) as unknown as Response,
    );
  });

  test('re-scans via the NodePod transport when the runtime store resolves docker→nodepod', async () => {
    authFetch.mockClear();
    scanNodePodBindings.mockClear();
    // Start in the store's default Docker state — the first scan runs the Docker (authFetch) path.
    useNodePodRuntimeStore.getState().setRuntime('docker', null);

    const { result, unmount } = renderHook(() =>
      useBrowserI18nText({
        canvas: null,
        filePath: 'src/Hero.tsx',
        sourceLocation: { line: 4, column: 14 },
        library: 'react-i18next',
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(scanNodePodBindings).not.toHaveBeenCalled();

    // The active runtime resolves to NodePod AFTER the first scan (the real-world race: the store is
    // still at the Docker default when the hook first mounts on a NodePod project). The scan effect
    // must re-run against the NodePod transport — it only does so if the hook SUBSCRIBES to the store.
    act(() => {
      useNodePodRuntimeStore.getState().setRuntime('nodepod', 'proj-1');
    });
    await waitFor(() => expect(scanNodePodBindings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.binding?.key).toBe('pod.key'));

    // Unmount before resetting the shared store so no post-test async scan update escapes act().
    unmount();
    useNodePodRuntimeStore.getState().setRuntime('docker', null);
  });

  test('docker→nodepod transition clears the Docker bindings while the NodePod scan loads', async () => {
    authFetch.mockClear();
    scanNodePodBindings.mockClear();
    useNodePodRuntimeStore.getState().setRuntime('docker', null);

    // Gate the NodePod scan so we can observe the loading window between the runtime flip and its
    // resolution — the Docker bindings must NOT remain visible there (they read a different FS).
    let releasePodScan!: (v: unknown) => void;
    const podScanGate = new Promise((r) => {
      releasePodScan = r;
    });
    scanNodePodBindings.mockImplementationOnce(async () => {
      await podScanGate;
      return {
        success: true,
        bindings: [{ bindingLoc: { line: 4, column: 14 }, key: 'pod.key', retargetable: true }],
        library: 'react-i18next',
      };
    });

    const { result, unmount } = renderHook(() =>
      useBrowserI18nText({
        canvas: null,
        filePath: 'src/Hero.tsx',
        sourceLocation: { line: 4, column: 14 },
        library: 'react-i18next',
      }),
    );
    // Docker scan resolves first → hero.title visible.
    await waitFor(() => expect(result.current.binding?.key).toBe('hero.title'));

    // Flip to NodePod; the pod scan is parked. The stale Docker binding must be cleared immediately.
    act(() => {
      useNodePodRuntimeStore.getState().setRuntime('nodepod', 'proj-1');
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.binding).toBeNull();
    expect(result.current.retargetableKeys).toEqual([]);

    // Let the pod scan finish → its bindings replace the (already cleared) Docker ones.
    act(() => {
      releasePodScan(undefined);
    });
    await waitFor(() => expect(result.current.binding?.key).toBe('pod.key'));

    unmount();
    useNodePodRuntimeStore.getState().setRuntime('docker', null);
  });
});
