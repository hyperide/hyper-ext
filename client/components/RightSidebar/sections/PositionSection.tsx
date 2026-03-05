import { memo, useCallback } from 'react';
import { Input } from '../../ui/input';
import type { PositionType, UIKitType } from '../types';

interface PositionSectionProps {
  selectedPosition: PositionType;
  posValues: { top: string; right: string; bottom: string; left: string };
  projectUIKit: UIKitType;
  onPositionChange: (pos: PositionType) => void;
  onPositionValueChange: (key: 'top' | 'right' | 'bottom' | 'left', value: string) => void;
  onPositionKeyDown: (
    e: React.KeyboardEvent<HTMLInputElement>,
    currentValue: string,
    setValue: (value: string) => void,
    styleKey?: string,
  ) => void;
}

export const PositionSection = memo(function PositionSection({
  selectedPosition,
  posValues,
  projectUIKit,
  onPositionChange,
  onPositionValueChange,
  onPositionKeyDown,
}: PositionSectionProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, key: 'top' | 'right' | 'bottom' | 'left') => {
      onPositionKeyDown(e, posValues[key], (v: string) => onPositionValueChange(key, v), key);
    },
    [onPositionKeyDown, posValues, onPositionValueChange],
  );

  return (
    <div className="px-4 py-3 max-w-sidebar-section overflow-hidden">
      <div className="mb-3">
        <span className="text-xs font-semibold text-foreground">Position</span>
      </div>
      <div className="flex items-center mb-2 whitespace-nowrap">
        <button
          type="button"
          onClick={() => onPositionChange('static')}
          className={`flex-1 h-6 px-2 text-xs rounded-l flex items-center justify-center w-10 ${
            selectedPosition === 'static' ? 'bg-background border border-border font-medium' : 'bg-muted'
          }`}
        >
          static
        </button>
        <button
          type="button"
          onClick={() => onPositionChange('rel')}
          className={`flex-1 h-6 px-2 text-xs flex items-center justify-center ${
            selectedPosition === 'rel' ? 'bg-background border border-border font-medium' : 'bg-muted'
          }`}
        >
          rel
        </button>
        <button
          type="button"
          onClick={() => onPositionChange('abs')}
          className={`flex-1 h-6 px-2 text-xs flex items-center justify-center ${
            selectedPosition === 'abs' ? 'bg-background border border-border font-medium' : 'bg-muted'
          }`}
        >
          abs
        </button>
        <button
          type="button"
          onClick={() => onPositionChange('fixed')}
          className={`flex-1 h-6 px-2 text-xs flex items-center justify-center ${
            projectUIKit === 'tamagui' ? 'rounded-r' : ''
          } ${selectedPosition === 'fixed' ? 'bg-background border border-border font-medium' : 'bg-muted'}`}
        >
          fixed
        </button>
        {projectUIKit !== 'tamagui' && (
          <button
            type="button"
            onClick={() => onPositionChange('sticky')}
            className={`flex-1 h-6 px-2 text-xs rounded-r flex items-center justify-center ${
              selectedPosition === 'sticky' ? 'bg-background border border-border font-medium' : 'bg-muted'
            }`}
          >
            sticky
          </button>
        )}
      </div>
      {selectedPosition !== 'static' && (
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
            <span className="text-xs text-muted-foreground">left</span>
            <Input
              type="text"
              value={posValues.left}
              onChange={(e) => onPositionValueChange('left', e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'left')}
              placeholder="auto"
              className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
            />
          </div>
          <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
            <span className="text-xs text-muted-foreground">top</span>
            <Input
              type="text"
              value={posValues.top}
              onChange={(e) => onPositionValueChange('top', e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'top')}
              placeholder="auto"
              className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
            />
          </div>
          <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
            <span className="text-xs text-muted-foreground">right</span>
            <Input
              type="text"
              value={posValues.right}
              onChange={(e) => onPositionValueChange('right', e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'right')}
              placeholder="auto"
              className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
            />
          </div>
          <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
            <span className="text-xs text-muted-foreground">bottom</span>
            <Input
              type="text"
              value={posValues.bottom}
              onChange={(e) => onPositionValueChange('bottom', e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'bottom')}
              placeholder="auto"
              className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
            />
          </div>
        </div>
      )}
    </div>
  );
});
