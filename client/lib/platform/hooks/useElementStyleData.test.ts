import { describe, expect, test } from 'bun:test';
import type { SelectedElementRuntimeStyle } from '@lib/types';
import { parseHexWithAlpha } from '@shared/utils/color';
import { classNameToStyles, mergeRuntimeStyle } from './useElementStyleData';

describe('mergeRuntimeStyle', () => {
  const elementId = 'client/components/FAQ.tsx:42:10';

  test('bg-primary/15 class + computed rgba populates backgroundColor with alpha', () => {
    // tw-to-css cannot resolve CSS-variable tokens like bg-primary/15 → backgroundColor is undefined
    const base = classNameToStyles('bg-primary/15');
    expect(base.backgroundColor).toBeUndefined();

    const runtime: SelectedElementRuntimeStyle = {
      componentPath: 'client/components/FAQ.tsx',
      elementId,
      seq: 1,
      computedStyle: { backgroundColor: 'rgba(184, 103, 46, 0.15)' },
    };

    const merged = mergeRuntimeStyle(base, runtime, elementId);
    expect(merged.backgroundColor).toBeDefined();
    // Should be hex with alpha channel so Inspector can parse opacity
    const { color, opacity } = parseHexWithAlpha(merged.backgroundColor!);
    expect(color).toBe('#b8672e');
    // 0.15 * 255 = 38.25 → 38 / 255 * 100 = 14.9 → round → 15
    expect(opacity).toBe('15');
  });

  test('does not overwrite Tailwind-parsed backgroundColor', () => {
    const base = classNameToStyles('bg-red-500');
    expect(base.backgroundColor).toBeDefined();
    const original = base.backgroundColor;

    const runtime: SelectedElementRuntimeStyle = {
      componentPath: 'client/components/FAQ.tsx',
      elementId,
      seq: 1,
      computedStyle: { backgroundColor: 'rgba(184, 103, 46, 0.15)' },
    };

    const merged = mergeRuntimeStyle(base, runtime, elementId);
    // Must not overwrite — Tailwind parse takes precedence
    expect(merged.backgroundColor).toBe(original);
  });

  test('stale runtime style (different elementId) is ignored', () => {
    const base = classNameToStyles('bg-primary/15');
    const runtime: SelectedElementRuntimeStyle = {
      componentPath: 'client/components/Other.tsx',
      elementId: 'client/components/Other.tsx:10:5',
      seq: 1,
      computedStyle: { backgroundColor: 'rgba(255, 0, 0, 1)' },
    };

    const merged = mergeRuntimeStyle(base, runtime, elementId);
    // Different elementId — merge must be skipped
    expect(merged.backgroundColor).toBeUndefined();
  });

  test('null runtime style returns base unchanged', () => {
    const base = classNameToStyles('text-red-500');
    const merged = mergeRuntimeStyle(base, null, elementId);
    expect(merged).toBe(base);
  });

  test('fully transparent computed background is not applied', () => {
    const base = classNameToStyles('bg-primary/15');
    const runtime: SelectedElementRuntimeStyle = {
      componentPath: 'client/components/FAQ.tsx',
      elementId,
      seq: 1,
      computedStyle: { backgroundColor: 'rgba(0, 0, 0, 0)' },
    };

    const merged = mergeRuntimeStyle(base, runtime, elementId);
    // rgba(0,0,0,0) is browser-default transparent — must not populate backgroundColor
    expect(merged.backgroundColor).toBeUndefined();
  });
});
