/**
 * @file Tailwind sizing and spacing parsing utilities
 *
 * Accessed via: tailwindParser.ts (parseSizing, parsePadding, parseMargin)
 */

import { extractArbitraryValue, SPACING_SCALE } from './modifiers';

export interface ParsedSizingStyles {
  width?: string;
  height?: string;
  minWidth?: string;
  minHeight?: string;
  maxWidth?: string;
  maxHeight?: string;
}

export interface ParsedSpacingStyles {
  padding?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
}

export function parseSizing(classes: string[]): ParsedSizingStyles {
  const result: ParsedSizingStyles = {};

  for (const cls of classes) {
    if (cls.startsWith('w-')) {
      const value = cls.slice(2);
      const arbValue = extractArbitraryValue(cls);
      result.width = arbValue || SPACING_SCALE[value] || value;
    } else if (cls.startsWith('h-')) {
      const value = cls.slice(2);
      const arbValue = extractArbitraryValue(cls);
      result.height = arbValue || SPACING_SCALE[value] || value;
    } else if (cls.startsWith('min-w-')) {
      const value = cls.slice(6);
      const arbValue = extractArbitraryValue(cls);
      result.minWidth = arbValue || SPACING_SCALE[value] || value;
    } else if (cls.startsWith('min-h-')) {
      const value = cls.slice(6);
      const arbValue = extractArbitraryValue(cls);
      result.minHeight = arbValue || SPACING_SCALE[value] || value;
    } else if (cls.startsWith('max-w-')) {
      const value = cls.slice(6);
      const arbValue = extractArbitraryValue(cls);
      result.maxWidth = arbValue || SPACING_SCALE[value] || value;
    } else if (cls.startsWith('max-h-')) {
      const value = cls.slice(6);
      const arbValue = extractArbitraryValue(cls);
      result.maxHeight = arbValue || SPACING_SCALE[value] || value;
    }
  }

  return result;
}

export function parsePadding(classes: string[]): ParsedSpacingStyles {
  const padding: ParsedSpacingStyles['padding'] = {};

  for (const cls of classes) {
    if (cls.startsWith('p-')) {
      const value = cls.slice(2);
      const arbValue = extractArbitraryValue(cls);
      const twValue = arbValue || value;
      padding.top = padding.right = padding.bottom = padding.left = twValue;
    } else if (cls.startsWith('px-')) {
      const value = cls.slice(3);
      const arbValue = extractArbitraryValue(cls);
      const twValue = arbValue || value;
      padding.left = padding.right = twValue;
    } else if (cls.startsWith('py-')) {
      const value = cls.slice(3);
      const arbValue = extractArbitraryValue(cls);
      const twValue = arbValue || value;
      padding.top = padding.bottom = twValue;
    } else if (cls.startsWith('pt-')) {
      const value = cls.slice(3);
      const arbValue = extractArbitraryValue(cls);
      padding.top = arbValue || value;
    } else if (cls.startsWith('pr-')) {
      const value = cls.slice(3);
      const arbValue = extractArbitraryValue(cls);
      padding.right = arbValue || value;
    } else if (cls.startsWith('pb-')) {
      const value = cls.slice(3);
      const arbValue = extractArbitraryValue(cls);
      padding.bottom = arbValue || value;
    } else if (cls.startsWith('pl-')) {
      const value = cls.slice(3);
      const arbValue = extractArbitraryValue(cls);
      padding.left = arbValue || value;
    }
  }

  return Object.keys(padding).length > 0 ? { padding } : {};
}

export function parseMargin(classes: string[]): ParsedSpacingStyles {
  const margin: ParsedSpacingStyles['margin'] = {};

  for (const cls of classes) {
    const isNegative = cls.startsWith('-');
    const cleanCls = isNegative ? cls.slice(1) : cls;

    if (cleanCls.startsWith('m-')) {
      const value = cleanCls.slice(2);
      const arbValue = extractArbitraryValue(cleanCls);
      let cssValue = arbValue || SPACING_SCALE[value] || value;
      if (isNegative) cssValue = `-${cssValue}`;
      margin.top = margin.right = margin.bottom = margin.left = cssValue;
    } else if (cleanCls.startsWith('mx-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      let cssValue = arbValue || SPACING_SCALE[value] || value;
      if (isNegative) cssValue = `-${cssValue}`;
      margin.left = margin.right = cssValue;
    } else if (cleanCls.startsWith('my-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      let cssValue = arbValue || SPACING_SCALE[value] || value;
      if (isNegative) cssValue = `-${cssValue}`;
      margin.top = margin.bottom = cssValue;
    } else if (cleanCls.startsWith('mt-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      let cssValue = arbValue || SPACING_SCALE[value] || value;
      if (isNegative) cssValue = `-${cssValue}`;
      margin.top = cssValue;
    } else if (cleanCls.startsWith('mr-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      let cssValue = arbValue || SPACING_SCALE[value] || value;
      if (isNegative) cssValue = `-${cssValue}`;
      margin.right = cssValue;
    } else if (cleanCls.startsWith('mb-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      let cssValue = arbValue || SPACING_SCALE[value] || value;
      if (isNegative) cssValue = `-${cssValue}`;
      margin.bottom = cssValue;
    } else if (cleanCls.startsWith('ml-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      let cssValue = arbValue || SPACING_SCALE[value] || value;
      if (isNegative) cssValue = `-${cssValue}`;
      margin.left = cssValue;
    }
  }

  return Object.keys(margin).length > 0 ? { margin } : {};
}
