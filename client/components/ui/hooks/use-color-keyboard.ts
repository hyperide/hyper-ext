/**
 * @file Composite keyboard handler for the color picker
 *
 * Accessed via: Internal hook, used by ColorCombobox wiring
 * Assumptions: popoverContentRef contains cmdk elements with aria-selected and data-value
 *
 * Handler chain: Enter (focusedValue apply) -> Backspace (clear) ->
 * handleContrastKey -> handleCopyKey
 *
 * Arrow nav tooltip: separate effect on popover container keydown.
 */

import { useEffect, useRef } from 'react';
import type { ColorOption, SearchResult, TokenSystem } from '../color-utils';
import { useColorCopy } from './use-color-copy';
import type { ColorTooltipState } from './use-color-tooltip';
import { useContrastFix } from './use-contrast-fix';

export interface ColorKeyboardParams {
  tooltip: ColorTooltipState;
  open: boolean;
  search: string;
  filteredGroups: Record<string, SearchResult[]>;
  colorGroups: Record<string, ColorOption[]>;
  colorOptions: ColorOption[];
  tokenSystem: TokenSystem;
  effectiveContrastPaired: string | undefined;
  contrastRole: 'text' | 'bg' | undefined;
  isLinkedRef: React.MutableRefObject<boolean>;
  currentHexRef: React.MutableRefObject<string>;
  onChangeRef: React.MutableRefObject<(value: string) => void>;
  addRecentColorRef: React.MutableRefObject<(hex: string, token?: string) => void>;
  setOpen: (open: boolean) => void;
}

export function useColorKeyboard(params: ColorKeyboardParams): void {
  const {
    tooltip,
    open,
    search,
    filteredGroups,
    colorGroups,
    colorOptions,
    tokenSystem,
    effectiveContrastPaired,
    contrastRole,
    isLinkedRef,
    currentHexRef,
    onChangeRef,
    addRecentColorRef,
    setOpen,
  } = params;

  const openRef = useRef(open);
  openRef.current = open;
  const searchRef = useRef(search);
  searchRef.current = search;
  const effectiveContrastPairedRef = useRef(effectiveContrastPaired);
  effectiveContrastPairedRef.current = effectiveContrastPaired;

  const { handleContrastKey } = useContrastFix({
    colorOptions,
    tokenSystem,
    hoveredColorRef: tooltip.hoveredColorRef,
    isLinkedRef,
    currentHexRef,
    effectiveContrastPairedRef,
    popoverContentRef: tooltip.popoverContentRef,
    handleColorHover: tooltip.handleColorHover,
    setFocusedValue: tooltip.setFocusedValue,
    onChangeRef,
    addRecentColorRef,
  });

  const { handleCopyKey } = useColorCopy({
    hoveredColorRef: tooltip.hoveredColorRef,
    copyModeRef: tooltip.copyModeRef,
    setCopyMode: tooltip.setCopyMode,
    copyModeTimerRef: tooltip.copyModeTimerRef,
  });

  // Global keydown listener — reads state via refs to avoid re-attach on hover/search changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are intentionally used to avoid re-attaching the listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Enter: apply contrast-fix focused color
      if (e.key === 'Enter' && tooltip.focusedValueRef.current) {
        e.preventDefault();
        e.stopPropagation();
        const el = tooltip.popoverContentRef.current?.querySelector(
          `[data-color-value="${tooltip.focusedValueRef.current}"]`,
        ) as HTMLElement | null;
        if (el) el.click();
        return;
      }

      // Backspace with empty search in open popover: clear color value
      if (e.key === 'Backspace' && openRef.current && searchRef.current === '') {
        e.preventDefault();
        e.stopPropagation();
        onChangeRef.current('');
        setOpen(false);
        return;
      }

      if (handleContrastKey(e)) return;
      handleCopyKey(e);
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleContrastKey, handleCopyKey, setOpen, tooltip]);

  // Arrow nav tooltip — show tooltip when arrow keys navigate Command items
  useEffect(() => {
    if (!open) return;
    const container = tooltip.popoverContentRef.current;
    if (!container) return;

    const handleArrowNav = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      requestAnimationFrame(() => {
        const el = container.querySelector('[aria-selected="true"]') as HTMLElement | null;
        if (!el) return;

        const val = el.getAttribute('data-value');
        if (!val || val === tooltip.lastCommandValueRef.current) return;
        tooltip.lastCommandValueRef.current = val;

        const searching = search.trim().length > 0;
        const allOptions = Object.values(searching ? filteredGroups : colorGroups).flat();
        const option = allOptions.find((o) => o.value === val);
        if (!option) return;

        if (tooltip.leaveTimerRef.current) {
          clearTimeout(tooltip.leaveTimerRef.current);
          tooltip.leaveTimerRef.current = null;
        }
        tooltip.setHoveredColor({
          tokenName: tokenSystem === 'tamagui' ? `$${option.value}` : option.value,
          hex: option.hex,
          pairedHex: effectiveContrastPaired,
          isTextColor: contrastRole === 'text',
          anchorRect: el.getBoundingClientRect(),
        });
      });
    };

    container.addEventListener('keydown', handleArrowNav);
    return () => container.removeEventListener('keydown', handleArrowNav);
  }, [open, search, filteredGroups, colorGroups, tokenSystem, effectiveContrastPaired, contrastRole, tooltip]);
}
