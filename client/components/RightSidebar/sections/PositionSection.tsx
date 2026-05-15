import { TID } from '@shared/data-testid-map';
import { memo, useCallback } from 'react';
import IconPositionBottom from '../../icons/IconPositionBottom';
import IconPositionLeft from '../../icons/IconPositionLeft';
import IconPositionRight from '../../icons/IconPositionRight';
import IconPositionTop from '../../icons/IconPositionTop';
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
  const focusInput = (e: React.MouseEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).parentElement?.querySelector('input')?.focus();
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, key: 'top' | 'right' | 'bottom' | 'left') => {
      onPositionKeyDown(e, posValues[key], (v: string) => onPositionValueChange(key, v), key);
    },
    [onPositionKeyDown, posValues, onPositionValueChange],
  );

  return (
    <div
      data-testid={TID.inspector.sectionHeader('position')}
      className="px-4 py-3 max-w-sidebar-section overflow-hidden"
    >
      <div className="mb-3">
        <span className="text-xs font-semibold text-foreground">Position</span>
      </div>
      <div className="toggle-container flex items-center mb-2 whitespace-nowrap">
        <button
          type="button"
          data-testid={TID.inspector.positionInput('static')}
          onClick={() => onPositionChange('static')}
          className={`flex-[1.4] h-6 px-2 text-xs rounded-l flex items-center justify-center ${
            selectedPosition === 'static' ? 'toggle-active font-medium' : ''
          }`}
        >
          static
        </button>
        <button
          type="button"
          data-testid={TID.inspector.positionInput('rel')}
          onClick={() => onPositionChange('rel')}
          className={`flex-[0.8] h-6 px-2 text-xs flex items-center justify-center ${
            selectedPosition === 'rel' ? 'toggle-active font-medium' : ''
          }`}
        >
          rel
        </button>
        <button
          type="button"
          data-testid={TID.inspector.positionInput('abs')}
          onClick={() => onPositionChange('abs')}
          className={`flex-[0.8] h-6 px-2 text-xs flex items-center justify-center ${
            selectedPosition === 'abs' ? 'toggle-active font-medium' : ''
          }`}
        >
          abs
        </button>
        <button
          type="button"
          data-testid={TID.inspector.positionInput('fixed')}
          onClick={() => onPositionChange('fixed')}
          className={`flex-1 h-6 px-2 text-xs flex items-center justify-center ${
            projectUIKit === 'tamagui' ? 'rounded-r' : ''
          } ${selectedPosition === 'fixed' ? 'toggle-active font-medium' : ''}`}
        >
          fixed
        </button>
        {projectUIKit !== 'tamagui' && (
          <button
            type="button"
            data-testid={TID.inspector.positionInput('sticky')}
            onClick={() => onPositionChange('sticky')}
            className={`flex-1 h-6 px-2 text-xs rounded-r flex items-center justify-center ${
              selectedPosition === 'sticky' ? 'toggle-active font-medium' : ''
            }`}
          >
            sticky
          </button>
        )}
      </div>
      {selectedPosition !== 'static' && (
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
            <IconPositionLeft className="w-3 h-3 text-muted-foreground cursor-pointer" onMouseDown={focusInput} />
            <Input
              type="text"
              testId={TID.inspector.positionInput('left')}
              value={posValues.left}
              onChange={(e) => onPositionValueChange('left', e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'left')}
              placeholder="auto"
              className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
            />
          </div>
          <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
            <IconPositionTop className="w-3 h-3 text-muted-foreground cursor-pointer" onMouseDown={focusInput} />
            <Input
              type="text"
              testId={TID.inspector.positionInput('top')}
              value={posValues.top}
              onChange={(e) => onPositionValueChange('top', e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'top')}
              placeholder="auto"
              className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
            />
          </div>
          <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
            <IconPositionRight className="w-3 h-3 text-muted-foreground cursor-pointer" onMouseDown={focusInput} />
            <Input
              type="text"
              testId={TID.inspector.positionInput('right')}
              value={posValues.right}
              onChange={(e) => onPositionValueChange('right', e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'right')}
              placeholder="auto"
              className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
            />
          </div>
          <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
            <IconPositionBottom className="w-3 h-3 text-muted-foreground cursor-pointer" onMouseDown={focusInput} />
            <Input
              type="text"
              testId={TID.inspector.positionInput('bottom')}
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
