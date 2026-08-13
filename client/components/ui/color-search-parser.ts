/**
 * @file Multi-format color input parser
 *
 * Accessed via: Internal module, used by ColorCombobox search
 * Assumptions: runs in browser environment (canvas API for named color fallback)
 */

import { hslToRgb, rgbToHex } from '@shared/utils/color';

export type ColorFormat = 'hex' | 'hex-short' | 'rgb' | 'hsl' | 'named';

export interface ParsedColorInput {
  hex: string;
  original: string;
  format: ColorFormat;
}

const HEX_6 = /^#?([0-9a-f]{6})$/i;
const HEX_3 = /^#?([0-9a-f]{3})$/i;
const HEX_1 = /^#?([0-9a-f])$/i;
const RGB_RE = /^rgb\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)$/i;
const HSL_RE = /^hsl\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})%?\s*[,\s]\s*(\d{1,3})%?\s*\)$/i;

/** Expand 3-digit hex to 6-digit: abc → aabbcc */
function expand3(short: string): string {
  return short
    .split('')
    .map((c) => c + c)
    .join('');
}

/** Canvas-based CSS color resolver for named colors and exotic formats */
let canvasCtx: CanvasRenderingContext2D | null = null;

function cssColorToHex(input: string): string | null {
  if (typeof document === 'undefined') return null;
  if (!canvasCtx) canvasCtx = document.createElement('canvas').getContext('2d');
  if (!canvasCtx) return null;

  // codeql[js/useless-assignment-to-property] -- sentinel probe: set known color, overwrite with input,
  // then read back the normalized value. Two probes handle the edge case where input IS '#010101'.
  canvasCtx.fillStyle = '#010101';
  canvasCtx.fillStyle = input;
  if (canvasCtx.fillStyle !== '#010101') return canvasCtx.fillStyle;

  canvasCtx.fillStyle = '#020202';
  canvasCtx.fillStyle = input;
  if (canvasCtx.fillStyle !== '#020202') return canvasCtx.fillStyle;

  return null;
}

export function parseColorInput(input: string): ParsedColorInput | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 6-digit hex
  const hex6 = HEX_6.exec(trimmed);
  if (hex6) {
    return { hex: `#${hex6[1].toLowerCase()}`, original: trimmed, format: 'hex' };
  }

  // 3-digit hex
  const hex3 = HEX_3.exec(trimmed);
  if (hex3) {
    return { hex: `#${expand3(hex3[1].toLowerCase())}`, original: trimmed, format: 'hex-short' };
  }

  // 1-digit hex: #a → #aaaaaa
  const hex1 = HEX_1.exec(trimmed);
  if (hex1) {
    const ch = hex1[1].toLowerCase();
    return { hex: `#${ch.repeat(6)}`, original: trimmed, format: 'hex-short' };
  }

  // rgb(r, g, b) or rgb(r g b)
  const rgb = RGB_RE.exec(trimmed);
  if (rgb) {
    const r = Number.parseInt(rgb[1], 10);
    const g = Number.parseInt(rgb[2], 10);
    const b = Number.parseInt(rgb[3], 10);
    if (r <= 255 && g <= 255 && b <= 255) {
      return { hex: rgbToHex(r, g, b), original: trimmed, format: 'rgb' };
    }
  }

  // hsl(h, s%, l%) or hsl(h s l)
  const hsl = HSL_RE.exec(trimmed);
  if (hsl) {
    const h = Number.parseInt(hsl[1], 10);
    const s = Number.parseInt(hsl[2], 10);
    const l = Number.parseInt(hsl[3], 10);
    if (h <= 360 && s <= 100 && l <= 100) {
      const { r, g, b } = hslToRgb(h, s, l);
      return { hex: rgbToHex(r, g, b), original: trimmed, format: 'hsl' };
    }
  }

  // Fallback: CSS named colors via canvas API
  const resolved = cssColorToHex(trimmed);
  if (resolved) {
    return { hex: resolved, original: trimmed, format: 'named' };
  }

  return null;
}
