import { describe, expect, test } from 'bun:test';
import { renderHook } from '@testing-library/react';
import type { ColorOption } from '../color-utils';
import { filterColorGroups, useColorSearch } from './use-color-search';

const opt = (value: string, hex: string, colorName: string): ColorOption => ({
  value,
  hex,
  label: value,
  colorName,
});

const groups: Record<string, ColorOption[]> = {
  red: [opt('red-400', '#f87171', 'red'), opt('red-500', '#ef4444', 'red'), opt('red-600', '#dc2626', 'red')],
  blue: [opt('blue-400', '#60a5fa', 'blue'), opt('blue-500', '#3b82f6', 'blue'), opt('blue-600', '#2563eb', 'blue')],
  green: [opt('green-500', '#22c55e', 'green')],
};

// --- filterColorGroups (pure function) ---

describe('filterColorGroups', () => {
  test('returns all groups unchanged when search is empty', () => {
    const result = filterColorGroups('', groups, null);
    expect(Object.keys(result)).toEqual(['red', 'blue', 'green']);
    expect(result.red).toHaveLength(3);
  });

  test('returns all groups unchanged when search is whitespace', () => {
    const result = filterColorGroups('   ', groups, null);
    expect(Object.keys(result)).toEqual(['red', 'blue', 'green']);
  });

  test('filters by group name match — returns all options in group', () => {
    const result = filterColorGroups('red', groups, null);
    expect(Object.keys(result)).toEqual(['red']);
    expect(result.red).toHaveLength(3);
    expect(result.red[0]._textMatch).toBe(true);
  });

  test('is case-insensitive for group name', () => {
    const result = filterColorGroups('RED', groups, null);
    expect(Object.keys(result)).toEqual(['red']);
  });

  test('filters by token value match across groups', () => {
    const result = filterColorGroups('500', groups, null);
    expect(Object.keys(result)).toEqual(['red', 'blue', 'green']);
    expect(result.red).toHaveLength(1);
    expect(result.red[0].value).toBe('red-500');
  });

  test('filters by label match', () => {
    const result = filterColorGroups('blue-6', groups, null);
    expect(result.blue).toHaveLength(1);
    expect(result.blue[0].value).toBe('blue-600');
  });

  test('returns empty when no text match and no color search', () => {
    const result = filterColorGroups('nonexistent', groups, null);
    expect(Object.keys(result)).toHaveLength(0);
  });

  test('finds exact color match by hex proximity', () => {
    const result = filterColorGroups('xyz', groups, { hex: '#ef4444', original: '#ef4444', format: 'hex' });
    expect(result.red).toBeDefined();
    const exact = result.red.find((o) => o.value === 'red-500');
    expect(exact).toBeDefined();
    expect(exact?._distance).toBe(0);
    expect(exact?._textMatch).toBe(false);
  });

  test('finds similar colors within threshold', () => {
    const result = filterColorGroups('xyz', groups, { hex: '#ee4343', original: '#ee4343', format: 'hex' });
    expect(result.red).toBeDefined();
    const close = result.red.find((o) => o.value === 'red-500');
    expect(close).toBeDefined();
    expect(close?._distance).toBeGreaterThan(0);
    expect(close?._distance).toBeLessThan(40);
  });

  test('excludes colors beyond distance threshold', () => {
    const result = filterColorGroups('xyz', groups, { hex: '#000000', original: '#000000', format: 'hex' });
    for (const opts of Object.values(result)) {
      for (const o of opts) {
        expect(o._distance).toBeLessThan(40);
      }
    }
  });

  test('sorts color proximity results by distance within group', () => {
    const result = filterColorGroups('xyz', groups, { hex: '#ef4444', original: '#ef4444', format: 'hex' });
    if (result.red && result.red.length > 1) {
      for (let i = 1; i < result.red.length; i++) {
        expect(result.red[i]._distance).toBeGreaterThanOrEqual(result.red[i - 1]._distance);
      }
    }
  });

  test('moves exact color match group to top', () => {
    const result = filterColorGroups('xyz', groups, { hex: '#3b82f6', original: '#3b82f6', format: 'hex' });
    const keys = Object.keys(result);
    expect(keys[0]).toBe('blue');
  });

  test('exact match color is first within its group', () => {
    const customGroups: Record<string, ColorOption[]> = {
      gray: [opt('gray-100', '#f3f4f6', 'gray'), opt('gray-500', '#6b7280', 'gray')],
    };
    const result = filterColorGroups('xyz', customGroups, { hex: '#6b7280', original: '#6b7280', format: 'hex' });
    if (result.gray) {
      expect(result.gray[0].value).toBe('gray-500');
      expect(result.gray[0]._distance).toBe(0);
    }
  });

  test('merges text and color results without duplicates', () => {
    const result = filterColorGroups('red', groups, { hex: '#ef4444', original: '#ef4444', format: 'hex' });
    expect(result.red).toBeDefined();
    const red500Count = result.red.filter((o) => o.value === 'red-500').length;
    expect(red500Count).toBe(1);
  });

  test('text matches appear before color proximity matches in merged group', () => {
    const result = filterColorGroups('red-4', groups, { hex: '#f87171', original: '#f87171', format: 'hex' });
    if (result.red && result.red.length > 0) {
      expect(result.red[0]._textMatch).toBe(true);
    }
  });

  test('color results create new group when no text match in that group', () => {
    const result = filterColorGroups('red', groups, { hex: '#3b82f6', original: '#3b82f6', format: 'hex' });
    expect(result.red).toBeDefined();
    expect(result.blue).toBeDefined();
  });

  test('returns only text results when parsedSearchColor is null', () => {
    const result = filterColorGroups('blue', groups, null);
    expect(result.blue).toHaveLength(3);
    for (const o of result.blue) {
      expect(o._textMatch).toBe(true);
    }
  });
});

// --- useColorSearch (React hook) ---

describe('useColorSearch', () => {
  test('returns all groups when search is empty', () => {
    const { result } = renderHook(() => useColorSearch('', groups));
    expect(result.current.isSearching).toBe(false);
    expect(result.current.hasResults).toBe(true);
    expect(result.current.parsedSearchColor).toBeNull();
    expect(Object.keys(result.current.filteredGroups)).toEqual(['red', 'blue', 'green']);
  });

  test('isSearching is true when search has content', () => {
    const { result } = renderHook(() => useColorSearch('red', groups));
    expect(result.current.isSearching).toBe(true);
  });

  test('hasResults is false when no match', () => {
    const { result } = renderHook(() => useColorSearch('nonexistent', groups));
    expect(result.current.hasResults).toBe(false);
  });

  test('parsedSearchColor is set for hex input', () => {
    const { result } = renderHook(() => useColorSearch('#ff0000', groups));
    expect(result.current.parsedSearchColor).not.toBeNull();
    expect(result.current.parsedSearchColor?.hex).toBe('#ff0000');
  });

  test('parsedSearchColor is null for non-color text', () => {
    const { result } = renderHook(() => useColorSearch('red', groups));
    expect(result.current.parsedSearchColor).toBeNull();
  });

  test('highlightMatch returns text as-is when not searching', () => {
    const { result } = renderHook(() => useColorSearch('', groups));
    expect(result.current.highlightMatch('blue-500')).toBe('blue-500');
  });

  test('highlightMatch returns text as-is when no match found', () => {
    const { result } = renderHook(() => useColorSearch('xyz', groups));
    expect(result.current.highlightMatch('blue-500')).toBe('blue-500');
  });

  test('highlightMatch wraps matching portion in JSX', () => {
    const { result } = renderHook(() => useColorSearch('blue', groups));
    const highlighted = result.current.highlightMatch('blue-500');
    // Should be a React element, not a plain string
    expect(typeof highlighted).toBe('object');
  });

  test('filteredGroups updates when search changes', () => {
    const { result, rerender } = renderHook(({ s }) => useColorSearch(s, groups), {
      initialProps: { s: '' },
    });
    expect(Object.keys(result.current.filteredGroups)).toHaveLength(3);

    rerender({ s: 'red' });
    expect(Object.keys(result.current.filteredGroups)).toEqual(['red']);
  });
});
