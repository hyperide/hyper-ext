/**
 * @file Tailwind border parsing utilities
 *
 * Accessed via: tailwindParser.ts (parseBorder)
 */

import { extractArbitraryValue } from './modifiers';

export interface ParsedBorderStyles {
  borderWidth?: string;
  borderTopWidth?: string;
  borderRightWidth?: string;
  borderBottomWidth?: string;
  borderLeftWidth?: string;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  borderRadius?: string;
  borderRadiusTopLeft?: string;
  borderRadiusTopRight?: string;
  borderRadiusBottomLeft?: string;
  borderRadiusBottomRight?: string;
}

const roundedValueMap: Record<string, string> = {
  none: '0px',
  sm: '0.125rem',
  '': '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  '2xl': '1rem',
  '3xl': '1.5rem',
  full: '9999px',
};

export function parseBorder(classes: string[]): ParsedBorderStyles {
  const result: ParsedBorderStyles = {};

  for (const cls of classes) {
    if (cls === 'border') {
      result.borderWidth = '1px';
    } else if (cls.startsWith('border-') && /^border-\d+$/.test(cls)) {
      const value = cls.slice(7);
      result.borderWidth = `${value}px`;
    } else if (cls.startsWith('border-[')) {
      const arbValue = extractArbitraryValue(cls);
      if (
        arbValue &&
        !arbValue.includes('#') &&
        (arbValue.includes('px') || arbValue.includes('rem') || arbValue.includes('em'))
      ) {
        result.borderWidth = arbValue;
      }
    }

    if (cls === 'border-t') {
      result.borderTopWidth = '1px';
    } else if (cls.startsWith('border-t-') && /^border-t-\d+$/.test(cls)) {
      const value = cls.slice(9);
      result.borderTopWidth = `${value}px`;
    } else if (cls.startsWith('border-t-[')) {
      const arbValue = extractArbitraryValue(cls);
      if (
        arbValue &&
        !arbValue.includes('#') &&
        (arbValue.includes('px') || arbValue.includes('rem') || arbValue.includes('em'))
      ) {
        result.borderTopWidth = arbValue;
      }
    }

    if (cls === 'border-r') {
      result.borderRightWidth = '1px';
    } else if (cls.startsWith('border-r-') && /^border-r-\d+$/.test(cls)) {
      const value = cls.slice(9);
      result.borderRightWidth = `${value}px`;
    } else if (cls.startsWith('border-r-[')) {
      const arbValue = extractArbitraryValue(cls);
      if (
        arbValue &&
        !arbValue.includes('#') &&
        (arbValue.includes('px') || arbValue.includes('rem') || arbValue.includes('em'))
      ) {
        result.borderRightWidth = arbValue;
      }
    }

    if (cls === 'border-b') {
      result.borderBottomWidth = '1px';
    } else if (cls.startsWith('border-b-') && /^border-b-\d+$/.test(cls)) {
      const value = cls.slice(9);
      result.borderBottomWidth = `${value}px`;
    } else if (cls.startsWith('border-b-[')) {
      const arbValue = extractArbitraryValue(cls);
      if (
        arbValue &&
        !arbValue.includes('#') &&
        (arbValue.includes('px') || arbValue.includes('rem') || arbValue.includes('em'))
      ) {
        result.borderBottomWidth = arbValue;
      }
    }

    if (cls === 'border-l') {
      result.borderLeftWidth = '1px';
    } else if (cls.startsWith('border-l-') && /^border-l-\d+$/.test(cls)) {
      const value = cls.slice(9);
      result.borderLeftWidth = `${value}px`;
    } else if (cls.startsWith('border-l-[')) {
      const arbValue = extractArbitraryValue(cls);
      if (
        arbValue &&
        !arbValue.includes('#') &&
        (arbValue.includes('px') || arbValue.includes('rem') || arbValue.includes('em'))
      ) {
        result.borderLeftWidth = arbValue;
      }
    }

    if (cls === 'border-solid') result.borderStyle = 'solid';
    else if (cls === 'border-dashed') result.borderStyle = 'dashed';
    else if (cls === 'border-dotted') result.borderStyle = 'dotted';
    else if (cls === 'border-double') result.borderStyle = 'double';
    else if (cls === 'border-none') result.borderStyle = 'none';

    if (
      cls === 'rounded' ||
      (cls.startsWith('rounded-') &&
        !cls.includes('tl-') &&
        !cls.includes('tr-') &&
        !cls.includes('bl-') &&
        !cls.includes('br-'))
    ) {
      if (cls === 'rounded') result.borderRadius = '0.25rem';
      else if (cls === 'rounded-none') result.borderRadius = '0px';
      else if (cls === 'rounded-sm') result.borderRadius = '0.125rem';
      else if (cls === 'rounded-md') result.borderRadius = '0.375rem';
      else if (cls === 'rounded-lg') result.borderRadius = '0.5rem';
      else if (cls === 'rounded-xl') result.borderRadius = '0.75rem';
      else if (cls === 'rounded-2xl') result.borderRadius = '1rem';
      else if (cls === 'rounded-3xl') result.borderRadius = '1.5rem';
      else if (cls === 'rounded-full') result.borderRadius = '9999px';
      else if (cls.startsWith('rounded-[')) {
        const arbValue = extractArbitraryValue(cls);
        if (arbValue) result.borderRadius = arbValue;
      }
    }

    if (cls.startsWith('rounded-tl-')) {
      const value = cls.slice(11);
      const arbValue = extractArbitraryValue(cls);
      result.borderRadiusTopLeft = arbValue || roundedValueMap[value] || value;
    } else if (cls.startsWith('rounded-tr-')) {
      const value = cls.slice(11);
      const arbValue = extractArbitraryValue(cls);
      result.borderRadiusTopRight = arbValue || roundedValueMap[value] || value;
    } else if (cls.startsWith('rounded-bl-')) {
      const value = cls.slice(11);
      const arbValue = extractArbitraryValue(cls);
      result.borderRadiusBottomLeft = arbValue || roundedValueMap[value] || value;
    } else if (cls.startsWith('rounded-br-')) {
      const value = cls.slice(11);
      const arbValue = extractArbitraryValue(cls);
      result.borderRadiusBottomRight = arbValue || roundedValueMap[value] || value;
    }
  }

  return result;
}
