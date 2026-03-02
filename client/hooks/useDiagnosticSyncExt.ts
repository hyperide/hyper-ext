/**
 * Extension diagnostic sync hook.
 *
 * Listens for diagnostic:* platform messages from the extension host
 * (DiagnosticHub) and writes to diagnosticStore. Much lighter than the
 * SaaS version — no SSE, no HTTP polling, no K8s metadata.
 */

import type { DiagnosticLogEntry, DiagnosticState } from '@shared/diagnostic-types';
import type { RuntimeError } from '@shared/runtime-error';
import { useEffect } from 'react';
import { usePlatformCanvas } from '@/lib/platform';
import { useDiagnosticStore } from '@/stores/diagnosticStore';

export function useDiagnosticSyncExt() {
  const canvas = usePlatformCanvas();
  const { addLogs, setRuntimeError, setBuildStatus, setConnected, clear, replaceAllLogs } = useDiagnosticStore();

  // Request full state on mount
  useEffect(() => {
    canvas.sendEvent({ type: 'diagnostic:requestState' });
  }, [canvas]);

  // Listen for diagnostic:state (full sync)
  useEffect(() => {
    return canvas.onEvent('diagnostic:state', (msg) => {
      const { state } = msg as { state: DiagnosticState };
      replaceAllLogs(state.logs);
      setRuntimeError(state.runtimeError);
      setBuildStatus(state.buildStatus);
      setConnected(state.isConnected);
    });
  }, [canvas, replaceAllLogs, setRuntimeError, setBuildStatus, setConnected]);

  // Listen for diagnostic:log (incremental)
  useEffect(() => {
    return canvas.onEvent('diagnostic:log', (msg) => {
      const { entries } = msg as { entries: DiagnosticLogEntry[] };
      addLogs(entries);
    });
  }, [canvas, addLogs]);

  // Listen for diagnostic:runtimeError
  useEffect(() => {
    return canvas.onEvent('diagnostic:runtimeError', (msg) => {
      const { error } = msg as { error: RuntimeError | null };
      setRuntimeError(error);
    });
  }, [canvas, setRuntimeError]);

  // Listen for diagnostic:buildStatus
  useEffect(() => {
    return canvas.onEvent('diagnostic:buildStatus', (msg) => {
      const { status } = msg as { status: DiagnosticState['buildStatus'] };
      setBuildStatus(status);
    });
  }, [canvas, setBuildStatus]);

  // Listen for diagnostic:clear
  useEffect(() => {
    return canvas.onEvent('diagnostic:clear', () => {
      clear();
    });
  }, [canvas, clear]);
}
