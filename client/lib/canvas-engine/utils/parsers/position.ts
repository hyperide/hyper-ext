/**
 * @file Tailwind position parsing utilities
 *
 * Accessed via: tailwindParser.ts (parsePosition)
 */

import { extractArbitraryValue, SPACING_SCALE } from './modifiers';

export interface ParsedPositionStyles {
  position?: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

export function parsePosition(classes: string[]): ParsedPositionStyles {
  const result: ParsedPositionStyles = {};

  for (const cls of classes) {
    if (cls === 'static') result.position = 'static';
    else if (cls === 'relative') result.position = 'relative';
    else if (cls === 'absolute') result.position = 'absolute';
    else if (cls === 'fixed') result.position = 'fixed';
    else if (cls === 'sticky') result.position = 'sticky';

    const isNegative = cls.startsWith('-');
    const cleanCls = isNegative ? cls.slice(1) : cls;

    if (cleanCls.startsWith('top-')) {
      const value = cleanCls.slice(4);
      const arbValue = extractArbitraryValue(cleanCls);
      result.top = arbValue || SPACING_SCALE[value] || value;
      if (isNegative && result.top) result.top = `-${result.top}`;
    } else if (cleanCls.startsWith('right-')) {
      const value = cleanCls.slice(6);
      const arbValue = extractArbitraryValue(cleanCls);
      result.right = arbValue || SPACING_SCALE[value] || value;
      if (isNegative && result.right) result.right = `-${result.right}`;
    } else if (cleanCls.startsWith('bottom-')) {
      const value = cleanCls.slice(7);
      const arbValue = extractArbitraryValue(cleanCls);
      result.bottom = arbValue || SPACING_SCALE[value] || value;
      if (isNegative && result.bottom) result.bottom = `-${result.bottom}`;
    } else if (cleanCls.startsWith('left-')) {
      const value = cleanCls.slice(5);
      const arbValue = extractArbitraryValue(cleanCls);
      result.left = arbValue || SPACING_SCALE[value] || value;
      if (isNegative && result.left) result.left = `-${result.left}`;
    }
  }

  return result;
}
