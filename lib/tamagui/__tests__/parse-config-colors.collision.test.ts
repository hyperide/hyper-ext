/**
 * @file HYP-784 sibling: the Tamagui palette extractor must survive a top-level name collision.
 *
 * Accessed via: TamaguiPaletteLoader on a project's tamagui config. Unlike the structure-only
 * residual sites, `parseTamaguiConfigColors` GENUINELY needs scope — `resolveColorObject` calls
 * `path.scope.getBinding` to follow a `tokens: { color }` identifier reference to its `const`.
 * So it cannot be made scope-free; instead the scope-enabled traverse is wrapped so that a
 * top-level name collision (which makes babel's scope crawl throw `Duplicate declaration`)
 * degrades to the same `null` result as "nothing statically resolvable" (the Radix fallback).
 */

import { describe, expect, it } from 'bun:test';
import { parseTamaguiConfigColors } from '../parse-config-colors';

describe('parseTamaguiConfigColors — top-level name collision (HYP-784 sibling)', () => {
  it('degrades to null (Radix fallback) instead of throwing on a collision config', () => {
    // `import { Layout }` collides with `export function Layout` — babel's scope crawl throws
    // `Duplicate declaration "Layout"` on this file today.
    const source = `import { Layout } from 'antd';
export function Layout() {
  return null;
}
export const config = createTamagui({
  tokens: {
    color: { red1: '#fff5f5', red2: '#ffe3e3' },
  },
});
`;
    expect(() => parseTamaguiConfigColors(source)).not.toThrow();
    expect(parseTamaguiConfigColors(source)).toBeNull();
  });

  it('still resolves the `tokens: { color }` identifier-reference form (scope binding path preserved)', () => {
    // This is the ONLY form that exercises `path.scope.getBinding` — `color` is a shorthand
    // reference to a separate `const`, so the binding must be followed. Proves the fix keeps
    // scope enabled (it only wraps the crawl crash; it does not disable scope).
    const source = `const color = { brand: '#123456', accent: '#abcdef' };
export const tokens = { color };
export const config = createTamagui({ tokens });
`;
    expect(parseTamaguiConfigColors(source)).toEqual({ brand: '#123456', accent: '#abcdef' });
  });
});
