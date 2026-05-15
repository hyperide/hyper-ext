import { TID } from '@shared/data-testid-map';
import { IconMinus, IconPlus } from '@tabler/icons-react';
import { memo, useCallback } from 'react';
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
            Stroke
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
        <span className="text-xs font-semibold text-foreground">Stroke</span>
        <button
          type="button"
          data-testid="hyper-inspector-stroke-remove"
          onClick={handleRemoveStroke}
          className="hover:bg-muted rounded p-0.5"
        >
          <IconMinus className="w-4 h-4" stroke={1.5} />
        </button>
      </div>
      <div className="text-xs text-muted-foreground">
        {strokes[0]?.width}px {strokes[0]?.style} border
      </div>
    </div>
  );
});
