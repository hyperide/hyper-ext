import { describe, expect, test } from 'bun:test';
import {
  colorDistance,
  contrastRatio,
  findContrastFixHex,
  hexToHsl,
  hexToRgb,
  hexWithAlpha,
  hslToHex,
  hslToRgb,
  normalizeComputedColor,
  parseHexWithAlpha,
  rgbToHex,
  wcagLevel,
} from './color';

describe('hexToRgb', () => {
  test('converts 6-digit hex', () => {
    expect(hexToRgb('#3b82f6')).toEqual({ r: 59, g: 130, b: 246 });
  });

  test('converts hex without #', () => {
    expect(hexToRgb('3b82f6')).toEqual({ r: 59, g: 130, b: 246 });
  });

  test('returns null for invalid input', () => {
    expect(hexToRgb('xyz')).toBeNull();
    expect(hexToRgb('')).toBeNull();
  });

  test('handles black and white', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  test('converts 3-digit hex', () => {
    expect(hexToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb('f00')).toEqual({ r: 255, g: 0, b: 0 });
  });
});

describe('rgbToHex', () => {
  test('converts rgb to hex', () => {
    expect(rgbToHex(59, 130, 246)).toBe('#3b82f6');
  });

  test('clamps values to 0-255', () => {
    expect(rgbToHex(-10, 300, 128)).toBe('#00ff80');
  });

  test('handles black and white', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
  });
});

describe('hslToRgb', () => {
  test('converts pure red', () => {
    expect(hslToRgb(0, 100, 50)).toEqual({ r: 255, g: 0, b: 0 });
  });

  test('converts pure green', () => {
    expect(hslToRgb(120, 100, 50)).toEqual({ r: 0, g: 255, b: 0 });
  });

  test('converts achromatic gray', () => {
    const { r, g, b } = hslToRgb(0, 0, 50);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeCloseTo(128, 0);
  });
});

describe('hslToHex', () => {
  test('converts hsl to hex', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
  });
});

describe('hexToHsl', () => {
  test('converts pure red', () => {
    const { h, s, l } = hexToHsl('#ff0000');
    expect(h).toBe(0);
    expect(s).toBe(100);
    expect(l).toBe(50);
  });

  test('converts blue-500', () => {
    const { h, s, l } = hexToHsl('#3b82f6');
    expect(h).toBeCloseTo(217, 0);
    expect(s).toBeCloseTo(91, 0);
    expect(l).toBeCloseTo(60, 0);
  });

  test('converts gray (achromatic)', () => {
    const { h, s, l } = hexToHsl('#808080');
    expect(h).toBe(0);
    expect(s).toBe(0);
    expect(l).toBeCloseTo(50, 0);
  });
});

describe('colorDistance', () => {
  test('identical colors return 0', () => {
    expect(colorDistance('#ff0000', '#ff0000')).toBe(0);
  });

  test('black and white return max-ish distance', () => {
    const d = colorDistance('#000000', '#ffffff');
    expect(d).toBeCloseTo(441.67, 0);
  });

  test('returns Infinity for invalid input', () => {
    expect(colorDistance('invalid', '#000000')).toBe(Infinity);
  });
});

describe('contrastRatio', () => {
  test('white on black is 21:1', () => {
    const ratio = contrastRatio('#ffffff', '#000000');
    expect(ratio).toBeCloseTo(21, 0);
  });

  test('identical colors return 1:1', () => {
    expect(contrastRatio('#3b82f6', '#3b82f6')).toBeCloseTo(1, 1);
  });

  test('returns 1 for invalid input', () => {
    expect(contrastRatio('invalid', '#000000')).toBe(1);
  });

  test('blue-500 on white', () => {
    const ratio = contrastRatio('#3b82f6', '#ffffff');
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(5);
  });
});

describe('wcagLevel', () => {
  test('AAA for ratio >= 7', () => {
    expect(wcagLevel(7)).toBe('AAA');
    expect(wcagLevel(21)).toBe('AAA');
  });

  test('AA for ratio >= 4.5 and < 7', () => {
    expect(wcagLevel(4.5)).toBe('AA');
    expect(wcagLevel(6.9)).toBe('AA');
  });

  test('Fail for ratio < 4.5', () => {
    expect(wcagLevel(1)).toBe('Fail');
    expect(wcagLevel(4.4)).toBe('Fail');
  });
});

describe('findContrastFixHex', () => {
  test('finds darker shade of same hue that passes AA on white', () => {
    // Light blue #93c5fd fails on white — should darken to pass AA
    const fix = findContrastFixHex('#93c5fd', '#ffffff', 'AA');
    if (!fix) throw new Error('expected non-null fix');
    const ratio = contrastRatio(fix, '#ffffff');
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    // Should preserve hue (blue)
    const origHsl = hexToHsl('#93c5fd');
    const fixHsl = hexToHsl(fix);
    expect(fixHsl.h).toBe(origHsl.h);
  });

  test('finds lighter shade that passes AA on black', () => {
    // Dark blue #1e3a8a fails on black — should lighten
    const fix = findContrastFixHex('#1e3a8a', '#000000', 'AA');
    if (!fix) throw new Error('expected non-null fix');
    const ratio = contrastRatio(fix, '#000000');
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  test('finds nearest lightness to current color', () => {
    // Gray that barely fails AA on white — fix should be close in lightness
    const fix = findContrastFixHex('#9ca3af', '#ffffff', 'AA');
    if (!fix) throw new Error('expected non-null fix');
    const origL = hexToHsl('#9ca3af').l;
    const fixL = hexToHsl(fix).l;
    // The fix should be darker (lower L) but not dramatically far
    expect(fixL).toBeLessThan(origL);
    expect(origL - fixL).toBeLessThan(20);
  });

  test('targets AAA when requested', () => {
    // Color that passes AA but not AAA on white
    const fix = findContrastFixHex('#6b7280', '#ffffff', 'AAA');
    if (!fix) throw new Error('expected non-null fix');
    const ratio = contrastRatio(fix, '#ffffff');
    expect(ratio).toBeGreaterThanOrEqual(7);
  });

  test('returns null when no lightness can achieve target', () => {
    // #7a7a7a background: black achieves ~4.9:1, white achieves ~4.3:1 — both below AAA 7:1.
    // No lightness of a gray (s=0) can reach 7:1 against this mid-gray background.
    const fix = findContrastFixHex('#808080', '#7a7a7a', 'AAA');
    expect(fix).toBeNull();
  });
});

describe('hexWithAlpha', () => {
  test('100% opacity adds ff', () => {
    expect(hexWithAlpha('#3b82f6', '100')).toBe('#3b82f6ff');
  });

  test('50% opacity adds 80', () => {
    expect(hexWithAlpha('#3b82f6', '50')).toBe('#3b82f680');
  });

  test('0% opacity adds 00', () => {
    expect(hexWithAlpha('#3b82f6', '0')).toBe('#3b82f600');
  });

  test('expands 3-digit hex correctly', () => {
    expect(hexWithAlpha('#f00', '50')).toBe('#ff000080');
  });

  test('returns original for non-hex', () => {
    expect(hexWithAlpha('$blue9', '50')).toBe('$blue9');
  });
});

describe('normalizeComputedColor', () => {
  test('rgba with fractional alpha → hex with alpha channel', () => {
    // bg-primary/15 resolves to ~rgba(184, 103, 46, 0.15)
    // 0.15 * 255 = 38.25 → round → 38 = 0x26
    expect(normalizeComputedColor('rgba(184, 103, 46, 0.15)')).toBe('#b8672e26');
  });

  test('rgb fully opaque → hex without alpha', () => {
    expect(normalizeComputedColor('rgb(184, 103, 46)')).toBe('#b8672e');
  });

  test('rgba fully opaque (a=1) → hex without alpha', () => {
    expect(normalizeComputedColor('rgba(255, 0, 0, 1)')).toBe('#ff0000');
  });

  test('rgba fully transparent (a=0) → null (unset background)', () => {
    expect(normalizeComputedColor('rgba(0, 0, 0, 0)')).toBeNull();
  });

  test('transparent keyword → null', () => {
    expect(normalizeComputedColor('transparent')).toBeNull();
  });

  test('empty string → null', () => {
    expect(normalizeComputedColor('')).toBeNull();
  });

  test('rgb black → #000000 (real color, not filtered)', () => {
    expect(normalizeComputedColor('rgb(0, 0, 0)')).toBe('#000000');
  });

  test('rgba semi-transparent white → hex with alpha', () => {
    // 0.5 * 255 = 127.5 → round → 128 = 0x80
    expect(normalizeComputedColor('rgba(255, 255, 255, 0.5)')).toBe('#ffffff80');
  });
});

describe('parseHexWithAlpha', () => {
  test('parses #rrggbbaa format', () => {
    expect(parseHexWithAlpha('#3b82f680')).toEqual({ color: '#3b82f6', opacity: '50' });
  });

  test('parses #rrggbb format (no alpha)', () => {
    expect(parseHexWithAlpha('#3b82f6')).toEqual({ color: '#3b82f6', opacity: undefined });
  });

  test('returns original for non-hex', () => {
    expect(parseHexWithAlpha('$blue9')).toEqual({ color: '$blue9', opacity: undefined });
  });
});
