/**
 * @file Text on Path — lay real glyph outlines along an arbitrary path
 *
 * Accessed via: Vector toolbar > Text-on-path tool; CLI word-art helpers (textOnPath/arcText/wavyText)
 * Assumptions: a font is registered via registerFont(); the input path provides the
 *   baseline curve. Each glyph's outline is rotated to the path tangent and placed at
 *   its cumulative advance offset (left-edge placement). Latin / simple scripts only in
 *   v1 — no HarfBuzz shaping or kerning yet (advance comes from opentype hmtx).
 * Tradeoffs: positions are sampled per-glyph at the glyph origin, not arc-length-resampled
 *   per outline point — fine for upright text on smooth curves; extreme curvature relative
 *   to glyph width will show minor shear at glyph edges.
 * Architecture: docs/specs/2026-06-03-vecli-vector-cli-decomposition.md §VECLI-5
 */

import { PathBuilder } from '../../path/builder';
import { type PathCommand, PathCmd } from '../../path/commands';
import { pathLength, pointAtOffset } from '../../path/geometry';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';
import { extractGlyphOutlines, type GlyphOutline } from './text-to-path';

export type { GlyphOutline } from './text-to-path';

export interface TextOnPathOptions {
  /** Extra spacing (px) inserted after every glyph advance. Default 0. */
  letterSpacing?: number;
  /** Shift along the path before the first glyph (px). Default 0. */
  startOffset?: number;
}

/** Affine point transform: rotate (cos/sin) then translate (tx, ty). */
function place(x: number, y: number, cos: number, sin: number, tx: number, ty: number): { x: number; y: number } {
  return { x: tx + x * cos - y * sin, y: ty + x * sin + y * cos };
}

/** Emit one origin-relative glyph command into the builder, rotated + translated. */
function appendGlyphCommand(
  builder: PathBuilder,
  cmd: PathCommand,
  cos: number,
  sin: number,
  tx: number,
  ty: number,
): void {
  switch (cmd.type) {
    case PathCmd.Move: {
      const p = place(cmd.x, cmd.y, cos, sin, tx, ty);
      builder.moveTo(p.x, p.y);
      break;
    }
    case PathCmd.Line: {
      const p = place(cmd.x, cmd.y, cos, sin, tx, ty);
      builder.lineTo(p.x, p.y);
      break;
    }
    case PathCmd.Cubic: {
      const c1 = place(cmd.cx1, cmd.cy1, cos, sin, tx, ty);
      const c2 = place(cmd.cx2, cmd.cy2, cos, sin, tx, ty);
      const p = place(cmd.x, cmd.y, cos, sin, tx, ty);
      builder.cubicTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
      break;
    }
    case PathCmd.Quad: {
      const c = place(cmd.cx, cmd.cy, cos, sin, tx, ty);
      const p = place(cmd.x, cmd.y, cos, sin, tx, ty);
      builder.quadTo(c.x, c.y, p.x, p.y);
      break;
    }
    case PathCmd.Arc: {
      // Arc radii/flags can't be cleanly rotated in command space; rotate the endpoint
      // and bake the path rotation into the arc's x-axis rotation. Glyph outlines from
      // opentype/harfbuzz never emit arcs, so this branch is defensive only.
      const p = place(cmd.x, cmd.y, cos, sin, tx, ty);
      const angleDeg = (Math.atan2(sin, cos) * 180) / Math.PI;
      builder.arcTo(cmd.rx, cmd.ry, cmd.rotation + angleDeg, cmd.largeArc, cmd.sweep, p.x, p.y);
      break;
    }
    case PathCmd.Close:
      builder.close();
      break;
  }
}

/**
 * Lay a sequence of glyph outlines along a path.
 *
 * For each glyph: the cumulative advance distance is converted to a normalized
 * path offset, `pointAtOffset` yields the baseline point + unit tangent there, and
 * the glyph's origin-relative outline is rotated by the tangent angle and translated
 * onto that point (rotate-around-origin-then-translate ⇒ a horizontal path is identity).
 *
 * Pure: no font loading, no I/O. Returns a single compound PathValue (multi-contour
 * glyphs keep all their subpaths — counters/holes survive). Glyphs that fall past the
 * end of the path are dropped (truncated), not clamped onto the endpoint.
 */
export function layoutGlyphsOnPath(
  glyphs: GlyphOutline[],
  pathCommands: Float64Array,
  opts: TextOnPathOptions = {},
): PathValue {
  const builder = new PathBuilder();
  if (glyphs.length === 0 || pathCommands.length === 0) return builder.build();

  const letterSpacing = opts.letterSpacing ?? 0;
  // Glyphs advance by their real pixel advance along the path arc-length.
  const pathLen = Math.max(pathLength(pathCommands), 1e-9);

  let distance = opts.startOffset ?? 0;
  for (const glyph of glyphs) {
    // Overflow handling: glyphs that fall past the end of the path are dropped
    // rather than clamped — clamping would pile every overflow glyph on top of
    // the path endpoint (an unreadable smudge). Dropping mirrors how a textPath
    // truncates text that doesn't fit.
    if (distance > pathLen) break;
    const offset = distance / pathLen;
    const { point, tangent } = pointAtOffset(pathCommands, offset);
    const cos = tangent.x;
    const sin = tangent.y;
    for (const cmd of glyph.outline) {
      appendGlyphCommand(builder, cmd, cos, sin, point.x, point.y);
    }
    distance += glyph.advance + letterSpacing;
  }

  return builder.build();
}

export const textOnPathNode: NodeTypeDefinition = {
  type: 'textOnPath',
  label: 'Text on Path',
  category: 'generator',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'text', type: 'string', default: 'Hello' },
    { name: 'fontSize', type: 'number', default: 48, min: 1 },
    { name: 'fontUrl', type: 'string', default: '' },
    { name: 'letterSpacing', type: 'number', default: 0, step: 1 },
    { name: 'startOffset', type: 'number', default: 0, step: 1 },
  ],
  execute(inputs: Record<string, NodeValue | NodeValue[]>, params: Record<string, unknown>): Record<string, NodeValue> {
    const empty: PathValue = { commands: new Float64Array(0), closed: false };
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput || pathInput.type !== 'path') {
      return { path: { type: 'path', value: empty } };
    }
    const fontUrl = params.fontUrl as string;
    const text = params.text as string;
    const glyphs = extractGlyphOutlines(fontUrl, text, params.fontSize as number);
    // Fail loudly instead of rendering a silently-empty path: outline mode needs a
    // host-registered font (registerFont + opentype.load). In the CLI sandbox there
    // is no font-loading path yet (HYP-513), so a fontUrl alone yields no glyphs —
    // surface that to the caller rather than emitting a blank result.
    if (text && fontUrl && glyphs.length === 0) {
      throw new Error(
        `textOnPath: no glyphs for font "${fontUrl}". Outline mode requires a host-registered font ` +
          `(opentype.load + registerFont); CLI font loading from a URL is not wired yet (HYP-513).`,
      );
    }
    const result = layoutGlyphsOnPath(glyphs, (pathInput.value as PathValue).commands, {
      letterSpacing: params.letterSpacing as number,
      startOffset: params.startOffset as number,
    });
    return { path: { type: 'path', value: result } };
  },
};
