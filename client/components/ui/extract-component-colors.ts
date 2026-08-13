/**
 * @file Extracts color values from component preview for color strip
 *
 * Accessed via: Internal module, used by useComponentColors hook
 * Assumptions: preview iframe accessible via same-origin
 *
 * Two extraction strategies:
 * 1. Preview DOM (primary): reads computed styles from rendered preview iframe elements
 * 2. AST fallback: parses static className props when iframe is unavailable
 */

import { getTamaguiColorHex } from '@lib/tamagui/values';
import type { ASTNode } from '@/lib/canvas-engine/types/ast';
import { getColorHex, getColorNames, TAILWIND_COLORS } from '@/lib/tailwind/tailwind-values';
import type { TokenSystem } from './color-utils';

export interface ColorEntry {
  value: string;
  hex: string;
  isToken: boolean;
  count: number;
  /** Source element ID for canvas navigation */
  nodeId?: string;
  /** All element IDs that use this color */
  nodeIds: string[];
  /** Source line number in file */
  line?: number;
  /** How this color is used: bg, text, or border */
  source?: 'bg' | 'text' | 'border';
  /** Hex of the paired color on the same element (text↔bg) for contrast check */
  pairedHex?: string;
}

type ColorShades = Record<string, string>;

/** Convert rgb(r, g, b) or rgba(r, g, b, a) to #rrggbb hex */
function cssRgbToHex(rgb: string): string | null {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) return null;
  const r = Number.parseInt(m[1], 10);
  const g = Number.parseInt(m[2], 10);
  const b = Number.parseInt(m[3], 10);
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** Find the closest Tailwind token for a hex color */
function findTailwindToken(hex: string): string | null {
  const normalized = hex.toLowerCase();
  if (normalized === '#ffffff') return 'white';
  if (normalized === '#000000') return 'black';

  const colorNames = getColorNames();
  for (const colorName of colorNames) {
    const colorData = TAILWIND_COLORS[colorName as keyof typeof TAILWIND_COLORS];
    if (typeof colorData === 'string') continue;
    for (const [shade, shadeHex] of Object.entries(colorData as ColorShades)) {
      if (shadeHex.toLowerCase() === normalized) {
        return `${colorName}-${shade}`;
      }
    }
  }
  return null;
}

/** Build a nodeId → line lookup from AST for cross-referencing */
function buildLineMap(nodes: ASTNode[], map: Map<string, number> = new Map()): Map<string, number> {
  for (const node of nodes) {
    if (node.id && node.loc?.start.line) {
      map.set(node.id, node.loc.start.line);
    }
    if (node.children) buildLineMap(node.children, map);
  }
  return map;
}

/**
 * Extract colors from the preview iframe's rendered DOM (primary strategy).
 * Reads computed backgroundColor and color from all elements in the preview.
 */
export function extractColorsFromPreview(tokenSystem: TokenSystem, astNodes?: ASTNode[]): ColorEntry[] {
  const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null;
  const doc = iframe?.contentDocument;
  if (!doc?.body) return [];

  const elements = doc.body.querySelectorAll('*');
  if (elements.length === 0) return [];

  const lineMap = astNodes ? buildLineMap(astNodes) : new Map<string, number>();
  const accumulator = new Map<string, ColorEntry>();

  for (const el of elements) {
    const nodeId = el.id || undefined;
    const style = getComputedStyle(el);

    const candidates: Array<{ rgb: string; source: string }> = [];
    const bg = style.backgroundColor;
    const color = style.color;
    const borderColor = style.borderColor;

    // Skip transparent/default values
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      candidates.push({ rgb: bg, source: 'bg' });
    }
    if (color && color !== 'rgba(0, 0, 0, 0)') {
      candidates.push({ rgb: color, source: 'text' });
    }
    if (borderColor && borderColor !== 'rgb(0, 0, 0)' && borderColor !== 'rgba(0, 0, 0, 0)') {
      candidates.push({ rgb: borderColor, source: 'border' });
    }

    for (const { rgb, source } of candidates) {
      const hex = cssRgbToHex(rgb);
      if (!hex) continue;

      // Determine paired color: text↔bg, border↔bg
      let paired: string | null = null;
      if (source === 'text' && bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        paired = cssRgbToHex(bg);
      } else if ((source === 'bg' || source === 'border') && color && color !== 'rgba(0, 0, 0, 0)') {
        paired = cssRgbToHex(color);
      }

      const key = hex.toLowerCase();
      const existing = accumulator.get(key);
      if (existing) {
        existing.count++;
        if (nodeId && !existing.nodeIds.includes(nodeId)) {
          existing.nodeIds.push(nodeId);
        }
        // Keep first pairedHex found
        if (!existing.pairedHex && paired) {
          existing.pairedHex = paired;
          existing.source = source as 'bg' | 'text' | 'border';
        }
      } else {
        let token: string | null = null;
        if (tokenSystem === 'tailwind') {
          token = findTailwindToken(hex);
        } else if (tokenSystem === 'tamagui') {
          // Try reverse lookup for Tamagui
          token = null; // TODO(HYP-289): implement Tamagui hex→token reverse lookup
        }

        accumulator.set(key, {
          value: token || hex,
          hex,
          isToken: !!token,
          count: 1,
          nodeId,
          nodeIds: nodeId ? [nodeId] : [],
          line: nodeId ? lineMap.get(nodeId) : undefined,
          source: source as 'bg' | 'text' | 'border',
          pairedHex: paired || undefined,
        });
      }
    }
  }

  const entries = Array.from(accumulator.values());

  // Sort: tokens first (alphabetical), then hex (by count desc)
  return entries.sort((a, b) => {
    if (a.isToken !== b.isToken) return a.isToken ? -1 : 1;
    if (a.isToken && b.isToken) return a.value.localeCompare(b.value);
    return b.count - a.count;
  });
}

// --- AST-based fallback extraction (kept for environments without preview iframe) ---

/** Tailwind color class prefixes that carry color values */
const TW_COLOR_PREFIXES = [
  'bg-',
  'text-',
  'border-',
  'shadow-',
  'ring-',
  'outline-',
  'accent-',
  'fill-',
  'stroke-',
  'decoration-',
];

/** Tamagui props that carry color values */
const TAMAGUI_COLOR_PROPS = ['backgroundColor', 'color', 'borderColor', 'shadowColor'];

function extractTailwindColors(className: string): Array<{ value: string; hex: string; isToken: boolean }> {
  const classes = className.split(/\s+/);
  const colors: Array<{ value: string; hex: string; isToken: boolean }> = [];

  for (const cls of classes) {
    // Strip state variants (hover:, focus:, etc.)
    const parts = cls.split(':');
    const base = cls.includes(':') ? parts[parts.length - 1] : cls;

    // Arbitrary color: bg-[#ff0000]
    const arbMatch =
      /^(?:bg|text|border|shadow|ring|outline|accent|fill|stroke|decoration)-\[#([0-9a-fA-F]{3,6})\]$/.exec(base);
    if (arbMatch) {
      let hex = arbMatch[1];
      if (hex.length === 3)
        hex = hex
          .split('')
          .map((c) => c + c)
          .join('');
      colors.push({ value: `#${hex}`, hex: `#${hex.toLowerCase()}`, isToken: false });
      continue;
    }

    // Token color: bg-blue-500, text-white, border-red-200, etc.
    for (const prefix of TW_COLOR_PREFIXES) {
      if (!base.startsWith(prefix)) continue;
      const token = base.slice(prefix.length);
      // Strip opacity modifier: blue-500/50 → blue-500
      const tokenClean = token.includes('/') ? token.split('/')[0] : token;
      const resolvedHex = getColorHex(tokenClean);
      if (resolvedHex) {
        colors.push({ value: tokenClean, hex: resolvedHex, isToken: true });
      }
      break;
    }
  }

  return colors;
}

function extractTamaguiColors(props: Record<string, unknown>): Array<{ value: string; hex: string; isToken: boolean }> {
  const colors: Array<{ value: string; hex: string; isToken: boolean }> = [];

  for (const prop of TAMAGUI_COLOR_PROPS) {
    const val = props[prop];
    if (typeof val !== 'string' || !val) continue;

    if (val.startsWith('$')) {
      const hex = getTamaguiColorHex(val);
      if (hex) colors.push({ value: val, hex, isToken: true });
    } else if (val.startsWith('#')) {
      colors.push({ value: val, hex: val, isToken: false });
    }
  }

  return colors;
}

function extractInlineStyleColors(
  props: Record<string, unknown>,
): Array<{ value: string; hex: string; isToken: boolean }> {
  const colors: Array<{ value: string; hex: string; isToken: boolean }> = [];
  const style = props.style;
  if (!style || typeof style !== 'object') return colors;

  const styleObj = style as Record<string, unknown>;
  const colorProps = ['color', 'backgroundColor', 'borderColor', 'background'];

  for (const prop of colorProps) {
    const val = styleObj[prop];
    if (typeof val !== 'string' || !val) continue;
    if (/^#[0-9a-fA-F]{3,8}$/.test(val)) {
      colors.push({ value: val, hex: val.toLowerCase(), isToken: false });
    }
  }

  return colors;
}

function traverseAST(nodes: ASTNode[], tokenSystem: TokenSystem, accumulator: Map<string, ColorEntry>) {
  for (const node of nodes) {
    let extracted: Array<{ value: string; hex: string; isToken: boolean }> = [];

    if (tokenSystem === 'tailwind' && typeof node.props?.className === 'string') {
      extracted = extractTailwindColors(node.props.className);
    } else if (tokenSystem === 'tamagui' && node.props) {
      extracted = extractTamaguiColors(node.props);
    }

    // Also check inline style colors for any token system
    if (node.props) {
      extracted = [...extracted, ...extractInlineStyleColors(node.props)];
    }

    for (const color of extracted) {
      const key = color.hex.toLowerCase();
      const existing = accumulator.get(key);
      if (existing) {
        existing.count++;
        if (node.id && !existing.nodeIds.includes(node.id)) {
          existing.nodeIds.push(node.id);
        }
        if (color.isToken && !existing.isToken) {
          existing.value = color.value;
          existing.isToken = true;
        }
      } else {
        accumulator.set(key, {
          ...color,
          count: 1,
          nodeId: node.id,
          nodeIds: node.id ? [node.id] : [],
          line: node.loc?.start.line,
        });
      }
    }

    if (node.children) {
      traverseAST(node.children, tokenSystem, accumulator);
    }
  }
}

export function extractComponentColors(astNodes: ASTNode[], tokenSystem: TokenSystem): ColorEntry[] {
  const accumulator = new Map<string, ColorEntry>();
  traverseAST(astNodes, tokenSystem, accumulator);

  const entries = Array.from(accumulator.values());

  // Sort: tokens first (alphabetical), then hex (by count desc)
  return entries.sort((a, b) => {
    if (a.isToken !== b.isToken) return a.isToken ? -1 : 1;
    if (a.isToken && b.isToken) return a.value.localeCompare(b.value);
    return b.count - a.count;
  });
}
