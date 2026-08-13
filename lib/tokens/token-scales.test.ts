import { describe, expect, test } from 'bun:test';
import {
  findNearestToken,
  getAdjacentTokens,
  getNeighboringFamilies,
  getSpecialValues,
  getTokenScale,
} from './token-scales';

describe('getTokenScale', () => {
  describe('tailwind', () => {
    test('returns spacing scale for width', () => {
      const scale = getTokenScale('width', 'tailwind');
      expect(scale.length).toBeGreaterThan(20);
      expect(scale[0]).toEqual({ token: 'w-0', value: '0px', px: 0 });
      expect(scale.find((t) => t.token === 'w-60')).toEqual({
        token: 'w-60',
        value: '15rem',
        px: 240,
      });
    });

    test('returns radius scale for borderRadius', () => {
      const scale = getTokenScale('borderRadius', 'tailwind');
      expect(scale).toHaveLength(9);
      expect(scale[0]).toEqual({ token: 'rounded-none', value: '0px', px: 0 });
      expect(scale[8]).toEqual({ token: 'rounded-full', value: '9999px', px: 9999 });
    });

    test('returns opacity scale', () => {
      const scale = getTokenScale('opacity', 'tailwind');
      expect(scale).toHaveLength(15);
      expect(scale[0]).toEqual({ token: 'opacity-0', value: '0', px: 0 });
      expect(scale[14]).toEqual({ token: 'opacity-100', value: '100', px: 100 });
    });

    test('returns border-width scale', () => {
      const scale = getTokenScale('borderWidth', 'tailwind');
      expect(scale).toHaveLength(5);
    });

    test('returns font-size scale', () => {
      const scale = getTokenScale('fontSize', 'tailwind');
      expect(scale.length).toBeGreaterThan(10);
      expect(scale[0].token).toBe('text-xs');
    });

    test('returns line-height scale', () => {
      const scale = getTokenScale('lineHeight', 'tailwind');
      expect(scale.length).toBeGreaterThan(5);
    });

    test('returns letter-spacing scale', () => {
      const scale = getTokenScale('letterSpacing', 'tailwind');
      expect(scale).toHaveLength(6);
      expect(scale[0].token).toBe('tracking-tighter');
    });

    test('returns color shade scale for backgroundColor', () => {
      const scale = getTokenScale('backgroundColor', 'tailwind', { colorFamily: 'blue' });
      expect(scale).toHaveLength(11);
      expect(scale[0]).toEqual({ token: 'blue-50', value: '#eff6ff', px: 0 });
    });

    test('returns empty array for unknown property', () => {
      expect(getTokenScale('unknownProp', 'tailwind')).toEqual([]);
    });
  });

  describe('tamagui', () => {
    test('returns spacing scale for width', () => {
      const scale = getTokenScale('width', 'tamagui');
      expect(scale.length).toBeGreaterThan(10);
      expect(scale[0]).toEqual({ token: '$0', value: '0px', px: 0 });
    });

    test('returns color shade scale', () => {
      const scale = getTokenScale('backgroundColor', 'tamagui', { colorFamily: 'blue' });
      expect(scale).toHaveLength(12);
      expect(scale[0].token).toBe('$blue1');
    });

    test('returns empty for opacity (no discrete tokens)', () => {
      expect(getTokenScale('opacity', 'tamagui')).toEqual([]);
    });
  });
});

describe('findNearestToken', () => {
  test('exact match returns the token', () => {
    const scale = getTokenScale('width', 'tailwind');
    const result = findNearestToken('240px', scale);
    expect(result).toEqual({ token: 'w-60', value: '15rem', px: 240, exact: true });
  });

  test('approximate match returns nearest', () => {
    const scale = getTokenScale('width', 'tailwind');
    const result = findNearestToken('227px', scale);
    expect(result?.token).toBe('w-56'); // 224px is closer than 240px
    expect(result?.exact).toBe(false);
  });

  test('returns null for empty scale', () => {
    expect(findNearestToken('100px', [])).toBeNull();
  });

  test('parses rem values correctly', () => {
    const scale = getTokenScale('width', 'tailwind');
    const result = findNearestToken('15rem', scale);
    expect(result?.token).toBe('w-60');
    expect(result?.exact).toBe(true);
  });

  test('matches color tokens by hex value', () => {
    const scale = getTokenScale('backgroundColor', 'tailwind', { colorFamily: 'blue' });
    const result = findNearestToken('#3b82f6', scale);
    expect(result?.token).toBe('blue-500');
    expect(result?.exact).toBe(true);
  });

  test('returns null for unrecognized hex color', () => {
    const scale = getTokenScale('backgroundColor', 'tailwind', { colorFamily: 'blue' });
    expect(findNearestToken('#123456', scale)).toBeNull();
  });
});

describe('getAdjacentTokens', () => {
  test('returns prev, next, first, last around current token', () => {
    const scale = getTokenScale('width', 'tailwind');
    const result = getAdjacentTokens('w-60', scale);
    expect(result.prev?.token).toBe('w-56');
    expect(result.next?.token).toBe('w-64');
    expect(result.first.token).toBe('w-0');
    expect(result.last.token).toBe('w-96');
  });

  test('at start of scale, prev is null', () => {
    const scale = getTokenScale('width', 'tailwind');
    const result = getAdjacentTokens('w-0', scale);
    expect(result.prev).toBeNull();
    expect(result.next).not.toBeNull();
  });

  test('at end of scale, next is null', () => {
    const scale = getTokenScale('width', 'tailwind');
    const result = getAdjacentTokens('w-96', scale);
    expect(result.next).toBeNull();
    expect(result.prev).not.toBeNull();
  });
});

describe('getSpecialValues', () => {
  test('width has auto, full, screen, fit, min, max', () => {
    const specials = getSpecialValues('width', 'tailwind');
    expect(specials).toEqual(['auto', 'full', 'screen', 'fit', 'min', 'max']);
  });

  test('padding has no special values', () => {
    expect(getSpecialValues('padding', 'tailwind')).toEqual([]);
  });

  test('borderRadius has no special values', () => {
    expect(getSpecialValues('borderRadius', 'tailwind')).toEqual([]);
  });

  test('tamagui width has auto only', () => {
    expect(getSpecialValues('width', 'tamagui')).toEqual(['auto']);
  });
});

describe('getNeighboringFamilies', () => {
  test('blue has sky above and indigo below (tailwind)', () => {
    const result = getNeighboringFamilies('blue', 'tailwind');
    expect(result.prev).toBe('sky');
    expect(result.next).toBe('indigo');
  });

  test('first family has no prev', () => {
    const result = getNeighboringFamilies('slate', 'tailwind');
    expect(result.prev).toBeNull();
  });

  test('tamagui blue neighbors', () => {
    const result = getNeighboringFamilies('blue', 'tamagui');
    expect(result.prev).toBe('green');
    expect(result.next).toBe('purple');
  });
});
