/**
 * Shared diagnostic logs viewer — reads from diagnosticStore.
 *
 * Works in SaaS (LogsPanel, ProjectSettings) and ext (Logs webview).
 * Data providers (useDiagnosticSync / DiagnosticHub) fill the store;
 * this component only renders.
 *
 * Features: virtual scrolling, source/time/search filtering,
 * smart autoscroll with jump-to-bottom, search highlighting.
 */

import type { DiagnosticLogEntry } from '@shared/diagnostic-types';
import { IconAlertTriangle, IconArrowDown, IconChevronDown, IconTrash, IconWand } from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import cn from 'clsx';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { DiagnosticFilterBar } from '@/components/DiagnosticFilterBar';
import { useThemeOptional } from '@/components/ThemeProvider';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDiagnosticFilter } from '@/hooks/useDiagnosticFilter';
import { useDiagnosticStore } from '@/stores/diagnosticStore';
import { highlightSearch } from '@/utils/highlight';

interface DiagnosticLogsViewerProps {
  /** Height of the component. Default: "100%" */
  height?: string;
  /** Called when user clicks Auto Fix. Receives formatted prompt. */
  onAutoFix?: (prompt: string) => void;
  /** Called when user clicks Clear. If not set, clears store directly. */
  onClear?: () => void;
  /** Called when user dismisses the panel (chevron-down button). */
  onDismiss?: () => void;
}

export function DiagnosticLogsViewer({ height = '100%', onAutoFix, onClear, onDismiss }: DiagnosticLogsViewerProps) {
  const { logs, runtimeError, isConnected, buildStatus, clear, getAIContext } = useDiagnosticStore();
  const { filter, updateFilter, filteredLogs } = useDiagnosticFilter(logs);
  const { resolvedTheme } = useThemeOptional();

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAutoScrollingRef = useRef(false);

  // Get the Radix ScrollArea viewport as scroll container
  const getScrollElement = useCallback(
    () => scrollAreaRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]') ?? null,
    [],
  );

  const virtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement,
    estimateSize: () => 20,
    overscan: 30,
  });

  // Scroll handler — detect if user is at the bottom
  const handleScroll = useCallback(() => {
    if (isAutoScrollingRef.current) return;
    const el = getScrollElement();
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    setIsAtBottom(atBottom);
  }, [getScrollElement]);

  // Auto-scroll when new logs arrive and user is at bottom
  useEffect(() => {
    if (!isAtBottom || filteredLogs.length === 0) return;
    isAutoScrollingRef.current = true;
    virtualizer.scrollToIndex(filteredLogs.length - 1, { align: 'end' });
    // Release guard after scroll settles
    const timer = setTimeout(() => {
      isAutoScrollingRef.current = false;
    }, 50);
    return () => clearTimeout(timer);
  }, [filteredLogs.length, isAtBottom, virtualizer]);

  const jumpToBottom = useCallback(() => {
    setIsAtBottom(true);
    virtualizer.scrollToIndex(filteredLogs.length - 1, { align: 'end' });
  }, [virtualizer, filteredLogs.length]);

  const handleAutoFix = useCallback(() => {
    if (!onAutoFix) return;
    const context = getAIContext();
    const issueType = runtimeError ? 'build/runtime' : 'server';
    const prompt = `Fix the ${issueType} issues in this project.\n\n${context}\n\nAnalyze the errors and suggest a fix.`;
    onAutoFix(prompt);
  }, [onAutoFix, getAIContext, runtimeError]);

  const handleClear = useCallback(() => {
    if (onClear) {
      onClear();
    }
    clear();
    setIsAtBottom(true);
  }, [clear, onClear]);

  const hasErrors = logs.some((l) => l.isError) || runtimeError !== null;

  return (
    <div className="flex flex-col" style={{ height }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span>Diagnostics</span>
          <span
            className={cn(
              'w-2 h-2 rounded-full',
              isConnected ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-muted-foreground/30',
            )}
            title={isConnected ? 'Connected' : 'Disconnected'}
          />
          {buildStatus === 'building' && <span className="text-[10px] text-muted-foreground">(building...)</span>}
          {buildStatus === 'error' && <span className="text-[10px] text-destructive">(build error)</span>}
        </div>
        <div className="flex items-center gap-1">
          {hasErrors && onAutoFix && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-foreground hover:text-foreground/80"
              onClick={handleAutoFix}
            >
              <IconWand size={14} className="mr-1" />
              Auto Fix
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleClear} title="Clear logs">
            <IconTrash size={14} />
          </Button>
          {onDismiss && (
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onDismiss} title="Dismiss logs">
              <IconChevronDown size={14} />
            </Button>
          )}
        </div>
      </div>

      {/* Runtime error banner */}
      {runtimeError && (
        <div className="px-3 py-2 bg-destructive/10 border-b border-destructive/30 text-xs shrink-0">
          <div className="flex items-center gap-1.5 text-destructive font-medium mb-1">
            <IconAlertTriangle size={14} />
            <span>
              {runtimeError.type}
              {runtimeError.file ? ` in ${runtimeError.file}${runtimeError.line ? `:${runtimeError.line}` : ''}` : ''}
            </span>
          </div>
          <div className="text-destructive/80 line-clamp-3">{runtimeError.message}</div>
          {runtimeError.codeframe && (
            <pre className="mt-1 p-2 bg-black/20 rounded text-[11px] overflow-auto max-h-[120px] whitespace-pre-wrap break-all">
              {runtimeError.codeframe}
            </pre>
          )}
        </div>
      )}

      {/* Filter bar */}
      <DiagnosticFilterBar
        filter={filter}
        onFilterChange={updateFilter}
        filteredCount={filteredLogs.length}
        totalCount={logs.length}
      />

      {/* Virtualized log content */}
      <div className="relative flex-1 min-h-0">
        <ScrollArea ref={scrollAreaRef} className="h-full" onScrollCapture={handleScroll}>
          {filteredLogs.length === 0 ? (
            <div className="text-muted-foreground text-center py-8 text-xs">No logs yet.</div>
          ) : (
            <div
              className="p-2 font-mono text-xs leading-relaxed relative"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const entry = filteredLogs[virtualRow.index];
                const prev = virtualRow.index > 0 ? filteredLogs[virtualRow.index - 1] : null;
                const showDivider = prev !== null && prev.source !== entry.source && !isSystemDivider(entry);
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 right-0 px-2"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <LogLine
                      entry={entry}
                      searchQuery={filter.searchQuery}
                      showDivider={showDivider}
                      isDark={resolvedTheme === 'dark'}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Jump to bottom */}
        {!isAtBottom && filteredLogs.length > 0 && (
          <button
            type="button"
            onClick={jumpToBottom}
            className="absolute bottom-3 right-3 z-10 flex items-center gap-1 px-2 py-1 rounded-full bg-accent text-accent-foreground text-[10px] font-medium shadow-md hover:bg-accent/80 transition-colors"
          >
            <IconArrowDown size={12} />
            Jump to bottom
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Inline bar + text colors per source.
 * Uses inline styles because Tailwind JIT doesn't scan Record values.
 * Light/dark variants picked at render time via .dark class on <html>.
 */
const SOURCE_STYLE_LIGHT: Record<string, { bar: string; text?: string }> = {
  server: { bar: '#94a3b8' },
  proxy: { bar: '#06b6d4', text: '#0e7490' },
  console: { bar: '#3b82f6', text: '#1d4ed8' },
  system: { bar: '#ca8a04', text: '#a16207' },
};

const SOURCE_STYLE_DARK: Record<string, { bar: string; text?: string }> = {
  server: { bar: '#64748b' },
  proxy: { bar: '#22d3ee', text: '#22d3ee' },
  console: { bar: '#60a5fa', text: '#60a5fa' },
  system: { bar: '#eab308', text: '#eab308' },
};

function getSourceStyle(source: string, isDark: boolean): { bar: string; text?: string } {
  const styles = isDark ? SOURCE_STYLE_DARK : SOURCE_STYLE_LIGHT;
  return styles[source] ?? styles.server;
}

const SOURCE_TOOLTIP: Record<string, string> = {
  server: 'Server',
  proxy: 'Proxy',
  console: 'Console',
  system: 'System',
};

function isSystemDivider(entry: DiagnosticLogEntry): boolean {
  return entry.source === 'system' && entry.line.startsWith('---');
}

const LogLine = memo(function LogLine({
  entry,
  searchQuery,
  showDivider,
  isDark,
}: {
  entry: DiagnosticLogEntry;
  searchQuery?: string;
  showDivider: boolean;
  isDark: boolean;
}) {
  const levelPrefix = entry.source === 'console' && entry.level ? `[${entry.level}] ` : '';
  const sourceTag = entry.source !== 'server' ? `[${entry.source}] ` : '';
  const style = getSourceStyle(entry.source, isDark);

  if (isSystemDivider(entry)) {
    return (
      <div className="flex items-center gap-2 py-1 select-none">
        <div className="flex-1 border-t border-border" />
        <span className="text-[10px] text-muted-foreground italic whitespace-nowrap">
          {entry.line.replace(/^-+\s*|\s*-+$/g, '')}
        </span>
        <div className="flex-1 border-t border-border" />
      </div>
    );
  }

  return (
    <>
      {showDivider && <div className="border-t border-border/40 my-0.5" />}
      <div
        className={cn('flex items-stretch', entry.isError && 'text-destructive font-medium')}
        style={style.text && !entry.isError ? { color: style.text } : undefined}
      >
        <div
          className="shrink-0 rounded-sm mr-1.5"
          style={{ width: 4, minWidth: 4, backgroundColor: style.bar }}
          title={SOURCE_TOOLTIP[entry.source]}
        />
        <span className="whitespace-pre-wrap break-all min-w-0">
          <span className="text-muted-foreground/60 text-[10px] mr-1.5 select-none">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
          {sourceTag}
          {levelPrefix}
          {searchQuery ? highlightSearch(entry.line, searchQuery) : entry.line}
        </span>
      </div>
    </>
  );
});
