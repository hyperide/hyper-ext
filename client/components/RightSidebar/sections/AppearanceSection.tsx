import { IconBorderCorners, IconDragDrop2, IconEye } from '@tabler/icons-react';
import cn from 'clsx';
import { memo, useCallback, useState } from 'react';
import { Input } from '../../ui/input';

interface AppearanceSectionProps {
  opacity: string;
  borderRadius: string;
  onOpacityChange: (value: string) => void;
  onBorderRadiusChange: (value: string) => void;
  onNumericKeyDown: (
    e: React.KeyboardEvent<HTMLInputElement>,
    currentValue: string,
    setValue: (value: string) => void,
    styleKey?: string,
  ) => void;
  syncStyleChange: (key: string, value: string) => void;
}

export const AppearanceSection = memo(function AppearanceSection({
  opacity,
  borderRadius,
  onOpacityChange,
  onBorderRadiusChange,
  onNumericKeyDown,
  syncStyleChange,
}: AppearanceSectionProps) {
  const [borderRadiusExpanded, setBorderRadiusExpanded] = useState(false);
  const [borderRadiusTopLeft, setBorderRadiusTopLeft] = useState(borderRadius);
  const [borderRadiusTopRight, setBorderRadiusTopRight] = useState(borderRadius);
  const [borderRadiusBottomLeft, setBorderRadiusBottomLeft] = useState(borderRadius);
  const [borderRadiusBottomRight, setBorderRadiusBottomRight] = useState(borderRadius);

  const handleOpacityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      const num = Number.parseFloat(value);
      if (!Number.isNaN(num)) {
        const clamped = Math.max(0, Math.min(100, num));
        const clampedStr = clamped.toString();
        onOpacityChange(clampedStr);
        syncStyleChange('opacity', clampedStr);
      } else {
        onOpacityChange(value);
      }
    },
    [onOpacityChange, syncStyleChange],
  );

  const handleUnifiedBorderRadiusChange = useCallback(
    (value: string) => {
      setBorderRadiusTopLeft(value);
      setBorderRadiusTopRight(value);
      setBorderRadiusBottomLeft(value);
      setBorderRadiusBottomRight(value);
      onBorderRadiusChange(value);
      syncStyleChange('borderRadius', value);
    },
    [onBorderRadiusChange, syncStyleChange],
  );

  const handleCornerRadiusChange = useCallback(
    (corner: string, value: string) => {
      const setters: Record<string, (v: string) => void> = {
        topLeft: setBorderRadiusTopLeft,
        topRight: setBorderRadiusTopRight,
        bottomLeft: setBorderRadiusBottomLeft,
        bottomRight: setBorderRadiusBottomRight,
      };
      const styleKeys: Record<string, string> = {
        topLeft: 'borderRadiusTopLeft',
        topRight: 'borderRadiusTopRight',
        bottomLeft: 'borderRadiusBottomLeft',
        bottomRight: 'borderRadiusBottomRight',
      };
      setters[corner]?.(value);
      syncStyleChange(styleKeys[corner], value);
    },
    [syncStyleChange],
  );

  return (
    <div className="px-4 py-3 border-t border-border max-w-sidebar-section overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-foreground">Appearance</span>
        <IconEye className="w-4 h-4" stroke={1.5} />
      </div>

      {!borderRadiusExpanded ? (
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
            <IconDragDrop2 className="w-3 h-3 text-muted-foreground" stroke={1.5} />
            <Input
              type="text"
              value={opacity}
              onChange={handleOpacityChange}
              onKeyDown={(e) => onNumericKeyDown(e, opacity, onOpacityChange, 'opacity')}
              placeholder="100"
              className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
            />
          </div>
          <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
            <IconBorderCorners className="w-3 h-3 text-muted-foreground" stroke={1.5} />
            <Input
              type="text"
              value={borderRadiusTopLeft || borderRadius}
              onChange={(e) => handleUnifiedBorderRadiusChange(e.target.value)}
              onKeyDown={(e) =>
                onNumericKeyDown(
                  e,
                  borderRadiusTopLeft || borderRadius,
                  handleUnifiedBorderRadiusChange,
                  'borderRadius',
                )
              }
              placeholder="0px"
              className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
            />
          </div>
          <button
            type="button"
            onClick={() => setBorderRadiusExpanded(true)}
            className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 bg-transparent"
          >
            <IconBorderCorners className="w-4 h-4 text-foreground" stroke={1.5} />
          </button>
        </div>
      ) : (
        <div className="space-y-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
              <IconDragDrop2 className="w-3 h-3 text-muted-foreground" stroke={1.5} />
              <Input
                type="text"
                value={opacity}
                onChange={handleOpacityChange}
                onKeyDown={(e) => onNumericKeyDown(e, opacity, onOpacityChange, 'opacity')}
                placeholder="100"
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
              />
            </div>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setBorderRadiusExpanded(false)}
              className={cn(
                'w-6 h-6 rounded flex items-center justify-center flex-shrink-0',
                'bg-blue-100 dark:bg-blue-900/30',
              )}
            >
              <IconBorderCorners className="w-4 h-4 text-[#3479DE]" stroke={1.5} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 w-sidebar-content">
            <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">TL</span>
              <Input
                type="text"
                value={borderRadiusTopLeft}
                onChange={(e) => handleCornerRadiusChange('topLeft', e.target.value)}
                onKeyDown={(e) =>
                  onNumericKeyDown(
                    e,
                    borderRadiusTopLeft,
                    (v) => handleCornerRadiusChange('topLeft', v),
                    'borderRadiusTopLeft',
                  )
                }
                placeholder="0px"
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
              />
            </div>
            <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">TR</span>
              <Input
                type="text"
                value={borderRadiusTopRight}
                onChange={(e) => handleCornerRadiusChange('topRight', e.target.value)}
                onKeyDown={(e) =>
                  onNumericKeyDown(
                    e,
                    borderRadiusTopRight,
                    (v) => handleCornerRadiusChange('topRight', v),
                    'borderRadiusTopRight',
                  )
                }
                placeholder="0px"
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
              />
            </div>
            <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">BL</span>
              <Input
                type="text"
                value={borderRadiusBottomLeft}
                onChange={(e) => handleCornerRadiusChange('bottomLeft', e.target.value)}
                onKeyDown={(e) =>
                  onNumericKeyDown(
                    e,
                    borderRadiusBottomLeft,
                    (v) => handleCornerRadiusChange('bottomLeft', v),
                    'borderRadiusBottomLeft',
                  )
                }
                placeholder="0px"
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
              />
            </div>
            <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">BR</span>
              <Input
                type="text"
                value={borderRadiusBottomRight}
                onChange={(e) => handleCornerRadiusChange('bottomRight', e.target.value)}
                onKeyDown={(e) =>
                  onNumericKeyDown(
                    e,
                    borderRadiusBottomRight,
                    (v) => handleCornerRadiusChange('bottomRight', v),
                    'borderRadiusBottomRight',
                  )
                }
                placeholder="0px"
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
