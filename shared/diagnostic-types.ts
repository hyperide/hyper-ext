import type { RuntimeError } from './runtime-error';

export type DiagnosticSource = 'server' | 'proxy' | 'console' | 'system';
export type ConsoleLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

export interface DiagnosticLogEntry {
  line: string;
  timestamp: number;
  source: DiagnosticSource;
  isError: boolean;
  level?: ConsoleLevel;
}

export interface DiagnosticState {
  logs: DiagnosticLogEntry[];
  runtimeError: RuntimeError | null;
  buildStatus: 'idle' | 'building' | 'ready' | 'error';
  isConnected: boolean;
}

/** Max entries in the ring buffer */
export const DIAGNOSTIC_LOG_LIMIT = 5000;

export type DiagnosticTimeRange = 'all' | '5m' | '30m' | '1h' | 'custom';

export interface DiagnosticFilterState {
  sources: Record<DiagnosticSource, boolean>;
  timeRange: DiagnosticTimeRange;
  customTimeStart?: number;
  customTimeEnd?: number;
  searchQuery: string;
}

export const DEFAULT_DIAGNOSTIC_FILTER: DiagnosticFilterState = {
  sources: { server: true, proxy: true, console: true, system: true },
  timeRange: 'all',
  searchQuery: '',
};

export const TIME_RANGE_MS: Record<Exclude<DiagnosticTimeRange, 'all' | 'custom'>, number> = {
  '5m': 5 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

/** Console capture postMessage event type */
export const CONSOLE_CAPTURE_EVENT = 'hypercanvas:console';

export interface ConsoleCaptureMessage {
  type: typeof CONSOLE_CAPTURE_EVENT;
  entries: Array<{
    level: ConsoleLevel;
    args: string[];
    timestamp: number;
  }>;
}
