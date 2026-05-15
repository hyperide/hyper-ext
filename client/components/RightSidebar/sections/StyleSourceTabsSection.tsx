/**
 * @file Inspector style source tab row for selecting write targets
 *
 * Accessed via: Right sidebar inspector, above pseudo-state style controls
 * Assumptions: the Computed tab is an aggregate read view and must not be sent
 * as an explicit write target.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import type { StyleSourceTab } from '@lib/style-read/types';
import cn from 'clsx';

interface StyleSourceTabsSectionProps {
  tabs: StyleSourceTab[];
  selectedTabId: string;
  onSourceTabChange: (tabId: string) => void;
}

export function StyleSourceTabsSection({ tabs, selectedTabId, onSourceTabChange }: StyleSourceTabsSectionProps) {
  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="w-full px-4 py-3 border-b border-border overflow-hidden">
      <fieldset className="border-0 p-0 m-0 min-w-0">
        <legend className="sr-only">Style source</legend>
        <div
          className="overflow-x-auto overflow-y-hidden hide-scrollbar"
          style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}
        >
          <div className="inline-flex rounded-md bg-muted p-px whitespace-nowrap h-6">
            {tabs.map((tab) => {
              const selected = tab.id === selectedTabId;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSourceTabChange(tab.id)}
                  className={cn(
                    'px-3 text-xs font-medium rounded transition-colors flex-shrink-0 flex items-center h-full',
                    selected
                      ? 'border border-border bg-popover text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  title={tab.filePath ? `${tab.label} - ${tab.filePath}` : tab.label}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </fieldset>
    </div>
  );
}
