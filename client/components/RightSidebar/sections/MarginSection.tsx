import { IconBorderSides } from '@tabler/icons-react';
import { memo } from 'react';
import {
  getSpacingDisplayValue,
  handleSpacingArrowKey,
  updateSpacingFromInput,
} from '@/lib/canvas-engine/utils/spacingValue';
import { Input } from '../../ui/input';

interface MarginSectionProps {
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  marginLinked: boolean;
  onMarginChange: (key: string, value: string) => void;
  onMarginLinkedToggle: () => void;
  onNumericKeyDown: (
    e: React.KeyboardEvent<HTMLInputElement>,
    value: string,
    setValue: (v: string) => void,
    styleKey?: string,
  ) => void;
}

export const MarginSection = memo(function MarginSection({
  marginTop,
  marginRight,
  marginBottom,
  marginLeft,
  marginLinked,
  onMarginChange,
  onMarginLinkedToggle,
  onNumericKeyDown,
}: MarginSectionProps) {
  const handleHorizontalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const result = updateSpacingFromInput(e.target.value, marginLeft, marginRight, marginLinked);
    if (result.firstChanged) {
      onMarginChange('marginLeft', result.first);
    }
    if (result.secondChanged) {
      onMarginChange('marginRight', result.second);
    }
  };

  const handleVerticalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const result = updateSpacingFromInput(e.target.value, marginTop, marginBottom, marginLinked);
    if (result.firstChanged) {
      onMarginChange('marginTop', result.first);
    }
    if (result.secondChanged) {
      onMarginChange('marginBottom', result.second);
    }
  };

  const handleHorizontalKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const input = e.currentTarget;
    const delta = e.key === 'ArrowUp' ? 1 : -1;
    const cursorPos = input.selectionStart ?? 0;
    const displayValue = input.value;
    const result = handleSpacingArrowKey(displayValue, cursorPos, marginLeft, marginRight, delta, marginLinked);
    if (result.firstChanged) {
      onMarginChange('marginLeft', result.first);
    }
    if (result.secondChanged) {
      onMarginChange('marginRight', result.second);
    }
    // Select the changed part after React updates
    setTimeout(() => {
      const newValue = getSpacingDisplayValue(result.first, result.second, marginLinked);
      const commaIdx = newValue.indexOf(',');
      if (result.firstChanged) {
        input.setSelectionRange(0, commaIdx === -1 ? newValue.length : commaIdx);
      } else if (result.secondChanged && commaIdx !== -1) {
        input.setSelectionRange(commaIdx + 2, newValue.length);
      }
    }, 0);
  };

  const handleVerticalKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const input = e.currentTarget;
    const delta = e.key === 'ArrowUp' ? 1 : -1;
    const cursorPos = input.selectionStart ?? 0;
    const displayValue = input.value;
    const result = handleSpacingArrowKey(displayValue, cursorPos, marginTop, marginBottom, delta, marginLinked);
    if (result.firstChanged) {
      onMarginChange('marginTop', result.first);
    }
    if (result.secondChanged) {
      onMarginChange('marginBottom', result.second);
    }
    // Select the changed part after React updates
    setTimeout(() => {
      const newValue = getSpacingDisplayValue(result.first, result.second, marginLinked);
      const commaIdx = newValue.indexOf(',');
      if (result.firstChanged) {
        input.setSelectionRange(0, commaIdx === -1 ? newValue.length : commaIdx);
      } else if (result.secondChanged && commaIdx !== -1) {
        input.setSelectionRange(commaIdx + 2, newValue.length);
      }
    }, 0);
  };

  return (
    <div className="px-4 pb-3 max-w-sidebar-section overflow-hidden">
      <span className="text-xs text-foreground mb-2 block">Margin</span>
      <div className="flex items-start gap-2 mb-2">
        <div className="grid grid-cols-2 gap-2 flex-1">
          <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
            <span className="text-xs text-muted-foreground">{marginLinked ? 'Left' : 'Hor'}</span>
            <Input
              type="text"
              value={getSpacingDisplayValue(marginLeft, marginRight, marginLinked)}
              onChange={handleHorizontalChange}
              onKeyDown={handleHorizontalKeyDown}
              placeholder="0px"
              className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
            />
          </div>
          <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
            <span className="text-xs text-muted-foreground">{marginLinked ? 'Top' : 'Vert'}</span>
            <Input
              type="text"
              value={getSpacingDisplayValue(marginTop, marginBottom, marginLinked)}
              onChange={handleVerticalChange}
              onKeyDown={handleVerticalKeyDown}
              placeholder="0px"
              className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
            />
          </div>
          {marginLinked && (
            <>
              <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
                <span className="text-xs text-muted-foreground">Right</span>
                <Input
                  type="text"
                  value={marginRight}
                  onChange={(e) => onMarginChange('marginRight', e.target.value)}
                  onKeyDown={(e) =>
                    onNumericKeyDown(e, marginRight, (v) => onMarginChange('marginRight', v), 'marginRight')
                  }
                  placeholder="0px"
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                />
              </div>
              <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
                <span className="text-xs text-muted-foreground">Bottom</span>
                <Input
                  type="text"
                  value={marginBottom}
                  onChange={(e) => onMarginChange('marginBottom', e.target.value)}
                  onKeyDown={(e) =>
                    onNumericKeyDown(e, marginBottom, (v) => onMarginChange('marginBottom', v), 'marginBottom')
                  }
                  placeholder="0px"
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                />
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onMarginLinkedToggle}
          className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${
            marginLinked ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-transparent'
          }`}
        >
          <IconBorderSides className={`w-4 h-4 ${marginLinked ? 'text-[#3479DE]' : 'text-foreground'}`} stroke={1.5} />
        </button>
      </div>
    </div>
  );
});
