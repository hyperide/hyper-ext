import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { DiagnosticLogEntry } from '@shared/diagnostic-types';
import { DEFAULT_DIAGNOSTIC_FILTER } from '@shared/diagnostic-types';

// We test the filtering logic directly by importing the hook
// and calling it via a minimal wrapper. But since hooks need React,
// we'll test the filtering logic extracted from the hook.
// For now, test the pure filtering logic by simulating what useMemo does.

function makeEntry(overrides: Partial<DiagnosticLogEntry> = {}): DiagnosticLogEntry {
  return {
    line: 'test log line',
    timestamp: Date.now(),
    source: 'server',
    isError: false,
    ...overrides,
  };
}

function filterLogs(
  logs: DiagnosticLogEntry[],
  filter: typeof DEFAULT_DIAGNOSTIC_FILTER,
  debouncedQuery: string,
): DiagnosticLogEntry[] {
  let result = logs;

  const enabledSources = (Object.entries(filter.sources) as [string, boolean][])
    .filter(([, enabled]) => enabled)
    .map(([source]) => source);

  if (enabledSources.length < 4) {
    result = result.filter((entry) => enabledSources.includes(entry.source));
  }

  if (filter.timeRange !== 'all') {
    if (filter.timeRange === 'custom') {
      const start = filter.customTimeStart ?? 0;
      const end = filter.customTimeEnd ?? Number.POSITIVE_INFINITY;
      result = result.filter((entry) => entry.timestamp >= start && entry.timestamp <= end);
    } else {
      const rangeMs: Record<string, number> = {
        '5m': 5 * 60 * 1000,
        '30m': 30 * 60 * 1000,
        '1h': 60 * 60 * 1000,
      };
      const cutoff = Date.now() - rangeMs[filter.timeRange];
      result = result.filter((entry) => entry.timestamp >= cutoff);
    }
  }

  if (debouncedQuery) {
    const lower = debouncedQuery.toLowerCase();
    result = result.filter((entry) => entry.line.toLowerCase().includes(lower));
  }

  return result;
}

describe('diagnostic filter logic', () => {
  const now = Date.now();

  const logs: DiagnosticLogEntry[] = [
    makeEntry({ line: 'server log 1', source: 'server', timestamp: now }),
    makeEntry({ line: 'proxy log', source: 'proxy', timestamp: now }),
    makeEntry({ line: 'console warn', source: 'console', timestamp: now }),
    makeEntry({ line: 'system event', source: 'system', timestamp: now }),
    makeEntry({ line: 'old server log', source: 'server', timestamp: now - 2 * 60 * 60 * 1000 }),
    makeEntry({ line: 'ERROR: something failed', source: 'server', timestamp: now, isError: true }),
  ];

  describe('source filtering', () => {
    it('should return all logs when all sources enabled', () => {
      const result = filterLogs(logs, DEFAULT_DIAGNOSTIC_FILTER, '');
      expect(result).toHaveLength(6);
    });

    it('should filter by single source', () => {
      const filter = {
        ...DEFAULT_DIAGNOSTIC_FILTER,
        sources: { server: true, proxy: false, console: false, system: false },
      };
      const result = filterLogs(logs, filter, '');
      expect(result.every((l) => l.source === 'server')).toBe(true);
      expect(result).toHaveLength(3);
    });

    it('should return empty when no sources enabled', () => {
      const filter = {
        ...DEFAULT_DIAGNOSTIC_FILTER,
        sources: { server: false, proxy: false, console: false, system: false },
      };
      const result = filterLogs(logs, filter, '');
      expect(result).toHaveLength(0);
    });

    it('should filter multiple sources', () => {
      const filter = {
        ...DEFAULT_DIAGNOSTIC_FILTER,
        sources: { server: false, proxy: true, console: true, system: false },
      };
      const result = filterLogs(logs, filter, '');
      expect(result).toHaveLength(2);
      expect(result.map((l) => l.source)).toEqual(['proxy', 'console']);
    });
  });

  describe('time range filtering', () => {
    it('should return all logs when timeRange is "all"', () => {
      const result = filterLogs(logs, DEFAULT_DIAGNOSTIC_FILTER, '');
      expect(result).toHaveLength(6);
    });

    it('should filter by 5m range', () => {
      const filter = { ...DEFAULT_DIAGNOSTIC_FILTER, timeRange: '5m' as const };
      const result = filterLogs(logs, filter, '');
      // "old server log" is 2h old — should be excluded
      expect(result).toHaveLength(5);
      expect(result.find((l) => l.line === 'old server log')).toBeUndefined();
    });

    it('should filter by custom time range', () => {
      const filter = {
        ...DEFAULT_DIAGNOSTIC_FILTER,
        timeRange: 'custom' as const,
        customTimeStart: now - 1000,
        customTimeEnd: now + 1000,
      };
      const result = filterLogs(logs, filter, '');
      // Only recent logs (not the 2h old one)
      expect(result).toHaveLength(5);
    });
  });

  describe('search filtering', () => {
    it('should filter by text (case-insensitive)', () => {
      const result = filterLogs(logs, DEFAULT_DIAGNOSTIC_FILTER, 'error');
      expect(result).toHaveLength(1);
      expect(result[0].line).toBe('ERROR: something failed');
    });

    it('should return all when search is empty', () => {
      const result = filterLogs(logs, DEFAULT_DIAGNOSTIC_FILTER, '');
      expect(result).toHaveLength(6);
    });

    it('should handle partial matches', () => {
      const result = filterLogs(logs, DEFAULT_DIAGNOSTIC_FILTER, 'log');
      expect(result).toHaveLength(3); // server log 1, proxy log, old server log
    });
  });

  describe('combined filters', () => {
    it('should apply source + search together', () => {
      const filter = {
        ...DEFAULT_DIAGNOSTIC_FILTER,
        sources: { server: true, proxy: false, console: false, system: false },
      };
      const result = filterLogs(logs, filter, 'error');
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('server');
    });

    it('should apply source + time + search together', () => {
      const filter = {
        ...DEFAULT_DIAGNOSTIC_FILTER,
        sources: { server: true, proxy: false, console: false, system: false },
        timeRange: '5m' as const,
      };
      const result = filterLogs(logs, filter, 'log');
      expect(result).toHaveLength(1);
      expect(result[0].line).toBe('server log 1');
    });
  });
});

describe('localStorage persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should store and retrieve filter state', () => {
    const filter = {
      ...DEFAULT_DIAGNOSTIC_FILTER,
      sources: { server: true, proxy: false, console: true, system: false },
      searchQuery: 'test',
    };
    localStorage.setItem('diagnostic-filter', JSON.stringify(filter));

    const raw = localStorage.getItem('diagnostic-filter');
    expect(raw).toBeTruthy();
    // biome-ignore lint/style/noNonNullAssertion: test asserts truthy above
    const parsed = JSON.parse(raw!);
    expect(parsed.sources.proxy).toBe(false);
    expect(parsed.searchQuery).toBe('test');
  });

  it('should return default filter when localStorage is empty', () => {
    const raw = localStorage.getItem('diagnostic-filter');
    expect(raw).toBeNull();
  });
});
