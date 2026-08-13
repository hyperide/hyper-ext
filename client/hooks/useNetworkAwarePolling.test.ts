/**
 * @file useNetworkAwarePolling — network-aware behavior (HYP-518)
 *
 * Accessed via: diagnostics polling loops (useDiagnosticSync) and other future consumers.
 * Assumptions:
 *   - while the network store reports offline, the interval is torn down → no polls fire;
 *   - on reconnect the hook polls immediately (useOnReconnect);
 *   - last successful `data` is preserved across an error (never cleared).
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useNetworkAwarePolling } from './useNetworkAwarePolling';
import { useNetworkStore } from '@/stores/networkStore';

describe('useNetworkAwarePolling', () => {
  beforeEach(() => {
    useNetworkStore.setState({ isOnline: true });
  });
  afterEach(() => {
    useNetworkStore.setState({ isOnline: true });
  });

  it('pauses polling while offline and resumes on reconnect', async () => {
    const fetchFn = mock(() => Promise.resolve('ok'));

    const { unmount } = renderHook(() => useNetworkAwarePolling(fetchFn, { interval: 20 }));

    // Online: interval fires repeatedly.
    await waitFor(() => expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(3));

    // Offline: interval torn down → call count freezes.
    act(() => {
      useNetworkStore.setState({ isOnline: false });
    });
    const frozen = fetchFn.mock.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchFn.mock.calls.length).toBe(frozen);

    // Reconnect: immediate poll, then interval resumes.
    act(() => {
      useNetworkStore.setState({ isOnline: true });
    });
    await waitFor(() => expect(fetchFn.mock.calls.length).toBeGreaterThan(frozen));

    unmount();
  });

  it('preserves last-good data when a later poll throws', async () => {
    // The hook logs preserved-error polls via console.error by design — suppress and
    // assert it so the intentional error doesn't pollute test output.
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      let call = 0;
      const fetchFn = mock(() => {
        call += 1;
        if (call === 1) return Promise.resolve('good');
        return Promise.reject(new Error('boom'));
      });

      const { result } = renderHook(() => useNetworkAwarePolling(fetchFn, { interval: 15 }));

      await waitFor(() => expect(result.current.data).toBe('good'));
      // Subsequent failing polls set error but never wipe data.
      await waitFor(() => expect(result.current.error).not.toBeNull());
      expect(result.current.data).toBe('good');
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });
});
