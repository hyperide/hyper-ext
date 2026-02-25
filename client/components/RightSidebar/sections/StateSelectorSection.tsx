import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import cn from 'clsx';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

interface StateSelectorSectionProps {
  currentState: string | undefined;
  onStateChange: (state: string | undefined) => void;
}

const STATE_OPTIONS = [
  { value: undefined, label: 'Base' },
  { value: 'hover', label: 'Hover' },
  { value: 'focus', label: 'Focus' },
  { value: 'active', label: 'Active' },
  { value: 'focus-visible', label: 'Focus Visible' },
  { value: 'disabled', label: 'Disabled' },
] as const;

export const StateSelectorSection = memo(function StateSelectorSection({
  currentState,
  onStateChange,
}: StateSelectorSectionProps) {
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const stateScrollRef = useRef<HTMLDivElement>(null);

  const updateScrollButtons = useCallback(() => {
    const el = stateScrollRef.current;
    if (!el) return;

    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);

  useEffect(() => {
    const el = stateScrollRef.current;
    if (!el) return;

    updateScrollButtons();
    el.addEventListener('scroll', updateScrollButtons);
    return () => el.removeEventListener('scroll', updateScrollButtons);
  }, [updateScrollButtons]);

  const scrollStateSelector = useCallback((direction: 'left' | 'right') => {
    const el = stateScrollRef.current;
    if (!el) return;

    const scrollAmount = 100;
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  }, []);

  return (
    <div className="px-4 py-3 border-b border-border max-w-sidebar-section overflow-hidden">
      <div className="relative flex items-center">
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollStateSelector('left')}
            className="absolute left-0 z-10 flex items-center justify-center w-6 h-6 bg-muted/80 backdrop-blur-sm rounded shadow-sm hover:bg-accent"
          >
            <IconChevronLeft className="w-4 h-4" stroke={1.5} />
          </button>
        )}

        <div
          ref={stateScrollRef}
          className="overflow-x-auto overflow-y-hidden hide-scrollbar"
          style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}
          onScroll={updateScrollButtons}
        >
          <div className="inline-flex rounded-md bg-muted p-px whitespace-nowrap h-6">
            {STATE_OPTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => onStateChange(option.value)}
                className={cn(
                  'px-3 text-xs font-medium rounded transition-colors flex-shrink-0 flex items-center h-full',
                  currentState === option.value
                    ? 'border border-border bg-popover text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollStateSelector('right')}
            className="absolute right-0 z-10 flex items-center justify-center w-6 h-6 bg-muted/80 backdrop-blur-sm rounded shadow-sm hover:bg-accent"
          >
            <IconChevronRight className="w-4 h-4" stroke={1.5} />
          </button>
        )}
      </div>
    </div>
  );
});
