/**
 * @file Color combobox — wiring component that composes hooks, context, and sub-components
 *
 * Accessed via: Properties panel > Fill/Text color sections
 * Assumptions: tokenSystem determines which color palette is used (Tailwind or Tamagui)
 */

import { hexWithAlpha } from '@shared/utils/color';
import { IconLink, IconLinkOff } from '@tabler/icons-react';
import cn from 'clsx';
import * as React from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine/core/CanvasEngine';
import { type ColorPickerContextValue, ColorPickerProvider } from './color-picker-context';
import type { TokenSystem } from './color-utils';
import { generateColorOptions, getColorGroups } from './color-utils';
import { useColorKeyboard } from './hooks/use-color-keyboard';
import { useColorSearch } from './hooks/use-color-search';
import { useColorTooltip } from './hooks/use-color-tooltip';
import { useColorValue } from './hooks/use-color-value';
import { useComponentColors } from './hooks/use-component-colors';
import { useRecentColors } from './hooks/use-recent-colors';
import { LinkedColorPicker } from './linked-color-picker';
import { OpacityInput, shouldShowOpacity } from './opacity-input';
import { UnlinkedColorPicker } from './unlinked-color-picker';

// Re-export for external consumers
export type { TokenSystem } from './color-utils';
export { findNearestPassingColor } from './color-utils';

interface ColorComboboxProps {
  value: string;
  onChange: (value: string) => void;
  inputPlaceholder?: string;
  className?: string;
  tokenSystem: TokenSystem;
  beforeUnlinkSlot?: React.ReactNode;
  isUnlinked?: boolean;
  testId?: string;
  inputTestId?: string;
  engine?: CanvasEngine | null;
  componentPath?: string | null;
  opacity?: string;
  onOpacityChange?: (value: string) => void;
  contrastPairedHex?: string;
  contrastRole?: 'text' | 'bg';
}

export function ColorCombobox({
  value,
  onChange,
  inputPlaceholder = 'none',
  className,
  tokenSystem,
  beforeUnlinkSlot,
  isUnlinked: controlledIsUnlinked,
  testId,
  inputTestId,
  engine,
  componentPath,
  opacity,
  onOpacityChange,
  contrastPairedHex,
  contrastRole,
}: ColorComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  // Disable contrast when opacity is not 100%
  const effectiveContrastPaired = opacity && opacity !== '100' ? undefined : contrastPairedHex;

  const colorOptions = React.useMemo(() => generateColorOptions(tokenSystem), [tokenSystem]);
  const colorGroups = React.useMemo(() => getColorGroups(colorOptions), [colorOptions]);
  const componentColors = useComponentColors(engine ?? null, componentPath ?? null, tokenSystem);
  const { recentColors, addRecentColor } = useRecentColors();

  const tooltip = useColorTooltip();
  const colorValue = useColorValue(value, tokenSystem, controlledIsUnlinked, onChange, addRecentColor);
  const colorSearch = useColorSearch(search, colorGroups);

  // Refs for keyboard handler (avoid deps churn)
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const addRecentColorRef = React.useRef(addRecentColor);
  addRecentColorRef.current = addRecentColor;

  useColorKeyboard({
    tooltip,
    open,
    search,
    filteredGroups: colorSearch.filteredGroups,
    colorGroups,
    colorOptions,
    tokenSystem,
    effectiveContrastPaired,
    contrastRole,
    isLinkedRef: colorValue.isLinkedRef,
    currentHexRef: colorValue.currentHexRef,
    onChangeRef,
    addRecentColorRef,
    setOpen,
  });

  // Recent colors filtered to exclude duplicates with component colors
  const recentColorsFiltered = React.useMemo(() => {
    const compHexes = new Set(componentColors.map((c) => c.hex.toLowerCase()));
    return recentColors.filter((rc) => !compHexes.has(rc.hex.toLowerCase()));
  }, [recentColors, componentColors]);

  // Scroll to current color group when popover opens
  React.useEffect(() => {
    if (!open || !colorValue.currentToken) return;
    requestAnimationFrame(() => {
      const swatches = tooltip.popoverContentRef.current?.querySelectorAll('button[style]');
      if (!swatches) return;
      for (const swatch of swatches) {
        if (swatch.classList.contains('ring-1')) {
          swatch.scrollIntoView({ block: 'center', behavior: 'instant' });
          return;
        }
      }
    });
  }, [open, colorValue.currentToken, tooltip.popoverContentRef]);

  // Cross-concern callbacks
  const resetPopoverState = React.useCallback(() => {
    setSearch('');
    tooltip.setHoveredColor(null);
    tooltip.setCopyMode(false);
    tooltip.setFocusedValue(null);
    tooltip.resetLastCommandValue();
  }, [tooltip]);

  // Wrap handleSelect to also close popover
  const handleSelectAndClose = React.useCallback(
    (token: string) => {
      colorValue.handleSelect(token);
      setOpen(false);
      resetPopoverState();
    },
    [colorValue, resetPopoverState],
  );

  const ctx: ColorPickerContextValue = {
    tokenSystem,
    colorOptions,
    colorGroups,
    contrastPairedHex: effectiveContrastPaired,
    contrastRole,
    engine: engine ?? null,
    componentPath: componentPath ?? null,
    value,
    onChange,
    open,
    setOpen,
    hoveredColor: tooltip.hoveredColor,
    copyMode: tooltip.copyMode,
    focusedValue: tooltip.focusedValue,
    handleColorHover: tooltip.handleColorHover,
    handleColorLeave: tooltip.handleColorLeave,
    popoverContentRef: tooltip.popoverContentRef,
    infoPanelRef: tooltip.infoPanelRef,
    search,
    setSearch,
    parsedSearchColor: colorSearch.parsedSearchColor,
    filteredGroups: colorSearch.filteredGroups,
    isSearching: colorSearch.isSearching,
    hasResults: colorSearch.hasResults,
    highlightMatch: colorSearch.highlightMatch,
    isLinked: colorValue.isLinked,
    currentHex: colorValue.currentHex,
    currentToken: colorValue.currentToken,
    handleSelect: handleSelectAndClose,
    handleUnlinkToggle: colorValue.handleUnlinkToggle,
    handleHexInput: colorValue.handleHexInput,
    addRecentColor,
    resetPopoverState,
  };

  return (
    <ColorPickerProvider value={ctx}>
      <div
        className={cn('flex items-center gap-0.5', className)}
        {...(testId != null ? { 'data-testid': testId } : {})}
      >
        {colorValue.isLinked ? (
          <LinkedColorPicker componentColors={componentColors} recentColors={recentColorsFiltered} />
        ) : (
          <UnlinkedColorPicker inputPlaceholder={inputPlaceholder} inputTestId={inputTestId} />
        )}

        {shouldShowOpacity(colorValue.isLinked, tokenSystem) && opacity !== undefined && onOpacityChange && (
          <OpacityInput
            value={opacity}
            onChange={(newOpacity) => {
              onOpacityChange(newOpacity);
              if (colorValue.currentHex?.startsWith('#')) {
                onChange(hexWithAlpha(colorValue.currentHex, newOpacity || '100'));
              }
            }}
          />
        )}
        {beforeUnlinkSlot}

        <button
          type="button"
          data-testid={inputTestId ? `${inputTestId}-link-toggle` : undefined}
          onClick={colorValue.handleUnlinkToggle}
          title={colorValue.isLinked ? `Unlink from ${tokenSystem} tokens` : `Link to nearest ${tokenSystem} token`}
          className={cn(
            'h-6 px-1.5 flex items-center justify-center transition-colors',
            beforeUnlinkSlot ? 'rounded' : 'rounded-r',
            colorValue.isLinked
              ? 'bg-muted hover:bg-accent text-muted-foreground'
              : 'bg-amber-100 hover:bg-amber-200 text-amber-700 dark:bg-amber-900/50 dark:hover:bg-amber-900 dark:text-amber-400',
          )}
        >
          {colorValue.isLinked ? (
            <IconLink className="w-3.5 h-3.5" stroke={1.5} />
          ) : (
            <IconLinkOff className="w-3.5 h-3.5" stroke={1.5} />
          )}
        </button>
      </div>
    </ColorPickerProvider>
  );
}
