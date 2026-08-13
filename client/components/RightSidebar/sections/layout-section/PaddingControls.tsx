import IconHorizontalPadding from '../../../icons/IconHorizontalPadding';
import IconVerticalPadding from '../../../icons/IconVerticalPadding';
import IconPaddingBottom from '../../../icons/IconPaddingBottom';
import IconPaddingLeft from '../../../icons/IconPaddingLeft';
import IconPaddingRight from '../../../icons/IconPaddingRight';
import IconPaddingTop from '../../../icons/IconPaddingTop';
import { HintTooltip } from '../../../ui/hint-tooltip';
import { Input } from '../../../ui/input';
import { TID } from '@shared/data-testid-map';

const PADDING_HINT_SUFFIX = ' — press ↑/↓ to nudge by 1px, Shift+↑/↓ by 10px';

interface PaddingControlsProps {
  paddingExpanded: boolean;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
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
  focusInput: (e: React.MouseEvent) => void;
}

export function PaddingControls({
  paddingExpanded,
  paddingTop,
  paddingRight,
  paddingBottom,
  paddingLeft,
  onPaddingChange,
  onHorizontalPaddingChange,
  onVerticalPaddingChange,
  onNumericKeyDown,
  syncStyleChange,
  focusInput,
}: PaddingControlsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 flex-1">
      {paddingExpanded ? (
        <>
          <HintTooltip label={`Left padding${PADDING_HINT_SUFFIX}`}>
            <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
              <IconPaddingLeft className="w-3 h-3 text-muted-foreground cursor-pointer" onMouseDown={focusInput} />
              <Input
                type="text"
                testId={TID.inspector.spacingInput('padding', 'left')}
                aria-label="Left padding"
                value={paddingLeft}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  onPaddingChange('paddingLeft', e.target.value);
                  syncStyleChange('paddingLeft', e.target.value);
                }}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) =>
                  onNumericKeyDown(e, paddingLeft, (v) => onPaddingChange('paddingLeft', v), 'paddingLeft')
                }
                placeholder="0px"
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
              />
            </div>
          </HintTooltip>
          <HintTooltip label={`Top padding${PADDING_HINT_SUFFIX}`}>
            <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
              <IconPaddingTop className="w-3 h-3 text-muted-foreground cursor-pointer" onMouseDown={focusInput} />
              <Input
                type="text"
                testId={TID.inspector.spacingInput('padding', 'top')}
                aria-label="Top padding"
                value={paddingTop}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  onPaddingChange('paddingTop', e.target.value);
                  syncStyleChange('paddingTop', e.target.value);
                }}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) =>
                  onNumericKeyDown(e, paddingTop, (v) => onPaddingChange('paddingTop', v), 'paddingTop')
                }
                placeholder="0px"
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
              />
            </div>
          </HintTooltip>
          <HintTooltip label={`Right padding${PADDING_HINT_SUFFIX}`}>
            <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
              <IconPaddingRight className="w-3 h-3 text-muted-foreground cursor-pointer" onMouseDown={focusInput} />
              <Input
                type="text"
                testId={TID.inspector.spacingInput('padding', 'right')}
                aria-label="Right padding"
                value={paddingRight}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  onPaddingChange('paddingRight', e.target.value);
                  syncStyleChange('paddingRight', e.target.value);
                }}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) =>
                  onNumericKeyDown(e, paddingRight, (v) => onPaddingChange('paddingRight', v), 'paddingRight')
                }
                placeholder="0px"
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
              />
            </div>
          </HintTooltip>
          <HintTooltip label={`Bottom padding${PADDING_HINT_SUFFIX}`}>
            <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
              <IconPaddingBottom className="w-3 h-3 text-muted-foreground cursor-pointer" onMouseDown={focusInput} />
              <Input
                type="text"
                testId={TID.inspector.spacingInput('padding', 'bottom')}
                aria-label="Bottom padding"
                value={paddingBottom}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  onPaddingChange('paddingBottom', e.target.value);
                  syncStyleChange('paddingBottom', e.target.value);
                }}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) =>
                  onNumericKeyDown(e, paddingBottom, (v) => onPaddingChange('paddingBottom', v), 'paddingBottom')
                }
                placeholder="0px"
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
              />
            </div>
          </HintTooltip>
        </>
      ) : (
        <>
          <HintTooltip label={`Horizontal padding${PADDING_HINT_SUFFIX}`}>
            <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
              <IconHorizontalPadding
                className="w-3 h-3 text-muted-foreground cursor-pointer"
                onMouseDown={focusInput}
              />
              <Input
                type="text"
                testId={TID.inspector.spacingInput('padding', 'horizontal')}
                aria-label="Horizontal padding"
                value={paddingLeft || paddingRight}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onHorizontalPaddingChange(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) =>
                  onNumericKeyDown(e, paddingLeft || paddingRight, (v) => onHorizontalPaddingChange(v), 'paddingLeft')
                }
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                placeholder="0px"
              />
            </div>
          </HintTooltip>
          <HintTooltip label={`Vertical padding${PADDING_HINT_SUFFIX}`}>
            <div className="h-6 px-2 bg-muted rounded flex items-center gap-1">
              <IconVerticalPadding className="w-3 h-3 text-muted-foreground cursor-pointer" onMouseDown={focusInput} />
              <Input
                type="text"
                testId={TID.inspector.spacingInput('padding', 'vertical')}
                aria-label="Vertical padding"
                value={paddingTop || paddingBottom}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onVerticalPaddingChange(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) =>
                  onNumericKeyDown(e, paddingTop || paddingBottom, (v) => onVerticalPaddingChange(v), 'paddingTop')
                }
                className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                placeholder="0px"
              />
            </div>
          </HintTooltip>
        </>
      )}
    </div>
  );
}
