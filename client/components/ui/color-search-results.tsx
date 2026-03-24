/**
 * @file Search results list view for the color picker
 *
 * Accessed via: Internal component, rendered inside LinkedColorPicker CommandList (search mode)
 */

import { IconCheck } from '@tabler/icons-react';
import cn from 'clsx';
import { CommandGroup, CommandItem } from '@/components/ui/command';
import { useColorPickerContext } from './color-picker-context';
import { ColorSwatch } from './color-swatch';
import type { SearchResult } from './color-utils';

const COLOR_SEARCH_DISTANCE_THRESHOLD = 40;

export function ColorSearchResults() {
  const ctx = useColorPickerContext();
  const { filteredGroups, parsedSearchColor, tokenSystem, currentToken, value } = ctx;

  return (
    <>
      {Object.entries(filteredGroups).map(([groupName, options]) => (
        <CommandGroup
          key={groupName}
          heading={groupName === 'special' ? 'Basic' : groupName.charAt(0).toUpperCase() + groupName.slice(1)}
        >
          {(options as SearchResult[]).map((option) => {
            const { _distance: distance, _textMatch: isTextMatch } = option;
            const isExactColor = parsedSearchColor && distance === 0;
            const isSimilarColor = !isTextMatch && distance < COLOR_SEARCH_DISTANCE_THRESHOLD && !isExactColor;
            const tokenLabel = tokenSystem === 'tamagui' ? `$${option.label}` : option.label;

            return (
              <CommandItem
                key={option.value}
                value={option.value}
                onSelect={() => ctx.handleSelect(option.value)}
                onMouseEnter={(e) =>
                  ctx.handleColorHover(
                    tokenSystem === 'tamagui' ? `$${option.value}` : option.value,
                    option.hex,
                    e.currentTarget,
                    undefined,
                    ctx.contrastPairedHex,
                    ctx.contrastRole === 'text',
                  )
                }
                onMouseLeave={ctx.handleColorLeave}
                className={cn(
                  'flex items-center gap-2 cursor-pointer',
                  isExactColor && 'bg-amber-50 dark:bg-amber-950/30',
                )}
              >
                <ColorSwatch hex={option.hex} value={option.value} size="md" />
                <span className="flex-1 text-xs truncate">
                  {isTextMatch ? ctx.highlightMatch(tokenLabel) : tokenLabel}
                  <span className="text-muted-foreground ml-1">
                    {isExactColor && parsedSearchColor ? (
                      <mark className="bg-yellow-200 dark:bg-yellow-700 text-inherit rounded-sm px-0.5">
                        {parsedSearchColor.format === 'hex' || parsedSearchColor.format === 'hex-short'
                          ? option.hex
                          : parsedSearchColor.original}
                      </mark>
                    ) : isTextMatch ? (
                      ctx.highlightMatch(option.hex)
                    ) : (
                      option.hex
                    )}
                  </span>
                </span>
                {isExactColor && parsedSearchColor && (
                  <span className="text-[10px] bg-muted text-muted-foreground px-1 rounded shrink-0">exact</span>
                )}
                {isSimilarColor && (
                  <span className="text-[10px] bg-muted text-muted-foreground px-1 rounded shrink-0">similar</span>
                )}
                {(option.value === 'none' ? !value : currentToken === option.value) && (
                  <IconCheck className="w-4 h-4 text-green-600 shrink-0" stroke={2} />
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>
      ))}
    </>
  );
}
