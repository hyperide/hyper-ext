/**
 * Filter toolbar for DiagnosticLogsViewer.
 *
 * Layout: [source toggles] [time range] [search] [count]
 */

import type { DiagnosticFilterState, DiagnosticSource, DiagnosticTimeRange } from '@shared/diagnostic-types';
import { IconSearch, IconX } from '@tabler/icons-react';
import cn from 'clsx';
import { useCallback } from 'react';
import { useThemeOptional } from '@/components/ThemeProvider';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface DiagnosticFilterBarProps {
  filter: DiagnosticFilterState;
  onFilterChange: (patch: Partial<DiagnosticFilterState>) => void;
  filteredCount: number;
  totalCount: number;
}

/**
 * Inline styles for active pill state.
 * Tailwind JIT doesn't scan Record values, so we use inline styles.
 */
const SOURCE_PILLS: {
  source: DiagnosticSource;
  label: string;
  tooltip: string;
  activeStyle: { backgroundColor: string; color: string };
  activeDarkStyle: { backgroundColor: string; color: string };
}[] = [
  {
    source: 'server',
    label: 'SRV',
    tooltip: 'Server logs',
    activeStyle: { backgroundColor: 'rgba(0,0,0,0.08)', color: 'inherit' },
    activeDarkStyle: { backgroundColor: 'rgba(255,255,255,0.1)', color: 'inherit' },
  },
  {
    source: 'proxy',
    label: 'PRX',
    tooltip: 'Proxy logs',
    activeStyle: { backgroundColor: 'rgba(6,182,212,0.2)', color: '#0e7490' },
    activeDarkStyle: { backgroundColor: 'rgba(6,182,212,0.2)', color: '#22d3ee' },
  },
  {
    source: 'console',
    label: 'CON',
    tooltip: 'Console output',
    activeStyle: { backgroundColor: 'rgba(59,130,246,0.2)', color: '#1d4ed8' },
    activeDarkStyle: { backgroundColor: 'rgba(59,130,246,0.2)', color: '#60a5fa' },
  },
  {
    source: 'system',
    label: 'SYS',
    tooltip: 'System events',
    activeStyle: { backgroundColor: 'rgba(234,179,8,0.2)', color: '#a16207' },
    activeDarkStyle: { backgroundColor: 'rgba(234,179,8,0.2)', color: '#eab308' },
  },
];

const TIME_RANGE_OPTIONS: { value: DiagnosticTimeRange; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '5m', label: 'Last 5m' },
  { value: '30m', label: 'Last 30m' },
  { value: '1h', label: 'Last 1h' },
  { value: 'custom', label: 'Custom' },
];

export function DiagnosticFilterBar({ filter, onFilterChange, filteredCount, totalCount }: DiagnosticFilterBarProps) {
  const { resolvedTheme } = useThemeOptional();
  const isDark = resolvedTheme === 'dark';

  const toggleSource = useCallback(
    (source: DiagnosticSource) => {
      onFilterChange({
        sources: { ...filter.sources, [source]: !filter.sources[source] },
      });
    },
    [filter.sources, onFilterChange],
  );

  const handleTimeRange = useCallback(
    (value: string) => {
      onFilterChange({ timeRange: value as DiagnosticTimeRange });
    },
    [onFilterChange],
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onFilterChange({ searchQuery: e.target.value });
    },
    [onFilterChange],
  );

  const clearSearch = useCallback(() => {
    onFilterChange({ searchQuery: '' });
  }, [onFilterChange]);

  const handleCustomStart = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onFilterChange({ customTimeStart: e.target.value ? new Date(e.target.value).getTime() : undefined });
    },
    [onFilterChange],
  );

  const handleCustomEnd = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onFilterChange({ customTimeEnd: e.target.value ? new Date(e.target.value).getTime() : undefined });
    },
    [onFilterChange],
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col gap-1.5 px-2 py-1.5 border-b border-border bg-muted/20 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Source toggles */}
          <div className="flex items-center gap-0.5">
            {SOURCE_PILLS.map(({ source, label, tooltip, activeStyle, activeDarkStyle }) => {
              const active = filter.sources[source];
              const style = active ? (isDark ? activeDarkStyle : activeStyle) : undefined;
              return (
                <Tooltip key={source}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => toggleSource(source)}
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer select-none',
                        !active && 'text-muted-foreground opacity-40 hover:opacity-70',
                      )}
                      style={style}
                    >
                      {label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {tooltip}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          {/* Time range */}
          <Select value={filter.timeRange} onValueChange={handleTimeRange}>
            <SelectTrigger className="h-6 w-[90px] text-[10px] border-border/50 px-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGE_OPTIONS.map(({ value, label }) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Search */}
          <div className="relative flex-1 min-w-[100px]">
            <IconSearch size={12} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter.searchQuery}
              onChange={handleSearchChange}
              placeholder="Search logs..."
              className="h-6 text-[10px] pl-5 pr-6 border-border/50"
            />
            {filter.searchQuery && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <IconX size={12} />
              </button>
            )}
          </div>

          {/* Count badge */}
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {filteredCount === totalCount ? totalCount : `${filteredCount}/${totalCount}`}
          </span>
        </div>

        {/* Custom time range inputs */}
        {filter.timeRange === 'custom' && (
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-muted-foreground">From:</span>
            <input
              type="datetime-local"
              onChange={handleCustomStart}
              className="h-5 text-[10px] bg-background border border-border/50 rounded px-1"
            />
            <span className="text-muted-foreground">To:</span>
            <input
              type="datetime-local"
              onChange={handleCustomEnd}
              className="h-5 text-[10px] bg-background border border-border/50 rounded px-1"
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
