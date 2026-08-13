/**
 * @file Tailwind color and typography parsing utilities
 *
 * Accessed via: tailwindParser.ts (parseColors)
 * Assumptions: tw-to-css library returns rgb() for standard Tailwind colors
 */

import { twj } from 'tw-to-css';
import { extractArbitraryValue } from './modifiers';

export interface ParsedColorStyles {
  backgroundColor?: string;
  backgroundImage?: string;
  fontSize?: string;
  textColor?: string;
  borderColor?: string;
}

function rgbToHex(rgb: string): string | undefined {
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return undefined;
  const [, r, g, b] = match;
  return `#${Number.parseInt(r, 10).toString(16).padStart(2, '0')}${Number.parseInt(g, 10).toString(16).padStart(2, '0')}${Number.parseInt(b, 10).toString(16).padStart(2, '0')}`;
}

function getTailwindColorValue(
  twClass: string,
  property: 'color' | 'backgroundColor' | 'borderColor',
): string | undefined {
  try {
    const styles = twj(twClass);
    const colorValue = styles[property];
    if (colorValue?.startsWith('rgb')) {
      return rgbToHex(colorValue);
    }
    return colorValue;
  } catch (e) {
    console.error('[tw-to-css] Error:', twClass, e);
    return undefined;
  }
}

const TAILWIND_TEXT_SIZE_CLASSES = new Set([
  'text-xs',
  'text-sm',
  'text-base',
  'text-lg',
  'text-xl',
  'text-2xl',
  'text-3xl',
  'text-4xl',
  'text-5xl',
  'text-6xl',
  'text-7xl',
  'text-8xl',
  'text-9xl',
]);

const TAILWIND_TEXT_OTHER_NON_COLOR_CLASSES = new Set([
  'text-wrap',
  'text-nowrap',
  'text-balance',
  'text-pretty',
  'text-left',
  'text-center',
  'text-right',
  'text-justify',
  'text-start',
  'text-end',
]);

function isArbitraryTextSizeValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return /^-?\d*\.?\d+(px|r?em|ex|ch|lh|rlh|vw|vh|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cqw|cqh|cqi|cqmin|cqmax|%)$/.test(
    normalized,
  );
}

function isTailwindTextSizeClass(baseClass: string): boolean {
  if (TAILWIND_TEXT_SIZE_CLASSES.has(baseClass)) return true;
  const match = baseClass.match(/^text-\[(.+)\]$/);
  if (!match) return false;
  return isArbitraryTextSizeValue(match[1]);
}

function isTailwindTextOtherNonColorClass(baseClass: string): boolean {
  return TAILWIND_TEXT_OTHER_NON_COLOR_CLASSES.has(baseClass);
}

function isTailwindTextColorClass(baseClass: string): boolean {
  return (
    baseClass.startsWith('text-') && !isTailwindTextSizeClass(baseClass) && !isTailwindTextOtherNonColorClass(baseClass)
  );
}

const TEXT_SIZE_MAP: Record<string, string> = {
  'text-xs': '0.75rem',
  'text-sm': '0.875rem',
  'text-base': '1rem',
  'text-lg': '1.125rem',
  'text-xl': '1.25rem',
  'text-2xl': '1.5rem',
  'text-3xl': '1.875rem',
  'text-4xl': '2.25rem',
  'text-5xl': '3rem',
  'text-6xl': '3.75rem',
  'text-7xl': '4.5rem',
  'text-8xl': '6rem',
  'text-9xl': '8rem',
};

export function parseColors(classes: string[]): ParsedColorStyles {
  const result: ParsedColorStyles = {};

  for (const cls of classes) {
    if (cls.startsWith('bg-[url(')) {
      const urlMatch = cls.match(/bg-\[url\(['"]?([^'"\)]+)['"]?\)\]/);
      if (urlMatch) {
        result.backgroundImage = urlMatch[1];
      }
    } else if (cls.startsWith('bg-')) {
      const arbValue = extractArbitraryValue(cls);
      if (arbValue) {
        result.backgroundColor = arbValue;
      } else {
        const color = getTailwindColorValue(cls, 'backgroundColor');
        if (color) result.backgroundColor = color;
      }
    } else if (isTailwindTextSizeClass(cls)) {
      const arbValue = extractArbitraryValue(cls);
      if (arbValue && isArbitraryTextSizeValue(arbValue)) {
        result.fontSize = arbValue;
      } else {
        result.fontSize = TEXT_SIZE_MAP[cls];
      }
    } else if (isTailwindTextColorClass(cls)) {
      const arbValue = extractArbitraryValue(cls);
      if (arbValue) {
        result.textColor = arbValue;
      } else {
        const color = getTailwindColorValue(cls, 'color');
        if (color) result.textColor = color;
      }
    } else if (
      cls.startsWith('border-') &&
      !cls.startsWith('border-t') &&
      !cls.startsWith('border-r') &&
      !cls.startsWith('border-b') &&
      !cls.startsWith('border-l')
    ) {
      const arbValue = extractArbitraryValue(cls);
      if (arbValue && (arbValue.includes('#') || arbValue.startsWith('rgb'))) {
        result.borderColor = arbValue;
      } else {
        const color = getTailwindColorValue(cls, 'borderColor');
        if (color) result.borderColor = color;
      }
    }
  }

  return result;
}
