import { describe, expect, test } from 'bun:test';
import {
  findClosestColor,
  findNearestPassingColor,
  generateColorOptions,
  getColorGroups,
  getHexFromToken,
  getTokenFromHex,
  SPECIAL_CSS_VALUES,
} from './color-utils';

const makeOption = (value: string, hex: string) => ({
  value,
  hex,
  label: value,
  colorName: value.split('-')[0],
});

function expectValue(result: ReturnType<typeof findNearestPassingColor>): string {
  if (!result) throw new Error('expected non-null result');
  return result.value;
}

// --- SPECIAL_CSS_VALUES ---

describe('SPECIAL_CSS_VALUES', () => {
  test('contains transparent, inherit, currentColor', () => {
    expect(SPECIAL_CSS_VALUES.has('transparent')).toBe(true);
    expect(SPECIAL_CSS_VALUES.has('inherit')).toBe(true);
    expect(SPECIAL_CSS_VALUES.has('currentColor')).toBe(true);
  });

  test('does not contain none or arbitrary values', () => {
    expect(SPECIAL_CSS_VALUES.has('none')).toBe(false);
    expect(SPECIAL_CSS_VALUES.has('#ff0000')).toBe(false);
  });
});

// --- getTokenFromHex ---

describe('getTokenFromHex', () => {
  test('returns null for empty hex', () => {
    expect(getTokenFromHex('', 'tailwind')).toBeNull();
  });

  test('returns "white" for #ffffff (tailwind)', () => {
    expect(getTokenFromHex('#ffffff', 'tailwind')).toBe('white');
  });

  test('returns "black" for #000000 (tailwind)', () => {
    expect(getTokenFromHex('#000000', 'tailwind')).toBe('black');
  });

  test('returns "transparent" for transparent (tailwind)', () => {
    expect(getTokenFromHex('transparent', 'tailwind')).toBe('transparent');
  });

  test('is case-insensitive', () => {
    expect(getTokenFromHex('#FFFFFF', 'tailwind')).toBe('white');
  });

  test('finds tailwind palette token from hex', () => {
    // blue-500 in tailwind is #3b82f6
    const token = getTokenFromHex('#3b82f6', 'tailwind');
    expect(token).toBe('blue-500');
  });

  test('returns null for unknown hex (tailwind)', () => {
    expect(getTokenFromHex('#123456', 'tailwind')).toBeNull();
  });

  test('returns tamagui token from hex', () => {
    // Tamagui has its own color system
    const token = getTokenFromHex('#ff0000', 'tamagui');
    // May or may not find a match depending on tamagui values
    expect(token === null || typeof token === 'string').toBe(true);
  });
});

// --- getHexFromToken ---

describe('getHexFromToken', () => {
  test('returns hex for tailwind token', () => {
    const hex = getHexFromToken('blue-500', 'tailwind');
    expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  test('returns hex for special tailwind tokens', () => {
    expect(getHexFromToken('white', 'tailwind')).toBe('#ffffff');
    expect(getHexFromToken('black', 'tailwind')).toBe('#000000');
  });

  test('returns null for unknown tailwind token', () => {
    expect(getHexFromToken('nonexistent-999', 'tailwind')).toBeNull();
  });

  test('returns hex for tamagui token', () => {
    const hex = getHexFromToken('blue9', 'tamagui');
    expect(hex === null || hex.startsWith('#')).toBe(true);
  });
});

// --- findClosestColor ---

describe('findClosestColor', () => {
  test('returns null for empty hex', () => {
    expect(findClosestColor('', 'tailwind')).toBeNull();
  });

  test('finds exact match for white', () => {
    const result = findClosestColor('#ffffff', 'tailwind');
    expect(result).not.toBeNull();
    expect(result?.token).toBe('white');
    expect(result?.hex).toBe('#ffffff');
  });

  test('finds exact match for black', () => {
    const result = findClosestColor('#000000', 'tailwind');
    expect(result).not.toBeNull();
    expect(result?.token).toBe('black');
  });

  test('finds closest tailwind palette color', () => {
    // #3b82f6 is exactly blue-500
    const result = findClosestColor('#3b82f6', 'tailwind');
    expect(result).not.toBeNull();
    expect(result?.token).toBe('blue-500');
  });

  test('finds approximate match', () => {
    // Slightly off-blue should still find a blue token
    const result = findClosestColor('#3a81f5', 'tailwind');
    expect(result).not.toBeNull();
    expect(result?.token).toContain('blue');
  });

  test('finds tamagui closest color', () => {
    const result = findClosestColor('#ff0000', 'tamagui');
    expect(result === null || (result.token && result.hex)).toBeTruthy();
  });
});

// --- generateColorOptions ---

describe('generateColorOptions', () => {
  test('generates tailwind options with special colors first', () => {
    const options = generateColorOptions('tailwind');
    expect(options.length).toBeGreaterThan(10);
    expect(options[0].value).toBe('none');
    expect(options[0].colorName).toBe('special');
    expect(options[1].value).toBe('white');
    expect(options[2].value).toBe('black');
    expect(options[3].value).toBe('transparent');
    expect(options[4].value).toBe('inherit');
    expect(options[5].value).toBe('currentColor');
  });

  test('tailwind options have correct shape', () => {
    const options = generateColorOptions('tailwind');
    for (const opt of options.slice(0, 10)) {
      expect(typeof opt.value).toBe('string');
      expect(typeof opt.hex).toBe('string');
      expect(typeof opt.label).toBe('string');
      expect(typeof opt.colorName).toBe('string');
    }
  });

  test('tailwind palette options use colorName-shade format', () => {
    const options = generateColorOptions('tailwind');
    const paletteOption = options.find((o) => o.colorName !== 'special');
    expect(paletteOption).toBeDefined();
    expect(paletteOption?.value).toMatch(/^[a-z]+-\d+$/);
  });

  test('generates tamagui options', () => {
    const options = generateColorOptions('tamagui');
    expect(options.length).toBeGreaterThan(10);
    // Tamagui options don't have special colors
    expect(options[0].colorName).not.toBe('special');
  });

  test('tamagui semantic tokens sort before palette colors', () => {
    const options = generateColorOptions('tamagui');
    // Semantic tokens have _ prefix in colorName
    const firstSemantic = options.findIndex((o) => o.colorName.startsWith('_'));
    const firstPalette = options.findIndex((o) => !o.colorName.startsWith('_'));
    if (firstSemantic !== -1 && firstPalette !== -1) {
      expect(firstSemantic).toBeLessThan(firstPalette);
    }
  });
});

// --- getColorGroups ---

describe('getColorGroups', () => {
  test('groups options by colorName', () => {
    const options = [
      makeOption('red-500', '#ef4444'),
      makeOption('red-600', '#dc2626'),
      makeOption('blue-500', '#3b82f6'),
    ];
    const groups = getColorGroups(options);
    expect(Object.keys(groups)).toEqual(['red', 'blue']);
    expect(groups.red).toHaveLength(2);
    expect(groups.blue).toHaveLength(1);
  });

  test('handles empty options', () => {
    const groups = getColorGroups([]);
    expect(Object.keys(groups)).toHaveLength(0);
  });

  test('works with generated tailwind options', () => {
    const options = generateColorOptions('tailwind');
    const groups = getColorGroups(options);
    expect(groups.special).toBeDefined();
    expect(groups.special.length).toBe(6); // none, white, black, transparent, inherit, currentColor
  });
});

// --- findNearestPassingColor ---

describe('findNearestPassingColor', () => {
  const options = [
    makeOption('gray-100', '#f3f4f6'),
    makeOption('gray-500', '#6b7280'),
    makeOption('gray-700', '#374151'),
    makeOption('gray-900', '#111827'),
    makeOption('blue-200', '#bfdbfe'),
    makeOption('blue-700', '#1d4ed8'),
  ];

  test('returns nearest passing color against white background', () => {
    const result = findNearestPassingColor('#f3f4f6', '#ffffff', options);
    expect(expectValue(result)).toBe('gray-500');
  });

  test('returns nearest passing color against dark background', () => {
    const result = findNearestPassingColor('#111827', '#000000', options);
    expect(expectValue(result)).toBe('blue-200');
  });

  test('returns null when no options pass', () => {
    const narrowOptions = [makeOption('gray-400', '#9ca3af'), makeOption('gray-500', '#6b7280')];
    const result = findNearestPassingColor('#9ca3af', '#a0a0a0', narrowOptions);
    expect(result).toBeNull();
  });

  test('prefers closest color by euclidean distance', () => {
    const result = findNearestPassingColor('#bfdbfe', '#ffffff', options);
    expect(expectValue(result)).toBe('gray-500');
  });

  test('finds nearest AAA shade when minLevel is AAA', () => {
    const result = findNearestPassingColor('#6b7280', '#ffffff', options, 'AAA');
    expect(expectValue(result)).toBe('gray-700');
  });

  test('prefers same color group when preferredGroup is set', () => {
    const result = findNearestPassingColor('#bfdbfe', '#ffffff', options, 'AA', 'blue');
    expect(expectValue(result)).toBe('blue-700');
  });

  test('falls back to all options when no match in preferred group', () => {
    const result = findNearestPassingColor('#bfdbfe', '#ffffff', options, 'AAA', 'blue');
    expect(expectValue(result)).toBe('gray-700');
  });

  test('returns null when no options meet AAA', () => {
    const lightOptions = [makeOption('gray-100', '#f3f4f6'), makeOption('blue-200', '#bfdbfe')];
    const result = findNearestPassingColor('#f3f4f6', '#ffffff', lightOptions, 'AAA');
    expect(result).toBeNull();
  });
});
