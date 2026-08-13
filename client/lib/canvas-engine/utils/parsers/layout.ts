/**
 * @file Tailwind layout and flexbox parsing utilities
 *
 * Accessed via: tailwindParser.ts (parseFlexbox, parseOverflow)
 */

import { extractArbitraryValue, SPACING_SCALE } from './modifiers';

export interface ParsedLayoutStyles {
  display?: string;
  flexDirection?: string;
  alignItems?: string;
  justifyContent?: string;
  alignContent?: string;
  justifyItems?: string;
  gap?: string;
  rowGap?: string;
  columnGap?: string;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  overflow?: 'visible' | 'hidden' | 'scroll' | 'auto';
}

export function parseFlexbox(classes: string[]): ParsedLayoutStyles {
  const result: ParsedLayoutStyles = {};

  for (const cls of classes) {
    if (cls === 'flex') result.display = 'flex';
    else if (cls === 'inline-flex') result.display = 'inline-flex';
    else if (cls === 'block') result.display = 'block';
    else if (cls === 'inline-block') result.display = 'inline-block';
    else if (cls === 'grid') result.display = 'grid';
    else if (cls === 'inline-grid') result.display = 'inline-grid';

    if (cls === 'flex-row') result.flexDirection = 'row';
    else if (cls === 'flex-col') result.flexDirection = 'column';
    else if (cls.startsWith('space-y-')) {
      result.display = 'flex';
      result.flexDirection = 'column';
      const value = cls.slice(8);
      const arbValue = extractArbitraryValue(cls);
      result.gap = arbValue || SPACING_SCALE[value] || value;
    } else if (cls.startsWith('space-x-')) {
      result.display = 'flex';
      result.flexDirection = 'row';
      const value = cls.slice(8);
      const arbValue = extractArbitraryValue(cls);
      result.gap = arbValue || SPACING_SCALE[value] || value;
    }

    if (cls === 'items-start') result.alignItems = 'flex-start';
    else if (cls === 'items-center') result.alignItems = 'center';
    else if (cls === 'items-end') result.alignItems = 'flex-end';
    else if (cls === 'items-stretch') result.alignItems = 'stretch';
    else if (cls === 'items-baseline') result.alignItems = 'baseline';

    if (cls === 'justify-start') result.justifyContent = 'flex-start';
    else if (cls === 'justify-center') result.justifyContent = 'center';
    else if (cls === 'justify-end') result.justifyContent = 'flex-end';
    else if (cls === 'justify-between') result.justifyContent = 'space-between';
    else if (cls === 'justify-around') result.justifyContent = 'space-around';
    else if (cls === 'justify-evenly') result.justifyContent = 'space-evenly';

    if (cls === 'content-start') result.alignContent = 'flex-start';
    else if (cls === 'content-center') result.alignContent = 'center';
    else if (cls === 'content-end') result.alignContent = 'flex-end';
    else if (cls === 'content-between') result.alignContent = 'space-between';
    else if (cls === 'content-around') result.alignContent = 'space-around';
    else if (cls === 'content-evenly') result.alignContent = 'space-evenly';
    else if (cls === 'content-stretch') result.alignContent = 'stretch';

    if (cls === 'justify-items-start') result.justifyItems = 'start';
    else if (cls === 'justify-items-center') result.justifyItems = 'center';
    else if (cls === 'justify-items-end') result.justifyItems = 'end';
    else if (cls === 'justify-items-stretch') result.justifyItems = 'stretch';

    if (cls.startsWith('gap-x-')) {
      const value = cls.slice(6);
      const arbValue = extractArbitraryValue(cls);
      result.columnGap = arbValue || SPACING_SCALE[value] || value;
    } else if (cls.startsWith('gap-y-')) {
      const value = cls.slice(6);
      const arbValue = extractArbitraryValue(cls);
      result.rowGap = arbValue || SPACING_SCALE[value] || value;
    } else if (cls.startsWith('gap-')) {
      const value = cls.slice(4);
      const arbValue = extractArbitraryValue(cls);
      result.gap = arbValue || SPACING_SCALE[value] || value;
    }

    if (cls.startsWith('grid-cols-')) {
      const value = cls.slice(10);
      const arbValue = extractArbitraryValue(cls);
      result.gridTemplateColumns = arbValue || value;
    }

    if (cls.startsWith('grid-rows-')) {
      const value = cls.slice(10);
      const arbValue = extractArbitraryValue(cls);
      result.gridTemplateRows = arbValue || value;
    }
  }

  return result;
}

export function parseOverflow(classes: string[]): Pick<ParsedLayoutStyles, 'overflow'> {
  const result: Pick<ParsedLayoutStyles, 'overflow'> = {};

  for (const cls of classes) {
    if (cls === 'overflow-visible') result.overflow = 'visible';
    else if (cls === 'overflow-hidden') result.overflow = 'hidden';
    else if (cls === 'overflow-scroll') result.overflow = 'scroll';
    else if (cls === 'overflow-auto') result.overflow = 'auto';
  }

  return result;
}
