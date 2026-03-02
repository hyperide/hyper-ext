/**
 * Hook for filtering diagnostic log entries.
 *
 * Manages filter state (sources, time range, text search) with
 * localStorage persistence so filters survive panel hide/show.
 * Returns filtered log array ready for rendering.
 */

import type { DiagnosticFilterState, DiagnosticLogEntry, DiagnosticSource } from '@shared/diagnostic-types';
import { DEFAULT_DIAGNOSTIC_FILTER, TIME_RANGE_MS } from '@shared/diagnostic-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'diagnostic-filter';

function loadFilter(): DiagnosticFilterState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DIAGNOSTIC_FILTER;
    const parsed = JSON.parse(raw) as Partial<DiagnosticFilterState>;
    return { ...DEFAULT_DIAGNOSTIC_FILTER, ...parsed };
  } catch {
    return DEFAULT_DIAGNOSTIC_FILTER;
  }
}

function saveFilter(filter: DiagnosticFilterState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filter));
  } catch {
    // quota exceeded — ignore
  }
}

export function useDiagnosticFilter(logs: DiagnosticLogEntry[]) {
  const [filter, setFilterRaw] = useState<DiagnosticFilterState>(loadFilter);
  const [debouncedQuery, setDebouncedQuery] = useState(filter.searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const updateFilter = useCallback((patch: Partial<DiagnosticFilterState>) => {
    setFilterRaw((prev) => {
      const next = { ...prev, ...patch };
      saveFilter(next);
      return next;
    });
  }, []);

  // Debounce search query
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(filter.searchQuery);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [filter.searchQuery]);

  const filteredLogs = useMemo(() => {
    let result = logs;

    // Filter by source
    const enabledSources = (Object.entries(filter.sources) as [DiagnosticSource, boolean][])
      .filter(([, enabled]) => enabled)
      .map(([source]) => source);

    if (enabledSources.length < 4) {
      result = result.filter((entry) => enabledSources.includes(entry.source));
    }

    // Filter by time range
    if (filter.timeRange !== 'all') {
      if (filter.timeRange === 'custom') {
        const start = filter.customTimeStart ?? 0;
        const end = filter.customTimeEnd ?? Number.POSITIVE_INFINITY;
        result = result.filter((entry) => entry.timestamp >= start && entry.timestamp <= end);
      } else {
        const cutoff = Date.now() - TIME_RANGE_MS[filter.timeRange];
        result = result.filter((entry) => entry.timestamp >= cutoff);
      }
    }

    // Filter by search query
    if (debouncedQuery) {
      const lower = debouncedQuery.toLowerCase();
      result = result.filter((entry) => entry.line.toLowerCase().includes(lower));
    }

    return result;
  }, [logs, filter.sources, filter.timeRange, filter.customTimeStart, filter.customTimeEnd, debouncedQuery]);

  return { filter, updateFilter, filteredLogs } as const;
}
