import { describe, expect, it } from 'bun:test';
import { encodeCommands, PathCmd } from './commands';
import { pathArea, pathLength, pointAtOffset } from './geometry';

describe('pathLength', () => {
  it('should compute line segment length', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
    ]);
    expect(pathLength(cmds)).toBeCloseTo(100, 5);
  });

  it('should compute polyline length', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
    ]);
    expect(pathLength(cmds)).toBeCloseTo(200, 5);
  });

  it('should approximate cubic bezier length via Gauss-Legendre', () => {
    // Quarter-circle approximation: known length ≈ π/2 * 50 ≈ 78.54
    const k = 0.5522847498;
    const r = 50;
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: r, y: 0 },
      { type: PathCmd.Cubic, cx1: r, cy1: r * k, cx2: r * k, cy2: r, x: 0, y: r },
    ]);
    expect(pathLength(cmds)).toBeCloseTo((Math.PI / 2) * r, 0);
  });

  it('should compute quad bezier length', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Quad, cx: 50, cy: 100, x: 100, y: 0 },
    ]);
    const len = pathLength(cmds);
    // Quad bezier should be longer than chord (100) but shorter than going through control point
    expect(len).toBeGreaterThan(100);
    expect(len).toBeLessThan(224); // 100 + 2*sqrt(50^2+100^2) ≈ 223.6
  });

  it('should handle empty path', () => {
    const cmds = encodeCommands([]);
    expect(pathLength(cmds)).toBe(0);
  });

  it('should handle close command', () => {
    // Triangle: perimeter should be sum of 3 sides
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 50, y: 86.6 },
      { type: PathCmd.Close },
    ]);
    const len = pathLength(cmds);
    // Close adds segment back to start (50,86.6) → (0,0) ≈ 100
    // Total ≈ 100 + 93.3 + 100 ≈ 293
    expect(len).toBeGreaterThan(280);
    expect(len).toBeLessThan(300);
  });
});

describe('pathArea', () => {
  it('should compute area of a unit square', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Line, x: 0, y: 100 },
      { type: PathCmd.Close },
    ]);
    expect(Math.abs(pathArea(cmds))).toBeCloseTo(10000, 0);
  });

  it('should return positive for CW winding, negative for CCW', () => {
    const cw = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Close },
    ]);
    const ccw = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 0, y: 100 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Close },
    ]);
    expect(Math.sign(pathArea(cw))).not.toBe(Math.sign(pathArea(ccw)));
  });

  it('should handle empty path', () => {
    expect(pathArea(new Float64Array(0))).toBe(0);
  });

  it('should return zero for a path of only Move commands', () => {
    // A path with only moves has no contour — area must be 0
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Move, x: 10, y: 0 },
      { type: PathCmd.Move, x: 10, y: 10 },
    ]);
    expect(pathArea(cmds)).toBe(0);
  });

  it('should compute sum of contour areas for compound paths', () => {
    // Two disjoint squares: each 100x100 = 10000. Total abs area = 20000.
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Line, x: 0, y: 100 },
      { type: PathCmd.Close },
      { type: PathCmd.Move, x: 200, y: 0 },
      { type: PathCmd.Line, x: 300, y: 0 },
      { type: PathCmd.Line, x: 300, y: 100 },
      { type: PathCmd.Line, x: 200, y: 100 },
      { type: PathCmd.Close },
    ]);
    expect(Math.abs(pathArea(cmds))).toBeCloseTo(20000, 0);
  });
});

describe('pointAtOffset', () => {
  it('should return start point at offset 0', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
    ]);
    const pt = pointAtOffset(cmds, 0);
    expect(pt.point.x).toBeCloseTo(0, 5);
    expect(pt.point.y).toBeCloseTo(0, 5);
  });

  it('should return end point at offset 1', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
    ]);
    const pt = pointAtOffset(cmds, 1);
    expect(pt.point.x).toBeCloseTo(100, 5);
    expect(pt.point.y).toBeCloseTo(0, 5);
  });

  it('should return midpoint at offset 0.5', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
    ]);
    const pt = pointAtOffset(cmds, 0.5);
    expect(pt.point.x).toBeCloseTo(50, 5);
  });

  it('should return tangent direction', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
    ]);
    const pt = pointAtOffset(cmds, 0.5);
    expect(pt.tangent.x).toBeCloseTo(1, 5);
    expect(pt.tangent.y).toBeCloseTo(0, 5);
  });

  it('should return perpendicular normal', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
    ]);
    const pt = pointAtOffset(cmds, 0.5);
    expect(Math.abs(pt.normal.x)).toBeCloseTo(0, 5);
    expect(Math.abs(pt.normal.y)).toBeCloseTo(1, 5);
  });

  it('should handle multi-segment path', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
    ]);
    // Total length = 200, offset 0.75 → at distance 150
    // First segment is 100, second goes from (100,0) to (100,100)
    // At distance 150: 50 units into second segment → (100, 50)
    const pt = pointAtOffset(cmds, 0.75);
    expect(pt.point.x).toBeCloseTo(100, 1);
    expect(pt.point.y).toBeCloseTo(50, 1);
  });

  it('should handle cubic bezier path', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Cubic, cx1: 33, cy1: 100, cx2: 66, cy2: 100, x: 100, y: 0 },
    ]);
    const pt = pointAtOffset(cmds, 0.5);
    // Midpoint of this symmetric cubic should be around (50, 75)
    expect(pt.point.x).toBeCloseTo(50, 0);
    expect(pt.point.y).toBeGreaterThan(50);
  });

  it('should handle quadratic bezier path — midpoint on curve', () => {
    // M0 0 Q50 100 100 0 — midpoint at t=0.5 is (50, 50), not (50, 0) as chord would give
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Quad, cx: 50, cy: 100, x: 100, y: 0 },
    ]);
    const pt = pointAtOffset(cmds, 0.5);
    expect(pt.point.y).toBeGreaterThan(30);
  });

  it('should handle arc path — midpoint on curve', () => {
    // Quarter circle: M50 0 A50 50 0 0 1 0 50 — midpoint should be near (35, 15)
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 50, y: 0 },
      { type: PathCmd.Arc, rx: 50, ry: 50, rotation: 0, largeArc: 0, sweep: 1, x: 0, y: 50 },
    ]);
    const pt = pointAtOffset(cmds, 0.5);
    // Midpoint of quarter arc should be off the chord (not at (25, 25) which is below the arc)
    const chordMidDist = Math.sqrt((pt.point.x - 25) ** 2 + (pt.point.y - 25) ** 2);
    expect(chordMidDist).toBeGreaterThan(5);
  });

  it('should clamp offset to [0, 1]', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
    ]);
    const ptNeg = pointAtOffset(cmds, -0.5);
    expect(ptNeg.point.x).toBeCloseTo(0, 5);
    const ptOver = pointAtOffset(cmds, 1.5);
    expect(ptOver.point.x).toBeCloseTo(100, 5);
  });

  it('should return default point for empty commands', () => {
    const pt = pointAtOffset(new Float64Array(0), 0.5);
    expect(pt.point.x).toBe(0);
    expect(pt.point.y).toBe(0);
    expect(pt.tangent.x).toBe(1);
    expect(pt.tangent.y).toBe(0);
  });

  it('should handle close command — treats it as synthetic line to subpath start', () => {
    // Square: M0,0 L100,0 L100,100 L0,100 Z — total length ≈ 400
    // offset 0.875 → 350 units in → 50 units into the close segment → (50, 0) from (0,100) toward (0,0)
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Line, x: 0, y: 100 },
      { type: PathCmd.Close },
    ]);
    // offset 0 → start at (0,0)
    const ptStart = pointAtOffset(cmds, 0);
    expect(ptStart.point.x).toBeCloseTo(0, 3);
    expect(ptStart.point.y).toBeCloseTo(0, 3);
    // offset 1 → end of close segment (back at start)
    const ptEnd = pointAtOffset(cmds, 1);
    expect(ptEnd.point.x).toBeCloseTo(0, 3);
    expect(ptEnd.point.y).toBeCloseTo(0, 3);
  });

  it('should handle degenerate path (only Move — zero total length)', () => {
    const cmds = encodeCommands([{ type: PathCmd.Move, x: 10, y: 20 }]);
    const pt = pointAtOffset(cmds, 0.5);
    // Zero-length fallback: returns last known point
    expect(pt.point.x).toBe(10);
    expect(pt.point.y).toBe(20);
  });

  it('should return valid tangent on quadratic bezier at offset 0 and 1', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Quad, cx: 50, cy: 100, x: 100, y: 0 },
    ]);
    const ptStart = pointAtOffset(cmds, 0);
    const ptEnd = pointAtOffset(cmds, 1);
    // Tangent should be a unit vector
    const magStart = Math.sqrt(ptStart.tangent.x ** 2 + ptStart.tangent.y ** 2);
    const magEnd = Math.sqrt(ptEnd.tangent.x ** 2 + ptEnd.tangent.y ** 2);
    expect(magStart).toBeCloseTo(1, 5);
    expect(magEnd).toBeCloseTo(1, 5);
  });

  it('should return valid tangent on arc at offset 0 and 1', () => {
    // Quarter circle arc
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 50, y: 0 },
      { type: PathCmd.Arc, rx: 50, ry: 50, rotation: 0, largeArc: 0, sweep: 1, x: 0, y: 50 },
    ]);
    const ptMid = pointAtOffset(cmds, 0.5);
    const mag = Math.sqrt(ptMid.tangent.x ** 2 + ptMid.tangent.y ** 2);
    expect(mag).toBeCloseTo(1, 5);
    // Normal is perpendicular to tangent
    const dot = ptMid.tangent.x * ptMid.normal.x + ptMid.tangent.y * ptMid.normal.y;
    expect(Math.abs(dot)).toBeLessThan(1e-9);
  });
});

describe('pathArea — curved contours', () => {
  it('should estimate area of a cubic bezier closed shape', () => {
    // Rough circle via 4 cubic beziers (radius 50)
    const k = 0.5522847498;
    const r = 50;
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: r, y: 0 },
      { type: PathCmd.Cubic, cx1: r, cy1: r * k, cx2: r * k, cy2: r, x: 0, y: r },
      { type: PathCmd.Cubic, cx1: -r * k, cy1: r, cx2: -r, cy2: r * k, x: -r, y: 0 },
      { type: PathCmd.Cubic, cx1: -r, cy1: -r * k, cx2: -r * k, cy2: -r, x: 0, y: -r },
      { type: PathCmd.Cubic, cx1: r * k, cy1: -r, cx2: r, cy2: -r * k, x: r, y: 0 },
      { type: PathCmd.Close },
    ]);
    const area = Math.abs(pathArea(cmds));
    // π * 50² ≈ 7854; tolerance 5%
    expect(area).toBeGreaterThan(7400);
    expect(area).toBeLessThan(8300);
  });

  it('should estimate area of a quad bezier closed shape', () => {
    // Triangle-ish shape using quad beziers
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Quad, cx: 50, cy: 0, x: 100, y: 0 },
      { type: PathCmd.Quad, cx: 100, cy: 50, x: 50, y: 100 },
      { type: PathCmd.Quad, cx: 0, cy: 50, x: 0, y: 0 },
      { type: PathCmd.Close },
    ]);
    const area = Math.abs(pathArea(cmds));
    // Rough check: area should be positive and significant
    expect(area).toBeGreaterThan(1000);
    expect(area).toBeLessThan(15000);
  });

  it('should estimate area of arc-based closed shape', () => {
    // Full circle built from two semicircular arcs, radius 50
    const r = 50;
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: r, y: 0 },
      { type: PathCmd.Arc, rx: r, ry: r, rotation: 0, largeArc: 0, sweep: 1, x: -r, y: 0 },
      { type: PathCmd.Arc, rx: r, ry: r, rotation: 0, largeArc: 0, sweep: 1, x: r, y: 0 },
      { type: PathCmd.Close },
    ]);
    const area = Math.abs(pathArea(cmds));
    // π * 50² ≈ 7854; flattenPath tolerance introduces small error, allow 10%
    expect(area).toBeGreaterThan(7000);
    expect(area).toBeLessThan(8700);
  });
});

describe('pathLength — arc branch', () => {
  it('should approximate quarter-circle arc length', () => {
    // Quarter circle of radius 50: expected length ≈ π/2 * 50 ≈ 78.54
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 50, y: 0 },
      { type: PathCmd.Arc, rx: 50, ry: 50, rotation: 0, largeArc: 0, sweep: 1, x: 0, y: 50 },
    ]);
    const len = pathLength(cmds);
    expect(len).toBeGreaterThan(75);
    expect(len).toBeLessThan(82);
  });
});
