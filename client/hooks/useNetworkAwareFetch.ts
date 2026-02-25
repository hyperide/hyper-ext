/**
 * Network-aware fetch hook for one-time data fetching.
 *
 * Features:
 * - Distinguishes network errors from server errors
 * - Optionally auto-retries when network reconnects
 * - Optionally preserves data on network errors (shows stale data + error indicator)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { isNetworkError } from '../utils/networkError';
import { useNetworkStore, useOnReconnect } from '../stores/networkStore';

export interface UseNetworkAwareFetchOptions<T> {
  /** Dependencies array - refetch when these change (like useEffect deps) */
  deps?: unknown[];
  /** Auto-retry fetch when network reconnects after offline */
  autoRetryOnReconnect?: boolean;
  /** Keep previous data when a network error occurs (shows stale data) */
  keepDataOnNetworkError?: boolean;
  /** Initial data value */
  initialData?: T;
  /** Skip initial fetch (useful for conditional fetching) */
  skip?: boolean;
}

export interface UseNetworkAwareFetchResult<T> {
  /** Fetched data (null if not loaded yet or error without keepData) */
  data: T | null;
  /** Error message if fetch failed */
  error: string | null;
  /** True if the error is a network error (offline, connection failed, etc.) */
  isNetworkError: boolean;
  /** True if browser reports being offline */
  isOffline: boolean;
  /** True during initial load or refetch */
  isLoading: boolean;
  /** Manually trigger a refetch */
  refetch: () => void;
}

/**
 * Hook for network-aware data fetching.
 *
 * @param fetchFn - Async function that fetches and returns data
 * @param options - Configuration options
 *
 * @example
 * ```tsx
 * const { data, error, isNetworkError, isOffline, isLoading, refetch } = useNetworkAwareFetch(
 *   async () => {
 *     const res = await authFetch('/api/config');
 *     if (!res.ok) throw new Error('Failed to load');
 *     return res.json();
 *   },
 *   { deps: [workspaceId], autoRetryOnReconnect: true }
 * );
 *
 * if (isLoading) return <Spinner />;
 * if (isNetworkError) return <NetworkStatusIndicator variant="banner" onRetry={refetch} />;
 * if (error) return <ErrorMessage>{error}</ErrorMessage>;
 * return <DataView data={data} />;
 * ```
 */
export function useNetworkAwareFetch<T>(
  fetchFn: () => Promise<T>,
  options: UseNetworkAwareFetchOptions<T> = {},
): UseNetworkAwareFetchResult<T> {
  const {
    deps = [],
    autoRetryOnReconnect = false,
    keepDataOnNetworkError = false,
    initialData = null,
    skip = false,
  } = options;

  const [data, setData] = useState<T | null>(initialData as T | null);
  const [error, setError] = useState<string | null>(null);
  const [isNetErr, setIsNetErr] = useState(false);
  const [isLoading, setIsLoading] = useState(!skip);

  const isOnline = useNetworkStore((state) => state.isOnline);
  const fetchFnRef = useRef(fetchFn);
  const mountedRef = useRef(true);

  // Keep fetchFn ref current
  fetchFnRef.current = fetchFn;

  const doFetch = useCallback(async () => {
    if (!mountedRef.current) return;

    setIsLoading(true);
    setError(null);
    setIsNetErr(false);

    try {
      const result = await fetchFnRef.current();
      if (!mountedRef.current) return;

      setData(result);
      setError(null);
      setIsNetErr(false);
    } catch (err) {
      if (!mountedRef.current) return;

      const isNet = isNetworkError(err);
      setIsNetErr(isNet);

      if (isNet) {
        console.log('[NetworkAwareFetch] Network error:', err);
        setError('No internet connection');
        // Only clear data if not keeping on network error
        if (!keepDataOnNetworkError) {
          setData(null);
        }
      } else {
        console.error('[NetworkAwareFetch] Server error:', err);
        setError(err instanceof Error ? err.message : 'Request failed');
        setData(null);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [keepDataOnNetworkError]);

  // Fetch on mount and when deps change
  useEffect(() => {
    mountedRef.current = true;

    if (!skip) {
      doFetch();
    }

    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, ...deps]);

  // Auto-retry on reconnect
  useOnReconnect(
    useCallback(() => {
      if (autoRetryOnReconnect && isNetErr) {
        console.log('[NetworkAwareFetch] Network reconnected, retrying...');
        doFetch();
      }
    }, [autoRetryOnReconnect, isNetErr, doFetch]),
  );

  return {
    data,
    error,
    isNetworkError: isNetErr,
    isOffline: !isOnline,
    isLoading,
    refetch: doFetch,
  };
}
