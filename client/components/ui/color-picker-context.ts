/**
 * @file React context for the color picker system
 *
 * Accessed via: Internal module, shared between ColorCombobox sub-components
 * Assumptions: must be used within ColorPickerProvider
 */

import type { RefObject } from 'react';
import { createContext, useContext } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine/core/CanvasEngine';
import type { ParsedColorInput } from './color-search-parser';
import type { ColorOption, HoveredColorState, SearchResult, TokenSystem } from './color-utils';

export interface ColorPickerContextValue {
  // Props forwarded
  tokenSystem: TokenSystem;
  colorOptions: ColorOption[];
  colorGroups: Record<string, ColorOption[]>;
  contrastPairedHex: string | undefined;
  contrastRole: 'text' | 'bg' | undefined;
  engine: CanvasEngine | null;
  componentPath: string | null;
  value: string;
  onChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;

  // useColorTooltip
  hoveredColor: HoveredColorState | null;
  copyMode: boolean;
  focusedValue: string | null;
  handleColorHover: (
    tokenName: string,
    hex: string,
    el: HTMLElement,
    sourceLabel?: string,
    pairedHex?: string,
    isTextColor?: boolean,
  ) => void;
  handleColorLeave: () => void;
  popoverContentRef: RefObject<HTMLDivElement>;
  infoPanelRef: RefObject<HTMLDivElement>;

  // useColorSearch
  search: string;
  setSearch: (value: string) => void;
  parsedSearchColor: ParsedColorInput | null;
  filteredGroups: Record<string, SearchResult[]>;
  isSearching: boolean;
  hasResults: boolean;
  highlightMatch: (text: string) => React.ReactNode;

  // useColorValue
  isLinked: boolean;
  currentHex: string;
  currentToken: string | null;
  handleSelect: (token: string) => void;
  handleUnlinkToggle: () => void;
  handleHexInput: (value: string) => void;

  // useRecentColors (forwarded)
  addRecentColor: (hex: string, token?: string) => void;

  // Popover lifecycle
  resetPopoverState: () => void;
}

const ColorPickerContext = createContext<ColorPickerContextValue | null>(null);

export const ColorPickerProvider = ColorPickerContext.Provider;

export function useColorPickerContext(): ColorPickerContextValue {
  const ctx = useContext(ColorPickerContext);
  if (!ctx) {
    throw new Error('useColorPickerContext must be used within ColorPickerProvider');
  }
  return ctx;
}
