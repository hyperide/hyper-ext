/**
 * Tailwind CSS Classes Parser
 * Parses Tailwind classes and extracts CSS values
 */

import { twj } from 'tw-to-css';

/**
 * Convert rgb/rgba color string to hex format
 */
function rgbToHex(rgb: string): string | undefined {
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return undefined;
  const [, r, g, b] = match;
  return `#${Number.parseInt(r, 10).toString(16).padStart(2, '0')}${Number.parseInt(g, 10).toString(16).padStart(2, '0')}${Number.parseInt(b, 10).toString(16).padStart(2, '0')}`;
}

/**
 * Get CSS color value from Tailwind class using tw-to-css
 * Converts rgb() format to hex for UI compatibility
 */
function getTailwindColorValue(
  twClass: string,
  property: 'color' | 'backgroundColor' | 'borderColor',
): string | undefined {
  try {
    const styles = twj(twClass);
    console.log('[tw-to-css]', twClass, '->', styles);
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

export interface ParsedTailwindStyles {
  position?: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  width?: string;
  height?: string;
  minWidth?: string;
  minHeight?: string;
  maxWidth?: string;
  maxHeight?: string;
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
  backgroundColor?: string;
  backgroundImage?: string;
  textColor?: string;
  borderColor?: string;
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
  opacity?: string;
  shadow?: string;
  shadowColor?: string;
  shadowOpacity?: string;
  shadowX?: string;
  shadowY?: string;
  shadowBlur?: string;
  shadowSpread?: string;
  blur?: string;
  transitionProperty?: string;
  transitionDuration?: string;
  transitionTiming?: string;
  transform?: string;

  // State-specific styles (Tailwind modifiers like hover:, focus:, etc.)
  hover?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  focus?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  active?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  focusVisible?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  disabled?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  groupHover?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  groupFocus?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  focusWithin?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
}

// Tailwind spacing scale (0-96 + auto)
const SPACING_SCALE: Record<string, string> = {
  '0': '0px',
  px: '1px',
  '0.5': '0.125rem',
  '1': '0.25rem',
  '1.5': '0.375rem',
  '2': '0.5rem',
  '2.5': '0.625rem',
  '3': '0.75rem',
  '3.5': '0.875rem',
  '4': '1rem',
  '5': '1.25rem',
  '6': '1.5rem',
  '7': '1.75rem',
  '8': '2rem',
  '9': '2.25rem',
  '10': '2.5rem',
  '11': '2.75rem',
  '12': '3rem',
  '14': '3.5rem',
  '16': '4rem',
  '20': '5rem',
  '24': '6rem',
  '28': '7rem',
  '32': '8rem',
  '36': '9rem',
  '40': '10rem',
  '44': '11rem',
  '48': '12rem',
  '52': '13rem',
  '56': '14rem',
  '60': '15rem',
  '64': '16rem',
  '72': '18rem',
  '80': '20rem',
  '96': '24rem',
  auto: 'auto',
};

// Extract arbitrary value from Tailwind class like w-[227px]
function extractArbitraryValue(className: string): string | null {
  const match = className.match(/\[([^\]]+)\]/);
  return match ? match[1] : null;
}

/**
 * Extract state modifier from Tailwind class (hover:, focus:, etc.)
 * @returns { modifier: string | null, baseClass: string }
 * @example 'hover:bg-blue-700' => { modifier: 'hover', baseClass: 'bg-blue-700' }
 */
function extractModifier(className: string): {
  modifier: string | null;
  baseClass: string;
} {
  const match = className.match(/^([a-z-]+):(.*)/);
  if (match) {
    return { modifier: match[1], baseClass: match[2] };
  }
  return { modifier: null, baseClass: className };
}

/**
 * Group classes by modifier (base classes, hover classes, focus classes, etc.)
 */
function groupClassesByModifier(classes: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {
    base: [],
  };

  for (const cls of classes) {
    const { modifier, baseClass } = extractModifier(cls);
    const key = modifier || 'base';

    if (!groups[key]) {
      groups[key] = [];
    }

    groups[key].push(baseClass);
  }

  return groups;
}

// Parse position classes
function parsePosition(
  classes: string[],
): Pick<ParsedTailwindStyles, 'position' | 'top' | 'right' | 'bottom' | 'left'> {
  const result: Pick<ParsedTailwindStyles, 'position' | 'top' | 'right' | 'bottom' | 'left'> = {};

  for (const cls of classes) {
    // Position type
    if (cls === 'static') result.position = 'static';
    else if (cls === 'relative') result.position = 'relative';
    else if (cls === 'absolute') result.position = 'absolute';
    else if (cls === 'fixed') result.position = 'fixed';
    else if (cls === 'sticky') result.position = 'sticky';

    // Position values
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

// Parse width and height
function parseSizing(
  classes: string[],
): Pick<ParsedTailwindStyles, 'width' | 'height' | 'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight'> {
  const result: Pick<ParsedTailwindStyles, 'width' | 'height' | 'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight'> =
    {};

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

// Parse padding - returns Tailwind values (e.g., "4", "6") not CSS values (e.g., "1rem", "1.5rem")
function parsePadding(classes: string[]): {
  padding?: ParsedTailwindStyles['padding'];
} {
  const padding: ParsedTailwindStyles['padding'] = {};

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

// Parse margin
function parseMargin(classes: string[]): {
  margin?: ParsedTailwindStyles['margin'];
} {
  const margin: ParsedTailwindStyles['margin'] = {};

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

// Parse colors using tw-to-css for accurate Tailwind color resolution
function parseColors(
  classes: string[],
): Pick<ParsedTailwindStyles, 'backgroundColor' | 'backgroundImage' | 'textColor' | 'borderColor'> {
  const result: Pick<ParsedTailwindStyles, 'backgroundColor' | 'backgroundImage' | 'textColor' | 'borderColor'> = {};

  for (const cls of classes) {
    // Background image: bg-\[url('/path/to/image.png')\]
    if (cls.startsWith('bg-[url(')) {
      // Extract URL from bg-\[url('...')\] or bg-\[url("...")\] or bg-\[url(...)\]
      const urlMatch = cls.match(/bg-\[url\(['"]?([^'")\]]+)['"]?\)\]/);
      if (urlMatch) {
        result.backgroundImage = urlMatch[1];
      }
    } else if (cls.startsWith('bg-')) {
      const arbValue = extractArbitraryValue(cls);
      if (arbValue) {
        result.backgroundColor = arbValue;
      } else {
        // Use tw-to-css to get accurate color value
        const color = getTailwindColorValue(cls, 'backgroundColor');
        if (color) result.backgroundColor = color;
      }
    } else if (cls.startsWith('text-')) {
      const arbValue = extractArbitraryValue(cls);
      if (arbValue) {
        result.textColor = arbValue;
      } else {
        // Use tw-to-css - it returns undefined for non-color text classes (like text-lg)
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
      if (arbValue) {
        // Check if arbitrary value is a color (has #) not a width
        if (arbValue.includes('#') || arbValue.startsWith('rgb')) {
          result.borderColor = arbValue;
        }
      } else {
        // Use tw-to-css - it returns undefined for non-color border classes (like border-2)
        const color = getTailwindColorValue(cls, 'borderColor');
        if (color) result.borderColor = color;
      }
    }
  }

  return result;
}

// Parse border
function parseBorder(
  classes: string[],
): Pick<
  ParsedTailwindStyles,
  | 'borderWidth'
  | 'borderTopWidth'
  | 'borderRightWidth'
  | 'borderBottomWidth'
  | 'borderLeftWidth'
  | 'borderStyle'
  | 'borderRadius'
  | 'borderRadiusTopLeft'
  | 'borderRadiusTopRight'
  | 'borderRadiusBottomLeft'
  | 'borderRadiusBottomRight'
> {
  const result: Pick<
    ParsedTailwindStyles,
    | 'borderWidth'
    | 'borderTopWidth'
    | 'borderRightWidth'
    | 'borderBottomWidth'
    | 'borderLeftWidth'
    | 'borderStyle'
    | 'borderRadius'
    | 'borderRadiusTopLeft'
    | 'borderRadiusTopRight'
    | 'borderRadiusBottomLeft'
    | 'borderRadiusBottomRight'
  > = {};

  // Helper to map rounded class value to CSS value
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

  for (const cls of classes) {
    // General border width
    if (cls === 'border') {
      result.borderWidth = '1px';
    } else if (cls.startsWith('border-') && /^border-\d+$/.test(cls)) {
      const value = cls.slice(7);
      result.borderWidth = `${value}px`;
    } else if (cls.startsWith('border-[')) {
      // Arbitrary value for border width (e.g., border-[9px])
      const arbValue = extractArbitraryValue(cls);
      // Check if it's a width value (has px/rem/em) not a color (has #)
      if (
        arbValue &&
        !arbValue.includes('#') &&
        (arbValue.includes('px') || arbValue.includes('rem') || arbValue.includes('em'))
      ) {
        result.borderWidth = arbValue;
      }
    }

    // Side-specific border widths
    // Top
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

    // Right
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

    // Bottom
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

    // Left
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

    // Border style
    if (cls === 'border-solid') {
      result.borderStyle = 'solid';
    } else if (cls === 'border-dashed') {
      result.borderStyle = 'dashed';
    } else if (cls === 'border-dotted') {
      result.borderStyle = 'dotted';
    } else if (cls === 'border-double') {
      result.borderStyle = 'double';
    } else if (cls === 'border-none') {
      result.borderStyle = 'none';
    }

    // General rounded classes
    if (
      cls === 'rounded' ||
      (cls.startsWith('rounded-') &&
        !cls.includes('tl-') &&
        !cls.includes('tr-') &&
        !cls.includes('bl-') &&
        !cls.includes('br-'))
    ) {
      if (cls === 'rounded') {
        result.borderRadius = '0.25rem';
      } else if (cls === 'rounded-none') {
        result.borderRadius = '0px';
      } else if (cls === 'rounded-sm') {
        result.borderRadius = '0.125rem';
      } else if (cls === 'rounded-md') {
        result.borderRadius = '0.375rem';
      } else if (cls === 'rounded-lg') {
        result.borderRadius = '0.5rem';
      } else if (cls === 'rounded-xl') {
        result.borderRadius = '0.75rem';
      } else if (cls === 'rounded-2xl') {
        result.borderRadius = '1rem';
      } else if (cls === 'rounded-3xl') {
        result.borderRadius = '1.5rem';
      } else if (cls === 'rounded-full') {
        result.borderRadius = '9999px';
      } else if (cls.startsWith('rounded-[')) {
        const arbValue = extractArbitraryValue(cls);
        if (arbValue) result.borderRadius = arbValue;
      }
    }

    // Individual corner classes: rounded-tl-*, rounded-tr-*, rounded-bl-*, rounded-br-*
    if (cls.startsWith('rounded-tl-')) {
      const value = cls.slice(11);
      const arbValue = extractArbitraryValue(cls);
      if (arbValue) {
        result.borderRadiusTopLeft = arbValue;
      } else {
        result.borderRadiusTopLeft = roundedValueMap[value] || value;
      }
    } else if (cls.startsWith('rounded-tr-')) {
      const value = cls.slice(11);
      const arbValue = extractArbitraryValue(cls);
      if (arbValue) {
        result.borderRadiusTopRight = arbValue;
      } else {
        result.borderRadiusTopRight = roundedValueMap[value] || value;
      }
    } else if (cls.startsWith('rounded-bl-')) {
      const value = cls.slice(11);
      const arbValue = extractArbitraryValue(cls);
      if (arbValue) {
        result.borderRadiusBottomLeft = arbValue;
      } else {
        result.borderRadiusBottomLeft = roundedValueMap[value] || value;
      }
    } else if (cls.startsWith('rounded-br-')) {
      const value = cls.slice(11);
      const arbValue = extractArbitraryValue(cls);
      if (arbValue) {
        result.borderRadiusBottomRight = arbValue;
      } else {
        result.borderRadiusBottomRight = roundedValueMap[value] || value;
      }
    }
  }

  return result;
}

// Parse flexbox and grid layout
function parseFlexbox(
  classes: string[],
): Pick<
  ParsedTailwindStyles,
  | 'display'
  | 'flexDirection'
  | 'alignItems'
  | 'justifyContent'
  | 'alignContent'
  | 'justifyItems'
  | 'gap'
  | 'rowGap'
  | 'columnGap'
  | 'gridTemplateColumns'
  | 'gridTemplateRows'
> {
  const result: Pick<
    ParsedTailwindStyles,
    | 'display'
    | 'flexDirection'
    | 'alignItems'
    | 'justifyContent'
    | 'alignContent'
    | 'justifyItems'
    | 'gap'
    | 'rowGap'
    | 'columnGap'
    | 'gridTemplateColumns'
    | 'gridTemplateRows'
  > = {};

  for (const cls of classes) {
    if (cls === 'flex') {
      result.display = 'flex';
    } else if (cls === 'inline-flex') {
      result.display = 'inline-flex';
    } else if (cls === 'block') {
      result.display = 'block';
    } else if (cls === 'inline-block') {
      result.display = 'inline-block';
    } else if (cls === 'grid') {
      result.display = 'grid';
    } else if (cls === 'inline-grid') {
      result.display = 'inline-grid';
    }

    if (cls === 'flex-row') {
      result.flexDirection = 'row';
    } else if (cls === 'flex-col') {
      result.flexDirection = 'column';
    } else if (cls.startsWith('space-y-')) {
      // space-y-* implies flex column direction with gap
      result.display = 'flex';
      result.flexDirection = 'column';
      const value = cls.slice(8);
      const arbValue = extractArbitraryValue(cls);
      result.gap = arbValue || SPACING_SCALE[value] || value;
    } else if (cls.startsWith('space-x-')) {
      // space-x-* implies flex row direction with gap
      result.display = 'flex';
      result.flexDirection = 'row';
      const value = cls.slice(8);
      const arbValue = extractArbitraryValue(cls);
      result.gap = arbValue || SPACING_SCALE[value] || value;
    }

    // align-items (items-*)
    if (cls === 'items-start') {
      result.alignItems = 'flex-start';
    } else if (cls === 'items-center') {
      result.alignItems = 'center';
    } else if (cls === 'items-end') {
      result.alignItems = 'flex-end';
    } else if (cls === 'items-stretch') {
      result.alignItems = 'stretch';
    } else if (cls === 'items-baseline') {
      result.alignItems = 'baseline';
    }

    // justify-content (justify-*)
    if (cls === 'justify-start') {
      result.justifyContent = 'flex-start';
    } else if (cls === 'justify-center') {
      result.justifyContent = 'center';
    } else if (cls === 'justify-end') {
      result.justifyContent = 'flex-end';
    } else if (cls === 'justify-between') {
      result.justifyContent = 'space-between';
    } else if (cls === 'justify-around') {
      result.justifyContent = 'space-around';
    } else if (cls === 'justify-evenly') {
      result.justifyContent = 'space-evenly';
    }

    // align-content (content-*)
    if (cls === 'content-start') {
      result.alignContent = 'flex-start';
    } else if (cls === 'content-center') {
      result.alignContent = 'center';
    } else if (cls === 'content-end') {
      result.alignContent = 'flex-end';
    } else if (cls === 'content-between') {
      result.alignContent = 'space-between';
    } else if (cls === 'content-around') {
      result.alignContent = 'space-around';
    } else if (cls === 'content-evenly') {
      result.alignContent = 'space-evenly';
    } else if (cls === 'content-stretch') {
      result.alignContent = 'stretch';
    }

    // justify-items (justify-items-*)
    if (cls === 'justify-items-start') {
      result.justifyItems = 'start';
    } else if (cls === 'justify-items-center') {
      result.justifyItems = 'center';
    } else if (cls === 'justify-items-end') {
      result.justifyItems = 'end';
    } else if (cls === 'justify-items-stretch') {
      result.justifyItems = 'stretch';
    }

    // Gap parsing - handle gap-x-*, gap-y-*, and gap-*
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

    // Grid template columns: grid-cols-1, grid-cols-2, ..., grid-cols-12, grid-cols-none, grid-cols-subgrid
    if (cls.startsWith('grid-cols-')) {
      const value = cls.slice(10);
      const arbValue = extractArbitraryValue(cls);
      // Return just the number for standard classes (e.g., "4" for grid-cols-4)
      // or the full arbitrary value (e.g., "200px_1fr" for grid-cols-[200px_1fr])
      result.gridTemplateColumns = arbValue || value;
    }

    // Grid template rows: grid-rows-1, grid-rows-2, ..., grid-rows-12, grid-rows-none, grid-rows-subgrid
    if (cls.startsWith('grid-rows-')) {
      const value = cls.slice(10);
      const arbValue = extractArbitraryValue(cls);
      result.gridTemplateRows = arbValue || value;
    }
  }

  return result;
}

// Parse overflow
function parseOverflow(classes: string[]): Pick<ParsedTailwindStyles, 'overflow'> {
  const result: Pick<ParsedTailwindStyles, 'overflow'> = {};

  for (const cls of classes) {
    if (cls === 'overflow-visible') {
      result.overflow = 'visible';
    } else if (cls === 'overflow-hidden') {
      result.overflow = 'hidden';
    } else if (cls === 'overflow-scroll') {
      result.overflow = 'scroll';
    } else if (cls === 'overflow-auto') {
      result.overflow = 'auto';
    }
  }

  return result;
}

// Parse opacity
function parseOpacity(classes: string[]): Pick<ParsedTailwindStyles, 'opacity'> {
  const result: Pick<ParsedTailwindStyles, 'opacity'> = {};

  for (const cls of classes) {
    if (cls.startsWith('opacity-')) {
      const value = cls.slice(8);
      const arbValue = extractArbitraryValue(cls);
      if (arbValue) {
        // Arbitrary value in CSS is 0-1, convert to UI range 0-100 (0.12 -> 12)
        const uiValue = Number.parseFloat(arbValue) * 100;
        result.opacity = uiValue.toString();
      } else {
        // Tailwind opacity values: 0, 5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95, 100
        result.opacity = value;
      }
    }
  }

  return result;
}

// Parse shadow
function parseShadow(
  classes: string[],
): Pick<
  ParsedTailwindStyles,
  'shadow' | 'shadowColor' | 'shadowOpacity' | 'shadowX' | 'shadowY' | 'shadowBlur' | 'shadowSpread'
> {
  const result: Pick<
    ParsedTailwindStyles,
    'shadow' | 'shadowColor' | 'shadowOpacity' | 'shadowX' | 'shadowY' | 'shadowBlur' | 'shadowSpread'
  > = {};

  for (const cls of classes) {
    if (cls === 'shadow') {
      result.shadow = 'default';
    } else if (cls === 'shadow-sm') {
      result.shadow = 'sm';
    } else if (cls === 'shadow-md') {
      result.shadow = 'md';
    } else if (cls === 'shadow-lg') {
      result.shadow = 'lg';
    } else if (cls === 'shadow-xl') {
      result.shadow = 'xl';
    } else if (cls === 'shadow-2xl') {
      result.shadow = '2xl';
    } else if (cls === 'shadow-inner') {
      result.shadow = 'inner';
    } else if (cls === 'shadow-none') {
      result.shadow = 'none';
    } else if (cls.startsWith('shadow-[')) {
      // Parse arbitrary value: shadow-[0_10px_15px_-3px_rgba(255,0,0,0.5)] or shadow-[0_20px_25px_-5px_#c90303]
      // Or just color for presets: shadow-[#ff0000ff]
      const match = cls.match(/shadow-\[([^\]]+)\]/);
      if (match) {
        const shadowValue = match[1].replace(/_/g, ' ');

        // Check if it's just a color (for preset shadow colors)
        const justColorMatch = shadowValue.match(/^#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
        if (justColorMatch) {
          // This is a color-only arbitrary value (for preset shadows)
          result.shadowColor = justColorMatch[0];
          result.shadowOpacity = '100'; // Will be parsed from alpha channel if present
          // Don't set shadowX/Y/blur/spread - this indicates it's a preset
        } else {
          // Try to extract rgba color
          const rgbaMatch = shadowValue.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          if (rgbaMatch) {
            const [, r, g, b, a] = rgbaMatch;
            // Convert to hex
            const hex = `#${Number.parseInt(r, 10).toString(16).padStart(2, '0')}${Number.parseInt(g, 10).toString(16).padStart(2, '0')}${Number.parseInt(b, 10).toString(16).padStart(2, '0')}`;
            result.shadowColor = hex;
            result.shadowOpacity = a ? `${Math.round(Number.parseFloat(a) * 100)}` : '100';
          } else {
            // Try to extract hex color (e.g., #c90303)
            const hexMatch = shadowValue.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/);
            if (hexMatch) {
              result.shadowColor = hexMatch[0];
              result.shadowOpacity = '100'; // Hex colors in shadows are assumed to be 100% opaque
            }
          }
        }

        // Parse concrete shadow values: h-offset v-offset blur spread color
        // e.g., "0px 1px 3px 10px rgba(201,3,3,0.3)"
        // Skip if it's just a color (for preset shadows with custom color)
        const parts = shadowValue.split(/\s+/);
        if (!justColorMatch && parts.length >= 4) {
          result.shadowX = parts[0];
          result.shadowY = parts[1];
          result.shadowBlur = parts[2];
          result.shadowSpread = parts[3];

          // Also determine shadow size for backwards compatibility
          const vOffset = parts[1];
          const blur = parts[2];

          // Map common Tailwind shadow patterns
          if (vOffset === '1px' && blur === '2px') {
            result.shadow = 'sm';
          } else if (vOffset === '1px' && blur === '3px') {
            result.shadow = 'default';
          } else if (vOffset === '4px' && blur === '6px') {
            result.shadow = 'md';
          } else if (vOffset === '10px' && blur === '15px') {
            result.shadow = 'lg';
          } else if (vOffset === '20px' && blur === '25px') {
            result.shadow = 'xl';
          } else if (vOffset === '25px' && blur === '50px') {
            result.shadow = '2xl';
          } else if (shadowValue.includes('inset')) {
            result.shadow = 'inner';
          } else {
            // Default if we can't determine
            result.shadow = 'default';
          }
        } else if (!justColorMatch && parts.length >= 3) {
          // Old format without spread: h-offset v-offset blur color
          result.shadowX = parts[0];
          result.shadowY = parts[1];
          result.shadowBlur = parts[2];
          result.shadowSpread = '0';
        }
      }
    }
  }

  return result;
}

// Parse blur
function parseBlur(classes: string[]): Pick<ParsedTailwindStyles, 'blur'> {
  const result: Pick<ParsedTailwindStyles, 'blur'> = {};

  for (const cls of classes) {
    if (cls === 'blur') {
      result.blur = 'default';
    } else if (cls === 'blur-sm') {
      result.blur = 'sm';
    } else if (cls === 'blur-md') {
      result.blur = 'md';
    } else if (cls === 'blur-lg') {
      result.blur = 'lg';
    } else if (cls === 'blur-xl') {
      result.blur = 'xl';
    } else if (cls === 'blur-2xl') {
      result.blur = '2xl';
    } else if (cls === 'blur-3xl') {
      result.blur = '3xl';
    } else if (cls === 'blur-none') {
      result.blur = 'none';
    }
  }

  return result;
}

// Parse transitions
function parseTransition(
  classes: string[],
): Pick<ParsedTailwindStyles, 'transitionProperty' | 'transitionDuration' | 'transitionTiming'> {
  const result: Pick<ParsedTailwindStyles, 'transitionProperty' | 'transitionDuration' | 'transitionTiming'> = {};

  for (const cls of classes) {
    // Transition property
    if (cls === 'transition' || cls === 'transition-all') {
      result.transitionProperty = 'all';
    } else if (cls === 'transition-colors') {
      result.transitionProperty = 'colors';
    } else if (cls === 'transition-opacity') {
      result.transitionProperty = 'opacity';
    } else if (cls === 'transition-transform') {
      result.transitionProperty = 'transform';
    } else if (cls === 'transition-none') {
      result.transitionProperty = 'none';
    }

    // Duration
    if (cls.startsWith('duration-')) {
      const value = cls.slice(9);
      result.transitionDuration = value;
    }

    // Timing function
    if (cls === 'ease-linear') {
      result.transitionTiming = 'linear';
    } else if (cls === 'ease-in') {
      result.transitionTiming = 'in';
    } else if (cls === 'ease-out') {
      result.transitionTiming = 'out';
    } else if (cls === 'ease-in-out') {
      result.transitionTiming = 'in-out';
    }
  }

  return result;
}

/**
 * Convert modifier name to camelCase key for TypeScript
 * @example 'focus-visible' => 'focusVisible', 'group-hover' => 'groupHover'
 */
function modifierToCamelCase(modifier: string): string {
  return modifier.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Parse Tailwind classes and extract CSS values
 * Supports state modifiers like hover:, focus:, etc.
 */
export function parseTailwindClasses(className: string): ParsedTailwindStyles {
  if (!className) return {};

  const classes = className.split(/\s+/).filter(Boolean);
  const groups = groupClassesByModifier(classes);

  const result: ParsedTailwindStyles = {};

  // Parse base styles (classes without modifiers)
  if (groups.base && groups.base.length > 0) {
    Object.assign(result, {
      ...parsePosition(groups.base),
      ...parseSizing(groups.base),
      ...parsePadding(groups.base),
      ...parseMargin(groups.base),
      ...parseColors(groups.base),
      ...parseBorder(groups.base),
      ...parseFlexbox(groups.base),
      ...parseOverflow(groups.base),
      ...parseOpacity(groups.base),
      ...parseShadow(groups.base),
      ...parseBlur(groups.base),
      ...parseTransition(groups.base),
    });
  }

  // Parse state-specific styles (hover, focus, etc.)
  const stateModifiers = [
    'hover',
    'focus',
    'active',
    'focus-visible',
    'disabled',
    'group-hover',
    'group-focus',
    'focus-within',
  ];

  for (const modifier of stateModifiers) {
    if (groups[modifier] && groups[modifier].length > 0) {
      const stateKey = modifierToCamelCase(modifier) as
        | 'hover'
        | 'focus'
        | 'active'
        | 'focusVisible'
        | 'disabled'
        | 'groupHover'
        | 'groupFocus'
        | 'focusWithin';

      result[stateKey] = {
        ...parsePosition(groups[modifier]),
        ...parseSizing(groups[modifier]),
        ...parsePadding(groups[modifier]),
        ...parseMargin(groups[modifier]),
        ...parseColors(groups[modifier]),
        ...parseBorder(groups[modifier]),
        ...parseFlexbox(groups[modifier]),
        ...parseOverflow(groups[modifier]),
        ...parseOpacity(groups[modifier]),
        ...parseShadow(groups[modifier]),
        ...parseBlur(groups[modifier]),
        ...parseTransition(groups[modifier]),
      };
    }
  }

  return result;
}

/**
 * Map CSS properties to their Tailwind classes from DOM className
 * Used to tell AI which classes correspond to which properties
 * Supports state modifiers (hover:, focus:, etc.) using dot notation
 * @param domClasses - Space-separated className from DOM
 * @returns Object mapping CSS properties to their TW classes
 * @example
 * mapPropertiesToTailwindClasses('bg-blue-600 hover:bg-blue-700 text-white shadow-lg')
 * // returns:
 * // {
 * //   backgroundColor: 'bg-blue-600',
 * //   'hover.backgroundColor': 'hover:bg-blue-700',
 * //   color: 'text-white',
 * //   boxShadow: 'shadow-lg'
 * // }
 */
export function mapPropertiesToTailwindClasses(domClasses: string): Record<string, string> {
  if (!domClasses) return {};

  const classes = domClasses.split(/\s+/).filter(Boolean);
  const result: Record<string, string> = {};

  // Group shadow classes by state
  const shadowClasses: Record<string, string[]> = { base: [] };

  for (const cls of classes) {
    // Extract modifier if present (hover:, focus:, etc.)
    const { modifier, baseClass } = extractModifier(cls);
    const prefix = modifier ? `${modifierToCamelCase(modifier)}.` : '';

    // Background color
    if (baseClass.startsWith('bg-') && !baseClass.startsWith('bg-gradient-')) {
      result[`${prefix}backgroundColor`] = cls;
    }

    // Text color
    else if (baseClass.startsWith('text-') && !baseClass.includes('/')) {
      result[`${prefix}color`] = cls;
    }

    // Border color
    else if (baseClass.startsWith('border-') && !baseClass.match(/^border-[0-9]/)) {
      result[`${prefix}borderColor`] = cls;
    }

    // Border width
    else if (baseClass.match(/^border(-[0-9])?$/)) {
      result[`${prefix}borderWidth`] = cls;
    }

    // Border radius
    else if (baseClass.startsWith('rounded')) {
      result[`${prefix}borderRadius`] = cls;
    }

    // Width
    else if (baseClass.startsWith('w-')) {
      result[`${prefix}width`] = cls;
    }

    // Height
    else if (baseClass.startsWith('h-')) {
      result[`${prefix}height`] = cls;
    }

    // Min width
    else if (baseClass.startsWith('min-w-')) {
      result[`${prefix}minWidth`] = cls;
    }

    // Min height
    else if (baseClass.startsWith('min-h-')) {
      result[`${prefix}minHeight`] = cls;
    }

    // Max width
    else if (baseClass.startsWith('max-w-')) {
      result[`${prefix}maxWidth`] = cls;
    }

    // Max height
    else if (baseClass.startsWith('max-h-')) {
      result[`${prefix}maxHeight`] = cls;
    }

    // Padding
    else if (
      baseClass.startsWith('p-') ||
      baseClass.startsWith('px-') ||
      baseClass.startsWith('py-') ||
      baseClass.startsWith('pt-') ||
      baseClass.startsWith('pr-') ||
      baseClass.startsWith('pb-') ||
      baseClass.startsWith('pl-')
    ) {
      const key = `${prefix}padding`;
      result[key] = result[key] ? `${result[key]} ${cls}` : cls;
    }

    // Margin
    else if (
      baseClass.startsWith('m-') ||
      baseClass.startsWith('mx-') ||
      baseClass.startsWith('my-') ||
      baseClass.startsWith('mt-') ||
      baseClass.startsWith('mr-') ||
      baseClass.startsWith('mb-') ||
      baseClass.startsWith('ml-')
    ) {
      const key = `${prefix}margin`;
      result[key] = result[key] ? `${result[key]} ${cls}` : cls;
    }

    // Shadow
    else if (baseClass.startsWith('shadow')) {
      const shadowKey = modifier || 'base';
      if (!shadowClasses[shadowKey]) {
        shadowClasses[shadowKey] = [];
      }
      shadowClasses[shadowKey].push(cls);
    }

    // Opacity
    else if (baseClass.startsWith('opacity-')) {
      result[`${prefix}opacity`] = cls;
    }

    // Blur
    else if (baseClass.startsWith('blur')) {
      result[`${prefix}blur`] = cls;
    }

    // Display
    else if (
      baseClass === 'flex' ||
      baseClass === 'inline-flex' ||
      baseClass === 'grid' ||
      baseClass === 'inline-grid' ||
      baseClass === 'block' ||
      baseClass === 'inline-block' ||
      baseClass === 'hidden'
    ) {
      result[`${prefix}display`] = cls;
    }

    // Flex direction
    else if (
      baseClass === 'flex-row' ||
      baseClass === 'flex-col' ||
      baseClass === 'flex-row-reverse' ||
      baseClass === 'flex-col-reverse'
    ) {
      result[`${prefix}flexDirection`] = cls;
    }

    // Align items
    else if (baseClass.startsWith('items-')) {
      result[`${prefix}alignItems`] = cls;
    }

    // Justify content
    else if (baseClass.startsWith('justify-')) {
      result[`${prefix}justifyContent`] = cls;
    }

    // Gap
    else if (baseClass.startsWith('gap-')) {
      result[`${prefix}gap`] = cls;
    }

    // Position
    else if (
      baseClass === 'static' ||
      baseClass === 'relative' ||
      baseClass === 'absolute' ||
      baseClass === 'fixed' ||
      baseClass === 'sticky'
    ) {
      result[`${prefix}position`] = cls;
    }

    // Top, right, bottom, left
    else if (baseClass.startsWith('top-')) {
      result[`${prefix}top`] = cls;
    } else if (baseClass.startsWith('right-')) {
      result[`${prefix}right`] = cls;
    } else if (baseClass.startsWith('bottom-')) {
      result[`${prefix}bottom`] = cls;
    } else if (baseClass.startsWith('left-')) {
      result[`${prefix}left`] = cls;
    }
  }

  // Combine shadow classes by state
  for (const [shadowKey, classes] of Object.entries(shadowClasses)) {
    if (classes.length > 0) {
      const prefix = shadowKey === 'base' ? '' : `${modifierToCamelCase(shadowKey)}.`;
      result[`${prefix}boxShadow`] = classes.join(' ');
    }
  }

  return result;
}

/**
 * Get className from AST node
 */
export function getClassNameFromNode(node: { props?: { className?: string } }): string {
  return node?.props?.className || '';
}
