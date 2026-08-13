/**
 * Tamagui token constants for use in UI pickers
 * Based on @tamagui/config which uses Radix colors
 * @see https://www.radix-ui.com/colors
 */

import { colorDistance } from '@shared/utils/color';

/**
 * Tamagui color palette with hex values (Radix colors)
 * Scale: 1 = lightest, 12 = darkest for most colors
 */
/**
 * Tamagui semantic tokens (theme-dependent)
 * These map to gray scale by default in light theme
 * $color = text color, $background = bg color
 */
export const TAMAGUI_SEMANTIC_TOKENS = {
  // Text colors (1=lightest, 12=darkest)
  color: {
    1: '#fcfcfc',
    2: '#f9f9f9',
    3: '#f0f0f0',
    4: '#e8e8e8',
    5: '#e0e0e0',
    6: '#d9d9d9',
    7: '#cecece',
    8: '#bbbbbb',
    9: '#8d8d8d',
    10: '#838383',
    11: '#646464',
    12: '#202020',
  },
  // Background colors
  background: {
    1: '#fcfcfc',
    2: '#f9f9f9',
    3: '#f0f0f0',
    4: '#e8e8e8',
    5: '#e0e0e0',
    6: '#d9d9d9',
    7: '#cecece',
    8: '#bbbbbb',
    9: '#8d8d8d',
    10: '#838383',
    11: '#646464',
    12: '#202020',
  },
};

export const TAMAGUI_COLORS = {
  gray: {
    1: '#fcfcfc',
    2: '#f9f9f9',
    3: '#f0f0f0',
    4: '#e8e8e8',
    5: '#e0e0e0',
    6: '#d9d9d9',
    7: '#cecece',
    8: '#bbbbbb',
    9: '#8d8d8d',
    10: '#838383',
    11: '#646464',
    12: '#202020',
  },
  red: {
    1: '#fffcfc',
    2: '#fff7f7',
    3: '#feebec',
    4: '#ffdbdc',
    5: '#ffcdce',
    6: '#fdbdbe',
    7: '#f4a9aa',
    8: '#eb8e90',
    9: '#e5484d',
    10: '#dc3e42',
    11: '#ce2c31',
    12: '#641723',
  },
  orange: {
    1: '#fefcfb',
    2: '#fff7ed',
    3: '#ffefd6',
    4: '#ffdfb5',
    5: '#ffd19a',
    6: '#ffc182',
    7: '#f5ae73',
    8: '#ec9455',
    9: '#f76b15',
    10: '#ef5f00',
    11: '#cc4e00',
    12: '#582d1d',
  },
  yellow: {
    1: '#fdfdf9',
    2: '#fefce9',
    3: '#fffab8',
    4: '#fff394',
    5: '#ffe770',
    6: '#f3d768',
    7: '#e4c767',
    8: '#d5ae39',
    9: '#ffe629',
    10: '#ffdc00',
    11: '#9e6c00',
    12: '#473b1f',
  },
  green: {
    1: '#fbfefc',
    2: '#f4fbf6',
    3: '#e6f6eb',
    4: '#d6f1df',
    5: '#c4e8d1',
    6: '#adddc0',
    7: '#8eceaa',
    8: '#5bb98b',
    9: '#30a46c',
    10: '#2b9a66',
    11: '#218358',
    12: '#193b2d',
  },
  blue: {
    1: '#fbfdff',
    2: '#f4faff',
    3: '#e6f4fe',
    4: '#d5efff',
    5: '#c2e5ff',
    6: '#acd8fc',
    7: '#8ec8f6',
    8: '#5eb1ef',
    9: '#0090ff',
    10: '#0588f0',
    11: '#0d74ce',
    12: '#113264',
  },
  purple: {
    1: '#fefcfe',
    2: '#fbf7fe',
    3: '#f7edfe',
    4: '#f2e2fc',
    5: '#ead5f9',
    6: '#e0c4f4',
    7: '#d1afec',
    8: '#be93e4',
    9: '#8e4ec6',
    10: '#8347b9',
    11: '#8145b5',
    12: '#402060',
  },
  pink: {
    1: '#fffcfe',
    2: '#fef7fb',
    3: '#fee9f5',
    4: '#fbdcef',
    5: '#f6cee7',
    6: '#efbfdd',
    7: '#e7acd0',
    8: '#dd93c2',
    9: '#d6409f',
    10: '#cf3897',
    11: '#c2298a',
    12: '#651249',
  },
  cyan: {
    1: '#fafdfe',
    2: '#f2fafb',
    3: '#def7f9',
    4: '#caf1f6',
    5: '#b5e9f0',
    6: '#9ddde7',
    7: '#7dcfdc',
    8: '#3db9cf',
    9: '#00a2c7',
    10: '#0797b9',
    11: '#107d98',
    12: '#0d3c48',
  },
  teal: {
    1: '#fafefd',
    2: '#f3fbf9',
    3: '#e0f8f3',
    4: '#ccf3ea',
    5: '#b8eae0',
    6: '#a1ded2',
    7: '#83cdc1',
    8: '#53b9ab',
    9: '#12a594',
    10: '#0d9b8a',
    11: '#008573',
    12: '#0d3d38',
  },
};

/**
 * Project-derived color palette (flat token → hex), installed at runtime by the
 * Tamagui palette loader when a project ships a parseable `tokens.color`. When
 * null (the default), all readers fall back to the hardcoded Radix palette.
 * See parse-config-colors.ts and HYP-288.
 */
let _activePalette: Record<string, string> | null = null;

/**
 * Install (or clear) the active project color palette. An empty palette is
 * treated as no override. Clears the getAllTamaguiColors cache so subsequent
 * reads reflect the new palette.
 */
export function setTamaguiPalette(palette: Record<string, string> | null): void {
  _activePalette = palette && Object.keys(palette).length > 0 ? palette : null;
  _cachedAllColors = null;
}

/**
 * Get all available color names (palette colors). When a project palette is
 * active, families are derived from its token names (digits stripped).
 */
export function getTamaguiColorNames(): string[] {
  if (_activePalette) {
    const families = new Set<string>();
    for (const token of Object.keys(_activePalette)) {
      families.add(token.replace(/\d+$/, ''));
    }
    return [...families];
  }
  return Object.keys(TAMAGUI_COLORS);
}

/**
 * Get all semantic token names
 */
export function getTamaguiSemanticNames(): string[] {
  return Object.keys(TAMAGUI_SEMANTIC_TOKENS);
}

/**
 * Get hex color for a Tamagui token
 * @example getTamaguiColorHex('blue9') => '#0090ff'
 * @example getTamaguiColorHex('$blue9') => '#0090ff'
 * @example getTamaguiColorHex('$color11') => '#646464' (semantic token)
 */
export function getTamaguiColorHex(token: string): string | null {
  // Remove $ prefix if present
  const cleanToken = token.startsWith('$') ? token.slice(1) : token;

  // Active project palette wins — it's a flat token → hex map. Resolution is
  // limited to the project palette plus the (still-advertised) semantic tokens;
  // hardcoded Radix tokens are deliberately NOT resolvable so we never hand out
  // a token that listColors()/getFamilies() hide.
  if (_activePalette) {
    const fromPalette = _activePalette[cleanToken];
    if (fromPalette) return fromPalette;
    const m = cleanToken.match(/^([a-z]+)(\d+)$/i);
    if (m) {
      const semanticData = TAMAGUI_SEMANTIC_TOKENS[m[1].toLowerCase() as keyof typeof TAMAGUI_SEMANTIC_TOKENS];
      if (semanticData) {
        const shadeNum = Number.parseInt(m[2], 10) as keyof typeof semanticData;
        return semanticData[shadeNum] || null;
      }
    }
    return null;
  }

  // Parse color name and shade
  const match = cleanToken.match(/^([a-z]+)(\d+)$/i);
  if (!match) return null;

  const [, colorName, shade] = match;
  const colorNameLower = colorName.toLowerCase();

  // Check semantic tokens first (color, background)
  const semanticData = TAMAGUI_SEMANTIC_TOKENS[colorNameLower as keyof typeof TAMAGUI_SEMANTIC_TOKENS];
  if (semanticData) {
    const shadeNum = Number.parseInt(shade, 10) as keyof typeof semanticData;
    return semanticData[shadeNum] || null;
  }

  // Then check palette colors
  const colorData = TAMAGUI_COLORS[colorNameLower as keyof typeof TAMAGUI_COLORS];
  if (!colorData) return null;

  const shadeNum = Number.parseInt(shade, 10) as keyof typeof colorData;
  return colorData[shadeNum] || null;
}

/**
 * Get Tamagui token from hex value
 * Prefers palette colors over semantic tokens (since semantic tokens map to gray by default).
 * Falls back to semantic tokens when no palette match is found — useful for custom themes
 * where semantic token hex values differ from the default gray scale.
 * @example getTamaguiTokenFromHex('#0090ff') => 'blue9'
 * @example getTamaguiTokenFromHex('#646464') => 'gray11' (palette wins over color11/background11)
 */
export function getTamaguiTokenFromHex(hex: string): string | null {
  if (!hex) return null;
  const normalizedHex = hex.toLowerCase();

  // Active project palette wins — flat token → hex map.
  if (_activePalette) {
    for (const [token, tokenHex] of Object.entries(_activePalette)) {
      if (tokenHex.toLowerCase() === normalizedHex) return token;
    }
    // Semantic tokens stay advertised (getAllTamaguiColors/getFamilies include
    // them), so the reverse lookup must check them too — but NOT the hardcoded
    // Radix palette, which the project palette replaced.
    for (const [semanticName, shades] of Object.entries(TAMAGUI_SEMANTIC_TOKENS)) {
      for (const [shade, shadeHex] of Object.entries(shades)) {
        if (shadeHex.toLowerCase() === normalizedHex) return `${semanticName}${shade}`;
      }
    }
    return null;
  }

  // Check palette colors first (more specific)
  for (const [colorName, shades] of Object.entries(TAMAGUI_COLORS)) {
    for (const [shade, shadeHex] of Object.entries(shades)) {
      if (shadeHex.toLowerCase() === normalizedHex) {
        return `${colorName}${shade}`;
      }
    }
  }

  // Fallback: check semantic tokens (e.g. custom themes where semantic hex differs from palette)
  for (const [semanticName, shades] of Object.entries(TAMAGUI_SEMANTIC_TOKENS)) {
    for (const [shade, shadeHex] of Object.entries(shades)) {
      if (shadeHex.toLowerCase() === normalizedHex) {
        return `${semanticName}${shade}`;
      }
    }
  }

  return null;
}

/**
 * Get all Tamagui colors as a flat list of {token, hex} entries (palette + semantic).
 * Palette tokens come first so stable sort prefers them over semantic tokens at equal distance.
 */
let _cachedAllColors: Array<{ token: string; hex: string }> | null = null;

export function getAllTamaguiColors(): Array<{ token: string; hex: string }> {
  if (_cachedAllColors) return _cachedAllColors;
  const entries: Array<{ token: string; hex: string }> = [];
  if (_activePalette) {
    // Project palette replaces the hardcoded Radix scale; semantic tokens
    // (theme-level $color/$background) stay as a reasonable default.
    for (const [token, hex] of Object.entries(_activePalette)) {
      entries.push({ token, hex });
    }
  } else {
    for (const [colorName, shades] of Object.entries(TAMAGUI_COLORS)) {
      for (const [shade, shadeHex] of Object.entries(shades)) {
        entries.push({ token: `${colorName}${shade}`, hex: shadeHex });
      }
    }
  }
  for (const [semanticName, shades] of Object.entries(TAMAGUI_SEMANTIC_TOKENS)) {
    for (const [shade, shadeHex] of Object.entries(shades)) {
      entries.push({ token: `${semanticName}${shade}`, hex: shadeHex });
    }
  }
  _cachedAllColors = entries;
  return entries;
}

/**
 * Find closest Tamagui color to a given hex
 */
export function findClosestTamaguiColor(hex: string): { token: string; hex: string } | null {
  if (!hex) return null;
  const results = findNearestTamaguiTokens(hex, 1);
  return results.length > 0 ? { token: results[0].token, hex: results[0].hex } : null;
}

/**
 * Find N nearest Tamagui color tokens to a given hex value, sorted by distance.
 */
export function findNearestTamaguiTokens(
  hex: string,
  count: number,
): Array<{ token: string; hex: string; distance: number }> {
  if (!hex) return [];
  return getAllTamaguiColors()
    .map((c) => ({ ...c, distance: colorDistance(hex, c.hex) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}
