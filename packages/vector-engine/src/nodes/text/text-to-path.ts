/**
 * @file Text to Path — convert text string to vector outlines via opentype.js
 *
 * Accessed via: Vector toolbar > Text tool (vector mode)
 * Assumptions: font file must be loadable via URL or path. Latin scripts only in v1.
 *   Complex scripts (Arabic, Devanagari) need rustybuzz shaping (Plan 2b).
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Text to Path
 */

import type { Font, Path as OpentypePath } from 'opentype.js';
import { PathBuilder } from '../../path/builder';
import { PathCmd, type PathCommand } from '../../path/commands';
import type { NodeTypeDefinition } from '../../types';

// Font cache to avoid re-parsing on repeated executions
const fontCache = new Map<string, Font>();

/** Convert opentype.js path commands into engine PathCommands. */
function opentypeCommandsToPathCommands(otPath: OpentypePath): PathCommand[] {
  const out: PathCommand[] = [];
  for (const cmd of otPath.commands) {
    switch (cmd.type) {
      case 'M':
        out.push({ type: PathCmd.Move, x: cmd.x, y: cmd.y });
        break;
      case 'L':
        out.push({ type: PathCmd.Line, x: cmd.x, y: cmd.y });
        break;
      case 'C':
        out.push({ type: PathCmd.Cubic, cx1: cmd.x1, cy1: cmd.y1, cx2: cmd.x2, cy2: cmd.y2, x: cmd.x, y: cmd.y });
        break;
      case 'Q':
        out.push({ type: PathCmd.Quad, cx: cmd.x1, cy: cmd.y1, x: cmd.x, y: cmd.y });
        break;
      case 'Z':
        out.push({ type: PathCmd.Close });
        break;
    }
  }
  return out;
}

/** One glyph laid out as an origin-relative outline plus its advance width (in px). */
export interface GlyphOutline {
  outline: PathCommand[];
  advance: number;
}

/**
 * Extract per-glyph outlines + advances from a registered font.
 *
 * Each outline is produced at the glyph's own origin (0,0) so callers can place
 * it freely (e.g. along a path). Advance is scaled to pixels: `advanceWidth *
 * fontSize / unitsPerEm` — the same scaling opentype.js uses internally.
 *
 * Returns [] when the font is not registered, the text is empty, or anything throws.
 * Latin / simple scripts only (v1) — no HarfBuzz shaping or kerning yet.
 */
export function extractGlyphOutlines(fontUrl: string, text: string, fontSize: number): GlyphOutline[] {
  if (!text) return [];
  const font = fontCache.get(fontUrl);
  if (!font) return [];
  try {
    const scale = fontSize / font.unitsPerEm;
    return font.stringToGlyphs(text).map((glyph) => ({
      outline: opentypeCommandsToPathCommands(glyph.getPath(0, 0, fontSize)),
      advance: glyph.advanceWidth * scale,
    }));
  } catch {
    return [];
  }
}

export const textToPathNode: NodeTypeDefinition = {
  type: 'textToPath',
  label: 'Text to Path',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'text', type: 'string', default: 'Hello' },
    { name: 'fontSize', type: 'number', default: 48, min: 1 },
    { name: 'fontUrl', type: 'string', default: '' },
    { name: 'x', type: 'number', default: 0 },
    { name: 'y', type: 'number', default: 0 },
  ],
  execute(_inputs, params) {
    const builder = new PathBuilder();
    try {
      const fontUrl = params.fontUrl as string;
      const font = fontCache.get(fontUrl);
      if (!font) {
        return { path: { type: 'path', value: builder.build() } };
      }
      const opentypePath = font.getPath(
        params.text as string,
        params.x as number,
        params.y as number,
        params.fontSize as number,
      );
      for (const cmd of opentypePath.commands) {
        switch (cmd.type) {
          case 'M':
            builder.moveTo(cmd.x, cmd.y);
            break;
          case 'L':
            builder.lineTo(cmd.x, cmd.y);
            break;
          case 'C':
            builder.cubicTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
            break;
          case 'Q':
            builder.quadTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
            break;
          case 'Z':
            builder.close();
            break;
        }
      }
    } catch {
      // Font not available — return empty path
    }
    return { path: { type: 'path', value: builder.build() } };
  },
};

/**
 * Register a pre-loaded font in the cache so textToPathNode can use it.
 * Callers load the font via opentype.load() and pass it here.
 */
export function registerFont(url: string, font: Font): void {
  fontCache.set(url, font);
}
