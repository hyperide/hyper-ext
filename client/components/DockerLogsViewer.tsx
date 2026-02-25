import type { RuntimeError } from '@shared/runtime-error';
import { IconChevronDown, IconTrash, IconWand } from '@tabler/icons-react';
import cn from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useReconnectingEventSource } from '@/hooks/useReconnectingEventSource';
import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/utils/authFetch';

interface ProjectInfo {
  name: string;
  framework: string;
  path: string;
  devCommand: string;
}

interface DockerLogsViewerProps {
  projectId: string;
  height?: string;
  autoScroll?: boolean;
  initialLines?: number;
  containerStatus?: string;
  projectInfo?: ProjectInfo;
  proxyError?: string | null;
  runtimeError?: RuntimeError | null;
}

interface ProxyLogEntry {
  timestamp: string;
  method: string;
  path: string;
  targetHost: string;
  status: number | 'timeout' | 'error';
  duration: number;
  error?: string;
}

interface LogEntry {
  line: string;
  timestamp: string;
  type?: 'previous' | 'current' | 'restart' | 'event' | 'proxy' | 'container';
  proxyEntry?: ProxyLogEntry;
}

interface K8sEvent {
  type: string;
  reason: string;
  message: string;
  source: string;
  timestamp: string;
  count: number;
}

interface RestartInfo {
  restartCount: number;
  lastRestartTime?: string;
  reason?: string;
}

export function DockerLogsViewer({
  projectId,
  height = '400px',
  autoScroll = true,
  initialLines = 100,
  containerStatus,
  projectInfo,
  proxyError,
  runtimeError,
}: DockerLogsViewerProps) {
  const { accessToken } = useAuthStore();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [previousLogs, setPreviousLogs] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<K8sEvent[]>([]);
  const [restartInfo, setRestartInfo] = useState<RestartInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [usePolling, setUsePolling] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [userScrolled, setUserScrolled] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const HEADER_HEIGHT = 41; // px - height of header bar
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef<string | undefined>(containerStatus);
  const lastLogCountRef = useRef<number>(0);
  const sseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseReceivedDataRef = useRef(false);

  // Handle scroll to disable auto-scroll when user scrolls up
  const handleScroll = useCallback(() => {
    if (!scrollAreaRef.current) return;
    const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
    if (!scrollContainer) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

    if (!isAtBottom) {
      setUserScrolled(true);
    } else {
      setUserScrolled(false);
    }
  }, []);

  // Handle container status changes
  useEffect(() => {
    // Container stopped - close all connections
    if (containerStatus === 'stopped') {
      if (sseTimeoutRef.current) {
        clearTimeout(sseTimeoutRef.current);
        sseTimeoutRef.current = null;
      }
      setConnected(false);
      setUsePolling(false);
      setLoadingInitial(false);
    }

    // Container is starting - clear old logs and prepare for new ones
    if (containerStatus === 'building' && prevStatusRef.current !== 'building') {
      setLogs([]);
      setError(null);
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
  }, [containerStatus]);

  // Fetch K8s events, restart info, and previous logs
  useEffect(() => {
    if (!projectId) return;

    const fetchMetadata = async () => {
      // Fetch events
      try {
        const res = await authFetch(`/api/docker/events/${projectId}?limit=20`);
        if (res.ok) {
          const data = await res.json();
          if (data.events) {
            setEvents(data.events);
          }
        }
      } catch (err) {
        console.debug('[DockerLogsViewer] Failed to fetch events:', err);
      }

      // Fetch restart info
      try {
        const res = await authFetch(`/api/docker/restarts/${projectId}`);
        if (res.ok) {
          const data = await res.json();
          setRestartInfo(data);
        }
      } catch (err) {
        console.debug('[DockerLogsViewer] Failed to fetch restart info:', err);
      }

      // Fetch previous logs (from before last restart)
      try {
        const res = await authFetch(`/api/docker/logs/${projectId}/previous?lines=100`);
        if (res.ok) {
          const data = await res.json();
          if (data.logs) {
            const logLines = data.logs.split('\n').filter((line: string) => line.trim());
            const prevEntries: LogEntry[] = logLines.map((line: string) => ({
              line,
              timestamp: new Date().toISOString(),
              type: 'previous' as const,
            }));
            setPreviousLogs(prevEntries);
          }
        }
      } catch (err) {
        console.debug('[DockerLogsViewer] Failed to fetch previous logs:', err);
      }
    };

    // Fetch immediately and then every 30 seconds
    fetchMetadata();
    const interval = setInterval(fetchMetadata, 30000);

    return () => clearInterval(interval);
  }, [projectId]);

  // Fetch logs via HTTP (for initial load and polling fallback)
  const fetchLogs = useCallback(
    async (isInitial: boolean) => {
      try {
        const linesToFetch = isInitial ? initialLines : 500;
        const res = await authFetch(`/api/docker/logs/${projectId}?lines=${linesToFetch}`);

        if (res.ok) {
          const data = await res.json();
          if (data.logs) {
            const logLines = data.logs.split('\n').filter((line: string) => line.trim());
            const newEntries: LogEntry[] = logLines.map((line: string) => ({
              line,
              timestamp: new Date().toISOString(),
              type: 'current' as const,
            }));

            if (isInitial) {
              setLogs(newEntries);
              lastLogCountRef.current = newEntries.length;
            } else {
              // Container restarted - log count decreased, replace all logs
              if (newEntries.length < lastLogCountRef.current) {
                setLogs(newEntries);
                lastLogCountRef.current = newEntries.length;
              }
              // Only add new lines (compare by count - docker logs are append-only)
              else if (newEntries.length > lastLogCountRef.current) {
                const newLines = newEntries.slice(lastLogCountRef.current);
                setLogs((prev) => [...prev, ...newLines]);
                lastLogCountRef.current = newEntries.length;
              }
              // If equal - no changes
            }
            setError(null);
          }
        }
      } catch (err) {
        console.error('[DockerLogsViewer] Failed to fetch logs:', err);
        if (isInitial) {
          setError('Failed to load logs');
        }
      }
    },
    [initialLines, projectId],
  );

  // Initial fetch (only when container is running or building)
  useEffect(() => {
    if (!projectId || !loadingInitial) return;
    if (containerStatus === 'stopped') return;

    fetchLogs(true).finally(() => {
      setLoadingInitial(false);
    });
  }, [projectId, loadingInitial, fetchLogs, containerStatus]);

  // SSE URL for Docker logs (null when polling or not ready)
  const sseUrl = useMemo(() => {
    if (!projectId || loadingInitial || usePolling || containerStatus === 'stopped') {
      return null;
    }
    return accessToken
      ? `/api/docker/logs/${projectId}/stream?token=${accessToken}`
      : `/api/docker/logs/${projectId}/stream`;
  }, [projectId, accessToken, loadingInitial, usePolling, containerStatus]);

  // SSE with auto-reconnect, fallback to polling if no data received
  useReconnectingEventSource({
    url: sseUrl,
    onOpen: useCallback(() => {
      setConnected(true);
      setError(null);
      // Start timeout for polling fallback
      sseTimeoutRef.current = setTimeout(() => {
        if (!sseReceivedDataRef.current) {
          console.log('[DockerLogsViewer] SSE timeout - switching to polling (Cloudflare tunnel detected)');
          setConnected(false);
          setUsePolling(true);
        }
      }, 5000);
    }, []),
    onMessage: useCallback((data: unknown) => {
      sseReceivedDataRef.current = true;
      // Clear timeout since we received data
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
      if (event.error) {
        setError(event.error);
        return;
      }
      if (event.line && event.timestamp) {
        const { line, timestamp, type, proxyEntry } = event;
        const logType = type === 'proxy' ? 'proxy' : 'current';
        setLogs((prev) => [...prev, { line, timestamp, type: logType, proxyEntry }]);
      }
    }, []),
    onError: useCallback(() => {
      // Don't show error if we haven't received any data - will fallback to polling
      if (sseReceivedDataRef.current) {
        setError('Connection lost. Retrying...');
      }
    }, []),
    onStatusChange: useCallback((status) => {
      if (status !== 'connected') {
        setConnected(false);
      }
    }, []),
  });

  // Polling fallback (every 2 seconds)
  useEffect(() => {
    if (!projectId || loadingInitial || !usePolling) return;
    if (containerStatus === 'stopped') return;

    console.log('[DockerLogsViewer] Using polling mode');
    setConnected(true); // Show as "connected" even in polling mode

    const pollInterval = setInterval(() => {
      fetchLogs(false);
    }, 2000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [projectId, loadingInitial, usePolling, fetchLogs, containerStatus]);

  // Combine all logs: previous logs + restart marker + events + current logs
  const allLogs = useMemo(() => {
    const combined: LogEntry[] = [];

    // Add previous logs first
    if (previousLogs.length > 0) {
      combined.push(...previousLogs);

      // Add restart marker if there were restarts
      if (restartInfo && restartInfo.restartCount > 0) {
        combined.push({
          line: `═══ CONTAINER RESTARTED (${restartInfo.restartCount} total restarts${restartInfo.reason ? `, reason: ${restartInfo.reason}` : ''}) ═══`,
          timestamp: restartInfo.lastRestartTime || new Date().toISOString(),
          type: 'restart',
        });
      }
    }

    // Add K8s events as log entries
    for (const event of events) {
      combined.push({
        line: `[K8s ${event.type}] ${event.reason}: ${event.message}`,
        timestamp: event.timestamp,
        type: 'event',
      });
    }

    // Add current logs
    combined.push(...logs);

    return combined;
  }, [previousLogs, logs, restartInfo, events]);

  // Auto-scroll to bottom when new logs arrive (unless user scrolled up)
  useEffect(() => {
    if (autoScroll && !userScrolled && scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [allLogs, autoScroll, userScrolled]);

  // Add scroll event listener
  useEffect(() => {
    if (!scrollAreaRef.current) return;
    const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
    if (!scrollContainer) return;

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const handleClear = () => {
    setLogs([]);
    setPreviousLogs([]);
    setEvents([]);
    lastLogCountRef.current = 0;
    setUserScrolled(false);
  };

  // Auto Fix - opens AI chat with full context
  const handleAutoFix = () => {
    if (!projectInfo) return;

    const recentLogs = logs
      .slice(-50)
      .map((log) => log.line)
      .join('\n');
    const prevLogsText =
      previousLogs.length > 0
        ? previousLogs
            .slice(-50)
            .map((log) => log.line)
            .join('\n')
        : '';

    const eventsText = events.length > 0 ? events.map((e) => `- ${e.type}: ${e.reason} - ${e.message}`).join('\n') : '';

    const restartText =
      restartInfo && restartInfo.restartCount > 0
        ? `Container has restarted ${restartInfo.restartCount} times. ${restartInfo.reason ? `Last reason: ${restartInfo.reason}` : ''}`
        : '';

    const proxyErrorText = proxyError ? `**Proxy Error (request couldn't reach container):** ${proxyError}` : '';

    const runtimeErrorText = runtimeError
      ? `**Runtime Error (${runtimeError.framework}):**
${runtimeError.type}: ${runtimeError.message}
${runtimeError.file ? `File: ${runtimeError.file}${runtimeError.line ? `:${runtimeError.line}` : ''}` : ''}
${runtimeError.codeframe ? `\`\`\`\n${runtimeError.codeframe}\n\`\`\`` : ''}`
      : '';

    const issueType = runtimeError ? 'build/runtime' : proxyError?.includes('404') ? 'routing/preview' : 'container';

    const prompt = `Fix the ${issueType} issues in this project.

**Project:** ${projectInfo.name}
**Framework:** ${projectInfo.framework}
**Path:** ${projectInfo.path}
**Dev Command:** ${projectInfo.devCommand}
${runtimeErrorText ? `\n${runtimeErrorText}` : ''}
${proxyErrorText ? `\n${proxyErrorText}` : ''}
${restartText ? `\n**Restarts:** ${restartText}` : ''}
${eventsText ? `\n**K8s Events:**\n${eventsText}` : ''}
${prevLogsText ? `\n**Previous Container Logs (before restart - may contain startup errors):**\n\`\`\`\n${prevLogsText}\n\`\`\`` : ''}

**Current Container Logs (last 50 lines):**
\`\`\`
${recentLogs}
\`\`\`

Analyze the errors and suggest a fix.`;

    window.dispatchEvent(
      new CustomEvent('openAIChat', {
        detail: {
          prompt,
          forceNewChat: true,
          projectId,
        },
      }),
    );
  };

  // Get style for log entry based on type
  const getLogStyle = (log: LogEntry) => {
    if (log.type === 'previous') {
      return { color: '#888', opacity: 0.8 };
    }
    if (log.type === 'restart') {
      return {
        color: '#ef4444',
        fontWeight: 600,
        padding: '4px 0',
        borderTop: '1px solid rgba(239, 68, 68, 0.3)',
        borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
        margin: '8px 0',
      };
    }
    if (log.type === 'event') {
      return {
        color: log.line.includes('Warning') ? '#f97316' : '#3b82f6',
        fontStyle: 'italic',
      };
    }
    if (log.type === 'proxy') {
      // Check if it's an error/timeout (red) or success (cyan)
      const proxyEntry = log.proxyEntry;
      const isError =
        proxyEntry &&
        (proxyEntry.status === 'timeout' ||
          proxyEntry.status === 'error' ||
          (typeof proxyEntry.status === 'number' && proxyEntry.status >= 400));
      return {
        color: isError ? '#ef4444' : '#22d3ee', // Red for errors, cyan for success
        fontStyle: 'italic',
      };
    }
    return {};
  };

  return (
    <div
      style={{
        height: isCollapsed ? `${HEADER_HEIGHT}px` : height,
        transition: 'height 150ms ease-out',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="h-[41px] px-2 flex items-center justify-between bg-muted border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Container Logs</span>
          <div
            className={cn('w-2 h-2 rounded-full', connected ? 'bg-green-500' : 'bg-red-500')}
            title={connected ? (usePolling ? 'Polling' : 'SSE Connected') : 'Disconnected'}
          />
          {usePolling && <span className="text-[10px] text-muted-foreground">(polling)</span>}
          {restartInfo && restartInfo.restartCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">
              {restartInfo.restartCount} restarts
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {userScrolled && <span className="text-[10px] text-muted-foreground mr-1">(scroll paused)</span>}
          {projectInfo && (
            <Button variant="outline" size="sm" onClick={handleAutoFix} title="Open AI Chat to fix issues">
              <IconWand size={16} />
              <span className="ml-1">Auto Fix</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleClear} title="Clear logs">
            <IconTrash size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? 'Expand panel' : 'Collapse panel'}
          >
            <IconChevronDown
              size={16}
              className={cn('transition-transform duration-150', {
                'rotate-180': isCollapsed,
              })}
            />
          </Button>
        </div>
      </div>

      {/* Proxy error message - shown when request couldn't reach container */}
      {proxyError && (
        <div
          style={{
            padding: '8px 12px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
            fontFamily: 'monospace',
            fontSize: '12px',
          }}
        >
          <span style={{ color: '#ef4444', fontWeight: 600 }}>Proxy Error: </span>
          <span style={{ color: '#f87171' }}>{proxyError}</span>
        </div>
      )}

      {/* Runtime error from iframe - shown when Next.js/Vite/Bun error detected */}
      {runtimeError && (
        <div
          style={{
            padding: '8px 12px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
            fontFamily: 'monospace',
            fontSize: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ color: '#ef4444', fontWeight: 600 }}>
              {runtimeError.type} ({runtimeError.framework})
            </span>
            {runtimeError.file && (
              <span style={{ color: '#888' }}>
                {runtimeError.file}
                {runtimeError.line ? `:${runtimeError.line}` : ''}
              </span>
            )}
          </div>
          <div style={{ color: '#f87171' }}>{runtimeError.message}</div>
          {runtimeError.codeframe && (
            <pre
              style={{
                margin: '8px 0 0',
                padding: '8px',
                backgroundColor: 'rgba(0,0,0,0.2)',
                borderRadius: '4px',
                overflow: 'auto',
                maxHeight: '150px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {runtimeError.codeframe}
            </pre>
          )}
        </div>
      )}

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0, // Critical for flex children to allow shrinking
        }}
      >
        <ScrollArea ref={scrollAreaRef} style={{ height: '100%', flex: 1 }}>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: '12px',
              padding: '8px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {error && <div style={{ color: '#ef4444', marginBottom: '8px' }}>Error: {error}</div>}
            {loadingInitial && <div style={{ color: '#888', fontStyle: 'italic' }}>Loading logs...</div>}
            {!loadingInitial && allLogs.length === 0 && !error && (
              <div style={{ color: '#888', fontStyle: 'italic' }}>No logs available</div>
            )}
            {allLogs.map((log, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: log entries have no stable id
              <div key={index} style={{ marginBottom: '2px', ...getLogStyle(log) }}>
                {log.type !== 'restart' && (
                  <span style={{ color: '#666', marginRight: '8px', fontSize: '10px' }}>
                    {log.type === 'previous'
                      ? '[prev]'
                      : log.type === 'proxy'
                        ? '[proxy]'
                        : new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                )}
                <span>{log.line}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
