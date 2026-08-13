/**
 * @file Universal color token and style adapters for MCP tools
 *
 * Accessed via: Internal module, not exposed
 * Assumptions: projectUIKit determines which adapter to use
 * Architecture: adapter pattern for multi-framework support (Tailwind, Tamagui, future)
 */

import { parseTailwindClasses } from '@lib/tailwind/parser';
import { isValidTamaguiStyleProp } from '@lib/tamagui/style-props';
import {
  findNearestTamaguiTokens,
  getAllTamaguiColors,
  getTamaguiColorHex,
  TAMAGUI_COLORS,
  TAMAGUI_SEMANTIC_TOKENS,
} from '@lib/tamagui/values';
import { colorDistance, hexToRgb } from '@shared/utils/color';
import twColors from 'tailwindcss/colors';
import type { AstService } from '../../services/AstService';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ColorEntry {
  token: string;
  hex: string;
}

export interface ColorTokenProvider {
  systemName: string;
  listColors(family?: string): ColorEntry[];
  getFamilies(): string[];
  findNearest(hex: string, count: number): Array<ColorEntry & { distance: number }>;
}

type ResolveInput = { className?: string; styleProps?: Record<string, string> };
type ResolveResult =
  | { success: true; styles: Record<string, string>; warning?: string }
  | { success: false; error: string };

export interface StyleAdapter {
  applyStyles(
    astService: AstService,
    filePath: string,
    elementId: string,
    styles: Record<string, string>,
  ): Promise<{ success: boolean; result?: string; warning?: string; error?: string }>;

  resolveStyles(params: ResolveInput): ResolveResult;
}

export type { ResolveInput, ResolveResult };

// ---------------------------------------------------------------------------
// Shared helpers — hexToRgb and colorDistance from @shared/utils/color
// ---------------------------------------------------------------------------

export { colorDistance, hexToRgb };

export function parseAnyColorToHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  // Strip Tailwind arbitrary value brackets: [rgb(...)], [#fff]
  const unwrapped = trimmed.replace(/^\[|\]$/g, '');

  if (unwrapped.startsWith('#') && (unwrapped.length === 4 || unwrapped.length === 7)) {
    if (unwrapped.length === 4) {
      return `#${unwrapped[1]}${unwrapped[1]}${unwrapped[2]}${unwrapped[2]}${unwrapped[3]}${unwrapped[3]}`;
    }
    return unwrapped;
  }

  const rgbMatch = unwrapped.match(/^rgb\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/);
  if (rgbMatch) {
    const r = Math.max(0, Math.min(255, Number.parseInt(rgbMatch[1], 10)));
    const g = Math.max(0, Math.min(255, Number.parseInt(rgbMatch[2], 10)));
    const b = Math.max(0, Math.min(255, Number.parseInt(rgbMatch[3], 10)));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tailwind
// ---------------------------------------------------------------------------

const TW_COLOR_NAMES = [
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
] as const;

function buildTailwindPalette(): ColorEntry[] {
  const entries: ColorEntry[] = [
    { token: 'white', hex: '#ffffff' },
    { token: 'black', hex: '#000000' },
    { token: 'transparent', hex: 'transparent' },
    { token: 'current', hex: 'currentColor' },
    { token: 'inherit', hex: 'inherit' },
  ];
  for (const name of TW_COLOR_NAMES) {
    const palette = twColors[name as keyof typeof twColors];
    if (palette && typeof palette === 'object') {
      for (const [shade, hex] of Object.entries(palette)) {
        if (typeof hex === 'string') {
          entries.push({ token: `${name}-${shade}`, hex: hex.toLowerCase() });
        }
      }
    }
  }
  return entries;
}

const TW_ALL_COLORS = buildTailwindPalette();

class TailwindColorTokenProvider implements ColorTokenProvider {
  readonly systemName = 'Tailwind';

  listColors(family?: string): ColorEntry[] {
    if (!family) return TW_ALL_COLORS;
    const f = family.toLowerCase();
    return TW_ALL_COLORS.filter((c) => c.token === f || c.token.startsWith(`${f}-`));
  }

  getFamilies(): string[] {
    return [...new Set(TW_ALL_COLORS.map((c) => c.token.split('-')[0]))];
  }

  findNearest(hex: string, count: number): Array<ColorEntry & { distance: number }> {
    return TW_ALL_COLORS.map((c) => ({ ...c, distance: colorDistance(hex, c.hex) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, count);
  }
}

// ---------------------------------------------------------------------------
// Tamagui
// ---------------------------------------------------------------------------

class TamaguiColorTokenProvider implements ColorTokenProvider {
  readonly systemName = 'Tamagui';

  listColors(family?: string): ColorEntry[] {
    const all = getAllTamaguiColors();
    if (!family) return all;
    const f = family.toLowerCase();
    return all.filter((c) => {
      const colorName = c.token.replace(/\d+$/, '');
      return colorName === f;
    });
  }

  getFamilies(): string[] {
    return [...Object.keys(TAMAGUI_COLORS), ...Object.keys(TAMAGUI_SEMANTIC_TOKENS)];
  }

  findNearest(hex: string, count: number): Array<ColorEntry & { distance: number }> {
    return findNearestTamaguiTokens(hex, count);
  }
}

// ---------------------------------------------------------------------------
// StyleAdapter — Tailwind
// ---------------------------------------------------------------------------

// Map of Tailwind class prefixes to CSS property names.
// Axis shorthands (px, py, mx, my) map to both sides.
const TW_PREFIX_TO_CSS: Record<string, string | string[]> = {
  bg: 'backgroundColor',
  text: 'color',
  border: 'borderColor',
  ring: 'ringColor',
  shadow: 'shadowColor',
  p: 'padding',
  px: ['paddingLeft', 'paddingRight'],
  py: ['paddingTop', 'paddingBottom'],
  pt: 'paddingTop',
  pr: 'paddingRight',
  pb: 'paddingBottom',
  pl: 'paddingLeft',
  m: 'margin',
  mx: ['marginLeft', 'marginRight'],
  my: ['marginTop', 'marginBottom'],
  mt: 'marginTop',
  mr: 'marginRight',
  mb: 'marginBottom',
  ml: 'marginLeft',
  w: 'width',
  h: 'height',
  gap: 'gap',
  rounded: 'borderRadius',
  opacity: 'opacity',
};

// Derive regex from map keys — single source of truth
// Sort by length descending so longer prefixes match first (e.g. "px" before "p")
const TW_KEY_PREFIXES = Object.keys(TW_PREFIX_TO_CSS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const TW_KEY_PREFIX_RE = new RegExp(`^(${TW_KEY_PREFIXES})-(.+)$`);

// SYNC: subset of TW_PREFIX_TO_CSS — only prefixes that map to color CSS properties
const TW_COLOR_PREFIXES = ['bg', 'text', 'border', 'ring', 'shadow'];
const TW_VALUE_PREFIX_RE = new RegExp(`^(${TW_COLOR_PREFIXES.join('|')})-(.+)$`);

/**
 * Normalize styles input from AI agents that may pass Tailwind classes
 * instead of CSS properties, or mix formats.
 */
function normalizeStylesInput(raw: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'className' || key === 'class') continue;

    const twPrefixMatch = key.match(TW_KEY_PREFIX_RE);
    if (twPrefixMatch && (!value || value === 'true')) {
      const cssKey = TW_PREFIX_TO_CSS[twPrefixMatch[1]];
      if (cssKey) {
        if (Array.isArray(cssKey)) {
          for (const k of cssKey) result[k] = twPrefixMatch[2];
        } else {
          result[cssKey] = twPrefixMatch[2];
        }
        continue;
      }
    }

    const valueTwMatch = value.match(TW_VALUE_PREFIX_RE);
    if (valueTwMatch) {
      const cssKey = TW_PREFIX_TO_CSS[valueTwMatch[1]] ?? key;
      result[cssKey] = valueTwMatch[2];
      continue;
    }

    result[key] = value;
  }
  return result;
}

class TailwindStyleAdapter implements StyleAdapter {
  resolveStyles(params: ResolveInput): ResolveResult {
    if (params.styleProps) {
      return {
        success: false,
        error:
          "This is a Tailwind project. Pass { className: 'flex gap-4 bg-blue-500' } instead of styleProps. styleProps is for Tamagui projects.",
      };
    }
    if (!params.className) {
      return {
        success: false,
        error: "className is required for Tailwind projects. Example: { className: 'flex gap-4 bg-blue-500' }",
      };
    }
    const parsed = parseTailwindClasses(params.className);
    const styles: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined) styles[k] = String(v);
    }
    return { success: true, styles };
  }

  async applyStyles(astService: AstService, filePath: string, elementId: string, styles: Record<string, string>) {
    const normalized = normalizeStylesInput(styles);
    const result = await astService.updateStyles(filePath, elementId, normalized);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    const resultText = result.className ? `className="${result.className}"` : 'Styles updated';

    // Check for arbitrary color values
    const arbitraryColors = (result.className ?? '').match(
      /(?:bg|text|border|ring|shadow)-\[[^\]]*(?:rgb|hsl|#)[^\]]*\]/g,
    );
    if (arbitraryColors) {
      return {
        success: true,
        result: resultText,
        warning:
          `Arbitrary color values detected (${arbitraryColors.join(', ')}). ` +
          'These may not match the project design system. ' +
          'Use hyper_suggest_color_token to find the nearest design token.',
      };
    }

    return { success: true, result: resultText };
  }
}

// ---------------------------------------------------------------------------
// StyleAdapter — Tamagui
// ---------------------------------------------------------------------------

const COLOR_PROPS = new Set([
  'backgroundColor',
  'color',
  'borderColor',
  'borderTopColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRightColor',
  'shadowColor',
]);

// Max Euclidean RGB distance to auto-map a hex value to a Tamagui token.
// ~30 ≈ small perceptual shift (e.g. off-by-one shade). Beyond this, keep raw value and warn.
const TAMAGUI_AUTO_MAP_MAX_DISTANCE = 30;

class TamaguiStyleAdapter implements StyleAdapter {
  resolveStyles(params: ResolveInput): ResolveResult {
    if (params.className) {
      return {
        success: false,
        error:
          "This is a Tamagui project. Pass { styleProps: { backgroundColor: '$blue9' } } instead of className. className is for Tailwind projects.",
      };
    }
    if (!params.styleProps) {
      return {
        success: false,
        error:
          "styleProps is required for Tamagui projects. Example: { styleProps: { backgroundColor: '$blue9', padding: 16 } }",
      };
    }

    const unknownProps = Object.keys(params.styleProps).filter((k) => !isValidTamaguiStyleProp(k));
    const resolved: Record<string, string> = {};

    for (const [key, value] of Object.entries(params.styleProps)) {
      // Defensive: MCP input from external AI agents may bypass Zod at runtime
      if (typeof value !== 'string') continue;
      if (value.startsWith('$')) {
        const hex = getTamaguiColorHex(value);
        resolved[key] = hex ?? value;
      } else {
        resolved[key] = value;
      }
    }

    const warning =
      unknownProps.length > 0
        ? `Unknown style properties: ${unknownProps.join(', ')}. Valid Tamagui props include: backgroundColor, color, padding, display, flex, etc.`
        : undefined;

    return { success: true, styles: resolved, warning };
  }

  async applyStyles(astService: AstService, filePath: string, elementId: string, styles: Record<string, string>) {
    const tamaguiProps: Record<string, unknown> = {};
    let hasRawHex = false;

    for (const [key, value] of Object.entries(styles)) {
      if (COLOR_PROPS.has(key)) {
        const hex = parseAnyColorToHex(value);
        if (hex) {
          const nearest = tamaguiColorProvider.findNearest(hex, 1);
          if (nearest.length > 0 && nearest[0].distance <= TAMAGUI_AUTO_MAP_MAX_DISTANCE) {
            tamaguiProps[key] = `$${nearest[0].token}`;
          } else {
            tamaguiProps[key] = value;
            hasRawHex = true;
          }
        } else {
          // Already a token like $blue9
          tamaguiProps[key] = value;
        }
      } else {
        tamaguiProps[key] = value;
      }
    }

    const result = await astService.updateProps(filePath, elementId, tamaguiProps);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    const warning = hasRawHex
      ? 'Some color values could not be mapped to Tamagui tokens. Use hyper_suggest_color_token to find the nearest token.'
      : undefined;

    return { success: true, result: 'Props updated', warning };
  }
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const tailwindColorProvider = new TailwindColorTokenProvider();
const tamaguiColorProvider = new TamaguiColorTokenProvider();

export function getColorTokenProvider(uiKit: string | undefined): ColorTokenProvider {
  if (uiKit === 'tamagui') return tamaguiColorProvider;
  return tailwindColorProvider;
}

const tailwindStyleAdapter = new TailwindStyleAdapter();
const tamaguiStyleAdapter = new TamaguiStyleAdapter();

export function getStyleAdapter(uiKit: string | undefined): StyleAdapter {
  if (uiKit === 'tamagui') return tamaguiStyleAdapter;
  return tailwindStyleAdapter;
}
