/**
 * @file Unlinked (hex) mode color picker — native input + text hex input
 *
 * Accessed via: Internal component, rendered by ColorCombobox when isLinked=false
 */

import { Input } from '@/components/ui/input';
import { useColorPickerContext } from './color-picker-context';
import { ColorSwatch } from './color-swatch';
import { ContrastBadge } from './contrast-badge';

interface UnlinkedColorPickerProps {
  inputPlaceholder: string;
  inputTestId?: string;
}

export function UnlinkedColorPicker({ inputPlaceholder, inputTestId }: UnlinkedColorPickerProps) {
  const ctx = useColorPickerContext();
  const displayHex = ctx.currentHex?.replace('#', '') || '';

  return (
    <div className="flex items-center gap-0 h-6 bg-muted rounded-l flex-1">
      <label className="relative cursor-pointer px-2">
        <input
          type="color"
          value={ctx.currentHex || '#000000'}
          onChange={(e) => ctx.onChange(e.target.value)}
          className="absolute opacity-0 w-0 h-0"
        />
        <ColorSwatch hex={ctx.currentHex} className="cursor-pointer" />
      </label>
      <Input
        type="text"
        testId={inputTestId}
        value={displayHex}
        placeholder={inputPlaceholder}
        onChange={(e) => ctx.handleHexInput(e.target.value)}
        className="h-6 border-0 bg-transparent !text-[11px] text-foreground p-0 px-1 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 font-mono"
      />
      {ctx.contrastPairedHex && ctx.currentHex?.startsWith('#') && (
        <ContrastBadge
          hex={ctx.currentHex}
          pairedHex={ctx.contrastPairedHex}
          isTextColor={ctx.contrastRole === 'text'}
        />
      )}
    </div>
  );
}
