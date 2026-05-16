/**
 * Tailwind CSS Classes Parser
 * Parses Tailwind classes and extracts CSS values
 */

export interface ParsedTailwindStyles {
  position?: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  width?: string;
  height?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  borderColor?: string;
  borderRadius?: string;
  overflow?: 'visible' | 'hidden' | 'scroll' | 'auto';
  display?: string;
  flexDirection?: string;
  gap?: string;
  rowGap?: string;
  columnGap?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  color?: string;
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

/**
 * Extract arbitrary value from Tailwind class like w-[227px]
 */
function extractArbitraryValue(className: string): string | null {
  const match = className.match(/\[([^\]]+)\]/);
  return match ? match[1] : null;
}

// Import and re-export getConflictingPrefixes from generator
import { getConflictingPrefixes } from './generator';
export { getConflictingPrefixes };

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
 * Convert Tailwind modifier to camelCase for use as object key
 * @param modifier - Modifier string (e.g., 'hover', 'focus-visible', 'group-hover')
 * @returns Camel-cased string (e.g., 'hover', 'focusVisible', 'groupHover')
 * @example 'focus-visible' => 'focusVisible'
 */
function modifierToCamelCase(modifier: string): string {
  return modifier.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Remove conflicting classes from className
 * @param className - The className string to process
 * @param styleKeys - Style keys to find conflicting classes for
 * @param state - Optional state modifier (hover, focus, etc.). If provided, only removes classes with matching state.
 * @returns Object with preserved classes and removed classes
 */
/** Shadow utility classes that are NOT shadow color (box-shadow size/preset) */
const TAILWIND_SHADOW_NON_COLOR_CLASSES = new Set([
  'shadow-sm',
  'shadow-md',
  'shadow-lg',
  'shadow-xl',
  'shadow-2xl',
  'shadow-inner',
  'shadow-none',
  'shadow',
]);

/** Background utility classes that are NOT background color */
const TAILWIND_BG_NON_COLOR_CLASSES = new Set([
  'bg-cover',
  'bg-contain',
  'bg-center',
  'bg-bottom',
  'bg-left',
  'bg-left-bottom',
  'bg-left-top',
  'bg-right',
  'bg-right-bottom',
  'bg-right-top',
  'bg-top',
  'bg-repeat',
  'bg-no-repeat',
  'bg-repeat-x',
  'bg-repeat-y',
  'bg-repeat-round',
  'bg-repeat-space',
  'bg-auto',
  'bg-fixed',
  'bg-local',
  'bg-scroll',
  'bg-clip-border',
  'bg-clip-padding',
  'bg-clip-content',
  'bg-clip-text',
  'bg-origin-border',
  'bg-origin-padding',
  'bg-origin-content',
  'bg-none',
]);

/** Border utility classes that are NOT border color (width, style) */
const TAILWIND_BORDER_NON_COLOR_CLASSES = new Set([
  'border-0',
  'border-2',
  'border-4',
  'border-8',
  'border-solid',
  'border-dashed',
  'border-dotted',
  'border-double',
  'border-hidden',
  'border-none',
  'border-collapse',
  'border-separate',
]);

/** Side-specific border width: border-t-2, border-b-[3px], border-x-4.
 *  Arbitrary values must start with a digit (border-t-[3px]), NOT a color (#, rgb, etc.) */
const BORDER_SIDE_WIDTH_RE = /^border-[trblxy]-(\d|\[\d)/;

/**
 * Checks if a border-* class is a non-color utility (width, style, spacing, side-width).
 * Used to avoid false removals when updating borderColor.
 */
function isBorderNonColorClass(baseClass: string): boolean {
  if (TAILWIND_BORDER_NON_COLOR_CLASSES.has(baseClass)) return true;
  if (baseClass.startsWith('border-spacing-')) return true;
  if (BORDER_SIDE_WIDTH_RE.test(baseClass)) return true;
  return false;
}

/**
 * Checks if a shadow-[...] arbitrary value is a color (not a box-shadow definition).
 * Pure color: shadow-[#ff0000], shadow-[rgba(0,0,0,0.5)]
 * Box-shadow: shadow-[0_4px_6px_...], shadow-[rgba(0,0,0,0.25)_0_4px_6px_-1px]
 * Key heuristic: underscores outside parens indicate multi-part box-shadow syntax.
 */
function isArbitraryShadowColor(baseClass: string): boolean {
  const match = baseClass.match(/^shadow-\[(.+)\]$/);
  if (!match) return false;
  const value = match[1];
  // Strip balanced parens to check for underscores in the top-level structure.
  // e.g. "rgba(0,0,0,0.25)_0_4px" → after stripping parens → "rgba_0_4px" → has underscore
  // e.g. "rgba(0,0,0,0.5)" → after stripping parens → "rgba" → no underscore
  const withoutParens = value.replace(/\([^)]*\)/g, '');
  if (withoutParens.includes('_')) return false;
  if (value.startsWith('#')) return true;
  if (/^(?:rgb|rgba|hsl|hsla|oklch|oklab|lch|lab|color)\(/.test(value)) return true;
  return false;
}

const TAILWIND_TEXT_NON_COLOR_CLASSES = new Set([
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
  'text-ellipsis',
  'text-clip',
]);

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

function isArbitraryTextSizeValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return /^-?\d*\.?\d+(px|r?em|ex|ch|lh|rlh|vw|vh|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cqw|cqh|cqi|cqmin|cqmax|%)$/.test(
    normalized,
  );
}

function isArbitraryTextSizeClass(baseClass: string): boolean {
  const match = baseClass.match(/^text-\[(.+)\]$/);
  if (!match) return false;
  return isArbitraryTextSizeValue(match[1]);
}

function isTailwindTextSizeClass(baseClass: string): boolean {
  return TAILWIND_TEXT_SIZE_CLASSES.has(baseClass) || isArbitraryTextSizeClass(baseClass);
}

function isTailwindTextOtherNonColorClass(baseClass: string): boolean {
  return TAILWIND_TEXT_NON_COLOR_CLASSES.has(baseClass) && !TAILWIND_TEXT_SIZE_CLASSES.has(baseClass);
}

function isTailwindTextColorClass(baseClass: string): boolean {
  return (
    baseClass.startsWith('text-') && !isTailwindTextSizeClass(baseClass) && !isTailwindTextOtherNonColorClass(baseClass)
  );
}

/**
 * Determines if a class matched by prefix should be preserved (not removed).
 * Handles Tailwind prefix overlaps where different CSS properties share the same prefix
 * (e.g. shadow-md is boxShadow, shadow-red-500 is shadowColor — both start with "shadow").
 */
function shouldPreserveClass(prefix: string, baseClass: string, styleKeys: string[]): boolean {
  switch (prefix) {
    case 'border-':
      // 'border' (bare width) is not a color
      if (baseClass === 'border') return true;
      return isBorderNonColorClass(baseClass);

    case 'gap-':
      // gap-x-* / gap-y-* belong to columnGap/rowGap, not gap
      return baseClass.startsWith('gap-x-') || baseClass.startsWith('gap-y-');

    case 'justify-':
      // justify-items-* belongs to justifyItems, not justifyContent
      return baseClass.startsWith('justify-items-');

    case 'flex':
      // flex-col/flex-row belong to flexDirection, not display
      return baseClass === 'flex-col' || baseClass === 'flex-row';

    case 'text-': {
      const isSizeClass = isTailwindTextSizeClass(baseClass);
      const isOtherNonColorClass = isTailwindTextOtherNonColorClass(baseClass);
      const isColorClass = isTailwindTextColorClass(baseClass);
      const removingColor = styleKeys.includes('color');
      const removingFontSize = styleKeys.includes('fontSize');

      if (isOtherNonColorClass) return true;
      if (removingColor && !removingFontSize) return isSizeClass;
      if (removingFontSize && !removingColor) return isColorClass;
      if (removingColor && removingFontSize) return false;
      return false;
    }

    case 'shadow-':
      // shadow-md/lg/xl are boxShadow, not shadowColor
      return TAILWIND_SHADOW_NON_COLOR_CLASSES.has(baseClass);

    case 'shadow':
      // When removing boxShadow, preserve shadow color classes
      if (TAILWIND_SHADOW_NON_COLOR_CLASSES.has(baseClass)) return false;
      if (!baseClass.startsWith('shadow-')) return false;
      if (baseClass.startsWith('shadow-[')) {
        // Arbitrary: preserve colors (#hex, rgb(), hsl()), remove box-shadow values
        return isArbitraryShadowColor(baseClass);
      }
      // Named color (shadow-red-500) — preserve
      return true;

    case 'bg-':
      return (
        TAILWIND_BG_NON_COLOR_CLASSES.has(baseClass) ||
        baseClass.startsWith('bg-gradient-') ||
        baseClass.startsWith('bg-opacity-')
      );

    default:
      return false;
  }
}

export function removeConflictingClasses(
  className: string,
  styleKeys: string[],
  state?: string,
): { preserved: string; removed: string[] } {
  if (!className) return { preserved: '', removed: [] };

  const classes = className.split(/\s+/).filter(Boolean);
  const prefixes = getConflictingPrefixes(styleKeys);

  const preserved: string[] = [];
  const removed: string[] = [];

  for (const cls of classes) {
    const { modifier, baseClass } = extractModifier(cls);

    // If state is undefined (updating base styles), only remove base classes (no modifier)
    // This prevents removing hover:bg-* when updating base bg-*
    if (state === undefined && modifier !== null) {
      preserved.push(cls);
      continue;
    }

    // If state is specified (e.g., 'hover'), only check classes with matching state
    // This prevents removing base bg-* when updating hover:bg-*
    if (state !== undefined && modifier !== state) {
      preserved.push(cls);
      continue;
    }

    let shouldRemove = false;
    // Check if base class (without modifier) matches any conflicting prefix
    for (const prefix of prefixes) {
      if (baseClass === prefix || baseClass.startsWith(prefix)) {
        if (shouldPreserveClass(prefix, baseClass, styleKeys)) continue;
        shouldRemove = true;
        break;
      }
    }

    if (shouldRemove) {
      removed.push(cls);
    } else {
      preserved.push(cls);
    }
  }

  return {
    preserved: preserved.join(' '),
    removed,
  };
}

/**
 * Remove conflicting classes from className (legacy, returns only string)
 * @deprecated Use removeConflictingClasses instead
 */
export function removeConflictingClassesString(className: string, styleKeys: string[]): string {
  return removeConflictingClasses(className, styleKeys).preserved;
}

/**
 * Parse Tailwind classes and extract CSS values
 */
export function parseTailwindClasses(className: string): ParsedTailwindStyles {
  if (!className) return {};

  const classes = className.split(/\s+/).filter(Boolean);
  const result: ParsedTailwindStyles = {};

  for (const cls of classes) {
    // Skip state modifier classes (hover:, focus:, etc.) — base styles only
    const { modifier, baseClass } = extractModifier(cls);
    if (modifier !== null) continue;

    // Position type
    if (baseClass === 'static') result.position = 'static';
    else if (baseClass === 'relative') result.position = 'relative';
    else if (baseClass === 'absolute') result.position = 'absolute';
    else if (baseClass === 'fixed') result.position = 'fixed';
    else if (baseClass === 'sticky') result.position = 'sticky';

    // Position values (support negative: -top-4)
    const isNegative = baseClass.startsWith('-');
    const cleanCls = isNegative ? baseClass.slice(1) : baseClass;

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

    // Width and height
    if (baseClass.startsWith('w-')) {
      const value = baseClass.slice(2);
      const arbValue = extractArbitraryValue(baseClass);
      result.width = arbValue || SPACING_SCALE[value] || value;
    } else if (baseClass.startsWith('h-')) {
      const value = baseClass.slice(2);
      const arbValue = extractArbitraryValue(baseClass);
      result.height = arbValue || SPACING_SCALE[value] || value;
    }

    // Margin (negative support via cleanCls)
    if (cleanCls.startsWith('mt-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      let cssValue = arbValue || SPACING_SCALE[value] || value;
      if (isNegative) cssValue = `-${cssValue}`;
      result.marginTop = cssValue;
    } else if (cleanCls.startsWith('mr-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      let cssValue = arbValue || SPACING_SCALE[value] || value;
      if (isNegative) cssValue = `-${cssValue}`;
      result.marginRight = cssValue;
    } else if (cleanCls.startsWith('mb-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      let cssValue = arbValue || SPACING_SCALE[value] || value;
      if (isNegative) cssValue = `-${cssValue}`;
      result.marginBottom = cssValue;
    } else if (cleanCls.startsWith('ml-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      let cssValue = arbValue || SPACING_SCALE[value] || value;
      if (isNegative) cssValue = `-${cssValue}`;
      result.marginLeft = cssValue;
    }

    // Padding
    if (cleanCls.startsWith('p-')) {
      const value = cleanCls.slice(2);
      const arbValue = extractArbitraryValue(cleanCls);
      const cssValue = arbValue || SPACING_SCALE[value] || value;
      result.paddingTop = cssValue;
      result.paddingRight = cssValue;
      result.paddingBottom = cssValue;
      result.paddingLeft = cssValue;
    } else if (cleanCls.startsWith('px-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      const cssValue = arbValue || SPACING_SCALE[value] || value;
      result.paddingLeft = cssValue;
      result.paddingRight = cssValue;
    } else if (cleanCls.startsWith('py-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      const cssValue = arbValue || SPACING_SCALE[value] || value;
      result.paddingTop = cssValue;
      result.paddingBottom = cssValue;
    } else if (cleanCls.startsWith('pt-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      result.paddingTop = arbValue || SPACING_SCALE[value] || value;
    } else if (cleanCls.startsWith('pr-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      result.paddingRight = arbValue || SPACING_SCALE[value] || value;
    } else if (cleanCls.startsWith('pb-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      result.paddingBottom = arbValue || SPACING_SCALE[value] || value;
    } else if (cleanCls.startsWith('pl-')) {
      const value = cleanCls.slice(3);
      const arbValue = extractArbitraryValue(cleanCls);
      result.paddingLeft = arbValue || SPACING_SCALE[value] || value;
    }

    // Background image: bg-[url('/path/to/image.png')]
    if (baseClass.startsWith('bg-[url(')) {
      const urlMatch = baseClass.match(/bg-\[url\(['"]?([^'")\]]+)['"]?\)\]/);
      if (urlMatch) {
        result.backgroundImage = urlMatch[1];
      }
    }
    // Background color: arbitrary value
    else if (baseClass.startsWith('bg-[')) {
      const arbValue = extractArbitraryValue(baseClass);
      if (arbValue) result.backgroundColor = arbValue;
    }
    // Background color: named Tailwind color or custom token
    else if (
      baseClass.startsWith('bg-') &&
      !TAILWIND_BG_NON_COLOR_CLASSES.has(baseClass) &&
      !baseClass.startsWith('bg-gradient-') &&
      !baseClass.startsWith('bg-opacity-')
    ) {
      result.backgroundColor = baseClass.slice(3);
    }

    // Border color (arbitrary values)
    if (
      baseClass.startsWith('border-[') &&
      !baseClass.startsWith('border-t') &&
      !baseClass.startsWith('border-r') &&
      !baseClass.startsWith('border-b') &&
      !baseClass.startsWith('border-l')
    ) {
      const arbValue = extractArbitraryValue(baseClass);
      if (arbValue) result.borderColor = arbValue;
    }

    // Border radius
    if (baseClass === 'rounded') {
      result.borderRadius = '0.25rem';
    } else if (baseClass === 'rounded-none') {
      result.borderRadius = '0px';
    } else if (baseClass === 'rounded-sm') {
      result.borderRadius = '0.125rem';
    } else if (baseClass === 'rounded-md') {
      result.borderRadius = '0.375rem';
    } else if (baseClass === 'rounded-lg') {
      result.borderRadius = '0.5rem';
    } else if (baseClass === 'rounded-xl') {
      result.borderRadius = '0.75rem';
    } else if (baseClass === 'rounded-2xl') {
      result.borderRadius = '1rem';
    } else if (baseClass === 'rounded-3xl') {
      result.borderRadius = '1.5rem';
    } else if (baseClass === 'rounded-full') {
      result.borderRadius = '9999px';
    } else if (baseClass.startsWith('rounded-[')) {
      const arbValue = extractArbitraryValue(baseClass);
      if (arbValue) result.borderRadius = arbValue;
    }

    // Text color: named, custom token, or arbitrary
    if (isTailwindTextColorClass(baseClass)) {
      if (baseClass.startsWith('text-[')) {
        const arbValue = extractArbitraryValue(baseClass);
        if (arbValue) result.color = arbValue;
      } else {
        result.color = baseClass.slice(5);
      }
    }

    // Overflow
    if (baseClass === 'overflow-visible') {
      result.overflow = 'visible';
    } else if (baseClass === 'overflow-hidden') {
      result.overflow = 'hidden';
    } else if (baseClass === 'overflow-scroll') {
      result.overflow = 'scroll';
    } else if (baseClass === 'overflow-auto') {
      result.overflow = 'auto';
    }

    // Display & Flexbox
    if (baseClass === 'flex') {
      result.display = 'flex';
    } else if (baseClass === 'block') {
      result.display = 'block';
    } else if (baseClass === 'grid') {
      result.display = 'grid';
    }

    if (baseClass === 'flex-col') {
      result.flexDirection = 'column';
    } else if (baseClass === 'flex-row') {
      result.flexDirection = 'row';
    } else if (baseClass.startsWith('space-y-')) {
      result.display = 'flex';
      result.flexDirection = 'column';
      const value = baseClass.slice(8);
      const arbValue = extractArbitraryValue(baseClass);
      result.gap = arbValue || SPACING_SCALE[value] || value;
    } else if (baseClass.startsWith('space-x-')) {
      result.display = 'flex';
      result.flexDirection = 'row';
      const value = baseClass.slice(8);
      const arbValue = extractArbitraryValue(baseClass);
      result.gap = arbValue || SPACING_SCALE[value] || value;
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

    // Text size
    else if (isTailwindTextSizeClass(baseClass)) {
      result[`${prefix}fontSize`] = cls;
    }

    // Text color
    else if (isTailwindTextColorClass(baseClass) && !baseClass.includes('/')) {
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

    // Gap (must check gap-x/gap-y before generic gap-)
    else if (baseClass.startsWith('gap-x-')) {
      result[`${prefix}columnGap`] = cls;
    } else if (baseClass.startsWith('gap-y-')) {
      result[`${prefix}rowGap`] = cls;
    } else if (baseClass.startsWith('gap-')) {
      result[`${prefix}gap`] = cls;
    }

    // Justify items (grid horizontal alignment)
    else if (baseClass.startsWith('justify-items-')) {
      result[`${prefix}justifyItems`] = cls;
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
