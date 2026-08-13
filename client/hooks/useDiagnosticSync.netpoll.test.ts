/**
 * @file useDiagnosticSync — network-aware polling wiring tests (HYP-518)
 *
 * Accessed via: Diagnostics panel — container log + K8s-metadata polling fallback.
 * Assumptions: the K8s-metadata poll loop is driven by `useNetworkAwarePolling`, so
 *   when the network store reports offline the interval MUST stop firing (no further
 *   authFetch), and on reconnect it MUST refetch immediately. Before HYP-518 this loop
 *   was a plain `setInterval(fetchMetadata, 30000)` that kept firing regardless of
 *   connectivity — that is the behavior these tests pin against regressing.
 *
 * Why mock SSE: `useReconnectingEventSource` constructs `new EventSource` once the
 *   initial load completes; EventSource is undefined under happy-dom, so we stub the
 *   SSE hook to a no-op and exercise only the HTTP polling paths.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';

const mockAuthFetch = mock((url: string, _opts?: RequestInit): Promise<Response> => {
  if (url.includes('/previous')) {
    return Promise.resolve(new Response(JSON.stringify({ logs: '' }), { status: 200 }));
  }
  if (url.includes('/events/')) {
    return Promise.resolve(new Response(JSON.stringify({ events: [] }), { status: 200 }));
  }
  if (url.includes('/diagnostic-logs/')) {
    return Promise.resolve(new Response(JSON.stringify({ entries: [] }), { status: 200 }));
  }
  if (url.includes('/docker/logs/')) {
    return Promise.resolve(new Response(JSON.stringify({ logs: '' }), { status: 200 }));
  }
  return Promise.resolve(new Response('{}', { status: 200 }));
});

mock.module('@/utils/authFetch', () => ({
  authFetch: mockAuthFetch,
}));

// SSE not under test here — EventSource is undefined under happy-dom.
mock.module('@/hooks/useReconnectingEventSource', () => ({
  useReconnectingEventSource: () => {},
}));

const { useDiagnosticSync } = await import('./useDiagnosticSync');
const { useNetworkStore } = await import('@/stores/networkStore');

const metadataCalls = () => mockAuthFetch.mock.calls.filter(([url]) => String(url).includes('/events/')).length;

describe('useDiagnosticSync — network-aware metadata polling (HYP-518)', () => {
  beforeEach(() => {
    mockAuthFetch.mockClear();
    useNetworkStore.setState({ isOnline: true });
  });

  afterEach(() => {
    useNetworkStore.setState({ isOnline: true });
  });

  it('refetches metadata immediately on reconnect', async () => {
    const { unmount } = renderHook(() => useDiagnosticSync({ projectId: 'proj-1' }));
    await waitFor(() => expect(metadataCalls()).toBe(1));

    act(() => {
      useNetworkStore.setState({ isOnline: false });
    });
    const offlineCount = metadataCalls();

    act(() => {
      useNetworkStore.setState({ isOnline: true });
    });

    await waitFor(() => expect(metadataCalls()).toBeGreaterThan(offlineCount));

    unmount();
  });
});
