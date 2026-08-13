/**
 * @file Token scale data and lookup utilities for Nudge HUD
 *
 * Accessed via: Internal module, not exposed
 * Assumptions: Tailwind and Tamagui adapter scales are hardcoded from standard configs
 * Tradeoffs: Hardcoded scales avoid runtime config parsing; scales must be updated when frameworks update
 */

import colors from 'tailwindcss/colors';
// SYNC: lib/tailwind/parser.ts → SPACING_SCALE
import { SPACING_SCALE } from '../tailwind/parser';
import { TAMAGUI_COLORS } from '../tamagui/values';

export type AdapterName = 'tailwind' | 'tamagui';

export interface TokenEntry {
  token: string;
  value: string;
  px: number;
}

export type NearestTokenResult = TokenEntry & { exact: boolean };

export interface AdjacentTokens {
  prev: TokenEntry | null;
  next: TokenEntry | null;
  first: TokenEntry;
  last: TokenEntry;
}

interface TokenScaleOptions {
  colorFamily?: string;
}

const REM_BASE = 16;

function remToPx(rem: string): number {
  const val = Number.parseFloat(rem);
  return Number.isNaN(val) ? 0 : val * REM_BASE;
}

/** For scale construction only: converts known-good values (rem, px, bare number) to px. Returns 0 for unrecognized formats. */
function knownValueToPx(value: string): number {
  if (value.endsWith('rem')) return remToPx(value);
  if (value.endsWith('px')) return Number.parseFloat(value);
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// Tailwind scales
// ---------------------------------------------------------------------------

export const TAILWIND_COLOR_FAMILIES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
];

function buildTailwindSpacingScale(prefix: string): TokenEntry[] {
  return Object.entries(SPACING_SCALE)
    .filter(([, value]) => value !== 'auto')
    .map(([key, value]) => ({
      token: `${prefix}${key}`,
      value,
      px: knownValueToPx(value),
    }))
    .sort((a, b) => a.px - b.px);
}

const TAILWIND_RADIUS_SCALE: TokenEntry[] = [
  { token: 'rounded-none', value: '0px', px: 0 },
  { token: 'rounded-sm', value: '0.125rem', px: 2 },
  { token: 'rounded', value: '0.25rem', px: 4 },
  { token: 'rounded-md', value: '0.375rem', px: 6 },
  { token: 'rounded-lg', value: '0.5rem', px: 8 },
  { token: 'rounded-xl', value: '0.75rem', px: 12 },
  { token: 'rounded-2xl', value: '1rem', px: 16 },
  { token: 'rounded-3xl', value: '1.5rem', px: 24 },
  { token: 'rounded-full', value: '9999px', px: 9999 },
];

// SYNC: lib/tailwind/generator.ts → validOpacities
const TAILWIND_OPACITY_SCALE: TokenEntry[] = [
  { token: 'opacity-0', value: '0', px: 0 },
  { token: 'opacity-5', value: '5', px: 5 },
  { token: 'opacity-10', value: '10', px: 10 },
  { token: 'opacity-20', value: '20', px: 20 },
  { token: 'opacity-25', value: '25', px: 25 },
  { token: 'opacity-30', value: '30', px: 30 },
  { token: 'opacity-40', value: '40', px: 40 },
  { token: 'opacity-50', value: '50', px: 50 },
  { token: 'opacity-60', value: '60', px: 60 },
  { token: 'opacity-70', value: '70', px: 70 },
  { token: 'opacity-75', value: '75', px: 75 },
  { token: 'opacity-80', value: '80', px: 80 },
  { token: 'opacity-90', value: '90', px: 90 },
  { token: 'opacity-95', value: '95', px: 95 },
  { token: 'opacity-100', value: '100', px: 100 },
];

const TAILWIND_BORDER_WIDTH_SCALE: TokenEntry[] = [
  { token: 'border-0', value: '0px', px: 0 },
  { token: 'border', value: '1px', px: 1 },
  { token: 'border-2', value: '2px', px: 2 },
  { token: 'border-4', value: '4px', px: 4 },
  { token: 'border-8', value: '8px', px: 8 },
];

const TAILWIND_FONT_SIZE_SCALE: TokenEntry[] = [
  { token: 'text-xs', value: '0.75rem', px: 12 },
  { token: 'text-sm', value: '0.875rem', px: 14 },
  { token: 'text-base', value: '1rem', px: 16 },
  { token: 'text-lg', value: '1.125rem', px: 18 },
  { token: 'text-xl', value: '1.25rem', px: 20 },
  { token: 'text-2xl', value: '1.5rem', px: 24 },
  { token: 'text-3xl', value: '1.875rem', px: 30 },
  { token: 'text-4xl', value: '2.25rem', px: 36 },
  { token: 'text-5xl', value: '3rem', px: 48 },
  { token: 'text-6xl', value: '3.75rem', px: 60 },
  { token: 'text-7xl', value: '4.5rem', px: 72 },
  { token: 'text-8xl', value: '6rem', px: 96 },
  { token: 'text-9xl', value: '8rem', px: 128 },
];

const TAILWIND_LINE_HEIGHT_SCALE: TokenEntry[] = [
  { token: 'leading-none', value: '1', px: 1 },
  { token: 'leading-tight', value: '1.25', px: 1.25 },
  { token: 'leading-snug', value: '1.375', px: 1.375 },
  { token: 'leading-normal', value: '1.5', px: 1.5 },
  { token: 'leading-relaxed', value: '1.625', px: 1.625 },
  { token: 'leading-loose', value: '2', px: 2 },
  { token: 'leading-3', value: '0.75rem', px: 12 },
  { token: 'leading-4', value: '1rem', px: 16 },
  { token: 'leading-5', value: '1.25rem', px: 20 },
  { token: 'leading-6', value: '1.5rem', px: 24 },
  { token: 'leading-7', value: '1.75rem', px: 28 },
  { token: 'leading-8', value: '2rem', px: 32 },
  { token: 'leading-9', value: '2.25rem', px: 36 },
  { token: 'leading-10', value: '2.5rem', px: 40 },
];

const TAILWIND_LETTER_SPACING_SCALE: TokenEntry[] = [
  { token: 'tracking-tighter', value: '-0.05em', px: -0.05 * REM_BASE },
  { token: 'tracking-tight', value: '-0.025em', px: -0.025 * REM_BASE },
  { token: 'tracking-normal', value: '0em', px: 0 },
  { token: 'tracking-wide', value: '0.025em', px: 0.025 * REM_BASE },
  { token: 'tracking-wider', value: '0.05em', px: 0.05 * REM_BASE },
  { token: 'tracking-widest', value: '0.1em', px: 0.1 * REM_BASE },
];

// Color shades ordered for Tailwind (50, 100, 200, ..., 900, 950)
const TAILWIND_COLOR_SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

function buildTailwindColorScale(colorFamily: string): TokenEntry[] {
  const palette = colors[colorFamily as keyof typeof colors];
  if (!palette || typeof palette !== 'object') return [];

  return TAILWIND_COLOR_SHADES.flatMap((shade) => {
    const hex = (palette as Record<string, string>)[shade];
    if (!hex) return [];
    return [{ token: `${colorFamily}-${shade}`, value: hex.toLowerCase(), px: 0 }];
  });
}

// ---------------------------------------------------------------------------
// Tamagui scales
// ---------------------------------------------------------------------------

export const TAMAGUI_COLOR_FAMILIES = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'cyan',
  'teal',
];

// SYNC: @tamagui/config/v4 default spacing tokens
const TAMAGUI_SPACING_ENTRIES: Array<[string, number]> = [
  ['$0', 0],
  ['$0.25', 1],
  ['$0.5', 2],
  ['$0.75', 3],
  ['$1', 4],
  ['$1.5', 6],
  ['$2', 8],
  ['$2.5', 10],
  ['$3', 12],
  ['$3.5', 14],
  ['$4', 16],
  ['$4.5', 18],
  ['$5', 20],
  ['$6', 24],
  ['$7', 28],
  ['$8', 32],
  ['$9', 36],
  ['$10', 40],
  ['$12', 48],
  ['$14', 56],
  ['$16', 64],
  ['$20', 80],
  ['$24', 96],
  ['$32', 128],
  ['$40', 160],
  ['$48', 192],
  ['$56', 224],
  ['$64', 256],
];

const TAMAGUI_SPACING_SCALE: TokenEntry[] = TAMAGUI_SPACING_ENTRIES.map(([token, px]) => ({
  token,
  value: px === 0 ? '0px' : `${px}px`,
  px,
}));

function buildTamaguiColorScale(colorFamily: string): TokenEntry[] {
  const palette = TAMAGUI_COLORS[colorFamily as keyof typeof TAMAGUI_COLORS];
  if (!palette) return [];
  return Object.entries(palette).map(([shade, hex]) => ({
    token: `$${colorFamily}${shade}`,
    value: hex,
    px: 0,
  }));
}

// ---------------------------------------------------------------------------
// Properties that use the spacing scale
// ---------------------------------------------------------------------------

const SPACING_PROPERTIES = new Set([
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'gap',
  'rowGap',
  'columnGap',
  'top',
  'right',
  'bottom',
  'left',
]);

// SYNC: client/components/NudgeHUD/TokenMode.tsx → COLOR_PROPERTIES
export const COLOR_PROPERTIES = new Set([
  'backgroundColor',
  'color',
  'borderColor',
  'outlineColor',
  'shadowColor',
  'fill',
  'stroke',
]);

const TAILWIND_SPACING_PREFIXES: Record<string, string> = {
  width: 'w-',
  height: 'h-',
  minWidth: 'min-w-',
  minHeight: 'min-h-',
  maxWidth: 'max-w-',
  maxHeight: 'max-h-',
  padding: 'p-',
  paddingTop: 'pt-',
  paddingRight: 'pr-',
  paddingBottom: 'pb-',
  paddingLeft: 'pl-',
  margin: 'm-',
  marginTop: 'mt-',
  marginRight: 'mr-',
  marginBottom: 'mb-',
  marginLeft: 'ml-',
  gap: 'gap-',
  rowGap: 'gap-y-',
  columnGap: 'gap-x-',
  top: 'top-',
  right: 'right-',
  bottom: 'bottom-',
  left: 'left-',
};

// ---------------------------------------------------------------------------
// Special values per property
// ---------------------------------------------------------------------------

const TAILWIND_SPECIAL_VALUES: Record<string, string[]> = {
  width: ['auto', 'full', 'screen', 'fit', 'min', 'max'],
  height: ['auto', 'full', 'screen', 'fit', 'min', 'max'],
  minWidth: ['full', 'min', 'max', 'fit'],
  minHeight: ['full', 'screen', 'fit'],
  maxWidth: ['none', 'full', 'screen', 'fit', 'min', 'max'],
  maxHeight: ['none', 'full', 'screen', 'fit'],
  margin: ['auto'],
  marginTop: ['auto'],
  marginRight: ['auto'],
  marginBottom: ['auto'],
  marginLeft: ['auto'],
  top: ['auto'],
  right: ['auto'],
  bottom: ['auto'],
  left: ['auto'],
  overflow: ['visible', 'hidden', 'scroll', 'auto'],
};

const TAMAGUI_SPECIAL_VALUES: Record<string, string[]> = {
  width: ['auto'],
  height: ['auto'],
  minWidth: ['auto'],
  minHeight: ['auto'],
  maxWidth: ['auto'],
  maxHeight: ['auto'],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getTokenScale(styleKey: string, adapter: AdapterName, options?: TokenScaleOptions): TokenEntry[] {
  if (adapter === 'tailwind') {
    if (COLOR_PROPERTIES.has(styleKey)) {
      if (!options?.colorFamily) return [];
      return buildTailwindColorScale(options.colorFamily);
    }
    if (styleKey === 'borderRadius') return TAILWIND_RADIUS_SCALE;
    if (styleKey === 'opacity') return TAILWIND_OPACITY_SCALE;
    if (styleKey === 'borderWidth') return TAILWIND_BORDER_WIDTH_SCALE;
    if (styleKey === 'fontSize') return TAILWIND_FONT_SIZE_SCALE;
    if (styleKey === 'lineHeight') return TAILWIND_LINE_HEIGHT_SCALE;
    if (styleKey === 'letterSpacing') return TAILWIND_LETTER_SPACING_SCALE;
    if (SPACING_PROPERTIES.has(styleKey)) {
      const prefix = TAILWIND_SPACING_PREFIXES[styleKey];
      if (!prefix) return [];
      return buildTailwindSpacingScale(prefix);
    }
    return [];
  }

  if (adapter === 'tamagui') {
    if (COLOR_PROPERTIES.has(styleKey)) {
      if (!options?.colorFamily) return [];
      return buildTamaguiColorScale(options.colorFamily);
    }
    if (styleKey === 'opacity') return [];
    if (SPACING_PROPERTIES.has(styleKey)) return TAMAGUI_SPACING_SCALE;
    return [];
  }

  return [];
}

/** Parses a CSS value (px or rem) into a pixel number. Returns null if not parseable as numeric. */
function parseValueToPx(value: string): number | null {
  if (value.endsWith('px')) {
    const n = Number.parseFloat(value);
    return Number.isNaN(n) ? null : n;
  }
  if (value.endsWith('rem')) {
    const n = Number.parseFloat(value);
    return Number.isNaN(n) ? null : n * REM_BASE;
  }
  // bare number
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(value);
}

export function findNearestToken(value: string, scale: TokenEntry[]): NearestTokenResult | null {
  if (scale.length === 0) return null;

  // Try exact token name match first (e.g. '$4', 'w-4', 'rounded-lg')
  const tokenMatch = scale.find((entry) => entry.token === value);
  if (tokenMatch) return { ...tokenMatch, exact: true };

  // Color scale: match by exact hex string
  if (isHexColor(value)) {
    const normalized = value.toLowerCase();
    const match = scale.find((entry) => entry.value.toLowerCase() === normalized);
    if (match) return { ...match, exact: true };
    return null;
  }

  const targetPx = parseValueToPx(value);
  if (targetPx === null) return null;

  let nearest: TokenEntry | null = null;
  let minDist = Infinity;

  for (const entry of scale) {
    const dist = Math.abs(entry.px - targetPx);
    if (dist < minDist) {
      minDist = dist;
      nearest = entry;
    }
  }

  if (!nearest) return null;
  return { ...nearest, exact: minDist === 0 };
}

export function getAdjacentTokens(tokenName: string, scale: TokenEntry[]): AdjacentTokens {
  const idx = scale.findIndex((e) => e.token === tokenName);
  const first = scale[0];
  const last = scale[scale.length - 1];

  if (idx === -1) {
    return { prev: null, next: null, first, last };
  }

  return {
    prev: idx > 0 ? scale[idx - 1] : null,
    next: idx < scale.length - 1 ? scale[idx + 1] : null,
    first,
    last,
  };
}

export function getSpecialValues(styleKey: string, adapter: AdapterName): string[] {
  if (adapter === 'tailwind') return TAILWIND_SPECIAL_VALUES[styleKey] ?? [];
  if (adapter === 'tamagui') return TAMAGUI_SPECIAL_VALUES[styleKey] ?? [];
  return [];
}

export function getNeighboringFamilies(
  family: string,
  adapter: AdapterName,
): { prev: string | null; next: string | null } {
  const families = adapter === 'tailwind' ? TAILWIND_COLOR_FAMILIES : TAMAGUI_COLOR_FAMILIES;
  const idx = families.indexOf(family);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? families[idx - 1] : null,
    next: idx < families.length - 1 ? families[idx + 1] : null,
  };
}
