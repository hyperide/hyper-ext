/**
 * SaaS diagnostic sync hook.
 *
 * Connects container logs (SSE + polling fallback), runtime errors,
 * proxy errors, and iframe console capture to the diagnosticStore.
 */

import type { ConsoleCaptureMessage, DiagnosticLogEntry } from '@shared/diagnostic-types';
import { CONSOLE_CAPTURE_EVENT } from '@shared/diagnostic-types';
import type { RuntimeError } from '@shared/runtime-error';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReconnectingEventSource } from '@/hooks/useReconnectingEventSource';
import { useAuthStore } from '@/stores/authStore';
import { useDiagnosticStore } from '@/stores/diagnosticStore';
import { authFetch } from '@/utils/authFetch';

interface ProxyLogEntry {
  timestamp: string;
  method: string;
  path: string;
  targetHost: string;
  status: number | 'timeout' | 'error';
  duration: number;
  error?: string;
}

interface UseDiagnosticSyncOptions {
  projectId: string | undefined;
  containerStatus?: string;
  runtimeError?: RuntimeError | null;
  proxyError?: string | null;
}

export function useDiagnosticSync({ projectId, containerStatus, runtimeError, proxyError }: UseDiagnosticSyncOptions) {
  const { accessToken } = useAuthStore();
  const {
    addLogs,
    addConsoleLogs,
    addSystemEvent,
    setRuntimeError,
    setBuildStatus,
    setConnected,
    clear,
    replaceAllLogs,
  } = useDiagnosticStore();
  const logsLength = useDiagnosticStore((s) => s.logs.length);

  const [usePolling, setUsePolling] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const lastLogCountRef = useRef(0);
  const sseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseReceivedDataRef = useRef(false);
  const prevStatusRef = useRef(containerStatus);
  const wasConnectedRef = useRef(false);

  // Sync runtime error to store
  useEffect(() => {
    setRuntimeError(runtimeError ?? null);
  }, [runtimeError, setRuntimeError]);

  // Sync proxy error as system log
  useEffect(() => {
    if (proxyError) {
      addLogs([
        {
          line: `Proxy Error: ${proxyError}`,
          timestamp: Date.now(),
          source: 'proxy',
          isError: true,
        },
      ]);
    }
  }, [proxyError, addLogs]);

  // Sync build status
  useEffect(() => {
    if (containerStatus === 'building') {
      setBuildStatus('building');
    } else if (containerStatus === 'running') {
      setBuildStatus('ready');
    } else if (containerStatus === 'stopped') {
      setBuildStatus('idle');
    }
  }, [containerStatus, setBuildStatus]);

  // Handle container status changes — clear on restart
  useEffect(() => {
    if (containerStatus === 'stopped') {
      if (sseTimeoutRef.current) {
        clearTimeout(sseTimeoutRef.current);
        sseTimeoutRef.current = null;
      }
      setConnected(false);
      setUsePolling(false);
      setLoadingInitial(false);
    }

    if (containerStatus === 'building' && prevStatusRef.current !== 'building') {
      addSystemEvent('Container restarting');
      clear();
      setLoadingInitial(true);
      setUsePolling(false);
      lastLogCountRef.current = 0;
      sseReceivedDataRef.current = false;

      if (sseTimeoutRef.current) {
        clearTimeout(sseTimeoutRef.current);
        sseTimeoutRef.current = null;
      }
    }
    prevStatusRef.current = containerStatus;
  }, [containerStatus, setConnected, clear, addSystemEvent]);

  // Fetch logs via HTTP (initial load + polling fallback)
  const fetchLogs = useCallback(
    async (isInitial: boolean) => {
      if (!projectId) return;
      try {
        const linesToFetch = isInitial ? 100 : 500;
        const res = await authFetch(`/api/docker/logs/${projectId}?lines=${linesToFetch}`);
        if (res.ok) {
          const data = await res.json();
          if (data.logs) {
            const logLines: string[] = data.logs.split('\n').filter((line: string) => line.trim());

            if (isInitial || logLines.length < lastLogCountRef.current) {
              // Initial load or container restarted — replace
              const entries = logLines.map((line: string) => ({
                line,
                timestamp: Date.now(),
                source: 'server' as const,
                isError: false,
              }));
              // Clear first then add
              clear();
              addLogs(entries);
              lastLogCountRef.current = logLines.length;
            } else if (logLines.length > lastLogCountRef.current) {
              const newLines = logLines.slice(lastLogCountRef.current);
              addLogs(
                newLines.map((line: string) => ({
                  line,
                  timestamp: Date.now(),
                  source: 'server' as const,
                  isError: false,
                })),
              );
              lastLogCountRef.current = logLines.length;
            }
          }
        }
      } catch (err) {
        console.error('[DiagnosticSync] Failed to fetch logs:', err);
      }
    },
    [projectId, addLogs, clear],
  );

  // Initial fetch
  useEffect(() => {
    if (!projectId || !loadingInitial) return;
    if (containerStatus === 'stopped') return;

    fetchLogs(true).finally(() => setLoadingInitial(false));
  }, [projectId, loadingInitial, fetchLogs, containerStatus]);

  // SSE URL
  const sseUrl = useMemo(() => {
    if (!projectId || loadingInitial || usePolling || containerStatus === 'stopped') return null;
    return accessToken
      ? `/api/docker/logs/${projectId}/stream?token=${accessToken}`
      : `/api/docker/logs/${projectId}/stream`;
  }, [projectId, accessToken, loadingInitial, usePolling, containerStatus]);

  // SSE with auto-reconnect
  useReconnectingEventSource({
    url: sseUrl,
    onOpen: useCallback(() => {
      setConnected(true);
      const label = wasConnectedRef.current ? 'Reconnected to log stream' : 'Connected to log stream';
      wasConnectedRef.current = true;
      addSystemEvent(label);
      sseTimeoutRef.current = setTimeout(() => {
        if (!sseReceivedDataRef.current) {
          setConnected(false);
          setUsePolling(true);
        }
      }, 5000);
    }, [setConnected, addSystemEvent]),
    onMessage: useCallback(
      (data: unknown) => {
        sseReceivedDataRef.current = true;
        if (sseTimeoutRef.current) {
          clearTimeout(sseTimeoutRef.current);
          sseTimeoutRef.current = null;
        }

        const event = data as {
          error?: string;
          line?: string;
          timestamp?: string;
          type?: 'container' | 'proxy';
          proxyEntry?: ProxyLogEntry;
        };

        if (event.line && event.timestamp) {
          const isProxy = event.type === 'proxy';
          const isError =
            isProxy &&
            event.proxyEntry &&
            (event.proxyEntry.status === 'timeout' ||
              event.proxyEntry.status === 'error' ||
              (typeof event.proxyEntry.status === 'number' && event.proxyEntry.status >= 400));

          addLogs([
            {
              line: event.line,
              timestamp: new Date(event.timestamp).getTime(),
              source: isProxy ? 'proxy' : 'server',
              isError: !!isError,
            },
          ]);
        }
      },
      [addLogs],
    ),
    onError: useCallback(() => {
      if (sseReceivedDataRef.current) {
        setConnected(false);
        addSystemEvent('Log stream disconnected');
      }
    }, [setConnected, addSystemEvent]),
    onStatusChange: useCallback(
      (status) => {
        setConnected(status === 'connected');
      },
      [setConnected],
    ),
  });

  // Polling fallback
  useEffect(() => {
    if (!projectId || loadingInitial || !usePolling) return;
    if (containerStatus === 'stopped') return;

    setConnected(true);
    const pollInterval = setInterval(() => fetchLogs(false), 2000);
    return () => clearInterval(pollInterval);
  }, [projectId, loadingInitial, usePolling, fetchLogs, containerStatus, setConnected]);

  // Listen for console capture messages from iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === CONSOLE_CAPTURE_EVENT) {
        const msg = event.data as ConsoleCaptureMessage;
        addConsoleLogs(msg.entries);
      }
    };

    // nosemgrep: insufficient-postmessage-origin-validation -- type-checked iframe console capture, same-origin
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [addConsoleLogs]);

  // Fetch K8s metadata (events, restart info, previous logs) — push to store
  useEffect(() => {
    if (!projectId) return;

    const fetchMetadata = async () => {
      // Previous logs
      try {
        const res = await authFetch(`/api/docker/logs/${projectId}/previous?lines=100`);
        if (res.ok) {
          const data = await res.json();
          if (data.logs) {
            const logLines: string[] = data.logs.split('\n').filter((line: string) => line.trim());
            addLogs(
              logLines.map((line) => ({
                line,
                timestamp: Date.now() - 1_000_000, // ensure they sort before current logs
                source: 'server' as const,
                isError: false,
              })),
            );
          }
        }
      } catch {
        // ignore
      }

      // K8s events
      try {
        const res = await authFetch(`/api/docker/events/${projectId}?limit=20`);
        if (res.ok) {
          const data = await res.json();
          if (data.events) {
            addLogs(
              data.events.map((e: { type: string; reason: string; message: string; timestamp: string }) => ({
                line: `[K8s ${e.type}] ${e.reason}: ${e.message}`,
                timestamp: new Date(e.timestamp).getTime(),
                source: 'system' as const,
                isError: e.type === 'Warning',
              })),
            );
          }
        }
      } catch {
        // ignore
      }
    };

    fetchMetadata();
    const interval = setInterval(fetchMetadata, 30000);
    return () => clearInterval(interval);
  }, [projectId, addLogs]);

  // ── Postgres persistence ──

  const persistedFetchedRef = useRef(false);
  const persistedReadyRef = useRef(false);
  const batchBufferRef = useRef<DiagnosticLogEntry[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const prevLogsLenRef = useRef(0);

  // Reset persistence state on project change
  useEffect(() => {
    persistedFetchedRef.current = false;
    persistedReadyRef.current = false;
    prevLogsLenRef.current = 0;
    batchBufferRef.current = [];
    clearTimeout(batchTimerRef.current);
  }, [projectId]);

  // Load persisted logs on mount (before SSE starts delivering)
  useEffect(() => {
    if (!projectId || persistedFetchedRef.current) return;
    persistedFetchedRef.current = true;

    authFetch(`/api/diagnostic-logs/${projectId}?limit=5000`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { entries: DiagnosticLogEntry[] } | null) => {
        if (data?.entries?.length) {
          replaceAllLogs(data.entries);
          prevLogsLenRef.current = data.entries.length;
        }
        persistedReadyRef.current = true;
      })
      .catch(() => {
        persistedReadyRef.current = true;
      });
  }, [projectId, replaceAllLogs]);

  // Batch writer: buffer new entries and flush every 3s
  const flushBatch = useCallback(() => {
    if (!projectId || batchBufferRef.current.length === 0) return;
    const entries = batchBufferRef.current;
    batchBufferRef.current = [];

    authFetch(`/api/diagnostic-logs/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    }).catch(() => {});
  }, [projectId]);

  // Track new log entries added to the store and buffer them for persistence.
  // Uses logsLength selector (not full logs array) to avoid re-running on every reference change.
  // Note: do NOT advance prevLogsLenRef until persistedReadyRef is true —
  // otherwise entries arriving before persisted load completes would be silently lost.
  useEffect(() => {
    if (!projectId || !persistedReadyRef.current) return;

    // Detect clear(): logsLength dropped below prevLogsLenRef → reset tracker
    if (logsLength < prevLogsLenRef.current) {
      prevLogsLenRef.current = logsLength;
      return;
    }
    if (logsLength <= prevLogsLenRef.current) return;

    const allLogs = useDiagnosticStore.getState().logs;
    const newEntries = allLogs.slice(prevLogsLenRef.current);
    prevLogsLenRef.current = logsLength;
    batchBufferRef.current.push(...newEntries);

    clearTimeout(batchTimerRef.current);
    batchTimerRef.current = setTimeout(flushBatch, 3000);
  }, [logsLength, projectId, flushBatch]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      clearTimeout(batchTimerRef.current);
      flushBatch();
    };
  }, [flushBatch]);

  // Wrap clear to also delete persisted logs
  const originalClear = clear;
  const persistedClear = useCallback(() => {
    originalClear();
    if (projectId) {
      authFetch(`/api/diagnostic-logs/${projectId}`, { method: 'DELETE' }).catch(() => {});
    }
  }, [originalClear, projectId]);

  return { clear: persistedClear };
}
