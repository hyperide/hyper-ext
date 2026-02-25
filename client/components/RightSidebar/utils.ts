import type { ASTNode } from '@/lib/canvas-engine/types/ast';
import type { PositionType } from './types';

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
 * Convert hex color and opacity (0-100) to hex with alpha channel (#rrggbbaa)
 */
export function hexWithAlpha(hex: string, opacity: string): string {
  if (!hex || !hex.startsWith('#')) return hex;
  const opacityNum = Number.parseFloat(opacity);
  if (Number.isNaN(opacityNum)) return hex;
  // Convert opacity 0-100 to alpha 0-255
  const alpha = Math.round((opacityNum / 100) * 255);
  const alphaHex = alpha.toString(16).padStart(2, '0');
  // Ensure hex is 6 characters (without #)
  const cleanHex = hex.slice(1).padEnd(6, '0').slice(0, 6);
  return `#${cleanHex}${alphaHex}`;
}

/**
 * Parse hex color with alpha channel (#rrggbbaa) to color and opacity
 * Returns { color: '#rrggbb', opacity: '0-100' } or { color: original, opacity: undefined }
 */
export function parseHexWithAlpha(hex: string): {
  color: string;
  opacity: string | undefined;
} {
  if (!hex || !hex.startsWith('#')) return { color: hex, opacity: undefined };
  // Check if it's #rrggbbaa format (8 hex chars + #)
  if (hex.length === 9) {
    const color = hex.slice(0, 7); // #rrggbb
    const alphaHex = hex.slice(7, 9); // aa
    const alpha = Number.parseInt(alphaHex, 16); // 0-255
    const opacity = Math.round((alpha / 255) * 100).toString(); // 0-100
    return { color, opacity };
  }
  return { color: hex, opacity: undefined };
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
