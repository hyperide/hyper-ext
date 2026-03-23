import { describe, expect, it } from 'bun:test';
import { computeBounds } from '../../path/bounds';
import { decodeCommands, PathCmd } from '../../path/commands';
import type { NodeValue, PathValue } from '../../types';
import { arcNode } from './arc';
import { arrowNode } from './arrow';
import { ellipseNode } from './ellipse';
import { lineNode } from './line';
import { polygonNode } from './polygon';
import { rectangleNode } from './rectangle';
import { spiralNode } from './spiral';
import { starNode } from './star';
import { svgPathNode } from './svg-path';

describe('Rectangle generator — edge cases', () => {
  it('zero width should not crash and produces degenerate path', () => {
    const result = rectangleNode.execute({}, { width: 0, height: 50, x: 0, y: 0 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    expect(cmds.length).toBeGreaterThan(0);
    // All x-coords should be the same (degenerate)
    const xs = cmds.filter((c) => 'x' in c).map((c) => (c as { x: number }).x);
    expect(xs.every((x) => x === 0)).toBe(true);
  });

  it('zero height should not crash and produces degenerate path', () => {
    const result = rectangleNode.execute({}, { width: 100, height: 0, x: 0, y: 0 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    expect(cmds.length).toBeGreaterThan(0);
    // All y-coords should be the same (degenerate)
    const ys = cmds.filter((c) => 'y' in c).map((c) => (c as { y: number }).y);
    expect(ys.every((y) => y === 0)).toBe(true);
  });
});

describe('Rectangle generator', () => {
  it('should generate a rectangle path', () => {
    const result = rectangleNode.execute({}, { width: 100, height: 50, x: 0, y: 0 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    expect(cmds).toHaveLength(5); // M, L, L, L, Z
    expect(cmds[0]).toEqual({ type: PathCmd.Move, x: 0, y: 0 });
    expect(cmds[1]).toEqual({ type: PathCmd.Line, x: 100, y: 0 });
    expect(cmds[2]).toEqual({ type: PathCmd.Line, x: 100, y: 50 });
    expect(cmds[3]).toEqual({ type: PathCmd.Line, x: 0, y: 50 });
  });

  it('should respect x, y offset', () => {
    const result = rectangleNode.execute({}, { width: 50, height: 30, x: 10, y: 20 });
    const path = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(path.commands);
    expect(cmds[0]).toEqual({ type: PathCmd.Move, x: 10, y: 20 });
  });

  it('should have correct params definition', () => {
    expect(rectangleNode.params.map((p) => p.name)).toEqual(['width', 'height', 'x', 'y']);
  });
});

describe('Polygon generator', () => {
  it('should generate a square (sides=4)', () => {
    const result = polygonNode.execute({}, { sides: 4, radius: 50, cx: 0, cy: 0 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    expect(cmds).toHaveLength(5); // M + 3L + Z
  });

  it('should generate a hexagon (sides=6)', () => {
    const result = polygonNode.execute({}, { sides: 6, radius: 50, cx: 0, cy: 0 });
    const cmds = decodeCommands(((result.path as NodeValue).value as PathValue).commands);
    expect(cmds).toHaveLength(7); // M + 5L + Z
  });

  it('should clamp sides=1 to a triangle (minimum 3 sides)', () => {
    const result = polygonNode.execute({}, { sides: 1, radius: 50, cx: 0, cy: 0 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    expect(cmds).toHaveLength(4); // M + 2L + Z (triangle)
  });
});

describe('Star generator', () => {
  it('should generate a 5-pointed star', () => {
    const result = starNode.execute({}, { points: 5, outerRadius: 50, innerRadius: 20, cx: 0, cy: 0 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    expect(cmds).toHaveLength(11); // M + 9L + Z (alternating outer/inner)
  });
});

describe('Line generator', () => {
  it('should generate an open line path', () => {
    const result = lineNode.execute({}, { x1: 0, y1: 0, x2: 100, y2: 50 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(false);
    const cmds = decodeCommands(path.commands);
    expect(cmds).toHaveLength(2); // M + L
    expect(cmds[0]).toMatchObject({ x: 0, y: 0 });
    expect(cmds[1]).toMatchObject({ x: 100, y: 50 });
  });
});

describe('Arc generator', () => {
  it('should generate an arc approximated with cubics', () => {
    const result = arcNode.execute({}, { radius: 50, startAngle: 0, endAngle: 180 });
    const path = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(path.commands);
    expect(cmds[0].type).toBe(PathCmd.Move);
    expect(cmds.filter((c) => c.type === PathCmd.Cubic).length).toBeGreaterThanOrEqual(1);
  });

  it('full circle (360°) bounding box should approximate the circle bounds within 10%', () => {
    const radius = 50;
    const result = arcNode.execute({}, { radius, startAngle: 0, endAngle: 360, cx: 0, cy: 0 });
    const path = (result.path as NodeValue).value as PathValue;
    const bounds = computeBounds(path.commands);
    // Control-point bounding box is slightly larger than the true circle (-radius, -radius, 2r, 2r)
    // but should be within 10% of the expected diameter
    const expectedDiameter = radius * 2;
    expect(bounds.width).toBeGreaterThanOrEqual(expectedDiameter * 0.9);
    expect(bounds.width).toBeLessThanOrEqual(expectedDiameter * 1.1);
    expect(bounds.height).toBeGreaterThanOrEqual(expectedDiameter * 0.9);
    expect(bounds.height).toBeLessThanOrEqual(expectedDiameter * 1.1);
  });
});

describe('Spiral generator', () => {
  it('should generate an open spiral path', () => {
    const result = spiralNode.execute({}, { turns: 3, startRadius: 10, endRadius: 50 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(false);
    const cmds = decodeCommands(path.commands);
    expect(cmds.length).toBeGreaterThan(10);
  });
});

describe('Arrow generator', () => {
  it('should generate a closed arrow shape', () => {
    const result = arrowNode.execute({}, { length: 100, headWidth: 20, headLength: 15 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
  });

  it('should not crash when headLength exceeds length (shaftLength clamped to 0)', () => {
    const result = arrowNode.execute({}, { length: 10, headWidth: 20, headLength: 50 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    expect(cmds.length).toBeGreaterThan(0);
  });
});

describe('Polygon generator — stress test', () => {
  it('100-gon (sides=100) should produce 101 commands without error', () => {
    const result = polygonNode.execute({}, { sides: 100, radius: 50, cx: 0, cy: 0 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    // M + 99L + Z = 101
    expect(cmds).toHaveLength(101);
  });
});

describe('Star generator — edge cases', () => {
  it('inverted star (innerRadius > outerRadius) should not crash', () => {
    const result = starNode.execute({}, { points: 5, outerRadius: 20, innerRadius: 50, cx: 0, cy: 0 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    expect(cmds.length).toBeGreaterThan(0);
  });

  it('star with innerRadius=0 should not crash (degenerate spike)', () => {
    const result = starNode.execute({}, { points: 5, outerRadius: 50, innerRadius: 0, cx: 0, cy: 0 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    expect(cmds).toHaveLength(11); // same structure as normal 5-point star
  });
});

describe('Arc generator — edge cases', () => {
  it('startAngle = endAngle (zero-length arc) should produce a single M point and no cubics', () => {
    const result = arcNode.execute({}, { radius: 50, startAngle: 45, endAngle: 45, cx: 0, cy: 0 });
    const path = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(path.commands);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type).toBe(PathCmd.Move);
  });

  it('negative radius should not crash', () => {
    // Generators clamp via param min:0 but execute() receives raw value — must not throw
    expect(() => arcNode.execute({}, { radius: -10, startAngle: 0, endAngle: 90, cx: 0, cy: 0 })).not.toThrow();
  });
});

describe('Ellipse generator — edge cases', () => {
  it('rx=0 should not crash (flat horizontal line)', () => {
    expect(() => ellipseNode.execute({}, { rx: 0, ry: 30, cx: 0, cy: 0 })).not.toThrow();
    const result = ellipseNode.execute({}, { rx: 0, ry: 30, cx: 0, cy: 0 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
  });

  it('ry=0 should not crash (flat vertical line)', () => {
    expect(() => ellipseNode.execute({}, { rx: 50, ry: 0, cx: 0, cy: 0 })).not.toThrow();
    const result = ellipseNode.execute({}, { rx: 50, ry: 0, cx: 0, cy: 0 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
  });
});

describe('Arrow generator — edge cases', () => {
  it('length=0 should not crash', () => {
    expect(() => arrowNode.execute({}, { length: 0, headWidth: 20, headLength: 15 })).not.toThrow();
    const result = arrowNode.execute({}, { length: 0, headWidth: 20, headLength: 15 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
  });
});

describe('Line generator — edge cases', () => {
  it('zero-length line (start = end) should not crash', () => {
    expect(() => lineNode.execute({}, { x1: 42, y1: 42, x2: 42, y2: 42 })).not.toThrow();
    const result = lineNode.execute({}, { x1: 42, y1: 42, x2: 42, y2: 42 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(false);
    const cmds = decodeCommands(path.commands);
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toMatchObject({ x: 42, y: 42 });
    expect(cmds[1]).toMatchObject({ x: 42, y: 42 });
  });
});

describe('Ellipse generator', () => {
  it('should generate a closed ellipse path', () => {
    const result = ellipseNode.execute({}, { rx: 50, ry: 30, cx: 0, cy: 0 });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    expect(cmds[0].type).toBe(PathCmd.Move);
    // 4 cubics + close = 6 commands total (M + 4C + Z)
    expect(cmds.filter((c) => c.type === PathCmd.Cubic)).toHaveLength(4);
  });

  it('should center at cx, cy', () => {
    const result = ellipseNode.execute({}, { rx: 50, ry: 30, cx: 100, cy: 200 });
    const path = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(path.commands);
    // First point should be at (cx + rx, cy) = (150, 200)
    expect(cmds[0]).toMatchObject({ x: 150, y: 200 });
  });
});

describe('svgPath generator', () => {
  it('should parse d attribute into PathValue', () => {
    const result = svgPathNode.execute({}, { d: 'M 0 0 L 100 0 L 100 100 Z' });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.commands.length).toBeGreaterThan(0);
    expect(path.closed).toBe(true);
  });

  it('should handle empty d attribute', () => {
    const result = svgPathNode.execute({}, { d: '' });
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.commands.length).toBe(0);
  });
});
