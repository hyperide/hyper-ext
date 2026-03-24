/**
 * @file Search and filter logic for the color picker
 *
 * Accessed via: Internal hook, used by ColorCombobox wiring
 * Assumptions: parseColorInput handles all supported color formats
 */

import { colorDistance } from '@shared/utils/color';
import { useCallback, useMemo } from 'react';
import { type ParsedColorInput, parseColorInput } from '../color-search-parser';
import type { ColorOption, SearchResult } from '../color-utils';

const COLOR_SEARCH_DISTANCE_THRESHOLD = 40;

export interface ColorSearchState {
  parsedSearchColor: ParsedColorInput | null;
  filteredGroups: Record<string, SearchResult[]>;
  isSearching: boolean;
  hasResults: boolean;
  highlightMatch: (text: string) => React.ReactNode;
}

/** Filter color groups by text query and/or color proximity. Pure function. */
export function filterColorGroups(
  search: string,
  colorGroups: Record<string, ColorOption[]>,
  parsedSearchColor: ParsedColorInput | null,
): Record<string, SearchResult[]> {
  if (!search.trim()) return colorGroups as Record<string, SearchResult[]>;
  const query = search.toLowerCase().trim();

  // Text-based search: filter by token name or group name
  const textFiltered: Record<string, SearchResult[]> = {};
  for (const [groupName, options] of Object.entries(colorGroups)) {
    const groupMatches = groupName.toLowerCase().includes(query);
    if (groupMatches) {
      textFiltered[groupName] = options.map((opt) => ({ ...opt, _distance: Infinity, _textMatch: true }));
    } else {
      const matching = options.filter(
        (opt) => opt.value.toLowerCase().includes(query) || opt.label.toLowerCase().includes(query),
      );
      if (matching.length > 0) {
        textFiltered[groupName] = matching.map((opt) => ({ ...opt, _distance: Infinity, _textMatch: true }));
      }
    }
  }

  // If no color search, return text results only
  if (!parsedSearchColor) return textFiltered;

  // Color-proximity search: add "similar color" matches not already in text results
  const textMatchKeys = new Set<string>();
  for (const options of Object.values(textFiltered)) {
    for (const opt of options) textMatchKeys.add(opt.value);
  }

  const colorFiltered: Record<string, SearchResult[]> = {};
  for (const [groupName, options] of Object.entries(colorGroups)) {
    const withDistance = options
      .filter((opt) => !textMatchKeys.has(opt.value))
      .map(
        (opt): SearchResult => ({
          ...opt,
          _distance: colorDistance(parsedSearchColor.hex, opt.hex),
          _textMatch: false,
        }),
      )
      .filter((opt) => opt._distance < COLOR_SEARCH_DISTANCE_THRESHOLD);
    if (withDistance.length > 0) {
      withDistance.sort((a, b) => a._distance - b._distance);
      colorFiltered[groupName] = withDistance;
    }
  }

  // Merge: text results first, then color-similar results
  const merged: Record<string, SearchResult[]> = { ...textFiltered };
  for (const [groupName, options] of Object.entries(colorFiltered)) {
    if (merged[groupName]) {
      merged[groupName] = [...merged[groupName], ...options];
    } else {
      merged[groupName] = options;
    }
  }

  // Move group with exact color match to top, exact match color first within it
  if (parsedSearchColor) {
    let exactGroup: string | null = null;
    for (const [groupName, options] of Object.entries(merged)) {
      const exactIdx = options.findIndex((opt) => opt._distance === 0);
      if (exactIdx !== -1) {
        exactGroup = groupName;
        if (exactIdx > 0) {
          const [exact] = options.splice(exactIdx, 1);
          options.unshift(exact);
        }
        break;
      }
    }
    if (exactGroup) {
      const reordered: Record<string, SearchResult[]> = {};
      reordered[exactGroup] = merged[exactGroup];
      for (const [groupName, options] of Object.entries(merged)) {
        if (groupName !== exactGroup) reordered[groupName] = options;
      }
      return reordered;
    }
  }

  return merged;
}

export function useColorSearch(search: string, colorGroups: Record<string, ColorOption[]>): ColorSearchState {
  const parsedSearchColor = useMemo(() => {
    return search.trim() ? parseColorInput(search.trim()) : null;
  }, [search]);

  const filteredGroups = useMemo(
    () => filterColorGroups(search, colorGroups, parsedSearchColor),
    [search, colorGroups, parsedSearchColor],
  );

  const isSearching = search.trim().length > 0;
  const hasResults = Object.keys(filteredGroups).length > 0;

  const highlightMatch = useCallback(
    (text: string) => {
      if (!isSearching) return text;
      const query = search.toLowerCase().trim();
      const idx = text.toLowerCase().indexOf(query);
      if (idx === -1) return text;

      return (
        <>
          {text.slice(0, idx)}
          <mark className="bg-yellow-200 dark:bg-yellow-700 text-inherit rounded-sm px-0.5">
            {text.slice(idx, idx + query.length)}
          </mark>
          {text.slice(idx + query.length)}
        </>
      );
    },
    [isSearching, search],
  );

  return {
    parsedSearchColor,
    filteredGroups,
    isSearching,
    hasResults,
    highlightMatch,
  };
}
