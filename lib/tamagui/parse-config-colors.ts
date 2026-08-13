/**
 * @file Static extraction of a project's Tamagui color palette from its config.
 *
 * Accessed via: TamaguiPaletteLoader (VS Code extension) when a project is
 * detected as Tamagui; result is installed via setTamaguiPalette() in values.ts.
 * Assumptions: best-effort static analysis only. A real Tamagui config often
 * builds `tokens.color` from imported color sets (e.g. `@tamagui/colors`) or
 * spreads — those are not statically resolvable and yield null so callers fall
 * back to the hardcoded Radix palette.
 */

import { parse as babelParse } from '@babel/parser';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { normalizeComputedColor } from '@shared/utils/color';

// @ts-expect-error - babel/traverse has ESM/CJS interop quirks
const traverse = (_traverse.default || _traverse) as typeof _traverse;

/** Flat map of Tamagui color token name → color value (hex / rgb / etc.). */
export type TamaguiPalette = Record<string, string>;

/**
 * Parse a Tamagui config source and extract the flat `tokens.color` palette.
 * Returns null when nothing can be statically resolved (unparseable source,
 * no `tokens.color`, or all values are non-literal references).
 */
export function parseTamaguiConfigColors(source: string): TamaguiPalette | null {
  if (!source || !source.trim()) return null;

  let ast: t.File;
  try {
    ast = babelParse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
  } catch {
    return null;
  }

  const palette: TamaguiPalette = {};
  // Any unresolved entry (spread, non-literal value, computed key) makes the
  // palette PARTIAL. Since setTamaguiPalette REPLACES the built-in palette rather
  // than merging, installing a partial map would hide the project's real
  // spread/imported tokens — worse than a clean Radix fallback. So a partial
  // tokens.color is treated as unparseable (null).
  let unresolved = false;

  // HYP-784: unlike the structure-only residual sites, this traverse GENUINELY needs scope —
  // `resolveColorObject` follows a `tokens: { color }` identifier reference via
  // `path.scope.getBinding`, so it cannot be made scope-free. A user tamagui config with a
  // top-level name collision (e.g. `import { Layout } from 'antd'` + `export function Layout`)
  // makes babel's scope crawl throw `Duplicate declaration`. We can't trust a partially-walked
  // palette, so degrade to `null` — exactly the "nothing statically resolvable" result, which
  // makes callers fall back to the built-in Radix palette.
  try {
    traverse(ast, {
      ObjectProperty(path) {
        if (!isKeyNamed(path.node.key, 'color')) return;
        // Only consider a `color` object that lives inside a `tokens` context —
        // e.g. `tokens: { color: {...} }`, `const tokens = { color: {...} }`,
        // `createTokens({ color: {...} })`, possibly with `as const` wrappers.
        if (!isInsideTokens(path)) return;
        const colorObj = resolveColorObject(path);
        // A `color` in a tokens context we can't statically resolve makes the
        // palette untrustworthy → reject (Radix fallback) rather than guess.
        if (!colorObj || !collectStringEntries(colorObj, palette)) unresolved = true;
      },
    });
  } catch (error) {
    console.warn(
      `[tamagui] parseTamaguiConfigColors: scope crawl failed (${
        error instanceof Error ? error.message : String(error)
      }); falling back to the default palette`,
    );
    return null;
  }

  if (unresolved) return null;
  return Object.keys(palette).length > 0 ? palette : null;
}

/** True when the `color` property's enclosing object is a `tokens` context. */
function isInsideTokens(colorPropPath: NodePath<t.ObjectProperty>): boolean {
  // colorPropPath = ObjectProperty(color)
  // .parentPath = ObjectExpression holding `color`
  // its parent is the `tokens` context, possibly wrapped in any combination of
  // createTokens(...)/createTamagui(...) calls and `as const`/`satisfies`/paren
  // expressions: `const tokens = createTokens({ color }) as const`, etc.
  let holder: NodePath | null = colorPropPath.parentPath?.parentPath ?? null;
  while (holder && isTransparentWrapper(holder)) holder = holder.parentPath;
  if (!holder) return false;
  if (holder.isObjectProperty()) return isKeyNamed(holder.node.key, 'tokens');
  if (holder.isVariableDeclarator()) return t.isIdentifier(holder.node.id, { name: 'tokens' });
  return false;
}

/**
 * Resolve a `color` property's value to its ObjectExpression. Handles a direct
 * object (possibly `as const`-wrapped) and the shorthand/reference form
 * `tokens: { color }` / `color: someConst` by following the identifier binding to
 * a local `const color = { ... }`. Returns null when not statically resolvable.
 */
function resolveColorObject(colorPropPath: NodePath<t.ObjectProperty>): t.ObjectExpression | null {
  const direct = unwrapExpression(colorPropPath.node.value);
  if (t.isObjectExpression(direct)) return direct;
  if (t.isIdentifier(direct)) {
    const binding = colorPropPath.scope.getBinding(direct.name);
    if (binding?.path.isVariableDeclarator()) {
      const init = binding.path.node.init;
      if (init) {
        const inner = unwrapExpression(init);
        if (t.isObjectExpression(inner)) return inner;
      }
    }
  }
  return null;
}

/** Nodes that wrap an expression without changing the underlying object value. */
function isTransparentWrapper(p: NodePath): boolean {
  return (
    p.isCallExpression() ||
    p.isTSAsExpression() ||
    p.isTSSatisfiesExpression() ||
    p.isTSTypeAssertion() ||
    p.isTSNonNullExpression() ||
    p.isParenthesizedExpression()
  );
}

/** Strip `as const`/`satisfies`/type-assertion/paren wrappers from an expression. */
function unwrapExpression(node: t.Node): t.Node {
  let current = node;
  while (
    t.isTSAsExpression(current) ||
    t.isTSSatisfiesExpression(current) ||
    t.isTSTypeAssertion(current) ||
    t.isTSNonNullExpression(current) ||
    t.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Collect string-literal entries from a color ObjectExpression into `out`.
 * Returns false if ANY entry can't be statically resolved (spread, non-literal
 * value, computed/unknown key) — the palette is then partial and must be rejected.
 */
function collectStringEntries(obj: t.ObjectExpression, out: TamaguiPalette): boolean {
  for (const prop of obj.properties) {
    if (!t.isObjectProperty(prop)) return false; // SpreadElement, method, getter…
    if (prop.computed) return false; // computed key `[BRAND]` — token name unknown
    const name = keyName(prop.key);
    if (name === null) return false; // unknown key kind
    const value = unwrapExpression(prop.value);
    if (!t.isStringLiteral(value)) return false; // ref, call, number…
    const hex = normalizeColorValue(value.value);
    if (hex === null) return false; // unmatchable format (hsl/named/…) → reject
    out[name] = hex;
  }
  return true;
}

/**
 * Canonicalize a color literal to a hex value that downstream hex-only consumers
 * (colorDistance / nearest-token matching) accept. Returns null for formats that
 * can't be matched (hsl/hsla, named CSS colors, etc.) so the caller rejects the
 * whole palette rather than installing unmatchable entries.
 * - hex (3 or 6 digit): kept (hexToRgb handles both)
 * - rgb()/rgba(): converted to hex, alpha channel dropped (colorDistance ignores
 *   alpha and hexToRgb rejects 8-digit hex)
 */
function normalizeColorValue(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) return trimmed;
  const norm = normalizeComputedColor(trimmed); // rgb()/rgba() → hex (maybe #rrggbbaa)
  if (!norm) return null; // hsl/hsla/named/other → not statically matchable
  return norm.length === 9 ? norm.slice(0, 7) : norm;
}

function isKeyNamed(key: t.Node, name: string): boolean {
  return keyName(key) === name;
}

/** Resolve an object key to its string name (identifier, string, or numeric). */
function keyName(key: t.Node): string | null {
  if (t.isIdentifier(key)) return key.name;
  if (t.isStringLiteral(key)) return key.value;
  if (t.isNumericLiteral(key)) return String(key.value);
  return null;
}
