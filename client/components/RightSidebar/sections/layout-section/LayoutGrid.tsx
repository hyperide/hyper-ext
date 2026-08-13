import cn from 'clsx';
import { LAYOUT_OPTIONS } from '../../constants';
import IconLayoutChart from '../../../icons/IconLayoutChart';

interface LayoutGridProps {
  selectedLayout: 'col' | 'row';
  justifyContent: string;
  alignItems: string;
  isStyleSyncing: boolean;
  onClick: (pos: { justify: string; align: string }) => void;
  onDoubleClick: (pos: { justify: string; align: string }) => void;
}

function normalizeFlexValue(value: string | undefined): string {
  if (!value || value === 'normal') return 'flex-start';
  if (value.startsWith('space-')) return 'center';
  if (value === 'start') return 'flex-start';
  if (value === 'end') return 'flex-end';
  return value;
}

export function LayoutGrid({
  selectedLayout,
  justifyContent,
  alignItems,
  isStyleSyncing,
  onClick,
  onDoubleClick,
}: LayoutGridProps) {
  const normalizedJustify = normalizeFlexValue(justifyContent);
  const normalizedAlign = normalizeFlexValue(alignItems);
  const isSpaceBetween = justifyContent === 'space-between';

  return (
    <div className="w-[97px] h-14 rounded-md bg-muted relative">
      <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
        {LAYOUT_OPTIONS.map((pos) => {
          const isSpaceBetweenActive =
            isSpaceBetween &&
            ((selectedLayout === 'row' && pos.align === normalizedAlign) ||
              (selectedLayout === 'col' && pos.justify === normalizedAlign));

          const isActive =
            (selectedLayout === 'row' && normalizedJustify === pos.justify && normalizedAlign === pos.align) ||
            (selectedLayout === 'col' && normalizedJustify === pos.align && normalizedAlign === pos.justify);

          return (
            <button
              key={`${pos.col}-${pos.row}`}
              type="button"
              disabled={isStyleSyncing}
              onClick={() => onClick(pos)}
              onDoubleClick={() => onDoubleClick(pos)}
              className={cn('flex items-center justify-center', isStyleSyncing && 'opacity-50 cursor-not-allowed')}
            >
              {isSpaceBetweenActive ? (
                <div
                  className={cn('bg-[#027BE5] rounded-full', selectedLayout === 'row' ? 'w-0.5 h-3' : 'w-3 h-0.5')}
                />
              ) : isActive ? (
                <IconLayoutChart className="w-4 h-4 text-[#027BE5]" />
              ) : (
                <div className="w-1 h-1 rounded-full bg-[#B2B2B2]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
