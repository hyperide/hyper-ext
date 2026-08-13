/**
 * @file Validates and normalizes user input to canonical inspector form
 *
 * Accessed via: style write pipeline (user input -> canonical form), style read pipeline (adapter output -> display)
 * Assumptions: per-target value mapping is NOT this module's job — adapters handle CSS 0.5, Tailwind "opacity-50", etc.
 *   The codec only ensures input matches the inspector's canonical form per property.
 *   Opacity canonical form: 0-100 integer scale. Lengths canonical form: unitless number (px stripped).
 */

export interface NormalizedInspectorValue {
  kind: 'value' | 'remove';
  value: string;
}

const OPACITY_KEYS = new Set(['opacity']);

const COLOR_KEYS = new Set([
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'textDecorationColor',
  'caretColor',
  'shadowColor',
  'fill',
  'stroke',
]);

const LENGTH_EXACT_KEYS = new Set([
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'top',
  'right',
  'bottom',
  'left',
  'gap',
  'rowGap',
  'columnGap',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textIndent',
  'outlineWidth',
  'outlineOffset',
  'borderRadius',
  'borderWidth',
]);

const LENGTH_PREFIX_PATTERNS = ['padding', 'margin', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const;

const LENGTH_KEYWORDS = new Set([
  'auto',
  'min-content',
  'max-content',
  'fit-content',
  'none',
  'inherit',
  'initial',
  'unset',
  'revert',
]);

function isLengthProperty(key: string): boolean {
  if (LENGTH_EXACT_KEYS.has(key)) return true;

  for (const prefix of LENGTH_PREFIX_PATTERNS) {
    if (key.startsWith(prefix)) return true;
  }

  // borderTopLeftRadius, borderBottomRightRadius, etc.
  if (key.startsWith('border') && key.endsWith('Radius')) return true;

  return false;
}

function normalizeOpacity(value: unknown): NormalizedInspectorValue {
  const str = String(value).trim();
  if (str === '') return { kind: 'remove', value: '' };

  const cleaned = str.endsWith('%') ? str.slice(0, -1) : str;
  if (cleaned === '' || Number.isNaN(Number(cleaned))) {
    throw new Error(`Invalid opacity value: "${str}" — expected a number (0-100)`);
  }
  const num = Number(cleaned);

  const clamped = Math.min(100, Math.max(0, num));
  const formatted = String(clamped);

  return { kind: 'value', value: formatted };
}

function normalizeLength(value: unknown): NormalizedInspectorValue {
  if (typeof value === 'number') {
    return { kind: 'value', value: String(value) };
  }

  const str = String(value).trim();
  if (str === '') return { kind: 'remove', value: '' };

  // Keywords pass through
  if (LENGTH_KEYWORDS.has(str)) {
    return { kind: 'value', value: str };
  }

  // Strip px suffix — canonical form is bare number (only when prefix is numeric)
  if (str.endsWith('px')) {
    const numericPart = str.slice(0, -2);
    if (numericPart !== '' && !Number.isNaN(Number(numericPart))) {
      return { kind: 'value', value: numericPart };
    }
  }

  // Non-px units (rem, em, vh, vw, %, etc.) pass through
  return { kind: 'value', value: str };
}

function normalizePassthrough(value: unknown): NormalizedInspectorValue {
  const str = String(value).trim();
  if (str === '') return { kind: 'remove', value: '' };
  return { kind: 'value', value: str };
}

export const inspectorValueCodec = {
  normalize(input: { key: string; value: unknown }): NormalizedInspectorValue {
    const { key, value } = input;

    if (OPACITY_KEYS.has(key)) {
      return normalizeOpacity(value);
    }

    if (COLOR_KEYS.has(key)) {
      return normalizePassthrough(value);
    }

    if (isLengthProperty(key)) {
      return normalizeLength(value);
    }

    return normalizePassthrough(value);
  },

  format(input: { key: string; value: string }): string {
    return input.value;
  },
};
