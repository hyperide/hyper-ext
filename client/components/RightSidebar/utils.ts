import type { ASTNode } from '@/lib/canvas-engine/types/ast';
import type { PositionType } from './types';

export { hexWithAlpha, parseHexWithAlpha } from '@shared/utils/color';

/**
 * Convert hex color + opacity to rgba format
 */
export function hexToRgba(hex: string, opacity: string): string {
  const num = Number.parseInt(opacity, 10) || 100;
  if (num === 100) return hex;
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${num / 100})`;
}

/**
 * Map shadow size to concrete x, y, blur, spread values
 */
export function mapShadowSizeToValues(
  size: string,
  type: 'drop-shadow' | 'inner-shadow',
): { x: string; y: string; blur: string; spread: string } {
  const isInner = type === 'inner-shadow';

  const sizeMap: Record<string, { x: string; y: string; blur: string; spread: string }> = {
    sm: isInner ? { x: '0', y: '1px', blur: '1px', spread: '0' } : { x: '0', y: '1px', blur: '2px', spread: '0' },
    default: isInner ? { x: '0', y: '2px', blur: '4px', spread: '0' } : { x: '0', y: '1px', blur: '3px', spread: '0' },
    md: isInner ? { x: '0', y: '2px', blur: '4px', spread: '0' } : { x: '0', y: '4px', blur: '6px', spread: '-1px' },
    lg: isInner ? { x: '0', y: '2px', blur: '4px', spread: '0' } : { x: '0', y: '10px', blur: '15px', spread: '-3px' },
    xl: isInner ? { x: '0', y: '2px', blur: '4px', spread: '0' } : { x: '0', y: '20px', blur: '25px', spread: '-5px' },
    '2xl': isInner
      ? { x: '0', y: '2px', blur: '4px', spread: '0' }
      : { x: '0', y: '25px', blur: '50px', spread: '-12px' },
  };

  return sizeMap[size] || sizeMap.default;
}

/**
 * Generate box-shadow value with custom color
 */
export function generateBoxShadow(
  type: 'drop-shadow' | 'inner-shadow',
  x: string,
  y: string,
  blur: string,
  spread: string,
  color: string,
  opacity: string,
): string {
  const rgbaColor = hexToRgba(color, opacity);
  const isInner = type === 'inner-shadow';
  const insetPrefix = isInner ? 'inset ' : '';
  return `${insetPrefix}${x} ${y} ${blur} ${spread} ${rgbaColor}`;
}

/**
 * Convert position type to CSS value
 */
export function positionToCss(pos: PositionType): string {
  const map: Record<PositionType, string> = {
    static: 'static',
    rel: 'relative',
    abs: 'absolute',
    fixed: 'fixed',
    sticky: 'sticky',
  };
  return map[pos];
}

/**
 * Convert CSS position value to position type
 */
export function cssToPosition(css: string): PositionType {
  const map: Record<string, PositionType> = {
    static: 'static',
    relative: 'rel',
    absolute: 'abs',
    fixed: 'fixed',
    sticky: 'sticky',
  };
  return map[css] || 'static';
}

/**
 * Helper to recursively find node by id in AST
 */
export function findNodeById(nodes: ASTNode[], id: string): ASTNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Generate unique ID for items (strokes, effects, transitions)
 */
export function generateItemId(): string {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Pure helper for numeric inspector inputs that respond to ArrowUp/ArrowDown.
 * Parses the current display value (e.g. '2px', '50%', '0.5rem'), increments
 * or decrements by step (1, or 10 when shift/alt held), and re-formats with
 * the same unit. Returns null if the key is not Arrow{Up,Down}.
 *
 * Clamping rules:
 *   - `opacity` is clamped to [0, 100] (unitless).
 *   - Length properties that CSS rejects when negative (padding, gap,
 *     dimensions, border radius/width, font-size, …) are clamped to >= 0.
 *     Margins, position offsets and letter-spacing are NOT clamped — those
 *     are legitimately negative in CSS.
 *
 * Empty / NaN base is treated as 0 so the empty-leak branch can never emit
 * `-1px` or a bare-`px` string. The result is always a fully-formed
 * `<number><unit>` value.
 */
export interface ComputeNumericArrowValueOptions {
  key: string;
  currentValue: string;
  styleKey?: string;
  defaultValue?: string;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * Style keys whose CSS values are invalid when negative. Matches the
 * properties wired into the right-sidebar numeric inputs; expand this list
 * if a new non-negative length input is added.
 */
const NON_NEGATIVE_LENGTH_KEYS = new Set<string>([
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'gap',
  'rowGap',
  'columnGap',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderWidth',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontSize',
  'outlineWidth',
]);

function parseNumericPart(input: string | undefined): { num: number; unit: string } {
  if (!input) return { num: 0, unit: '' };
  const m = input.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { num: 0, unit: '' };
  const parsed = Number.parseFloat(m[1]);
  return {
    num: Number.isFinite(parsed) ? parsed : 0,
    unit: m[2] || '',
  };
}

export function computeNumericArrowValue(opts: ComputeNumericArrowValueOptions): string | null {
  const { key, currentValue, styleKey, defaultValue, shiftKey, altKey } = opts;
  if (key !== 'ArrowUp' && key !== 'ArrowDown') {
    return null;
  }

  const isUnitless = styleKey === 'opacity' || styleKey === 'gridTemplateColumns' || styleKey === 'gridTemplateRows';
  const trimmed = currentValue.replace(' Auto', '').trim();
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);

  const increment = key === 'ArrowUp' ? 1 : -1;
  const step = shiftKey || altKey ? 10 : 1;

  let baseNum: number;
  let unit: string;
  if (match) {
    const parsed = Number.parseFloat(match[1]);
    baseNum = Number.isFinite(parsed) ? parsed : 0;
    unit = match[2] || (isUnitless ? '' : 'px');
  } else {
    const defaults = parseNumericPart(defaultValue);
    baseNum = defaults.num;
    unit = isUnitless ? '' : defaults.unit || 'px';
  }

  let newNum = baseNum + increment * step;
  if (!Number.isFinite(newNum)) newNum = 0;

  if (styleKey === 'opacity') {
    newNum = Math.max(0, Math.min(100, newNum));
  } else if (styleKey && NON_NEGATIVE_LENGTH_KEYS.has(styleKey)) {
    newNum = Math.max(0, newNum);
  }

  return `${newNum}${unit}`;
}
