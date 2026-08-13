import cn from 'clsx';
import { LAYOUT_OPTIONS } from '../../constants';
import type { LayoutOption } from '../../types';
import IconLayoutChart from '../../../icons/IconLayoutChart';
import { Input } from '../../../ui/input';
import { TID } from '@shared/data-testid-map';
import IconSpacingHorizontal from '../../../icons/IconSpacingHorizontal';
import { IconX, IconBorderSides } from '@tabler/icons-react';
import { PaddingControls } from './PaddingControls';

interface GridLayoutControlsProps {
  gridCols: string;
  gridRows: string;
  gridJustifyItems: string;
  gridAlignItems: string;
  columnGap: string;
  rowGap: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  paddingExpanded: boolean;
  showGridTooltip: boolean;
  isStyleSyncing: boolean;
  onGridColsChange: (value: string) => void;
  onGridRowsChange: (value: string) => void;
  onGridJustifyItemsChange: (value: string) => void;
  onGridAlignItemsChange: (value: string) => void;
  onColumnGapChange: (value: string) => void;
  onRowGapChange: (value: string) => void;
  onPaddingChange: (key: string, value: string) => void;
  onHorizontalPaddingChange: (value: string) => void;
  onVerticalPaddingChange: (value: string) => void;
  onNumericKeyDown: (
    e: React.KeyboardEvent<HTMLInputElement>,
    currentValue: string,
    setValue: (value: string) => void,
    styleKey?: string,
    defaultValue?: string,
  ) => void;
  syncStyleChange: (key: string, value: string, options?: { debounceOnly?: boolean }) => void;
  onGridClick: (pos: { justify: string; align: string; col: number; row: number }, gridState: any) => void;
  onGridDoubleClick: (pos: { justify: string; align: string }, gridState: any) => void;
  dismissGridTooltip: () => void;
  focusInput: (e: React.MouseEvent) => void;
  setPaddingExpanded: (v: boolean) => void;
}

export function GridLayoutControls({
  gridCols,
  gridRows,
  gridJustifyItems,
  gridAlignItems,
  columnGap,
  rowGap,
  paddingTop,
  paddingRight,
  paddingBottom,
  paddingLeft,
  paddingExpanded,
  showGridTooltip,
  isStyleSyncing,
  onGridColsChange,
  onGridRowsChange,
  onColumnGapChange,
  onRowGapChange,
  onPaddingChange,
  onHorizontalPaddingChange,
  onVerticalPaddingChange,
  onNumericKeyDown,
  syncStyleChange,
  onGridClick,
  onGridDoubleClick,
  dismissGridTooltip,
  focusInput,
  setPaddingExpanded,
}: GridLayoutControlsProps) {
  const normalizedGridJustifyItems =
    !gridJustifyItems || gridJustifyItems === 'normal' || gridJustifyItems === 'stretch' ? 'stretch' : gridJustifyItems;
  const normalizedGridAlignItems =
    !gridAlignItems || gridAlignItems === 'normal' || gridAlignItems === 'stretch' ? 'stretch' : gridAlignItems;

  const isHorStretch = normalizedGridJustifyItems === 'stretch' && normalizedGridAlignItems !== 'stretch';
  const isVertStretch = normalizedGridJustifyItems !== 'stretch' && normalizedGridAlignItems === 'stretch';
  const isBothStretch = normalizedGridJustifyItems === 'stretch' && normalizedGridAlignItems === 'stretch';
  const isAnyStretch = isHorStretch || isVertStretch || isBothStretch;

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

  const gridState = { isHorStretch, isVertStretch, isBothStretch };

  return (
    <>
      <div className="flex items-center gap-1.5 mb-3">
        <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Cols</span>
          <Input
            type="text"
            testId={TID.inspector.numericInput('gridCols')}
            value={gridCols}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              onGridColsChange(e.target.value);
              syncStyleChange('gridTemplateColumns', e.target.value);
            }}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) =>
              onNumericKeyDown(e, gridCols, onGridColsChange, 'gridTemplateColumns')
            }
            className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
            placeholder="auto"
          />
        </div>
        <div className="flex-1 h-6 px-2 bg-muted rounded flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Rows</span>
          <Input
            type="text"
            testId={TID.inspector.numericInput('gridRows')}
            value={gridRows}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              onGridRowsChange(e.target.value);
              syncStyleChange('gridTemplateRows', e.target.value);
            }}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) =>
              onNumericKeyDown(e, gridRows, onGridRowsChange, 'gridTemplateRows')
            }
            className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
            placeholder="auto"
          />
        </div>
        <div className="w-6" />
      </div>

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

      <div className="flex items-start gap-1.5 mb-3">
        <div className="w-[97px] h-14 rounded-md bg-muted relative">
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
            {LAYOUT_OPTIONS.map((pos: LayoutOption) => {
              const isActive = !isAnyStretch && gridJustifyItems === pos.justify && gridAlignItems === pos.align;
              const showHorStretchDash = isHorStretch && pos.row === stretchRow;
              const showVertStretchDash = isVertStretch && pos.col === stretchCol;
              const showBothStretchCross = isBothStretch && pos.row === 1 && pos.col === 1;
              const showBothStretchVertDash = isBothStretch && pos.col === 1 && pos.row !== 1;
              const showBothStretchHorDash = isBothStretch && pos.row === 1 && pos.col !== 1;

              return (
                <button
                  key={`grid-${pos.col}-${pos.row}`}
                  type="button"
                  disabled={isStyleSyncing}
                  onClick={() => onGridClick(pos, gridState)}
                  onDoubleClick={() => onGridDoubleClick(pos, gridState)}
                  className={cn('flex items-center justify-center', isStyleSyncing && 'opacity-50 cursor-not-allowed')}
                >
                  {showBothStretchCross ? (
                    <div className="relative w-3 h-3 flex items-center justify-center">
                      <div className="absolute w-0.5 h-3 rounded-full bg-[#027BE5]" />
                      <div className="absolute w-3 h-0.5 rounded-full bg-[#027BE5]" />
                    </div>
                  ) : showBothStretchVertDash ? (
                    <div className="w-3 h-0.5 rounded-full bg-[#027BE5]" />
                  ) : showBothStretchHorDash ? (
                    <div className="w-0.5 h-3 rounded-full bg-[#027BE5]" />
                  ) : showHorStretchDash ? (
                    <div className="w-0.5 h-3 rounded-full bg-[#027BE5]" />
                  ) : showVertStretchDash ? (
                    <div className="w-3 h-0.5 rounded-full bg-[#027BE5]" />
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

        <div className="flex flex-col gap-1.5 flex-1">
          <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
            <IconSpacingHorizontal className="w-3 h-3 text-muted-foreground" />
            <Input
              type="text"
              testId={TID.inspector.numericInput('columnGap')}
              value={columnGap}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                onColumnGapChange(e.target.value);
                syncStyleChange('columnGap', e.target.value);
              }}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) =>
                onNumericKeyDown(e, columnGap, onColumnGapChange, 'columnGap')
              }
              className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
              placeholder="0px"
            />
          </div>
          <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
            <IconSpacingHorizontal className="w-3 h-3 text-muted-foreground rotate-90" />
            <Input
              type="text"
              testId={TID.inspector.numericInput('rowGap')}
              value={rowGap}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                onRowGapChange(e.target.value);
                syncStyleChange('rowGap', e.target.value);
              }}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) =>
                onNumericKeyDown(e, rowGap, onRowGapChange, 'rowGap')
              }
              className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
              placeholder="0px"
            />
          </div>
        </div>

        <div className="w-6" />
      </div>

      <div className="flex items-start gap-2 mb-3">
        <PaddingControls
          paddingExpanded={paddingExpanded}
          paddingTop={paddingTop}
          paddingRight={paddingRight}
          paddingBottom={paddingBottom}
          paddingLeft={paddingLeft}
          onPaddingChange={onPaddingChange}
          onHorizontalPaddingChange={onHorizontalPaddingChange}
          onVerticalPaddingChange={onVerticalPaddingChange}
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
  );
}
