/**
 * @file Component colors strip + recent colors strip
 *
 * Accessed via: Internal component, rendered inside LinkedColorPicker
 * Assumptions: engine available for Shift+Click selection and Cmd+Click code navigation
 */

import cn from 'clsx';
import { useColorPickerContext } from './color-picker-context';
import type { ColorEntry } from './extract-component-colors';
import type { RecentColor } from './hooks/use-recent-colors';
import { isModifierPressed } from './platform-keys';

interface ColorStripBarProps {
  componentColors: ColorEntry[];
  recentColors: RecentColor[];
}

export function ColorStripBar({ componentColors, recentColors }: ColorStripBarProps) {
  const ctx = useColorPickerContext();

  if (componentColors.length === 0 && recentColors.length === 0) return null;

  return (
    <div
      className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border overflow-x-auto"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      {componentColors.map((entry) => (
        <button
          key={`comp-${entry.hex}`}
          type="button"
          onMouseEnter={(e) =>
            ctx.handleColorHover(
              entry.isToken ? entry.value : entry.hex,
              entry.hex,
              e.currentTarget,
              entry.line && ctx.componentPath ? `${ctx.componentPath.split('/').pop()}:${entry.line}` : undefined,
              entry.pairedHex || ctx.contrastPairedHex,
              entry.source === 'text' || (!entry.source && ctx.contrastRole === 'text'),
            )
          }
          onMouseLeave={ctx.handleColorLeave}
          onClick={(e) => {
            // Shift+Click -> select all elements using this color
            if (e.shiftKey && ctx.engine && entry.nodeIds.length > 0) {
              ctx.engine.selectMultiple(entry.nodeIds);
              return;
            }
            // Cmd/Ctrl+Click -> navigate to source code
            if (isModifierPressed(e) && ctx.componentPath && entry.line) {
              ctx.setOpen(false);
              if (ctx.engine) {
                ctx.engine.setMode('code');
                requestAnimationFrame(() => {
                  window.dispatchEvent(
                    new CustomEvent('monaco-goto-position', {
                      detail: { line: entry.line, column: 1, filePath: ctx.componentPath },
                    }),
                  );
                });
              }
              return;
            }
            if (entry.isToken) {
              ctx.handleSelect(entry.value);
            } else {
              ctx.onChange(entry.hex);
              ctx.addRecentColor(entry.hex);
              ctx.setOpen(false);
            }
          }}
          className={cn(
            'w-5 h-5 rounded-full border shrink-0 transition-all hover:scale-110',
            ctx.currentHex === entry.hex
              ? 'border-foreground ring-1 ring-foreground ring-offset-1 ring-offset-background'
              : 'border-border hover:border-muted-foreground',
          )}
          style={{ backgroundColor: entry.hex }}
        />
      ))}
      {componentColors.length > 0 && recentColors.length > 0 && <div className="w-px h-4 bg-border shrink-0 mx-0.5" />}
      {recentColors.map((rc) => (
        <button
          key={`recent-${rc.hex}`}
          type="button"
          onMouseEnter={(e) =>
            ctx.handleColorHover(
              rc.token || rc.hex,
              rc.hex,
              e.currentTarget,
              undefined,
              ctx.contrastPairedHex,
              ctx.contrastRole === 'text',
            )
          }
          onMouseLeave={ctx.handleColorLeave}
          onClick={() => {
            if (rc.token) {
              ctx.handleSelect(rc.token);
            } else {
              ctx.onChange(rc.hex);
              ctx.setOpen(false);
            }
          }}
          className={cn(
            'w-5 h-5 rounded-full border shrink-0 transition-all hover:scale-110',
            ctx.currentHex === rc.hex
              ? 'border-foreground ring-1 ring-foreground ring-offset-1 ring-offset-background'
              : 'border-border/50 hover:border-muted-foreground',
          )}
          style={{ backgroundColor: rc.hex }}
        />
      ))}
    </div>
  );
}
