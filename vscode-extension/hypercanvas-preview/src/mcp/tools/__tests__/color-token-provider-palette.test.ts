/**
 * @file HYP-288 — TamaguiColorTokenProvider reflects the active project palette.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { setTamaguiPalette } from '@lib/tamagui/values';
import { getColorTokenProvider } from '../color-token-provider';

// Reset the shared module-level palette after every test so a custom palette
// can't leak into sibling tests that assume the hardcoded Radix scale.
afterEach(() => setTamaguiPalette(null));

describe('TamaguiColorTokenProvider with an active project palette', () => {
  it('lists the project palette colors instead of hardcoded Radix', () => {
    setTamaguiPalette({ brand1: '#111111', brand9: '#222222', accent3: '#333333' });
    const provider = getColorTokenProvider('tamagui');
    const all = provider.listColors();
    expect(all).toContainEqual({ token: 'brand1', hex: '#111111' });
    expect(all).toContainEqual({ token: 'accent3', hex: '#333333' });
    expect(all.some((c) => c.token === 'gray1')).toBe(false);
  });

  it('filters listColors by a project family', () => {
    setTamaguiPalette({ brand1: '#111111', brand9: '#222222', accent3: '#333333' });
    const tokens = getColorTokenProvider('tamagui')
      .listColors('brand')
      .map((c) => c.token);
    expect(tokens.sort()).toEqual(['brand1', 'brand9']);
  });

  it('exposes project families via getFamilies (plus semantic), not Radix families', () => {
    setTamaguiPalette({ brand1: '#111111', accent3: '#333333' });
    const families = getColorTokenProvider('tamagui').getFamilies();
    expect(families).toContain('brand');
    expect(families).toContain('accent');
    // Semantic tokens are theme-level and remain available.
    expect(families).toContain('color');
    expect(families).not.toContain('gray');
  });

  it('filters listColors by a mixed-case custom family (case-insensitive)', () => {
    setTamaguiPalette({ brandPrimary1: '#111111', brandPrimary9: '#222222', other2: '#333333' });
    const provider = getColorTokenProvider('tamagui');
    // getFamilies() returns the family original-cased; listColors must accept it.
    const family = provider.getFamilies().find((f) => f.toLowerCase() === 'brandprimary');
    expect(family).toBe('brandPrimary');
    const tokens = provider
      .listColors(family)
      .map((c) => c.token)
      .sort();
    expect(tokens).toEqual(['brandPrimary1', 'brandPrimary9']);
  });

  it('finds the nearest project token for an exact hex', () => {
    setTamaguiPalette({ brand1: '#111111', brand9: '#222222' });
    const nearest = getColorTokenProvider('tamagui').findNearest('#111111', 1);
    expect(nearest[0]?.token).toBe('brand1');
  });

  it('falls back to hardcoded Radix families when no palette is active', () => {
    const families = getColorTokenProvider('tamagui').getFamilies();
    expect(families).toContain('gray');
  });
});
