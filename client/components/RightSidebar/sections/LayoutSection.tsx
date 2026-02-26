import {
  IconAdjustmentsHorizontal,
  IconAspectRatio,
  IconBorderSides,
  IconCheck,
  IconLayout,
  IconLayoutGrid,
  IconSortDescending2,
  IconX,
} from '@tabler/icons-react';
import cn from 'clsx';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import IconFlexRow from '../../icons/IconFlexRow';
import IconHorizontalPadding from '../../icons/IconHorizontalPadding';
import IconLayoutChart from '../../icons/IconLayoutChart';
import IconSpacingHorizontal from '../../icons/IconSpacingHorizontal';
import IconVerticalPadding from '../../icons/IconVerticalPadding';
import { Input } from '../../ui/input';
import { LAYOUT_OPTIONS } from '../constants';
import type { LayoutType, UIKitType } from '../types';

/**
 * Normalizes CSS justify-content/align-items values to flex equivalents
 * for matching against the 9-point grid.
 */
function normalizeFlexValue(value: string | undefined): string {
  if (!value || value === 'normal') {
    return 'flex-start';
  }
  // space-between, space-around, space-evenly distribute items - no single position
  if (value.startsWith('space-')) {
    return 'center';
  }
  if (value === 'start') return 'flex-start';
  if (value === 'end') return 'flex-end';
  return value;
}

interface LayoutSectionProps {
  selectedLayout: LayoutType;
  width: string;
  height: string;
  gap: string;
  justifyContent: string;
  alignItems: string;
  // Grid-specific props
  columnGap: string;
  rowGap: string;
  gridJustifyItems: string;
  gridAlignItems: string;
  gridCols: string;
  gridRows: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  clipContent: boolean;
  projectUIKit: UIKitType;
  isStyleSyncing: boolean;
  onLayoutChange: (layout: LayoutType) => void;
  onWidthChange: (value: string) => void;
  onHeightChange: (value: string) => void;
  onWidthBlur: () => void;
  onHeightBlur: () => void;
  onGapChange: (value: string) => void;
  onJustifyContentChange: (value: string) => void;
  onAlignItemsChange: (value: string) => void;
  // Grid-specific handlers
  onColumnGapChange: (value: string) => void;
  onRowGapChange: (value: string) => void;
  onGridJustifyItemsChange: (value: string) => void;
  onGridAlignItemsChange: (value: string) => void;
  onGridColsChange: (value: string) => void;
  onGridRowsChange: (value: string) => void;
  onPaddingChange: (key: string, value: string) => void;
  onClipContentChange: (value: boolean) => void;
  onNumericKeyDown: (
    e: React.KeyboardEvent<HTMLInputElement>,
    currentValue: string,
    setValue: (value: string) => void,
    styleKey?: string,
  ) => void;
  syncStyleChange: (key: string, value: string, options?: { debounceOnly?: boolean }) => void;
}

/** Trailing-only debounce — disables leading edge for dblclick-capable controls */
const DB = { debounceOnly: true } as const;

export const LayoutSection = memo(function LayoutSection({
  selectedLayout,
  width,
  height,
  gap,
  justifyContent,
  alignItems,
  columnGap,
  rowGap,
  gridJustifyItems,
  gridAlignItems,
  gridCols,
  gridRows,
  paddingTop,
  paddingRight,
  paddingBottom,
  paddingLeft,
  clipContent,
  projectUIKit,
  isStyleSyncing,
  onLayoutChange,
  onWidthChange,
  onHeightChange,
  onWidthBlur,
  onHeightBlur,
  onGapChange,
  onJustifyContentChange,
  onAlignItemsChange,
  onColumnGapChange,
  onRowGapChange,
  onGridJustifyItemsChange,
  onGridAlignItemsChange,
  onGridColsChange,
  onGridRowsChange,
  onPaddingChange,
  onClipContentChange,
  onNumericKeyDown,
  syncStyleChange,
}: LayoutSectionProps) {
  const [aspectRatioLocked, setAspectRatioLocked] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [paddingExpanded, setPaddingExpanded] = useState(false);
  const [showGridTooltip, setShowGridTooltip] = useState(false);

  // Track clicks in bothStretch mode to show tooltip on second single click
  const bothStretchClickCountRef = useRef(0);
  const bothStretchClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bothStretchLastClickTimeRef = useRef(0);

  // Show grid tooltip on first grid layout view
  useEffect(() => {
    if (selectedLayout === 'grid') {
      const dismissed = localStorage.getItem('gridStretchTooltipDismissed');
      if (!dismissed) {
        setShowGridTooltip(true);
      }
    } else {
      setShowGridTooltip(false);
    }
  }, [selectedLayout]);

  const dismissGridTooltip = useCallback(() => {
    setShowGridTooltip(false);
    localStorage.setItem('gridStretchTooltipDismissed', 'true');
  }, []);

  const handleAspectRatioToggle = useCallback(() => {
    if (!aspectRatioLocked) {
      const widthNum = Number.parseFloat(width) || 0;
      const heightNum = Number.parseFloat(height) || 0;
      if (widthNum > 0 && heightNum > 0) {
        setAspectRatio(widthNum / heightNum);
        setAspectRatioLocked(true);
      }
    } else {
      setAspectRatioLocked(false);
      setAspectRatio(null);
    }
  }, [aspectRatioLocked, width, height]);

  const handleWidthInputChange = useCallback(
    (value: string) => {
      onWidthChange(value);
      if (aspectRatioLocked && aspectRatio) {
        const widthNum = Number.parseFloat(value) || 0;
        if (widthNum > 0) {
          const newHeight = widthNum / aspectRatio;
          onHeightChange(`${newHeight}px`);
        }
      }
    },
    [aspectRatioLocked, aspectRatio, onWidthChange, onHeightChange],
  );

  const handleHeightInputChange = useCallback(
    (value: string) => {
      onHeightChange(value);
      if (aspectRatioLocked && aspectRatio) {
        const heightNum = Number.parseFloat(value) || 0;
        if (heightNum > 0) {
          const newWidth = heightNum * aspectRatio;
          onWidthChange(`${newWidth}px`);
        }
      }
    },
    [aspectRatioLocked, aspectRatio, onWidthChange, onHeightChange],
  );

  const handleLayoutGridClick = useCallback(
    (pos: (typeof LAYOUT_OPTIONS)[0]) => {
      const isSpaceBetween = justifyContent === 'space-between';

      if (isSpaceBetween) {
        if (selectedLayout === 'row') {
          syncStyleChange('alignItems', pos.align, DB);
          onAlignItemsChange(pos.align);
        } else {
          syncStyleChange('alignItems', pos.justify, DB);
          onAlignItemsChange(pos.justify);
        }
      } else {
        if (selectedLayout === 'row') {
          syncStyleChange('justifyContent', pos.justify, DB);
          syncStyleChange('alignItems', pos.align, DB);
          onJustifyContentChange(pos.justify);
          onAlignItemsChange(pos.align);
        } else {
          syncStyleChange('justifyContent', pos.align, DB);
          syncStyleChange('alignItems', pos.justify, DB);
          onJustifyContentChange(pos.align);
          onAlignItemsChange(pos.justify);
        }
      }
    },
    [selectedLayout, justifyContent, syncStyleChange, onJustifyContentChange, onAlignItemsChange],
  );

  const handleLayoutGridDoubleClick = useCallback(
    (pos: (typeof LAYOUT_OPTIONS)[0]) => {
      const isSpaceBetween = justifyContent === 'space-between';

      if (isSpaceBetween) {
        if (selectedLayout === 'row') {
          syncStyleChange('justifyContent', pos.justify, DB);
          syncStyleChange('alignItems', pos.align, DB);
          onJustifyContentChange(pos.justify);
          onAlignItemsChange(pos.align);
        } else {
          syncStyleChange('justifyContent', pos.align, DB);
          syncStyleChange('alignItems', pos.justify, DB);
          onJustifyContentChange(pos.align);
          onAlignItemsChange(pos.justify);
        }
      } else {
        syncStyleChange('justifyContent', 'space-between', DB);
        onJustifyContentChange('space-between');
        if (selectedLayout === 'row') {
          syncStyleChange('alignItems', pos.align, DB);
          onAlignItemsChange(pos.align);
        } else {
          syncStyleChange('alignItems', pos.justify, DB);
          onAlignItemsChange(pos.justify);
        }
      }
    },
    [selectedLayout, justifyContent, syncStyleChange, onJustifyContentChange, onAlignItemsChange],
  );

  const handleHorizontalPaddingChange = useCallback(
    (value: string) => {
      onPaddingChange('paddingLeft', value);
      onPaddingChange('paddingRight', value);
      syncStyleChange('paddingLeft', value);
      syncStyleChange('paddingRight', value);
    },
    [onPaddingChange, syncStyleChange],
  );

  const handleVerticalPaddingChange = useCallback(
    (value: string) => {
      onPaddingChange('paddingTop', value);
      onPaddingChange('paddingBottom', value);
      syncStyleChange('paddingTop', value);
      syncStyleChange('paddingBottom', value);
    },
    [onPaddingChange, syncStyleChange],
  );

  const handleClipContentToggle = useCallback(() => {
    const newValue = !clipContent;
    onClipContentChange(newValue);
    syncStyleChange('overflow', newValue ? 'hidden' : 'visible');
  }, [clipContent, onClipContentChange, syncStyleChange]);

  return (
    <div className="px-4 py-3 border-t border-border max-w-sidebar-section overflow-hidden">
      <div className="mb-3">
        <span className="text-xs font-semibold text-foreground">
          {selectedLayout === 'col' || selectedLayout === 'row' ? 'Auto layout' : 'Layout'}
        </span>
      </div>

      {/* Layout type buttons */}
      <div className="flex items-center mb-3 w-sidebar-content">
        <button
          type="button"
          onClick={() => onLayoutChange('layout')}
          className={cn(
            'flex-1 h-6 px-1 rounded-l flex items-center justify-center',
            selectedLayout === 'layout' ? 'border border-border bg-background' : 'bg-muted',
          )}
        >
          <IconLayout className="w-4 h-4" stroke={1.5} />
        </button>
        <button
          type="button"
          onClick={() => onLayoutChange('col')}
          className={cn(
            'flex-1 h-6 px-1 flex items-center justify-center',
            selectedLayout === 'col' ? 'border border-border bg-background' : 'bg-muted',
          )}
        >
          <IconSortDescending2 className="w-5 h-5" stroke={1.5} />
        </button>
        <button
          type="button"
          onClick={() => onLayoutChange('row')}
          className={cn(
            'flex-1 h-6 px-1 flex items-center justify-center',
            projectUIKit === 'tamagui' ? 'rounded-r' : '',
            selectedLayout === 'row' ? 'border border-border bg-background' : 'bg-muted',
          )}
        >
          <IconFlexRow className="w-5 h-5" />
        </button>
        {projectUIKit !== 'tamagui' && (
          <button
            type="button"
            onClick={() => onLayoutChange('grid')}
            className={cn(
              'flex-1 h-6 px-1 rounded-r flex items-center justify-center',
              selectedLayout === 'grid' ? 'border border-border bg-background' : 'bg-muted',
            )}
          >
            <IconLayoutGrid className="w-5 h-5" stroke={1.5} />
          </button>
        )}
      </div>

      {/* Width/Height */}
      <div className="flex items-center gap-1.5 mb-3">
        <div className="flex items-center gap-1.5 w-sidebar-content">
          <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
            <span className="text-xs text-muted-foreground">W</span>
            <Input
              type="text"
              value={width.replace(' Auto', '')}
              onChange={(e) => handleWidthInputChange(e.target.value)}
              onBlur={onWidthBlur}
              onKeyDown={(e) => onNumericKeyDown(e, width, (v) => onWidthChange(v), 'width')}
              placeholder="auto"
              className={cn(
                'h-auto border-0 bg-transparent !text-[11px] p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1',
                width.includes('Auto') ? 'text-muted-foreground' : 'text-foreground',
              )}
            />
            {width.includes('Auto') && (
              <span className="text-[11px] font-medium text-foreground">
                {selectedLayout === 'col' || selectedLayout === 'row' ? 'Hug' : 'Auto'}
              </span>
            )}
          </div>
          <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
            <span className="text-xs text-muted-foreground">H</span>
            <Input
              type="text"
              value={height.replace(' Auto', '')}
              onChange={(e) => handleHeightInputChange(e.target.value)}
              onBlur={onHeightBlur}
              onKeyDown={(e) => onNumericKeyDown(e, height, (v) => onHeightChange(v), 'height')}
              placeholder="auto"
              className={cn(
                'h-auto border-0 bg-transparent !text-[11px] p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1',
                height.includes('Auto') ? 'text-muted-foreground' : 'text-foreground',
              )}
            />
            {height.includes('Auto') && (
              <span className="text-[11px] font-medium text-foreground">
                {selectedLayout === 'col' || selectedLayout === 'row' ? 'Hug' : 'Auto'}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleAspectRatioToggle}
          className={cn(
            'w-6 h-6 rounded flex items-center justify-center',
            aspectRatioLocked ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-transparent',
          )}
        >
          <IconAspectRatio
            className={cn('w-4 h-4', aspectRatioLocked ? 'text-[#3479DE]' : 'text-foreground')}
            stroke={1.5}
          />
        </button>
      </div>

      {/* Flex layout controls */}
      {(selectedLayout === 'col' || selectedLayout === 'row') && (
        <>
          <div className="flex items-start gap-1.5 mb-3">
            <div className="w-[97px] h-14 rounded-md bg-muted relative">
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                {LAYOUT_OPTIONS.map((pos) => {
                  const normalizedJustify = normalizeFlexValue(justifyContent);
                  const normalizedAlign = normalizeFlexValue(alignItems);
                  const isSpaceBetween = justifyContent === 'space-between';

                  // For space-between (justify-content: space-between):
                  // row + space-between: vertical dashes arranged horizontally (same row based on alignItems)
                  // col + space-between: horizontal dashes arranged vertically (same column based on alignItems)
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
                      onClick={() => handleLayoutGridClick(pos)}
                      onDoubleClick={() => handleLayoutGridDoubleClick(pos)}
                      className={cn(
                        'flex items-center justify-center',
                        isStyleSyncing && 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      {isSpaceBetweenActive ? (
                        // Space-between: vertical dashes for row, horizontal dashes for col
                        <div
                          className={cn(
                            'bg-[#027BE5] rounded-full',
                            selectedLayout === 'row' ? 'w-0.5 h-3' : 'w-3 h-0.5',
                          )}
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

            <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
              <IconSpacingHorizontal
                className={cn('w-3 h-3 text-muted-foreground transition-transform', {
                  'rotate-90': selectedLayout === 'col',
                })}
              />
              <Input
                type="text"
                value={gap}
                onChange={(e) => {
                  onGapChange(e.target.value);
                  syncStyleChange('gap', e.target.value);
                }}
                onKeyDown={(e) => onNumericKeyDown(e, gap, onGapChange, 'gap')}
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                placeholder="0px"
              />
            </div>

            <button type="button" className="w-6 h-6 rounded flex items-center justify-center invisible">
              <IconAdjustmentsHorizontal className="w-4 h-4 text-foreground" stroke={1.5} />
            </button>
          </div>

          {/* Padding controls */}
          {!paddingExpanded ? (
            <div className="flex items-center gap-1.5 mb-3">
              <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
                <IconHorizontalPadding className="w-3 h-3 text-muted-foreground" />
                <Input
                  type="text"
                  value={paddingLeft || paddingRight}
                  onChange={(e) => handleHorizontalPaddingChange(e.target.value)}
                  onKeyDown={(e) =>
                    onNumericKeyDown(e, paddingLeft, (v) => handleHorizontalPaddingChange(v), 'paddingLeft')
                  }
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                  placeholder="0px"
                />
              </div>
              <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
                <IconVerticalPadding className="w-3 h-3 text-muted-foreground" />
                <Input
                  type="text"
                  value={paddingTop || paddingBottom}
                  onChange={(e) => handleVerticalPaddingChange(e.target.value)}
                  onKeyDown={(e) =>
                    onNumericKeyDown(e, paddingTop, (v) => handleVerticalPaddingChange(v), 'paddingTop')
                  }
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                  placeholder="0px"
                />
              </div>
              <button
                type="button"
                onClick={() => setPaddingExpanded(true)}
                className="w-6 h-6 rounded flex items-center justify-center"
              >
                <IconBorderSides className="w-4 h-4 text-foreground" stroke={1.5} />
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 mb-3 w-sidebar-content">
              <div className="w-24 h-6 px-2 bg-muted rounded flex items-center gap-1">
                <span className="text-xs text-muted-foreground">T</span>
                <Input
                  type="text"
                  value={paddingTop}
                  onChange={(e) => {
                    onPaddingChange('paddingTop', e.target.value);
                    syncStyleChange('paddingTop', e.target.value);
                  }}
                  onKeyDown={(e) =>
                    onNumericKeyDown(e, paddingTop, (v) => onPaddingChange('paddingTop', v), 'paddingTop')
                  }
                  placeholder="0px"
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                />
              </div>
              <div className="w-24 h-6 px-2 bg-muted rounded flex items-center gap-1">
                <span className="text-xs text-muted-foreground">R</span>
                <Input
                  type="text"
                  value={paddingRight}
                  onChange={(e) => {
                    onPaddingChange('paddingRight', e.target.value);
                    syncStyleChange('paddingRight', e.target.value);
                  }}
                  onKeyDown={(e) =>
                    onNumericKeyDown(e, paddingRight, (v) => onPaddingChange('paddingRight', v), 'paddingRight')
                  }
                  placeholder="0px"
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                />
              </div>
              <div className="w-24 h-6 px-2 bg-muted rounded flex items-center gap-1">
                <span className="text-xs text-muted-foreground">B</span>
                <Input
                  type="text"
                  value={paddingBottom}
                  onChange={(e) => {
                    onPaddingChange('paddingBottom', e.target.value);
                    syncStyleChange('paddingBottom', e.target.value);
                  }}
                  onKeyDown={(e) =>
                    onNumericKeyDown(e, paddingBottom, (v) => onPaddingChange('paddingBottom', v), 'paddingBottom')
                  }
                  placeholder="0px"
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                />
              </div>
              <div className="w-24 h-6 px-2 bg-muted rounded flex items-center gap-1">
                <span className="text-xs text-muted-foreground">L</span>
                <Input
                  type="text"
                  value={paddingLeft}
                  onChange={(e) => {
                    onPaddingChange('paddingLeft', e.target.value);
                    syncStyleChange('paddingLeft', e.target.value);
                  }}
                  onKeyDown={(e) =>
                    onNumericKeyDown(e, paddingLeft, (v) => onPaddingChange('paddingLeft', v), 'paddingLeft')
                  }
                  placeholder="0px"
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                />
              </div>
              <button
                type="button"
                onClick={() => setPaddingExpanded(false)}
                className="col-span-2 text-xs text-muted-foreground hover:text-muted-foreground"
              >
                Collapse
              </button>
            </div>
          )}
        </>
      )}

      {/* Grid layout controls */}
      {selectedLayout === 'grid' && (
        <>
          {/* Grid cols/rows inputs */}
          <div className="flex items-center gap-1.5 mb-3">
            <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Cols</span>
              <Input
                type="text"
                value={gridCols}
                onChange={(e) => {
                  onGridColsChange(e.target.value);
                  syncStyleChange('gridTemplateColumns', e.target.value);
                }}
                onKeyDown={(e) => onNumericKeyDown(e, gridCols, onGridColsChange, 'gridTemplateColumns')}
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                placeholder="auto"
              />
            </div>
            <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Rows</span>
              <Input
                type="text"
                value={gridRows}
                onChange={(e) => {
                  onGridRowsChange(e.target.value);
                  syncStyleChange('gridTemplateRows', e.target.value);
                }}
                onKeyDown={(e) => onNumericKeyDown(e, gridRows, onGridRowsChange, 'gridTemplateRows')}
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                placeholder="auto"
              />
            </div>
            {/* Placeholder for alignment */}
            <div className="w-6" />
          </div>

          {/* Tooltip about stretch modes */}
          {showGridTooltip && (
            <div className="relative mb-2">
              <div className="bg-popover text-popover-foreground border border-border text-[10px] rounded-md p-2 pr-6 leading-relaxed">
                <button
                  type="button"
                  onClick={dismissGridTooltip}
                  className="absolute top-1 right-1 p-0.5 hover:bg-muted rounded"
                >
                  <IconX className="w-3 h-3" />
                </button>
                <div className="font-medium mb-1">Double-click to cycle stretch modes:</div>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <div className="w-0.5 h-2 bg-blue-400 rounded-full" />
                  <span>Horizontal stretch</span>
                </div>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <div className="w-2 h-0.5 bg-blue-400 rounded-full" />
                  <span>Vertical stretch</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="relative w-2 h-2">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-0.5 h-2 bg-blue-400 rounded-full absolute" />
                      <div className="w-2 h-0.5 bg-blue-400 rounded-full absolute" />
                    </div>
                  </div>
                  <span>Both directions</span>
                </div>
              </div>
              <div className="absolute -bottom-1 left-4 w-2 h-2 bg-popover border-r border-b border-border rotate-45" />
            </div>
          )}

          {/* Positioning Grid + Two Gap inputs */}
          <div className="flex items-start gap-1.5 mb-3">
            {/* 9-dot positioning grid for place-items */}
            <div className="w-[97px] h-14 rounded-md bg-muted relative">
              {/* 3x3 grid of clickable dots */}
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                {(() => {
                  // Normalize grid values: empty, 'normal', 'stretch' all mean stretch (CSS default)
                  const normalizedGridJustifyItems =
                    !gridJustifyItems || gridJustifyItems === 'normal' || gridJustifyItems === 'stretch'
                      ? 'stretch'
                      : gridJustifyItems;
                  const normalizedGridAlignItems =
                    !gridAlignItems || gridAlignItems === 'normal' || gridAlignItems === 'stretch'
                      ? 'stretch'
                      : gridAlignItems;

                  // Stretch modes: normal -> horStretch -> vertStretch -> bothStretch -> normal
                  const isHorStretch =
                    normalizedGridJustifyItems === 'stretch' && normalizedGridAlignItems !== 'stretch';
                  const isVertStretch =
                    normalizedGridJustifyItems !== 'stretch' && normalizedGridAlignItems === 'stretch';
                  const isBothStretch =
                    normalizedGridJustifyItems === 'stretch' && normalizedGridAlignItems === 'stretch';
                  const isAnyStretch = isHorStretch || isVertStretch || isBothStretch;

                  // Determine which row/col should show stretch indicators
                  // For horStretch: show in the row matching alignItems
                  // For vertStretch: show in the column matching justifyItems
                  // For bothStretch: show only center cell
                  const stretchRow =
                    normalizedGridAlignItems === 'flex-end' || normalizedGridAlignItems === 'end'
                      ? 2
                      : normalizedGridAlignItems === 'center'
                        ? 1
                        : 0;
                  const stretchCol =
                    normalizedGridJustifyItems === 'flex-end' || normalizedGridJustifyItems === 'end'
                      ? 2
                      : normalizedGridJustifyItems === 'center'
                        ? 1
                        : 0;

                  return LAYOUT_OPTIONS.map((pos) => {
                    // Convert flex values to grid values
                    const alignValue =
                      pos.align === 'flex-start' ? 'start' : pos.align === 'flex-end' ? 'end' : pos.align;
                    const justifyValue =
                      pos.justify === 'flex-start' ? 'start' : pos.justify === 'flex-end' ? 'end' : pos.justify;

                    // For grid: justify-items is horizontal, align-items is vertical
                    const isActive = !isAnyStretch && gridJustifyItems === pos.justify && gridAlignItems === pos.align;

                    // Determine what to show for stretch modes
                    const showHorStretchDash = isHorStretch && pos.row === stretchRow;
                    const showVertStretchDash = isVertStretch && pos.col === stretchCol;
                    const showBothStretchCross = isBothStretch && pos.row === 1 && pos.col === 1;
                    // In bothStretch: show vertical dashes above/below center, horizontal dashes left/right of center
                    const showBothStretchVertDash = isBothStretch && pos.col === 1 && pos.row !== 1;
                    const showBothStretchHorDash = isBothStretch && pos.row === 1 && pos.col !== 1;

                    return (
                      <button
                        key={`grid-${pos.col}-${pos.row}`}
                        type="button"
                        disabled={isStyleSyncing}
                        onClick={() => {
                          if (isBothStretch) {
                            // Track clicks - show tooltip on second single click (not double click)
                            const now = Date.now();
                            const timeSinceLastClick = now - bothStretchLastClickTimeRef.current;
                            bothStretchLastClickTimeRef.current = now;
                            bothStretchClickCountRef.current += 1;

                            // Clear existing timer
                            if (bothStretchClickTimerRef.current) {
                              clearTimeout(bothStretchClickTimerRef.current);
                            }

                            // On second click, show tooltip only if > 500ms passed (not a double click)
                            if (bothStretchClickCountRef.current >= 2 && timeSinceLastClick > 500) {
                              setShowGridTooltip(true);
                              localStorage.removeItem('gridStretchTooltipDismissed');
                              bothStretchClickCountRef.current = 0;
                            } else {
                              // Reset after delay if no second click
                              bothStretchClickTimerRef.current = setTimeout(() => {
                                bothStretchClickCountRef.current = 0;
                              }, 10_000);
                            }
                          } else if (isHorStretch) {
                            // In horStretch: single click changes vertical alignment
                            syncStyleChange('alignItems', alignValue, DB);
                            onGridAlignItemsChange(pos.align);
                          } else if (isVertStretch) {
                            // In vertStretch: single click changes horizontal alignment
                            syncStyleChange('justifyItems', justifyValue, DB);
                            onGridJustifyItemsChange(pos.justify);
                          } else {
                            // In normal mode: single click sets both values
                            syncStyleChange('justifyItems', justifyValue, DB);
                            syncStyleChange('alignItems', alignValue, DB);
                            onGridJustifyItemsChange(pos.justify);
                            onGridAlignItemsChange(pos.align);
                          }
                        }}
                        onDoubleClick={() => {
                          // Reset click counter on double click (user knows what they're doing)
                          bothStretchClickCountRef.current = 0;
                          if (bothStretchClickTimerRef.current) {
                            clearTimeout(bothStretchClickTimerRef.current);
                          }

                          // Cycle: normal -> horStretch -> vertStretch -> bothStretch -> normal
                          if (isBothStretch) {
                            // bothStretch -> normal (at clicked position)
                            syncStyleChange('justifyItems', justifyValue, DB);
                            syncStyleChange('alignItems', alignValue, DB);
                            onGridJustifyItemsChange(pos.justify);
                            onGridAlignItemsChange(pos.align);
                          } else if (isVertStretch) {
                            // vertStretch -> bothStretch
                            syncStyleChange('justifyItems', 'stretch', DB);
                            syncStyleChange('alignItems', 'stretch', DB);
                            onGridJustifyItemsChange('stretch');
                            onGridAlignItemsChange('stretch');
                          } else if (isHorStretch) {
                            // horStretch -> vertStretch (keep current justify position)
                            syncStyleChange('justifyItems', justifyValue, DB);
                            syncStyleChange('alignItems', 'stretch', DB);
                            onGridJustifyItemsChange(pos.justify);
                            onGridAlignItemsChange('stretch');
                          } else {
                            // normal -> horStretch (at this row)
                            syncStyleChange('justifyItems', 'stretch', DB);
                            syncStyleChange('alignItems', alignValue, DB);
                            onGridJustifyItemsChange('stretch');
                            onGridAlignItemsChange(pos.align);
                          }
                        }}
                        className={cn(
                          'flex items-center justify-center',
                          isStyleSyncing && 'opacity-50 cursor-not-allowed',
                        )}
                      >
                        {showBothStretchCross ? (
                          // Cross for both stretch - center only
                          <div className="relative w-3 h-3 flex items-center justify-center">
                            <div className="absolute w-0.5 h-3 rounded-full bg-[#027BE5]" />
                            <div className="absolute w-3 h-0.5 rounded-full bg-[#027BE5]" />
                          </div>
                        ) : showBothStretchVertDash ? (
                          // Horizontal dash above/below center in bothStretch mode
                          <div className="w-3 h-0.5 rounded-full bg-[#027BE5]" />
                        ) : showBothStretchHorDash ? (
                          // Vertical dash left/right of center in bothStretch mode
                          <div className="w-0.5 h-3 rounded-full bg-[#027BE5]" />
                        ) : showHorStretchDash ? (
                          // Vertical dash for horizontal stretch
                          <div className="w-0.5 h-3 rounded-full bg-[#027BE5]" />
                        ) : showVertStretchDash ? (
                          // Horizontal dash for vertical stretch
                          <div className="w-3 h-0.5 rounded-full bg-[#027BE5]" />
                        ) : isActive ? (
                          <IconLayoutChart className="w-4 h-4 text-[#027BE5]" />
                        ) : (
                          <div className="w-1 h-1 rounded-full bg-[#B2B2B2]" />
                        )}
                      </button>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Two gap inputs stacked vertically */}
            <div className="flex flex-col gap-1.5 flex-1">
              {/* Column gap (horizontal - gap-x) */}
              <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
                <IconSpacingHorizontal className="w-3 h-3 text-muted-foreground" />
                <Input
                  type="text"
                  value={columnGap}
                  onChange={(e) => {
                    onColumnGapChange(e.target.value);
                    syncStyleChange('columnGap', e.target.value);
                  }}
                  onKeyDown={(e) => onNumericKeyDown(e, columnGap, onColumnGapChange, 'columnGap')}
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                  placeholder="0px"
                />
              </div>
              {/* Row gap (vertical - gap-y) */}
              <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
                <IconSpacingHorizontal className="w-3 h-3 text-muted-foreground rotate-90" />
                <Input
                  type="text"
                  value={rowGap}
                  onChange={(e) => {
                    onRowGapChange(e.target.value);
                    syncStyleChange('rowGap', e.target.value);
                  }}
                  onKeyDown={(e) => onNumericKeyDown(e, rowGap, onRowGapChange, 'rowGap')}
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                  placeholder="0px"
                />
              </div>
            </div>

            {/* Placeholder for alignment with flex layout */}
            <div className="w-6" />
          </div>

          {/* Padding controls for grid */}
          {!paddingExpanded ? (
            <div className="flex items-center gap-1.5 mb-3">
              <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
                <IconHorizontalPadding className="w-3 h-3 text-muted-foreground" />
                <Input
                  type="text"
                  value={paddingLeft || paddingRight}
                  onChange={(e) => handleHorizontalPaddingChange(e.target.value)}
                  onKeyDown={(e) =>
                    onNumericKeyDown(e, paddingLeft, (v) => handleHorizontalPaddingChange(v), 'paddingLeft')
                  }
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                  placeholder="0px"
                />
              </div>
              <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
                <IconVerticalPadding className="w-3 h-3 text-muted-foreground" />
                <Input
                  type="text"
                  value={paddingTop || paddingBottom}
                  onChange={(e) => handleVerticalPaddingChange(e.target.value)}
                  onKeyDown={(e) =>
                    onNumericKeyDown(e, paddingTop, (v) => handleVerticalPaddingChange(v), 'paddingTop')
                  }
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                  placeholder="0px"
                />
              </div>
              <button
                type="button"
                onClick={() => setPaddingExpanded(true)}
                className="w-6 h-6 rounded flex items-center justify-center"
              >
                <IconBorderSides className="w-4 h-4 text-foreground" stroke={1.5} />
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 mb-3 w-sidebar-content">
              <div className="w-24 h-6 px-2 bg-muted rounded flex items-center gap-1">
                <span className="text-xs text-muted-foreground">T</span>
                <Input
                  type="text"
                  value={paddingTop}
                  onChange={(e) => {
                    onPaddingChange('paddingTop', e.target.value);
                    syncStyleChange('paddingTop', e.target.value);
                  }}
                  onKeyDown={(e) =>
                    onNumericKeyDown(e, paddingTop, (v) => onPaddingChange('paddingTop', v), 'paddingTop')
                  }
                  placeholder="0px"
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                />
              </div>
              <div className="w-24 h-6 px-2 bg-muted rounded flex items-center gap-1">
                <span className="text-xs text-muted-foreground">R</span>
                <Input
                  type="text"
                  value={paddingRight}
                  onChange={(e) => {
                    onPaddingChange('paddingRight', e.target.value);
                    syncStyleChange('paddingRight', e.target.value);
                  }}
                  onKeyDown={(e) =>
                    onNumericKeyDown(e, paddingRight, (v) => onPaddingChange('paddingRight', v), 'paddingRight')
                  }
                  placeholder="0px"
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                />
              </div>
              <div className="w-24 h-6 px-2 bg-muted rounded flex items-center gap-1">
                <span className="text-xs text-muted-foreground">B</span>
                <Input
                  type="text"
                  value={paddingBottom}
                  onChange={(e) => {
                    onPaddingChange('paddingBottom', e.target.value);
                    syncStyleChange('paddingBottom', e.target.value);
                  }}
                  onKeyDown={(e) =>
                    onNumericKeyDown(e, paddingBottom, (v) => onPaddingChange('paddingBottom', v), 'paddingBottom')
                  }
                  placeholder="0px"
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                />
              </div>
              <div className="w-24 h-6 px-2 bg-muted rounded flex items-center gap-1">
                <span className="text-xs text-muted-foreground">L</span>
                <Input
                  type="text"
                  value={paddingLeft}
                  onChange={(e) => {
                    onPaddingChange('paddingLeft', e.target.value);
                    syncStyleChange('paddingLeft', e.target.value);
                  }}
                  onKeyDown={(e) =>
                    onNumericKeyDown(e, paddingLeft, (v) => onPaddingChange('paddingLeft', v), 'paddingLeft')
                  }
                  placeholder="0px"
                  className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                />
              </div>
              <button
                type="button"
                onClick={() => setPaddingExpanded(false)}
                className="col-span-2 text-xs text-muted-foreground hover:text-muted-foreground"
              >
                Collapse
              </button>
            </div>
          )}
        </>
      )}

      {/* Clip content */}
      <button type="button" onClick={handleClipContentToggle} className="flex items-center gap-2 mb-3">
        <div
          className={cn(
            'w-4 h-4 rounded border border-border flex items-center justify-center',
            clipContent ? 'bg-muted' : 'bg-background',
          )}
        >
          {clipContent && <IconCheck className="w-3 h-3" stroke={1.5} />}
        </div>
        <span className="text-xs text-foreground">Clip content</span>
      </button>
    </div>
  );
});
