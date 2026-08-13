/**
 * @file Unit tests for transformPathCommands (affine bake into path geometry).
 */

import { describe, expect, it } from 'bun:test';
import type { TransformMatrix } from '../types';
import { decodeCommands, encodeCommands, type PathCommand, PathCmd } from './commands';
import { transformPathCommands } from './transform-path';

const IDENTITY: TransformMatrix = [1, 0, 0, 1, 0, 0];
const TRANSLATE_10_20: TransformMatrix = [1, 0, 0, 1, 10, 20];
const SCALE_2: TransformMatrix = [2, 0, 0, 2, 0, 0];

describe('transformPathCommands', () => {
  it('returns the same buffer reference for the identity transform', () => {
    const rect = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 10, y: 0 },
      { type: PathCmd.Close },
    ]);
    expect(transformPathCommands(rect, IDENTITY)).toBe(rect);
  });

  it('translates Move and Line anchors', () => {
    const input = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 5, y: 5 },
    ]);
    const out = decodeCommands(transformPathCommands(input, TRANSLATE_10_20));
    expect(out).toEqual([
      { type: PathCmd.Move, x: 10, y: 20 },
      { type: PathCmd.Line, x: 15, y: 25 },
    ]);
  });

  it('transforms cubic control points, not just endpoints', () => {
    const input = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Cubic, cx1: 1, cy1: 2, cx2: 3, cy2: 4, x: 5, y: 6 },
    ]);
    const out = decodeCommands(transformPathCommands(input, SCALE_2));
    expect(out[1]).toEqual({ type: PathCmd.Cubic, cx1: 2, cy1: 4, cx2: 6, cy2: 8, x: 10, y: 12 });
  });

  it('transforms quad control point', () => {
    const input = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Quad, cx: 1, cy: 2, x: 3, y: 4 },
    ]);
    const out = decodeCommands(transformPathCommands(input, SCALE_2));
    expect(out[1]).toEqual({ type: PathCmd.Quad, cx: 2, cy: 4, x: 6, y: 8 });
  });

  it('preserves Close', () => {
    const input = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 4, y: 0 },
      { type: PathCmd.Close },
    ]);
    const out = decodeCommands(transformPathCommands(input, TRANSLATE_10_20));
    expect(out[out.length - 1]).toEqual({ type: PathCmd.Close });
  });

  it('flattens an arc after Close from the subpath start (SVG current-point reset)', () => {
    // M(2,2) … Z resets the current point to (2,2). The arc that follows (no
    // intervening Move) must be flattened starting from (2,2), NOT the last drawn
    // point (10,0). An arc's flattened polyline depends on its start point, so a
    // wrong start yields entirely different intermediate vertices.
    const arc = { type: PathCmd.Arc, rx: 5, ry: 5, rotation: 0, largeArc: 0, sweep: 1, x: 12, y: 12 } as const;
    const afterClose = encodeCommands([
      { type: PathCmd.Move, x: 2, y: 2 },
      { type: PathCmd.Line, x: 10, y: 0 },
      { type: PathCmd.Close },
      arc,
    ]);
    // Reference: same arc explicitly starting at the subpath start (2,2).
    const fromStart = encodeCommands([{ type: PathCmd.Move, x: 2, y: 2 }, arc]);
    const refLines = decodeCommands(transformPathCommands(fromStart, TRANSLATE_10_20)).filter(
      (c: PathCommand) => c.type === PathCmd.Line,
    );
    const gotLines = decodeCommands(transformPathCommands(afterClose, TRANSLATE_10_20)).filter(
      (c: PathCommand) => c.type === PathCmd.Line,
    );
    // The trailing flattened-arc segments of the closed path must match the arc
    // flattened from (2,2). Compare the last refLines.length segments.
    const tail = gotLines.slice(gotLines.length - refLines.length);
    expect(tail.length).toBe(refLines.length);
    for (let i = 0; i < refLines.length; i++) {
      const a = tail[i];
      const b = refLines[i];
      if (a.type === PathCmd.Line && b.type === PathCmd.Line) {
        expect(a.x).toBeCloseTo(b.x, 9);
        expect(a.y).toBeCloseTo(b.y, 9);
      }
    }
  });

  it('flattens a transformed arc to line segments at its translated position', () => {
    const input = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Arc, rx: 10, ry: 10, rotation: 0, largeArc: 0, sweep: 1, x: 10, y: 10 },
    ]);
    const out = decodeCommands(transformPathCommands(input, TRANSLATE_10_20));
    // Arc becomes a polyline of Line segments; no Arc command survives.
    expect(out.some((c: PathCommand) => c.type === PathCmd.Arc)).toBe(false);
    expect(out[0]).toEqual({ type: PathCmd.Move, x: 10, y: 20 });
    // Every emitted segment lands in the translated frame: endpoint at (10+10, 10+20).
    const last = out[out.length - 1];
    expect(last.type).toBe(PathCmd.Line);
    if (last.type === PathCmd.Line) {
      expect(last.x).toBeCloseTo(20, 6);
      expect(last.y).toBeCloseTo(30, 6);
    }
  });

  it('scales the arc flatten tolerance by the transform so large scale subdivides finer', () => {
    // codex P2: a fixed tolerance is measured in untransformed space, then multiplied by the
    // transform scale. Under a large scale the tolerance must shrink → more line segments,
    // keeping the post-transform polyline error bounded near ARC_FLATTEN_TOLERANCE.
    const arc = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Arc, rx: 10, ry: 10, rotation: 0, largeArc: 0, sweep: 1, x: 10, y: 10 },
    ]);
    const SCALE_1000: TransformMatrix = [1000, 0, 0, 1000, 0, 0];
    const segsSmall = decodeCommands(transformPathCommands(arc, SCALE_2)).filter(
      (c: PathCommand) => c.type === PathCmd.Line,
    ).length;
    const segsLarge = decodeCommands(transformPathCommands(arc, SCALE_1000)).filter(
      (c: PathCommand) => c.type === PathCmd.Line,
    ).length;
    expect(segsLarge).toBeGreaterThan(segsSmall);
  });
});
