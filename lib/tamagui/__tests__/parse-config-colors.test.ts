import { describe, expect, it } from 'bun:test';
import { parseTamaguiConfigColors } from '../parse-config-colors';

describe('parseTamaguiConfigColors', () => {
  it('extracts flat color tokens from createTamagui({ tokens: { color } })', () => {
    const source = `
      import { createTamagui } from '@tamagui/core';
      export const config = createTamagui({
        tokens: {
          color: {
            red1: '#fff5f5',
            red2: '#ffe3e3',
            blue1: '#e7f5ff',
          },
          space: { 1: 4, 2: 8 },
        },
      });
    `;
    expect(parseTamaguiConfigColors(source)).toEqual({
      red1: '#fff5f5',
      red2: '#ffe3e3',
      blue1: '#e7f5ff',
    });
  });

  it('extracts from a standalone tokens object (createTokens or tokens const)', () => {
    const source = `
      export const tokens = {
        color: {
          brand: '#123456',
          accent: '#abcdef',
        },
      };
      export const config = createTamagui({ tokens });
    `;
    expect(parseTamaguiConfigColors(source)).toEqual({
      brand: '#123456',
      accent: '#abcdef',
    });
  });

  it('extracts from const tokens = createTokens({ color })', () => {
    const source = `
      import { createTokens } from '@tamagui/core';
      export const tokens = createTokens({
        color: { brand1: '#111111', brand9: '#222222' },
        space: { 1: 4 },
      });
    `;
    expect(parseTamaguiConfigColors(source)).toEqual({
      brand1: '#111111',
      brand9: '#222222',
    });
  });

  it('extracts from createTamagui({ tokens: createTokens({ color }) })', () => {
    const source = `
      const config = createTamagui({
        tokens: createTokens({
          color: { primary: '#0a0a0a', secondary: '#fafafa' },
        }),
      });
    `;
    expect(parseTamaguiConfigColors(source)).toEqual({
      primary: '#0a0a0a',
      secondary: '#fafafa',
    });
  });

  it('unwraps `as const` / satisfies wrappers around the tokens object', () => {
    const asConst = `export const tokens = { color: { brand1: '#111111' } } as const;`;
    expect(parseTamaguiConfigColors(asConst)).toEqual({ brand1: '#111111' });

    const satisfies = `const config = createTamagui({ tokens: createTokens({ color: { a: '#222222' } }) satisfies object });`;
    expect(parseTamaguiConfigColors(satisfies)).toEqual({ a: '#222222' });

    const wrappedCall = `export const tokens = createTokens({ color: { c: '#333333' } }) as const;`;
    expect(parseTamaguiConfigColors(wrappedCall)).toEqual({ c: '#333333' });
  });

  it('unwraps an `as const` wrapper on the color value itself', () => {
    const source = `export const tokens = { color: { brand1: '#abcdef' } as const };`;
    expect(parseTamaguiConfigColors(source)).toEqual({ brand1: '#abcdef' });
  });

  it('does not treat a stray non-tokens `color` object as a palette', () => {
    const source = `
      const theme = { color: { foo: '#abcabc' } };
    `;
    expect(parseTamaguiConfigColors(source)).toBeNull();
  });

  it('normalizes rgb() to hex and keeps hex for an all-literal palette', () => {
    const source = `
      const config = createTamagui({
        tokens: { color: { a: '#abc', b: 'rgb(10, 20, 30)' } },
      });
    `;
    // rgb() is canonicalized to hex so downstream hex-only matching works.
    expect(parseTamaguiConfigColors(source)).toEqual({ a: '#abc', b: '#0a141e' });
  });

  it('rejects a PARTIAL palette (any non-literal value) rather than installing a subset', () => {
    // setTamaguiPalette replaces (not merges), so a partial override would hide
    // the project's real tokens — fall back to Radix instead.
    const withRef = `
      const config = createTamagui({
        tokens: { color: { a: '#abc', c: red.red1 } },
      });
    `;
    expect(parseTamaguiConfigColors(withRef)).toBeNull();
  });

  it('strips the alpha channel from rgba() so the token stays hex-matchable', () => {
    const source = `const config = createTamagui({ tokens: { color: { a: 'rgba(10, 20, 30, 0.5)' } } });`;
    expect(parseTamaguiConfigColors(source)).toEqual({ a: '#0a141e' });
  });

  it('rejects a palette with non-hex-resolvable values (hsl / named)', () => {
    const hsl = `const config = createTamagui({ tokens: { color: { a: '#111111', b: 'hsl(200, 50%, 50%)' } } });`;
    expect(parseTamaguiConfigColors(hsl)).toBeNull();
    const named = `const config = createTamagui({ tokens: { color: { a: 'rebeccapurple' } } });`;
    expect(parseTamaguiConfigColors(named)).toBeNull();
  });

  it('rejects a palette with a computed token key', () => {
    const source = `
      const BRAND = 'brand1';
      const config = createTamagui({ tokens: { color: { [BRAND]: '#123456' } } });
    `;
    expect(parseTamaguiConfigColors(source)).toBeNull();
  });

  it('rejects a palette that spreads imported colors', () => {
    const withSpread = `
      const config = createTamagui({
        tokens: { color: { ...radixColors, brand1: '#111111' } },
      });
    `;
    expect(parseTamaguiConfigColors(withSpread)).toBeNull();
  });

  it('resolves a shorthand color from a local const binding', () => {
    const shorthandInTokensObj = `
      const color = { brand1: '#111111', brand9: '#222222' };
      export const tokens = { color };
    `;
    expect(parseTamaguiConfigColors(shorthandInTokensObj)).toEqual({
      brand1: '#111111',
      brand9: '#222222',
    });

    const shorthandInCreateTamagui = `
      const color = { primary: '#0a0a0a' };
      const config = createTamagui({ tokens: { color } });
    `;
    expect(parseTamaguiConfigColors(shorthandInCreateTamagui)).toEqual({ primary: '#0a0a0a' });
  });

  it('returns null when no color tokens can be statically resolved', () => {
    const source = `
      import { tokens } from '@tamagui/themes';
      export const config = createTamagui({ tokens });
    `;
    expect(parseTamaguiConfigColors(source)).toBeNull();
  });

  it('returns null on unparseable / empty source', () => {
    expect(parseTamaguiConfigColors('')).toBeNull();
    expect(parseTamaguiConfigColors('const x = (((')).toBeNull();
  });
});
