/**
 * @file Pure color utility functions and types for the color picker system
 *
 * Accessed via: Internal module, used by ColorCombobox and its sub-components/hooks
 * Assumptions: Tailwind and Tamagui color data available from respective modules
 */

import {
  findClosestTamaguiColor,
  getTamaguiColorHex,
  getTamaguiColorNames,
  getTamaguiSemanticNames,
  getTamaguiTokenFromHex,
  TAMAGUI_COLORS,
  TAMAGUI_SEMANTIC_TOKENS,
} from '@lib/tamagui/values';
import { colorDistance, contrastRatio, wcagLevel } from '@shared/utils/color';
import { getColorHex, getColorNames, TAILWIND_COLORS } from '@/lib/tailwind/tailwind-values';

export type TokenSystem = 'tailwind' | 'tamagui';

type ColorShades = Record<string, string>;

export interface ColorOption {
  value: string; // token like 'blue-500' or 'blue9'
  hex: string;
  label: string;
  colorName: string;
}

export interface SearchResult extends ColorOption {
  _distance: number;
  _textMatch: boolean;
}

export interface HoveredColorState {
  tokenName: string;
  hex: string;
  sourceLabel?: string;
  pairedHex?: string;
  isTextColor?: boolean;
  anchorRect: DOMRect;
}

export const SPECIAL_CSS_VALUES = new Set(['transparent', 'inherit', 'currentColor']);

/** Get token class from hex value based on system */
export function getTokenFromHex(hex: string, system: TokenSystem): string | null {
  if (!hex) return null;
  const normalizedHex = hex.toLowerCase();

  if (system === 'tamagui') {
    return getTamaguiTokenFromHex(normalizedHex);
  }

  // Tailwind
  if (normalizedHex === '#ffffff') return 'white';
  if (normalizedHex === '#000000') return 'black';
  if (normalizedHex === 'transparent') return 'transparent';

  const colorNames = getColorNames();
  for (const colorName of colorNames) {
    const colorData = TAILWIND_COLORS[colorName as keyof typeof TAILWIND_COLORS];
    if (typeof colorData === 'string') continue;

    for (const [shade, shadeHex] of Object.entries(colorData as ColorShades)) {
      if (shadeHex.toLowerCase() === normalizedHex) {
        return `${colorName}-${shade}`;
      }
    }
  }

  return null;
}

/** Get hex from token based on system */
export function getHexFromToken(token: string, system: TokenSystem): string | null {
  if (system === 'tamagui') {
    return getTamaguiColorHex(token);
  }
  return getColorHex(token);
}

/** Find closest color in the system */
export function findClosestColor(hex: string, system: TokenSystem): { token: string; hex: string } | null {
  if (!hex) return null;

  if (system === 'tamagui') {
    return findClosestTamaguiColor(hex);
  }

  // Tailwind - simplified closest color search
  let closestToken = '';
  let closestHex = '';
  let minDistance = Infinity;

  // Check special colors
  for (const special of [
    { token: 'white', hex: '#ffffff' },
    { token: 'black', hex: '#000000' },
  ]) {
    const distance = colorDistance(hex, special.hex);
    if (distance < minDistance) {
      minDistance = distance;
      closestToken = special.token;
      closestHex = special.hex;
    }
  }

  // Check all palette colors
  const colorNames = getColorNames();
  for (const colorName of colorNames) {
    const colorData = TAILWIND_COLORS[colorName as keyof typeof TAILWIND_COLORS];
    if (typeof colorData === 'string') continue;

    for (const [shade, shadeHex] of Object.entries(colorData as ColorShades)) {
      const distance = colorDistance(hex, shadeHex);
      if (distance < minDistance) {
        minDistance = distance;
        closestToken = `${colorName}-${shade}`;
        closestHex = shadeHex;
      }
    }
  }

  return closestToken ? { token: closestToken, hex: closestHex } : null;
}

/** Generate color options based on token system */
export function generateColorOptions(system: TokenSystem): ColorOption[] {
  const options: ColorOption[] = [];

  if (system === 'tamagui') {
    // Add semantic tokens first (color, background)
    const semanticNames = getTamaguiSemanticNames();
    for (const semanticName of semanticNames) {
      const semanticData = TAMAGUI_SEMANTIC_TOKENS[semanticName as keyof typeof TAMAGUI_SEMANTIC_TOKENS];
      for (const [shade, hex] of Object.entries(semanticData)) {
        options.push({
          value: `${semanticName}${shade}`,
          hex,
          label: `${semanticName}${shade}`,
          colorName: `_${semanticName}`, // Prefix with _ to sort before palette colors
        });
      }
    }

    // Add palette colors
    const colorNames = getTamaguiColorNames();
    for (const colorName of colorNames) {
      const colorData = TAMAGUI_COLORS[colorName as keyof typeof TAMAGUI_COLORS];
      for (const [shade, hex] of Object.entries(colorData)) {
        options.push({
          value: `${colorName}${shade}`,
          hex,
          label: `${colorName}${shade}`,
          colorName,
        });
      }
    }
  } else {
    // Tailwind
    for (const special of [
      { value: 'none', hex: '', label: 'None' },
      { value: 'white', hex: '#ffffff', label: 'White' },
      { value: 'black', hex: '#000000', label: 'Black' },
      { value: 'transparent', hex: 'transparent', label: 'Transparent' },
      { value: 'inherit', hex: 'inherit', label: 'Inherit' },
      { value: 'currentColor', hex: 'currentColor', label: 'Current Color' },
    ]) {
      options.push({ ...special, colorName: 'special' });
    }

    const colorNames = getColorNames();
    for (const colorName of colorNames) {
      const colorData = TAILWIND_COLORS[colorName as keyof typeof TAILWIND_COLORS];
      if (typeof colorData === 'string') continue;

      for (const [shade, hex] of Object.entries(colorData as ColorShades)) {
        options.push({
          value: `${colorName}-${shade}`,
          hex,
          label: `${colorName}-${shade}`,
          colorName,
        });
      }
    }
  }

  return options;
}

/** Group colors by color name */
export function getColorGroups(options: ColorOption[]): Record<string, ColorOption[]> {
  const groups: Record<string, ColorOption[]> = {};

  for (const option of options) {
    if (!groups[option.colorName]) {
      groups[option.colorName] = [];
    }
    groups[option.colorName].push(option);
  }

  return groups;
}

/**
 * Find the nearest color from options that meets the target WCAG level against pairedHex.
 * When preferredGroup is provided, searches that group first and falls back to all options.
 */
export function findNearestPassingColor(
  currentHex: string,
  pairedHex: string,
  options: ColorOption[],
  minLevel: 'AA' | 'AAA' = 'AA',
  preferredGroup?: string,
): ColorOption | null {
  const search = (opts: ColorOption[]) => {
    let best: ColorOption | null = null;
    let bestDist = Infinity;

    for (const opt of opts) {
      const ratio = contrastRatio(opt.hex, pairedHex);
      const level = wcagLevel(ratio);
      if (minLevel === 'AAA' && level !== 'AAA') continue;
      if (minLevel === 'AA' && level === 'Fail') continue;
      const dist = colorDistance(currentHex, opt.hex);
      if (dist < bestDist) {
        bestDist = dist;
        best = opt;
      }
    }
    return best;
  };

  if (preferredGroup) {
    const groupResult = search(options.filter((o) => o.colorName === preferredGroup));
    if (groupResult) return groupResult;
  }

  return search(options);
}
