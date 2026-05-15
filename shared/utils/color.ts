/**
 * @file Shared color conversion and distance utilities
 *
 * Accessed via: Internal module, not exposed
 * Assumptions: hex inputs are 6-digit (#rrggbb) or 3-digit (#rgb)
 */

export function hexToRgb(h: string): { r: number; g: number; b: number } | null {
  const result6 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
  if (result6) {
    return {
      r: Number.parseInt(result6[1], 16),
      g: Number.parseInt(result6[2], 16),
      b: Number.parseInt(result6[3], 16),
    };
  }
  const result3 = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(h);
  if (result3) {
    return {
      r: Number.parseInt(result3[1] + result3[1], 16),
      g: Number.parseInt(result3[2] + result3[2], 16),
      b: Number.parseInt(result3[3] + result3[3], 16),
    };
  }
  return null;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const rgb = hexToRgb(hex);
  if (!rgb) return { h: 0, s: 0, l: 0 };

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function hslToHex(h: number, s: number, l: number): string {
  const { r, g, b } = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

/** Relative luminance per WCAG 2.1 */
function sRgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * sRgbToLinear(r) + 0.7152 * sRgbToLinear(g) + 0.0722 * sRgbToLinear(b);
}

/** WCAG 2.1 contrast ratio between two hex colors (1–21) */
export function contrastRatio(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return 1;
  const l1 = relativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = relativeLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG level for normal text: AAA ≥ 7, AA ≥ 4.5, fail otherwise */
export function wcagLevel(ratio: number): 'AAA' | 'AA' | 'Fail' {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  return 'Fail';
}

/** Find the nearest hex of the same hue that meets the target WCAG level against pairedHex.
 *  Adjusts lightness while keeping hue and saturation constant.
 *  Searches outward from current lightness in both directions — O(d) where d is distance to fix. */
export function findContrastFixHex(hex: string, pairedHex: string, targetLevel: 'AA' | 'AAA'): string | null {
  const hsl = hexToHsl(hex);
  const targetRatio = targetLevel === 'AAA' ? 7 : 4.5;

  // Search both directions simultaneously, closest first
  let darkerFix: string | null = null;
  let lighterFix: string | null = null;

  for (let d = 1; d <= 100; d++) {
    const darkL = hsl.l - d;
    const lightL = hsl.l + d;

    if (!darkerFix && darkL >= 0) {
      const candidate = hslToHex(hsl.h, hsl.s, darkL);
      if (contrastRatio(candidate, pairedHex) >= targetRatio) darkerFix = candidate;
    }
    if (!lighterFix && lightL <= 100) {
      const candidate = hslToHex(hsl.h, hsl.s, lightL);
      if (contrastRatio(candidate, pairedHex) >= targetRatio) lighterFix = candidate;
    }

    if (darkerFix || lighterFix) return darkerFix ?? lighterFix;
    if (darkL < 0 && lightL > 100) break;
  }

  return null;
}

/** Euclidean distance in sRGB — not perceptually uniform, but sufficient for palette proximity matching */
export function colorDistance(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return Infinity;
  return Math.sqrt((rgb1.r - rgb2.r) ** 2 + (rgb1.g - rgb2.g) ** 2 + (rgb1.b - rgb2.b) ** 2);
}

/** Convert hex color and opacity (0-100) to hex with alpha channel (#rrggbbaa) */
export function hexWithAlpha(hex: string, opacity: string): string {
  if (!hex || !hex.startsWith('#')) return hex;
  const opacityNum = Number.parseFloat(opacity);
  if (Number.isNaN(opacityNum)) return hex;
  // opacity 0-100 → alpha 0-255
  const alpha = Math.round((opacityNum / 100) * 255);
  const alphaHex = alpha.toString(16).padStart(2, '0');
  const raw = hex.slice(1);
  const expanded = raw.length === 3 ? raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2] : raw;
  const cleanHex = expanded.padEnd(6, '0').slice(0, 6);
  return `#${cleanHex}${alphaHex}`;
}

/** Parse hex with alpha channel (#rrggbbaa) → { color: '#rrggbb', opacity: '0-100' } */
export function parseHexWithAlpha(hex: string): {
  color: string;
  opacity: string | undefined;
} {
  if (!hex || !hex.startsWith('#')) return { color: hex, opacity: undefined };
  // #rrggbbaa format (9 chars including #)
  if (hex.length === 9) {
    const color = hex.slice(0, 7);
    const alphaHex = hex.slice(7, 9);
    const alpha = Number.parseInt(alphaHex, 16); // 0-255
    const opacity = Math.round((alpha / 255) * 100).toString(); // 0-100
    return { color, opacity };
  }
  return { color: hex, opacity: undefined };
}
