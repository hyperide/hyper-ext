/**
 * Network-aware polling hook.
 *
 * CRITICAL: Data is NEVER replaced on error - only error state changes.
 * This prevents the UI from losing displayed content during network hiccups.
 *
 * Features:
 * - Preserves last successful data on errors
 * - Distinguishes network errors from server errors
 * - Pauses polling when offline
 * - Auto-resumes polling when back online
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { isNetworkError } from '../utils/networkError';
import { useNetworkStore, useOnReconnect } from '../stores/networkStore';

export interface UseNetworkAwarePollingOptions<T> {
  /** Polling interval in milliseconds */
  interval: number;
  /** Whether polling is enabled */
  enabled?: boolean;
  /** Initial data value */
  initialData?: T;
  /** Dependencies - refetch immediately when these change */
  deps?: unknown[];
}

export interface UseNetworkAwarePollingResult<T> {
  /** Last successfully fetched data (preserved on errors) */
  data: T | null;
  /** Error message if last fetch failed */
  error: string | null;
  /** True if the error is a network error */
  isNetworkError: boolean;
  /** True if browser reports being offline */
  isOffline: boolean;
  /** True during initial fetch (not during polling updates) */
  isLoading: boolean;
  /** Manually trigger a poll */
  poll: () => void;
  /** Clear the error state */
  clearError: () => void;
}

/**
 * Hook for network-aware polling that preserves data on errors.
 *
 * @param fetchFn - Async function that fetches and returns data
 * @param options - Configuration options
 *
 * @example
 * ```tsx
 * const { data: projects, isNetworkError, isOffline, poll } = useNetworkAwarePolling(
 *   async () => {
 *     const res = await authFetch('/api/projects');
 *     if (!res.ok) throw new Error('Failed');
 *     return res.json();
 *   },
 *   { interval: 3000, enabled: true }
 * );
 *
 * // In header:
 * {(isNetworkError || isOffline) && (
 *   <NetworkStatusIndicator variant="badge" isOffline={isOffline} />
 * )}
 *
 * // Projects list is always shown (even when offline)
 * {projects?.map(p => <ProjectCard key={p.id} project={p} />)}
 * ```
 */
export function useNetworkAwarePolling<T>(
  fetchFn: () => Promise<T>,
  options: UseNetworkAwarePollingOptions<T>,
): UseNetworkAwarePollingResult<T> {
  const { interval, enabled = true, initialData = null, deps = [] } = options;

  const [data, setData] = useState<T | null>(initialData as T | null);
  const [error, setError] = useState<string | null>(null);
  const [isNetErr, setIsNetErr] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const isOnline = useNetworkStore((state) => state.isOnline);
  const fetchFnRef = useRef(fetchFn);
  const mountedRef = useRef(true);
  const hasInitialData = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep fetchFn ref current
  fetchFnRef.current = fetchFn;

  const doPoll = useCallback(async () => {
    if (!mountedRef.current) return;

    // Don't poll if offline
    if (!navigator.onLine) {
      console.log('[NetworkAwarePolling] Skipping poll - offline');
      setIsNetErr(true);
      setError('No internet connection');
      return;
    }

    try {
      const result = await fetchFnRef.current();
      if (!mountedRef.current) return;

      // Success - update data and clear error
      setData(result);
      setError(null);
      setIsNetErr(false);
      hasInitialData.current = true;
    } catch (err) {
      if (!mountedRef.current) return;

      const isNet = isNetworkError(err);
      setIsNetErr(isNet);

      if (isNet) {
        console.log('[NetworkAwarePolling] Network error (data preserved):', err);
        setError('No internet connection');
        // CRITICAL: Do NOT clear data on network error
      } else {
        console.error('[NetworkAwarePolling] Server error (data preserved):', err);
        setError(err instanceof Error ? err.message : 'Request failed');
        // CRITICAL: Do NOT clear data on server error either during polling
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setIsNetErr(false);
  }, []);

  // Initial fetch and deps-triggered fetch
  useEffect(() => {
    mountedRef.current = true;
    setIsLoading(true);

    if (enabled) {
      doPoll();
    }

    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  // Polling interval
  useEffect(() => {
    if (!enabled || !isOnline) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(doPoll, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, isOnline, interval, doPoll]);

  // Resume polling on reconnect
  useOnReconnect(
    useCallback(() => {
      if (enabled) {
        console.log('[NetworkAwarePolling] Network reconnected, polling now...');
        doPoll();
      }
    }, [enabled, doPoll]),
  );

  return {
    data,
    error,
    isNetworkError: isNetErr,
    isOffline: !isOnline,
    isLoading: isLoading && !hasInitialData.current,
    poll: doPoll,
    clearError,
  };
}
