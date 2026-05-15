/**
 * @file Linked (token) mode color picker — Popover with Command search
 *
 * Accessed via: Internal component, rendered by ColorCombobox when isLinked=true
 * Assumptions: uses cmdk Command for keyboard-navigable color list
 */

import { contrastRatio, wcagLevel } from '@shared/utils/color';
import { IconChevronDown } from '@tabler/icons-react';
import cn from 'clsx';
import { createPortal } from 'react-dom';
import { Command, CommandEmpty, CommandInput, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColorPaletteGrid } from './color-palette-grid';
import { useColorPickerContext } from './color-picker-context';
import { ColorSearchResults } from './color-search-results';
import { ColorStripBar } from './color-strip-bar';
import { ColorSwatch } from './color-swatch';
import { ColorInfoPanel } from './color-tooltip';
import type { ColorEntry } from './extract-component-colors';
import type { RecentColor } from './hooks/use-recent-colors';

interface LinkedColorPickerProps {
  componentColors: ColorEntry[];
  recentColors: RecentColor[];
}

export function LinkedColorPicker({ componentColors, recentColors }: LinkedColorPickerProps) {
  const ctx = useColorPickerContext();

  return (
    <Popover
      open={ctx.open}
      onOpenChange={(isOpen) => {
        ctx.setOpen(isOpen);
        if (!isOpen) {
          ctx.resetPopoverState();
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={ctx.open}
          className="flex items-center gap-1.5 h-6 px-2 bg-muted rounded-l text-xs hover:bg-accent transition-colors flex-1"
        >
          <ColorSwatch hex={ctx.currentHex} value={ctx.value || 'none'} />
          <span
            className={cn(
              'truncate flex-1 text-left',
              ctx.currentToken || ctx.value ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {ctx.currentToken
              ? ctx.tokenSystem === 'tamagui'
                ? `$${ctx.currentToken}`
                : ctx.currentToken
              : ctx.value || 'none'}
          </span>
          <IconChevronDown className="w-3 h-3 text-muted-foreground shrink-0" stroke={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent ref={ctx.popoverContentRef} className="w-[280px] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="relative">
            <CommandInput
              placeholder="Search colors..."
              className="h-9"
              value={ctx.search}
              onValueChange={ctx.setSearch}
            />
            {ctx.parsedSearchColor && (
              <div
                className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border border-border"
                style={{ backgroundColor: ctx.parsedSearchColor.hex }}
              />
            )}
          </div>
          <ColorStripBar componentColors={componentColors} recentColors={recentColors} />
          <CommandList className="max-h-[300px]">
            {!ctx.hasResults && <CommandEmpty>No color found.</CommandEmpty>}
            {ctx.isSearching ? <ColorSearchResults /> : <ColorPaletteGrid />}
          </CommandList>
        </Command>
      </PopoverContent>
      {/* Color info panel — positioned to the left of popover, Y centered on hovered item */}
      {ctx.open &&
        ctx.hoveredColor &&
        ctx.popoverContentRef.current &&
        createPortal(
          <ColorInfoPanel
            ref={ctx.infoPanelRef}
            tokenName={ctx.hoveredColor.tokenName}
            hex={ctx.hoveredColor.hex}
            copyMode={ctx.copyMode}
            sourceLabel={ctx.hoveredColor.sourceLabel}
            pairedHex={ctx.hoveredColor.pairedHex}
            isTextColor={ctx.hoveredColor.isTextColor}
            tabFixTarget={
              ctx.hoveredColor.pairedHex
                ? (() => {
                    const level = wcagLevel(contrastRatio(ctx.hoveredColor.hex, ctx.hoveredColor.pairedHex));
                    if (level === 'Fail') return 'AA' as const;
                    if (level === 'AA') return 'AAA' as const;
                    return undefined;
                  })()
                : undefined
            }
            style={{
              position: 'fixed',
              zIndex: 60,
              right: `${window.innerWidth - ctx.popoverContentRef.current.getBoundingClientRect().left + 8}px`,
              top: `${ctx.hoveredColor.anchorRect.top + ctx.hoveredColor.anchorRect.height / 2}px`,
              transform: 'translateY(-50%)',
            }}
          />,
          document.body,
        )}
    </Popover>
  );
}
