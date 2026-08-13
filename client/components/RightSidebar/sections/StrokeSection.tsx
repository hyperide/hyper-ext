/**
 * @file Stroke section of the right sidebar inspector
 *
 * Accessed via: Properties panel > Stroke section when an element is selected
 * Assumptions: strokes array holds at most one item (single border model)
 */
import { TID } from '@shared/data-testid-map';
import { IconMinus, IconPlus } from '@tabler/icons-react';
import { memo, useCallback } from 'react';
import { ColorCombobox } from '../../ui/color-combobox';
import { NumericInput } from '../../ui/numeric-input';
import type { StrokeItem } from '../types';

interface StrokeSectionProps {
  strokes: StrokeItem[];
  onStrokesChange: (strokes: StrokeItem[]) => void;
  syncStyleChange: (key: string, value: string) => void;
}

export const StrokeSection = memo(function StrokeSection({
  strokes,
  onStrokesChange,
  syncStyleChange,
}: StrokeSectionProps) {
  const handleAddStroke = useCallback(() => {
    const newStroke: StrokeItem = {
      id: Date.now().toString(),
      visible: true,
      color: '#000000',
      opacity: '100',
      width: '1',
      style: 'solid',
      sides: {
        top: true,
        right: true,
        bottom: true,
        left: true,
      },
    };
    onStrokesChange([newStroke]);
    syncStyleChange('borderWidth', '1px');
    syncStyleChange('borderColor', '#000000');
    syncStyleChange('borderStyle', 'solid');
  }, [onStrokesChange, syncStyleChange]);

  const handleRemoveStroke = useCallback(() => {
    onStrokesChange([]);
    syncStyleChange('borderWidth', '0');
  }, [onStrokesChange, syncStyleChange]);

  const stroke = strokes[0];
  const updateStroke = useCallback(
    (patch: Partial<StrokeItem>, styles: Array<[string, string]>) => {
      if (!stroke) return;
      onStrokesChange([{ ...stroke, ...patch }]);
      for (const [key, value] of styles) {
        syncStyleChange(key, value);
      }
    },
    [onStrokesChange, stroke, syncStyleChange],
  );

  if (strokes.length === 0) {
    return (
      <div
        data-testid={TID.inspector.sectionHeader('stroke')}
        className="w-full px-4 py-3 border-t border-border overflow-hidden"
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            onClick={handleAddStroke}
          >
            Border
          </button>
          <button
            type="button"
            data-testid="hyper-inspector-stroke-add"
            onClick={handleAddStroke}
            className="hover:bg-muted rounded p-0.5"
          >
            <IconPlus className="w-4 h-4" stroke={1.5} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={TID.inspector.sectionHeader('stroke')}
      className="w-full px-4 py-3 border-t border-border overflow-hidden"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-foreground">Border</span>
        <button
          type="button"
          data-testid="hyper-inspector-stroke-remove"
          onClick={handleRemoveStroke}
          className="hover:bg-muted rounded p-0.5"
        >
          <IconMinus className="w-4 h-4" stroke={1.5} />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_72px_84px] gap-2">
        <ColorCombobox
          value={stroke.color ?? '#000000'}
          onChange={(color) => updateStroke({ color }, [['borderColor', color]])}
          tokenSystem="tailwind"
          testId={TID.inspector.strokeColor}
          className="h-7"
        />
        <label
          htmlFor="hyper-inspector-stroke-width-input"
          className="h-7 px-2 bg-muted rounded flex items-center gap-1 min-w-0"
        >
          <span className="text-[11px] text-muted-foreground shrink-0">W</span>
          <NumericInput
            id="hyper-inspector-stroke-width-input"
            testId={TID.inspector.strokeWidth}
            styleKey="borderWidth"
            value={stroke.width ?? ''}
            onChange={(val) => updateStroke({ width: val }, [['borderWidth', normalizeBorderWidth(val)]])}
            className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 min-w-0"
            placeholder="1"
          />
        </label>
        <select
          data-testid={TID.inspector.strokeStyle}
          value={stroke?.style ?? 'solid'}
          onChange={(event) =>
            updateStroke({ style: event.target.value as StrokeItem['style'] }, [['borderStyle', event.target.value]])
          }
          className="h-7 px-2 rounded bg-muted text-[11px] text-foreground border-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
          <option value="double">Double</option>
          <option value="none">None</option>
        </select>
      </div>
    </div>
  );
});

function normalizeBorderWidth(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '0';
  return /^-?\d+(?:\.\d+)?$/.test(trimmed) ? `${trimmed}px` : trimmed;
}
