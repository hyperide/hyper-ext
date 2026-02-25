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
        // Special case: don't remove 'border' (border-width) when removing borderColor
        if (prefix === 'border-' && baseClass === 'border') {
          continue;
        }
        // Special case: don't remove gap-x-* or gap-y-* when removing generic gap-*
        if (prefix === 'gap-' && (baseClass.startsWith('gap-x-') || baseClass.startsWith('gap-y-'))) {
          continue;
        }
        // Special case: don't remove justify-items-* when removing justify-* (justifyContent)
        if (prefix === 'justify-' && baseClass.startsWith('justify-items-')) {
          continue;
        }
        // Special case: don't remove flex-col/flex-row when removing display classes
        // 'flex-col'.startsWith('flex') is true, but flex-col is flexDirection, not display
        if (prefix === 'flex' && (baseClass === 'flex-col' || baseClass === 'flex-row')) {
          continue;
        }
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

    // Width and height
    if (cls.startsWith('w-')) {
      const value = cls.slice(2);
      const arbValue = extractArbitraryValue(cls);
      result.width = arbValue || SPACING_SCALE[value] || value;
    } else if (cls.startsWith('h-')) {
      const value = cls.slice(2);
      const arbValue = extractArbitraryValue(cls);
      result.height = arbValue || SPACING_SCALE[value] || value;
    }

    // Margin
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

    // Background image: bg-\[url('/path/to/image.png')\]
    if (cls.startsWith('bg-[url(')) {
      // Extract URL from bg-\[url('...')\] or bg-\[url("...")\] or bg-\[url(...)\]
      const urlMatch = cls.match(/bg-\[url\(['"]?([^'")\]]+)['"]?\)\]/);
      if (urlMatch) {
        result.backgroundImage = urlMatch[1];
      }
    }
    // Background color (arbitrary values only for now)
    else if (cls.startsWith('bg-[')) {
      const arbValue = extractArbitraryValue(cls);
      if (arbValue) result.backgroundColor = arbValue;
    }

    // Border color (arbitrary values only for now)
    if (
      cls.startsWith('border-[') &&
      !cls.startsWith('border-t') &&
      !cls.startsWith('border-r') &&
      !cls.startsWith('border-b') &&
      !cls.startsWith('border-l')
    ) {
      const arbValue = extractArbitraryValue(cls);
      if (arbValue) result.borderColor = arbValue;
    }

    // Border radius
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
    } else if (cls.startsWith('rounded-[')) {
      const arbValue = extractArbitraryValue(cls);
      if (arbValue) result.borderRadius = arbValue;
    }

    // Overflow
    if (cls === 'overflow-visible') {
      result.overflow = 'visible';
    } else if (cls === 'overflow-hidden') {
      result.overflow = 'hidden';
    } else if (cls === 'overflow-scroll') {
      result.overflow = 'scroll';
    } else if (cls === 'overflow-auto') {
      result.overflow = 'auto';
    }

    // Display & Flexbox
    if (cls === 'flex') {
      result.display = 'flex';
    } else if (cls === 'block') {
      result.display = 'block';
    } else if (cls === 'grid') {
      result.display = 'grid';
    }

    if (cls === 'flex-col') {
      result.flexDirection = 'column';
    } else if (cls === 'flex-row') {
      result.flexDirection = 'row';
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
