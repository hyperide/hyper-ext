/**
 * Network status store
 *
 * Tracks browser online/offline state and provides hooks
 * for reacting to network reconnection events.
 */

import { create } from 'zustand';
import { useEffect, useRef } from 'react';

interface NetworkState {
  /** Whether the browser reports being online */
  isOnline: boolean;

  /** Internal: initializes event listeners. Returns cleanup function. */
  _initialize: () => () => void;

  /** Internal: set online state */
  _setOnline: (online: boolean) => void;
}

export const useNetworkStore = create<NetworkState>()((set) => ({
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,

  _setOnline: (online) => {
    set({ isOnline: online });
  },

  _initialize: () => {
    const handleOnline = () => {
      console.log('[Network] Browser reports online');
      set({ isOnline: true });
    };

    const handleOffline = () => {
      console.log('[Network] Browser reports offline');
      set({ isOnline: false });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Sync initial state
    set({ isOnline: navigator.onLine });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  },
}));

/**
 * Hook that fires a callback when network reconnects (offline -> online).
 *
 * @param callback - Function to call on reconnection
 *
 * @example
 * ```ts
 * useOnReconnect(() => {
 *   console.log('Network restored, retrying...');
 *   refetch();
 * });
 * ```
 */
export function useOnReconnect(callback: () => void): void {
  const isOnline = useNetworkStore((state) => state.isOnline);
  const wasOfflineRef = useRef(!isOnline);
  const callbackRef = useRef(callback);

  // Keep callback ref current
  callbackRef.current = callback;

  useEffect(() => {
    if (isOnline && wasOfflineRef.current) {
      console.log('[Network] Reconnected, firing callback');
      callbackRef.current();
    }
    wasOfflineRef.current = !isOnline;
  }, [isOnline]);
}

/**
 * Hook to access current online state.
 */
export function useIsOnline(): boolean {
  return useNetworkStore((state) => state.isOnline);
}
