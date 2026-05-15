/**
 * @file Validates and normalizes CSS values using browser CSS.supports or a static fallback
 *
 * Accessed via: style write pipeline — CSS-target adapter writers call this AFTER converting
 *   canonical inspector values to CSS values, BEFORE emitting the write plan
 * Assumptions: non-CSS adapters (Tailwind, Tamagui) do NOT call this — they have their own validation.
 *   happy-dom's CSS.supports is a no-op stub (always returns true), so a probe test detects unreliable
 *   implementations and falls back to static validation.
 */

export type CssNormalizationResult =
  | { kind: 'value'; value: string }
  | { kind: 'remove' }
  | { kind: 'invalid'; reason: string };

const BARE_NUMBER_RE = /^-?\d+(\.\d+)?$/;

// --- Static fallback (for environments without reliable CSS.supports) ---

const GLOBAL_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert']);

const DISPLAY_VALUES = new Set([
  'block',
  'inline',
  'flex',
  'grid',
  'inline-flex',
  'inline-grid',
  'inline-block',
  'none',
  'contents',
  'table',
  'list-item',
  'flow-root',
]);

const POSITION_VALUES = new Set(['static', 'relative', 'absolute', 'fixed', 'sticky']);

const OVERFLOW_VALUES = new Set(['hidden', 'visible', 'scroll', 'clip', 'auto']);

const LAYOUT_KEYWORDS = new Set(['auto', 'none', 'min-content', 'max-content', 'fit-content']);

const FLEX_ALIGN_KEYWORDS = new Set([
  'row',
  'column',
  'row-reverse',
  'column-reverse',
  'flex-start',
  'flex-end',
  'center',
  'space-between',
  'space-around',
  'space-evenly',
  'stretch',
  'baseline',
  'start',
  'end',
  'normal',
  'wrap',
  'nowrap',
  'wrap-reverse',
]);

const LENGTH_UNIT_RE = /^-?\d+(\.\d+)?(px|rem|em|vh|vw|vmin|vmax|ch|ex|%)$/;

const COLOR_FUNC_RE = /^(rgb|rgba|hsl|hsla|oklch|lch|lab|oklab)\(.+\)$/;
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const NAMED_COLORS = new Set([
  'red',
  'blue',
  'green',
  'yellow',
  'orange',
  'purple',
  'pink',
  'brown',
  'black',
  'white',
  'gray',
  'grey',
  'cyan',
  'magenta',
  'lime',
  'olive',
  'navy',
  'teal',
  'aqua',
  'fuchsia',
  'maroon',
  'silver',
  'transparent',
  'currentColor',
  'currentcolor',
  'aliceblue',
  'antiquewhite',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'blanchedalmond',
  'blueviolet',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'greenyellow',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'limegreen',
  'linen',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'oldlace',
  'olivedrab',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'plum',
  'powderblue',
  'rebeccapurple',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'whitesmoke',
  'yellowgreen',
]);

const PROPERTY_VALUE_MAP: Record<string, Set<string>> = {
  display: DISPLAY_VALUES,
  position: POSITION_VALUES,
  overflow: OVERFLOW_VALUES,
  'overflow-x': OVERFLOW_VALUES,
  'overflow-y': OVERFLOW_VALUES,
  'flex-direction': new Set(['row', 'column', 'row-reverse', 'column-reverse']),
  'flex-wrap': new Set(['wrap', 'nowrap', 'wrap-reverse']),
  'justify-content': new Set([
    'flex-start',
    'flex-end',
    'center',
    'space-between',
    'space-around',
    'space-evenly',
    'start',
    'end',
    'normal',
    'stretch',
  ]),
  'align-items': new Set(['flex-start', 'flex-end', 'center', 'stretch', 'baseline', 'start', 'end', 'normal']),
  'align-content': new Set([
    'flex-start',
    'flex-end',
    'center',
    'stretch',
    'space-between',
    'space-around',
    'space-evenly',
    'start',
    'end',
    'normal',
  ]),
  'align-self': new Set(['auto', 'flex-start', 'flex-end', 'center', 'stretch', 'baseline', 'start', 'end', 'normal']),
  'justify-self': new Set(['auto', 'flex-start', 'flex-end', 'center', 'stretch', 'start', 'end', 'normal']),
  'justify-items': new Set(['flex-start', 'flex-end', 'center', 'stretch', 'start', 'end', 'normal', 'baseline']),
};

// --- Property category classification ---
// Enum-only properties accept ONLY their declared keywords + global keywords.
// They must NOT accept lengths, colors, or layout keywords.
const ENUM_ONLY_PROPERTIES = new Set([
  'display',
  'position',
  'overflow',
  'overflow-x',
  'overflow-y',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-content',
  'align-self',
  'justify-self',
  'justify-items',
]);

const UNITLESS_NUMBER_PROPERTIES = new Set(['opacity', 'z-index', 'flex-grow', 'flex-shrink', 'order', 'line-height']);

const COLOR_PROPERTIES = new Set([
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'caret-color',
  'fill',
  'stroke',
]);

function isColorValue(value: string): boolean {
  return HEX_COLOR_RE.test(value) || COLOR_FUNC_RE.test(value) || NAMED_COLORS.has(value);
}

function isLengthValue(value: string): boolean {
  return LENGTH_UNIT_RE.test(value);
}

function staticSupports(cssProperty: string, value: string): boolean {
  // Global CSS keywords are always valid for any property
  if (GLOBAL_KEYWORDS.has(value)) return true;

  // Property-specific enum values (display, position, overflow, flex-*, align-*, justify-*)
  const propertyValues = PROPERTY_VALUE_MAP[cssProperty];
  if (propertyValues?.has(value)) return true;

  // Enum-only properties accept ONLY their declared keywords + global keywords
  if (ENUM_ONLY_PROPERTIES.has(cssProperty)) return false;

  // Bare numbers are valid for unitless properties
  if (BARE_NUMBER_RE.test(value) && UNITLESS_NUMBER_PROPERTIES.has(cssProperty)) {
    return true;
  }

  // Color properties accept color values + transparent/currentColor
  if (COLOR_PROPERTIES.has(cssProperty)) {
    return isColorValue(value);
  }

  // Length values with units — valid for length-accepting properties (anything not enum-only, not color-only)
  if (isLengthValue(value)) return true;

  // Layout keywords (auto, none, min-content, etc.) — valid for length-accepting properties
  if (LAYOUT_KEYWORDS.has(value)) return true;

  // Flex/align keywords — valid for properties not in the enum-only map
  if (FLEX_ALIGN_KEYWORDS.has(value)) return true;

  return false;
}

// --- CSS.supports reliability detection ---

/**
 * Probe whether CSS.supports actually validates values.
 * happy-dom's implementation always returns true — we detect this by testing a known-invalid pair.
 */
function isCssSupportsFunctional(): boolean {
  if (typeof globalThis.CSS === 'undefined' || typeof globalThis.CSS.supports !== 'function') {
    return false;
  }
  // A real browser rejects this; happy-dom accepts it
  return !globalThis.CSS.supports('width', 'not-a-valid-value-xyzzy');
}

const useNativeCssSupports = isCssSupportsFunctional();

function cssSupports(cssProperty: string, value: string): boolean {
  if (useNativeCssSupports) {
    return globalThis.CSS.supports(cssProperty, value);
  }
  return staticSupports(cssProperty, value);
}

// --- Public API ---

export const cssRuntimeNormalizer = {
  normalize(input: { cssProperty: string; value: string }): CssNormalizationResult {
    const { cssProperty, value } = input;

    // 1. Empty string → remove
    if (value === '') {
      return { kind: 'remove' };
    }

    // 2. Value as-is
    if (cssSupports(cssProperty, value)) {
      return { kind: 'value', value };
    }

    // 3. Bare number → try appending px
    if (BARE_NUMBER_RE.test(value)) {
      const withPx = `${value}px`;
      if (cssSupports(cssProperty, withPx)) {
        return { kind: 'value', value: withPx };
      }
    }

    // 4. Invalid
    return { kind: 'invalid', reason: `${cssProperty}: ${value}` };
  },
};
