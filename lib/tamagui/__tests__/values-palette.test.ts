import { afterEach, describe, expect, it } from 'bun:test';
import {
  getAllTamaguiColors,
  getTamaguiColorHex,
  getTamaguiColorNames,
  getTamaguiTokenFromHex,
  setTamaguiPalette,
} from '../values';

// values.ts holds a module-level active palette. Always reset so a failing test
// can't leak custom colors into sibling tests (e.g. values.test.ts) sharing the run.
afterEach(() => setTamaguiPalette(null));

describe('setTamaguiPalette — project palette override', () => {
  it('routes getTamaguiColorHex through the active palette (with/without $)', () => {
    setTamaguiPalette({ brand1: '#111111', brand9: '#222222' });
    expect(getTamaguiColorHex('brand1')).toBe('#111111');
    expect(getTamaguiColorHex('$brand9')).toBe('#222222');
  });

  it('includes active-palette entries in getAllTamaguiColors', () => {
    setTamaguiPalette({ brand1: '#111111', brand9: '#222222' });
    const all = getAllTamaguiColors();
    expect(all).toContainEqual({ token: 'brand1', hex: '#111111' });
    expect(all).toContainEqual({ token: 'brand9', hex: '#222222' });
  });

  it('maps hex back to active-palette token', () => {
    setTamaguiPalette({ brand1: '#111111' });
    expect(getTamaguiTokenFromHex('#111111')).toBe('brand1');
  });

  it('still reverse-maps semantic token hex while a palette is active', () => {
    // Semantic tokens stay advertised, so their hex must remain reverse-mappable.
    // '#646464' is semantic color11/background11 in the hardcoded semantic set.
    setTamaguiPalette({ brand1: '#111111' });
    expect(getTamaguiTokenFromHex('#646464')).toBe('color11');
  });

  it('does NOT resolve hidden Radix tokens under an active palette', () => {
    // blue9 is a Radix token; listColors()/getFamilies() hide Radix when a
    // project palette is active, so getTamaguiColorHex must not resolve it.
    setTamaguiPalette({ brand1: '#111111' });
    expect(getTamaguiColorHex('$blue9')).toBeNull();
    expect(getTamaguiColorHex('blue9')).toBeNull();
    // Semantic tokens remain resolvable.
    expect(getTamaguiColorHex('$color11')).toBe('#646464');
  });

  it('derives families from the active palette in getTamaguiColorNames', () => {
    setTamaguiPalette({ brand1: '#111111', brand9: '#222222', accent3: '#333333' });
    const names = getTamaguiColorNames();
    expect(names).toContain('brand');
    expect(names).toContain('accent');
    // Hardcoded Radix families must NOT leak when a project palette is active.
    expect(names).not.toContain('gray');
  });

  it('invalidates the getAllTamaguiColors cache when the palette changes', () => {
    // Warm the cache with the hardcoded palette first.
    const hardcoded = getAllTamaguiColors();
    expect(hardcoded.some((c) => c.token === 'brand1')).toBe(false);
    setTamaguiPalette({ brand1: '#111111' });
    expect(getAllTamaguiColors()).toContainEqual({ token: 'brand1', hex: '#111111' });
  });

  it('treats an empty palette as no override (falls back to Radix)', () => {
    setTamaguiPalette({});
    expect(getTamaguiColorHex('blue9')).toBe('#0090ff');
  });

  it('restores hardcoded palette on reset(null)', () => {
    setTamaguiPalette({ brand1: '#111111' });
    setTamaguiPalette(null);
    expect(getTamaguiColorHex('brand1')).toBeNull();
    expect(getTamaguiColorHex('blue9')).toBe('#0090ff');
  });
});
