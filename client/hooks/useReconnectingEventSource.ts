import { useEffect, useRef, useCallback } from 'react';

export type SSEStatus = 'connected' | 'disconnected' | 'reconnecting';

export interface UseReconnectingEventSourceOptions {
  url: string | null;
  onMessage: (data: unknown) => void;
  onOpen?: () => void;
  onError?: () => void;
  onStatusChange?: (status: SSEStatus) => void;
  maxReconnectAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  withCredentials?: boolean;
}

/**
 * Hook for managing EventSource connections with automatic reconnection.
 *
 * Features:
 * - Exponential backoff with jitter on connection errors
 * - Reconnect on tab visibility change (when tab becomes visible)
 * - Reconnect on network online event
 * - Automatic cleanup on unmount
 */
export function useReconnectingEventSource({
  url,
  onMessage,
  onOpen,
  onError,
  onStatusChange,
  maxReconnectAttempts = 10,
  baseDelay = 1000,
  maxDelay = 30000,
  withCredentials = false,
}: UseReconnectingEventSourceOptions): void {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const statusRef = useRef<SSEStatus>('disconnected');
  const urlRef = useRef(url);
  const mountedRef = useRef(true);

  // Refs for callback props to avoid reconnection on callback reference changes
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  const onErrorRef = useRef(onError);
  const onStatusChangeRef = useRef(onStatusChange);

  // Keep refs up to date
  urlRef.current = url;
  onMessageRef.current = onMessage;
  onOpenRef.current = onOpen;
  onErrorRef.current = onError;
  onStatusChangeRef.current = onStatusChange;

  const setStatus = useCallback((status: SSEStatus) => {
    if (statusRef.current !== status) {
      statusRef.current = status;
      onStatusChangeRef.current?.(status);
    }
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const currentUrl = urlRef.current;
    if (!currentUrl) {
      setStatus('disconnected');
      return;
    }

    // Clean up existing connection
    closeEventSource();
    clearReconnectTimeout();

    // Check if online
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatus('disconnected');
      return;
    }

    const eventSource = new EventSource(currentUrl, { withCredentials });
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      if (!mountedRef.current) return;
      reconnectAttemptsRef.current = 0;
      setStatus('connected');
      onOpenRef.current?.();
    };

    eventSource.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(event.data);
        onMessageRef.current(data);
      } catch (err) {
        console.error('[SSE] Failed to parse message:', err);
      }
    };

    eventSource.onerror = () => {
      if (!mountedRef.current) return;

      closeEventSource();
      onErrorRef.current?.();

      // Attempt reconnect with exponential backoff
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        setStatus('reconnecting');

        // Exponential backoff with jitter
        const exponentialDelay = baseDelay * 2 ** reconnectAttemptsRef.current;
        const jitter = Math.random() * 0.3 * exponentialDelay;
        const delay = Math.min(exponentialDelay + jitter, maxDelay);

        reconnectAttemptsRef.current++;
        // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
        console.log(
          `[SSE] Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`,
        );

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        setStatus('disconnected');
        console.error('[SSE] Max reconnect attempts reached');
      }
    };
  }, [closeEventSource, clearReconnectTimeout, setStatus, maxReconnectAttempts, baseDelay, maxDelay, withCredentials]);

  // Main effect: connect when url changes
  useEffect(() => {
    mountedRef.current = true;

    if (url) {
      connect();
    } else {
      closeEventSource();
      clearReconnectTimeout();
      setStatus('disconnected');
    }

    return () => {
      mountedRef.current = false;
      closeEventSource();
      clearReconnectTimeout();
    };
  }, [url, connect, closeEventSource, clearReconnectTimeout, setStatus]);

  // Reconnect on visibility change (tab becomes visible)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && statusRef.current !== 'connected' && urlRef.current) {
        console.log('[SSE] Tab became visible, reconnecting...');
        reconnectAttemptsRef.current = 0; // Reset attempts on manual reconnect
        connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [connect]);

  // Reconnect on network online
  useEffect(() => {
    const handleOnline = () => {
      if (statusRef.current !== 'connected' && urlRef.current) {
        console.log('[SSE] Network online, reconnecting...');
        reconnectAttemptsRef.current = 0; // Reset attempts on manual reconnect
        connect();
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [connect]);
}
