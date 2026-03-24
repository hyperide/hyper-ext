/**
 * @file Grid view of color palette groups (non-search mode)
 *
 * Accessed via: Internal component, rendered inside LinkedColorPicker CommandList
 * Assumptions: renders data-color-value attributes on swatch buttons —
 *   useContrastFix queries these for scroll-to and tooltip positioning.
 */

import { IconBackspace, IconCheck } from '@tabler/icons-react';
import cn from 'clsx';
import { CommandGroup, CommandItem } from '@/components/ui/command';
import { useColorPickerContext } from './color-picker-context';
import { ColorSwatch } from './color-swatch';
import { isModifierPressed } from './platform-keys';

export function ColorPaletteGrid() {
  const ctx = useColorPickerContext();
  const { filteredGroups, tokenSystem, currentToken, focusedValue, value } = ctx;

  return (
    <>
      {/* Special colors group (Tailwind only) */}
      {tokenSystem === 'tailwind' && filteredGroups.special && (
        <CommandGroup heading="Basic">
          {filteredGroups.special.map((option) => (
            <CommandItem
              key={option.value}
              value={option.value}
              onSelect={() => ctx.handleSelect(option.value)}
              onMouseEnter={(e) =>
                option.value !== 'none' &&
                ctx.handleColorHover(
                  option.value,
                  option.hex,
                  e.currentTarget,
                  undefined,
                  ctx.contrastPairedHex,
                  ctx.contrastRole === 'text',
                )
              }
              onMouseLeave={ctx.handleColorLeave}
              className="flex items-center gap-2 cursor-pointer"
            >
              <ColorSwatch hex={option.hex} value={option.value} size="md" />
              <span className="flex-1 text-xs">{option.label}</span>
              {option.value === 'none' && (
                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted px-1 rounded">
                  <IconBackspace className="w-3 h-3" stroke={1.5} />
                  Backspace
                </span>
              )}
              {(option.value === 'none' ? !value : currentToken === option.value) && (
                <IconCheck className="w-4 h-4 text-green-600" stroke={2} />
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {/* Color palette groups - grid view */}
      {Object.entries(filteredGroups)
        .filter(([name]) => name !== 'special')
        .map(([colorName, options]) => (
          <CommandGroup key={colorName} heading={colorName.charAt(0).toUpperCase() + colorName.slice(1)}>
            <div className={cn('grid gap-0.5 p-1', tokenSystem === 'tamagui' ? 'grid-cols-12' : 'grid-cols-11')}>
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  data-color-value={option.value}
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
                  onClick={(e) => {
                    if (isModifierPressed(e)) {
                      ctx.onChange(option.hex);
                      ctx.addRecentColor(option.hex, option.value);
                      ctx.setOpen(false);
                      return;
                    }
                    ctx.handleSelect(option.value);
                  }}
                  className={cn(
                    'w-5 h-5 rounded border transition-all hover:scale-110 hover:z-10',
                    focusedValue === option.value
                      ? 'border-primary ring-2 ring-primary/50 ring-offset-1 ring-offset-background'
                      : currentToken === option.value
                        ? 'border-foreground ring-1 ring-foreground ring-offset-1 ring-offset-background'
                        : 'border-border hover:border-muted-foreground',
                  )}
                  style={{ backgroundColor: option.hex }}
                />
              ))}
            </div>
          </CommandGroup>
        ))}
    </>
  );
}
