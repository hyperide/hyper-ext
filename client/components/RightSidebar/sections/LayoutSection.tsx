import { TID } from '@shared/data-testid-map';
import {
  IconAdjustmentsHorizontal,
  IconAspectRatio,
  IconBorderSides,
  IconCheck,
  IconLayout,
  IconLayoutGrid,
  IconSortDescending2,
} from '@tabler/icons-react';
import cn from 'clsx';
import { memo } from 'react';
import IconFlexRow from '../../icons/IconFlexRow';
import IconSpacingHorizontal from '../../icons/IconSpacingHorizontal';
import { HintTooltip } from '../../ui/hint-tooltip';
import { Input } from '../../ui/input';
import type { LayoutType, UIKitType } from '../types';
import { GridLayoutControls, LayoutGrid, PaddingControls, useLayoutSection } from './layout-section';

interface LayoutSectionProps {
  selectedLayout: LayoutType;
  width: string;
  height: string;
  gap: string;
  justifyContent: string;
  alignItems: string;
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
    defaultValue?: string,
  ) => void;
  syncStyleChange: (key: string, value: string, options?: { debounceOnly?: boolean }) => void;
}

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
  const {
    aspectRatioLocked,
    paddingExpanded,
    showGridTooltip,
    setPaddingExpanded,
    dismissGridTooltip,
    handleAspectRatioToggle,
    handleWidthInputChange,
    handleHeightInputChange,
    handleLayoutGridClick,
    handleLayoutGridDoubleClick,
    handleHorizontalPaddingChange,
    handleVerticalPaddingChange,
    handleClipContentToggle,
    handleGridClick,
    handleGridDoubleClick,
  } = useLayoutSection({
    selectedLayout,
    width,
    height,
    justifyContent,
    alignItems,
    clipContent,
    onLayoutChange,
    onWidthChange,
    onHeightChange,
    onJustifyContentChange,
    onAlignItemsChange,
    onPaddingChange,
    onClipContentChange,
    syncStyleChange,
    onGridJustifyItemsChange,
    onGridAlignItemsChange,
  });

  const focusInput = (e: React.MouseEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).parentElement?.querySelector('input')?.focus();
  };

  return (
    <div
      data-testid={TID.inspector.sectionHeader('layout')}
      className="w-full px-4 py-3 border-t border-border overflow-hidden"
    >
      <div className="mb-3">
        <span className="text-xs font-semibold text-foreground">
          {selectedLayout === 'col' || selectedLayout === 'row' ? 'Auto layout' : 'Layout'}
        </span>
      </div>

      {/* Layout type buttons */}
      <div className="toggle-container flex items-center mb-3">
        <HintTooltip label="Block — normal document flow (display: block)">
          <button
            type="button"
            data-testid={TID.inspector.layoutDisplaySelect}
            onClick={() => onLayoutChange('layout')}
            aria-label="Block layout"
            aria-pressed={selectedLayout === 'layout'}
            className={cn(
              'flex-1 h-6 px-1 rounded-l flex items-center justify-center',
              selectedLayout === 'layout' && 'toggle-active',
            )}
          >
            <IconLayout className="w-4 h-4" stroke={1.5} />
          </button>
        </HintTooltip>
        <HintTooltip label="Vertical stack — children flow top to bottom (flex column)">
          <button
            type="button"
            data-testid={TID.inspector.layoutFlexDirection}
            onClick={() => onLayoutChange('col')}
            aria-label="Vertical stack layout"
            aria-pressed={selectedLayout === 'col'}
            className={cn(
              'flex-1 h-6 px-1 flex items-center justify-center',
              selectedLayout === 'col' && 'toggle-active',
            )}
          >
            <IconSortDescending2 className="w-5 h-5" stroke={1.5} />
          </button>
        </HintTooltip>
        <HintTooltip label="Horizontal stack — children flow left to right (flex row)">
          <button
            type="button"
            data-testid={TID.inspector.viewToggle('row')}
            onClick={() => onLayoutChange('row')}
            aria-label="Horizontal stack layout"
            aria-pressed={selectedLayout === 'row'}
            className={cn(
              'flex-1 h-6 px-1 flex items-center justify-center',
              projectUIKit === 'tamagui' ? 'rounded-r' : '',
              selectedLayout === 'row' && 'toggle-active',
            )}
          >
            <IconFlexRow className="w-5 h-5" />
          </button>
        </HintTooltip>
        {projectUIKit !== 'tamagui' && (
          <HintTooltip label="Grid — rows and columns (display: grid)">
            <button
              type="button"
              data-testid={TID.inspector.viewToggle('grid')}
              onClick={() => onLayoutChange('grid')}
              aria-label="Grid layout"
              aria-pressed={selectedLayout === 'grid'}
              className={cn(
                'flex-1 h-6 px-1 rounded-r flex items-center justify-center',
                selectedLayout === 'grid' && 'toggle-active',
              )}
            >
              <IconLayoutGrid className="w-5 h-5" stroke={1.5} />
            </button>
          </HintTooltip>
        )}
      </div>

      {/* Width/Height */}
      <div className="flex items-center gap-1.5 mb-3">
        <div className="flex items-center gap-1.5 flex-1">
          <HintTooltip label="Width — press ↑/↓ to nudge by 1px, Shift+↑/↓ by 10px">
            <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
              <span className="text-xs text-muted-foreground">W</span>
              <Input
                type="text"
                testId={TID.inspector.layoutWidth}
                aria-label="Width"
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
          </HintTooltip>
          <HintTooltip label="Height — press ↑/↓ to nudge by 1px, Shift+↑/↓ by 10px">
            <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
              <span className="text-xs text-muted-foreground">H</span>
              <Input
                type="text"
                testId={TID.inspector.layoutHeight}
                aria-label="Height"
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
          </HintTooltip>
        </div>
        <button
          type="button"
          onClick={handleAspectRatioToggle}
          className={cn(
            'w-6 h-6 rounded flex items-center justify-center',
            aspectRatioLocked ? 'inspector-btn-active' : 'bg-transparent',
          )}
        >
          <IconAspectRatio className={cn('w-4 h-4', !aspectRatioLocked && 'text-foreground')} stroke={1.5} />
        </button>
      </div>

      {/* Flex layout controls */}
      {(selectedLayout === 'col' || selectedLayout === 'row') && (
        <>
          <div className="flex items-start gap-1.5 mb-3">
            <LayoutGrid
              selectedLayout={selectedLayout}
              justifyContent={justifyContent}
              alignItems={alignItems}
              isStyleSyncing={isStyleSyncing}
              onClick={handleLayoutGridClick}
              onDoubleClick={handleLayoutGridDoubleClick}
            />

            <HintTooltip label="Gap — spacing between stacked children">
              <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
                <IconSpacingHorizontal
                  className={cn('w-3 h-3 text-muted-foreground transition-transform', {
                    'rotate-90': selectedLayout === 'col',
                  })}
                />
                <Input
                  type="text"
                  testId={TID.inspector.layoutGap}
                  aria-label="Gap between children"
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
            </HintTooltip>

            <button type="button" className="w-6 h-6 rounded flex items-center justify-center invisible">
              <IconAdjustmentsHorizontal className="w-4 h-4 text-foreground" stroke={1.5} />
            </button>
          </div>

          {/* Padding controls */}
          <div className="flex items-start gap-2 mb-3">
            <PaddingControls
              paddingExpanded={paddingExpanded}
              paddingTop={paddingTop}
              paddingRight={paddingRight}
              paddingBottom={paddingBottom}
              paddingLeft={paddingLeft}
              onPaddingChange={onPaddingChange}
              onHorizontalPaddingChange={handleHorizontalPaddingChange}
              onVerticalPaddingChange={handleVerticalPaddingChange}
              onNumericKeyDown={onNumericKeyDown}
              syncStyleChange={syncStyleChange}
              focusInput={focusInput}
            />
            <button
              type="button"
              data-testid={TID.inspector.spacingLink('padding')}
              onClick={() => setPaddingExpanded(!paddingExpanded)}
              className={cn(
                'w-6 h-6 rounded flex items-center justify-center flex-shrink-0 transition-colors',
                paddingExpanded ? 'inspector-btn-active' : 'bg-transparent',
              )}
            >
              <IconBorderSides className={cn('w-4 h-4', !paddingExpanded && 'text-foreground')} stroke={1.5} />
            </button>
          </div>
        </>
      )}

      {/* Grid layout controls */}
      {selectedLayout === 'grid' && (
        <GridLayoutControls
          gridCols={gridCols}
          gridRows={gridRows}
          gridJustifyItems={gridJustifyItems}
          gridAlignItems={gridAlignItems}
          columnGap={columnGap}
          rowGap={rowGap}
          paddingTop={paddingTop}
          paddingRight={paddingRight}
          paddingBottom={paddingBottom}
          paddingLeft={paddingLeft}
          paddingExpanded={paddingExpanded}
          showGridTooltip={showGridTooltip}
          isStyleSyncing={isStyleSyncing}
          onGridColsChange={onGridColsChange}
          onGridRowsChange={onGridRowsChange}
          onGridJustifyItemsChange={onGridJustifyItemsChange}
          onGridAlignItemsChange={onGridAlignItemsChange}
          onColumnGapChange={onColumnGapChange}
          onRowGapChange={onRowGapChange}
          onPaddingChange={onPaddingChange}
          onHorizontalPaddingChange={handleHorizontalPaddingChange}
          onVerticalPaddingChange={handleVerticalPaddingChange}
          onNumericKeyDown={onNumericKeyDown}
          syncStyleChange={syncStyleChange}
          onGridClick={handleGridClick}
          onGridDoubleClick={handleGridDoubleClick}
          dismissGridTooltip={dismissGridTooltip}
          focusInput={focusInput}
          setPaddingExpanded={setPaddingExpanded}
        />
      )}

      {/* Padding controls for block layout */}
      {selectedLayout === 'layout' && (
        <div className="flex items-start gap-2 mb-3">
          <PaddingControls
            paddingExpanded={paddingExpanded}
            paddingTop={paddingTop}
            paddingRight={paddingRight}
            paddingBottom={paddingBottom}
            paddingLeft={paddingLeft}
            onPaddingChange={onPaddingChange}
            onHorizontalPaddingChange={handleHorizontalPaddingChange}
            onVerticalPaddingChange={handleVerticalPaddingChange}
            onNumericKeyDown={onNumericKeyDown}
            syncStyleChange={syncStyleChange}
            focusInput={focusInput}
          />
          <button
            type="button"
            data-testid={TID.inspector.spacingLink('padding')}
            onClick={() => setPaddingExpanded(!paddingExpanded)}
            className={cn(
              'w-6 h-6 rounded flex items-center justify-center flex-shrink-0 transition-colors',
              paddingExpanded
                ? 'bg-accent text-accent-foreground'
                : 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <IconBorderSides className="w-4 h-4" stroke={1.5} />
          </button>
        </div>
      )}

      {/* Clip content */}
      <button
        type="button"
        data-testid={TID.inspector.layoutOverflow}
        onClick={handleClipContentToggle}
        className="flex items-center gap-2 mb-3"
      >
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
