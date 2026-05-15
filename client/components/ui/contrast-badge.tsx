/**
 * @file Inline WCAG contrast badge with interactive hover card
 *
 * Accessed via: Internal component, used by ColorCombobox (unlinked hex mode)
 * Assumptions: contrastRatio and wcagLevel available from shared/utils/color
 */

import { contrastRatio, findContrastFixHex, wcagLevel } from '@shared/utils/color';
import cn from 'clsx';
import * as React from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card';

interface ContrastBadgeProps {
  hex: string;
  pairedHex: string;
  isTextColor?: boolean;
}

const LEVEL_DESCRIPTIONS: Record<string, string> = {
  AAA: 'Excellent contrast (7:1+). Meets WCAG AAA for normal text.',
  AA: 'Sufficient contrast (4.5:1+). Meets WCAG AA for normal text.',
  Fail: 'Insufficient contrast (<4.5:1). Does not meet WCAG AA.',
};

export function ContrastBadge({ hex, pairedHex, isTextColor }: ContrastBadgeProps) {
  const ratio = contrastRatio(hex, pairedHex);
  const level = wcagLevel(ratio);

  const fixTarget = level === 'Fail' ? 'AA' : level === 'AA' ? 'AAA' : null;
  const fixHex = React.useMemo(
    () => (fixTarget ? findContrastFixHex(hex, pairedHex, fixTarget) : null),
    [hex, pairedHex, fixTarget],
  );

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span
          className={cn(
            'text-[9px] px-1 rounded font-medium shrink-0 mr-1 cursor-default',
            level === 'AAA' && 'bg-green-100 dark:bg-green-900 text-green-900 dark:text-green-100',
            level === 'AA' && 'bg-emerald-100 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100',
            level === 'Fail' && 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300',
          )}
        >
          {level}
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-56 p-2.5 text-xs">
        {/* Preview square */}
        <div className="flex items-start gap-2 mb-2">
          <span
            className="w-7 h-7 shrink-0 rounded border border-border flex items-center justify-center text-sm font-bold leading-none"
            style={{
              backgroundColor: isTextColor ? pairedHex : hex,
              color: isTextColor ? hex : pairedHex,
            }}
          >
            A
          </span>
          <div>
            <div className="font-mono font-medium">{ratio.toFixed(2)}:1</div>
            <div className="text-muted-foreground">{LEVEL_DESCRIPTIONS[level]}</div>
          </div>
        </div>

        {/* Contrast fix hint */}
        {fixTarget && fixHex && (
          <div className="flex items-center gap-1.5 pt-2 border-t border-border text-muted-foreground">
            <kbd className="text-[10px] bg-muted px-1 rounded">Ctrl×2</kbd>
            <span className="flex items-center gap-1">
              fix to {fixTarget}:
              <span
                className="inline-block w-3 h-3 rounded-sm border border-border shrink-0"
                style={{ backgroundColor: fixHex }}
              />
              <span className="font-mono">{fixHex}</span>
            </span>
          </div>
        )}

        {/* WCAG link */}
        <div className="pt-2 mt-2 border-t border-border">
          <a
            href="https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            WCAG 2.1 Contrast (Level AA)
          </a>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
