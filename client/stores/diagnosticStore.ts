/**
 * Diagnostic store — ring buffer of logs, runtime errors, build status.
 *
 * Data flows in from platform-specific sync hooks (SaaS: useDiagnosticSync,
 * ext: DiagnosticHub → platform messages). UI reads from here exclusively.
 */

import type { ConsoleLevel, DiagnosticLogEntry, DiagnosticSource, DiagnosticState } from '@shared/diagnostic-types';
import { DIAGNOSTIC_LOG_LIMIT } from '@shared/diagnostic-types';
import type { RuntimeError } from '@shared/runtime-error';
import { create } from 'zustand';

interface DiagnosticActions {
  addLogs: (entries: DiagnosticLogEntry[]) => void;
  addServerLog: (line: string, isError?: boolean) => void;
  addConsoleLogs: (entries: Array<{ level: ConsoleLevel; args: string[]; timestamp: number }>) => void;
  addSystemEvent: (message: string) => void;
  replaceAllLogs: (entries: DiagnosticLogEntry[]) => void;
  setRuntimeError: (error: RuntimeError | null) => void;
  setBuildStatus: (status: DiagnosticState['buildStatus']) => void;
  setConnected: (connected: boolean) => void;
  clear: () => void;
  getAIContext: () => string;
}

type DiagnosticStore = DiagnosticState & DiagnosticActions;

function appendWithLimit(existing: DiagnosticLogEntry[], incoming: DiagnosticLogEntry[]): DiagnosticLogEntry[] {
  const combined = [...existing, ...incoming];
  if (combined.length <= DIAGNOSTIC_LOG_LIMIT) return combined;
  return combined.slice(combined.length - DIAGNOSTIC_LOG_LIMIT);
}

function levelToError(level: ConsoleLevel): boolean {
  return level === 'error';
}

export const useDiagnosticStore = create<DiagnosticStore>()((set, get) => ({
  logs: [],
  runtimeError: null,
  buildStatus: 'idle',
  isConnected: false,

  addLogs: (entries) => {
    set((state) => ({ logs: appendWithLimit(state.logs, entries) }));
  },

  addServerLog: (line, isError = false) => {
    const entry: DiagnosticLogEntry = {
      line,
      timestamp: Date.now(),
      source: 'server',
      isError,
    };
    set((state) => ({ logs: appendWithLimit(state.logs, [entry]) }));
  },

  addSystemEvent: (message) => {
    const entry: DiagnosticLogEntry = {
      line: `--- ${message} ---`,
      timestamp: Date.now(),
      source: 'system',
      isError: false,
    };
    set((state) => ({ logs: appendWithLimit(state.logs, [entry]) }));
  },

  replaceAllLogs: (entries) => {
    set({ logs: entries.slice(-DIAGNOSTIC_LOG_LIMIT) });
  },

  addConsoleLogs: (entries) => {
    const logEntries: DiagnosticLogEntry[] = entries.map((e) => ({
      line: e.args.join(' '),
      timestamp: e.timestamp,
      source: 'console' as DiagnosticSource,
      isError: levelToError(e.level),
      level: e.level,
    }));
    set((state) => ({ logs: appendWithLimit(state.logs, logEntries) }));
  },

  setRuntimeError: (error) => set({ runtimeError: error }),

  setBuildStatus: (status) => set({ buildStatus: status }),

  setConnected: (connected) => set({ isConnected: connected }),

  clear: () => set({ logs: [], runtimeError: null }),

  getAIContext: () => {
    const { logs, runtimeError, buildStatus } = get();

    const parts: string[] = [];

    if (buildStatus !== 'ready' && buildStatus !== 'idle') {
      parts.push(`Build status: ${buildStatus}`);
    }

    if (runtimeError) {
      parts.push(
        `Runtime Error (${runtimeError.framework}): ${runtimeError.type}: ${runtimeError.message}` +
          (runtimeError.file ? `\nFile: ${runtimeError.file}${runtimeError.line ? `:${runtimeError.line}` : ''}` : '') +
          (runtimeError.codeframe ? `\n\`\`\`\n${runtimeError.codeframe}\n\`\`\`` : ''),
      );
    }

    const serverLogs = logs.filter((l) => l.source === 'server').slice(-50);
    if (serverLogs.length > 0) {
      parts.push(
        `Server logs (last ${serverLogs.length}):\n\`\`\`\n${serverLogs.map((l) => l.line).join('\n')}\n\`\`\``,
      );
    }

    const consoleLogs = logs.filter((l) => l.source === 'console').slice(-30);
    if (consoleLogs.length > 0) {
      parts.push(
        `Console output (last ${consoleLogs.length}):\n\`\`\`\n${consoleLogs.map((l) => `[${l.level ?? 'log'}] ${l.line}`).join('\n')}\n\`\`\``,
      );
    }

    const errorLogs = logs.filter((l) => l.isError).slice(-20);
    if (errorLogs.length > 0 && serverLogs.length === 0 && consoleLogs.length === 0) {
      parts.push(
        `Error entries (last ${errorLogs.length}):\n\`\`\`\n${errorLogs.map((l) => l.line).join('\n')}\n\`\`\``,
      );
    }

    return parts.join('\n\n');
  },
}));
