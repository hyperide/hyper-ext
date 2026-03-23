import { describe, expect, it } from 'bun:test';
import { encodeCommands, PathCmd } from './commands';
import { flattenPath } from './flatten';

describe('flattenPath', () => {
  it('should pass through line segments as-is', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
    ]);
    const points = flattenPath(cmds, 1.0);
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  it('should subdivide cubic bezier into line segments', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Cubic, cx1: 0, cy1: 100, cx2: 100, cy2: 100, x: 100, y: 0 },
    ]);
    const points = flattenPath(cmds, 1.0);
    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it('should produce fewer points with higher tolerance', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Cubic, cx1: 0, cy1: 100, cx2: 100, cy2: 100, x: 100, y: 0 },
    ]);
    const fine = flattenPath(cmds, 0.1);
    const coarse = flattenPath(cmds, 5.0);
    expect(fine.length).toBeGreaterThan(coarse.length);
  });

  it('should handle closed paths', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Close },
    ]);
    const points = flattenPath(cmds, 1.0);
    expect(points.length).toBe(3);
  });

  it('should flatten quad bezier', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Quad, cx: 50, cy: 100, x: 100, y: 0 },
    ]);
    const points = flattenPath(cmds, 1.0);
    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it('should not hang on zero or negative tolerance', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Cubic, cx1: 0, cy1: 100, cx2: 100, cy2: 100, x: 100, y: 0 },
    ]);
    // Must complete without stack overflow; result should be fine-grained but finite
    const points = flattenPath(cmds, 0);
    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it('should flatten arcs by converting to cubics first', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Arc, rx: 50, ry: 50, rotation: 0, largeArc: 0, sweep: 1, x: 100, y: 0 },
    ]);
    const points = flattenPath(cmds, 1.0);
    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 100, y: 0 });
    // The midpoint of a semicircle arc should be close to (50, -50)
    const midIdx = Math.floor(points.length / 2);
    expect(points[midIdx].y).toBeLessThan(-20); // Should be negative (arc goes up)
  });
});
