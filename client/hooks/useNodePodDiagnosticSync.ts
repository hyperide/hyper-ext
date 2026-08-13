import type { DiagnosticSource } from '@shared/diagnostic-types';
import { useEffect, useRef } from 'react';
import type { RuntimeStatus } from '@/lib/project-runtime/types';
import { useDiagnosticStore } from '@/stores/diagnosticStore';

interface UseNodePodDiagnosticSyncOptions {
  enabled: boolean;
  logs: string[];
  runtimeStatus: RuntimeStatus;
  runtimeError: string | null;
}

function mapSource(line: string): DiagnosticSource {
  if (
    line.startsWith('[npm]') ||
    line.startsWith('[npm:err]') ||
    line.startsWith('[vite]') ||
    line.startsWith('[vite:err]')
  )
    return 'server';
  if (line.startsWith('[error]')) return 'server';
  return 'system';
}

function isErrorLine(line: string): boolean {
  return line.startsWith('[error]') || line.startsWith('[npm:err]') || line.startsWith('[vite:err]');
}

export function useNodePodDiagnosticSync({
  enabled,
  logs,
  runtimeStatus,
  runtimeError,
}: UseNodePodDiagnosticSyncOptions): { clear: () => void } {
  const { addLogs, setRuntimeError, setBuildStatus, setConnected, clear } = useDiagnosticStore();
  const pushedCountRef = useRef(0);
  const prevLogsLengthRef = useRef(0);

  // Detect log reset (new boot session) — logs go empty when start() is called
  useEffect(() => {
    if (!enabled) return;
    if (logs.length === 0 && prevLogsLengthRef.current > 0) {
      clear();
      pushedCountRef.current = 0;
    }
    prevLogsLengthRef.current = logs.length;
  }, [enabled, logs.length, clear]);

  // Push new log lines into the store
  useEffect(() => {
    if (!enabled) return;
    if (logs.length <= pushedCountRef.current) return;
    const newLines = logs.slice(pushedCountRef.current);
    pushedCountRef.current = logs.length;
    addLogs(
      newLines.map((line) => ({
        line,
        timestamp: Date.now(),
        source: mapSource(line),
        isError: isErrorLine(line),
      })),
    );
  }, [enabled, logs, addLogs]);

  // Sync build status
  useEffect(() => {
    if (!enabled) return;
    if (runtimeStatus === 'starting') setBuildStatus('building');
    else if (runtimeStatus === 'running') setBuildStatus('ready');
    else if (runtimeStatus === 'error') setBuildStatus('error');
    else setBuildStatus('idle');
  }, [enabled, runtimeStatus, setBuildStatus]);

  // Always connected when enabled (logs come directly from runtime state)
  useEffect(() => {
    if (!enabled) return;
    setConnected(true);
    return () => setConnected(false);
  }, [enabled, setConnected]);

  // Sync runtime error
  useEffect(() => {
    if (!enabled) return;
    setRuntimeError(
      runtimeError ? { type: 'RuntimeError', message: runtimeError, framework: 'vite', fullText: runtimeError } : null,
    );
  }, [enabled, runtimeError, setRuntimeError]);

  return { clear };
}
