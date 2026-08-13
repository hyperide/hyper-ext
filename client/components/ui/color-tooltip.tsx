/**
 * @file Color info panel and utilities for color tooltip display
 *
 * Accessed via: Internal module, used by ColorCombobox
 * Assumptions: clipboard API available
 *
 * Copy flow: hover to show panel → Cmd/Ctrl+C activates copy mode →
 * press format key (#/r/h/t) to copy that format. Visual feedback on activation.
 */

import { contrastRatio, hexToHsl, hexToRgb, wcagLevel } from '@shared/utils/color';
import { IconCommand, IconCopy, IconExternalLink } from '@tabler/icons-react';
import cn from 'clsx';
import * as React from 'react';
import { toast } from '@/hooks/use-toast';
import { getModifierKey } from './platform-keys';

export interface ColorValue {
  label: string;
  value: string;
  hotkey: string;
}

/**
 * Map from KeyboardEvent.code to logical hotkey character.
 * Allows hotkeys to work regardless of keyboard layout (e.g. Russian).
 */
const CODE_TO_HOTKEY: Record<string, string> = {
  KeyT: 't',
  KeyR: 'r',
  KeyH: 'h',
  Digit3: '#', // Shift+3 = # on US layout, but we match the code
  // # is also produced by other key combos — fallback to e.key below
};

/** Match a KeyboardEvent to a hotkey character (layout-independent) */
export function matchHotkey(e: KeyboardEvent, hotkey: string): boolean {
  // First try code-based match (layout-independent)
  const mapped = CODE_TO_HOTKEY[e.code];
  if (mapped === hotkey) return true;
  // Fallback to key-based match (for # and special chars)
  return e.key === hotkey;
}

export function formatColorValues(tokenName: string, hex: string): ColorValue[] {
  const isHex = /^#[0-9a-fA-F]{3,8}$/.test(hex);
  if (!isHex) {
    // Special values like transparent, inherit, currentColor — only show token name
    return [{ label: tokenName, value: tokenName, hotkey: 't' }];
  }

  const rgb = hexToRgb(hex);
  const hsl = hexToHsl(hex);

  return [
    { label: tokenName, value: tokenName, hotkey: 't' },
    { label: hex, value: hex, hotkey: '#' },
    {
      label: rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : hex,
      value: rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : hex,
      hotkey: 'r',
    },
    {
      label: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
      value: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
      hotkey: 'h',
    },
  ];
}

export function copyToClipboard(value: string) {
  navigator.clipboard.writeText(value);
  toast({
    title: `Copied ${value}`,
    duration: 1500,
  });
}

interface ColorInfoPanelProps {
  tokenName: string;
  hex: string;
  copyMode: boolean;
  sourceLabel?: string;
  /** Paired color for contrast check (text↔bg of the same element) */
  pairedHex?: string;
  /** Whether the hovered color is the text color (true) or background (false) */
  isTextColor?: boolean;
  /** Tab fix target level (shown when contrast is below target) */
  tabFixTarget?: 'AA' | 'AAA';
  style?: React.CSSProperties;
  className?: string;
}

/** Non-interactive color info panel positioned externally by the parent */
export const ColorInfoPanel = React.forwardRef<HTMLDivElement, ColorInfoPanelProps>(
  ({ tokenName, hex, copyMode, sourceLabel, pairedHex, isTextColor, tabFixTarget, style, className }, ref) => {
    const values = React.useMemo(() => formatColorValues(tokenName, hex), [tokenName, hex]);
    const mod = getModifierKey();

    const contrast = React.useMemo(() => {
      if (!pairedHex) return null;
      const ratio = contrastRatio(hex, pairedHex);
      return { ratio, level: wcagLevel(ratio) };
    }, [hex, pairedHex]);

    return (
      <div
        ref={ref}
        className={cn(
          'rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 slide-in-from-right-1 duration-100',
          className,
        )}
        style={{ pointerEvents: 'none', ...style }}
      >
        <div className="flex flex-col py-1">
          {values.map((entry) => (
            <div key={entry.hotkey} className="flex items-center gap-3 px-2 py-0.5 text-xs whitespace-nowrap">
              <span className="flex-1 text-left font-mono">{entry.label}</span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <IconCopy
                  className={cn('w-3 h-3 transition-colors', copyMode && 'text-amber-600 dark:text-amber-400')}
                  stroke={1.5}
                />
                <kbd className={cn('flex items-center gap-0.5 transition-opacity', copyMode && 'opacity-40')}>
                  {mod.key === 'Meta' ? <IconCommand className="w-3 h-3" stroke={1.5} /> : 'Ctrl'}C,
                </kbd>
                <kbd
                  className={cn(
                    'transition-colors',
                    copyMode
                      ? 'bg-amber-200 dark:bg-amber-800 text-foreground px-1 rounded font-bold'
                      : 'text-muted-foreground',
                  )}
                >
                  {entry.hotkey}
                </kbd>
              </span>
            </div>
          ))}
          {contrast && pairedHex && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 border-t border-border text-[10px] whitespace-nowrap">
              <span
                className="w-5 h-5 rounded-sm border border-border flex items-center justify-center text-[11px] font-bold leading-none"
                style={{
                  backgroundColor: isTextColor ? pairedHex : hex,
                  color: isTextColor ? hex : pairedHex,
                }}
              >
                A
              </span>
              <span className="font-mono">{contrast.ratio.toFixed(1)}:1</span>
              <span
                className={cn(
                  'px-1 rounded font-medium',
                  contrast.level === 'AAA' && 'bg-green-100 dark:bg-green-900 text-green-900 dark:text-green-100',
                  contrast.level === 'AA' &&
                    'bg-emerald-100 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100',
                  contrast.level === 'Fail' && 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300',
                )}
              >
                {contrast.level}
              </span>
              {tabFixTarget && <kbd className="ml-auto text-[9px] text-muted-foreground">Ctrl×2 → {tabFixTarget}</kbd>}
            </div>
          )}
          {sourceLabel && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 border-t border-border text-[10px] text-muted-foreground whitespace-nowrap">
              <IconExternalLink className="w-3 h-3 shrink-0" stroke={1.5} />
              <span className="truncate">{sourceLabel}</span>
              <kbd className="ml-auto flex items-center gap-0.5 text-[9px]">
                {mod.key === 'Meta' ? <IconCommand className="w-2.5 h-2.5" stroke={1.5} /> : 'Ctrl'}Click
              </kbd>
            </div>
          )}
        </div>
      </div>
    );
  },
);
