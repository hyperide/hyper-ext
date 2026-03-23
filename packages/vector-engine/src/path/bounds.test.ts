import { describe, expect, it } from 'bun:test';
import { computeBounds } from './bounds';
import { PathBuilder } from './builder';
import { encodeCommands, PathCmd } from './commands';

describe('computeBounds', () => {
  it('should compute bounds for a rectangle', () => {
    const path = new PathBuilder().moveTo(10, 20).lineTo(110, 20).lineTo(110, 70).lineTo(10, 70).close().build();

    const bounds = computeBounds(path.commands);
    expect(bounds).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('should compute bounds for a line', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(50, 100).build();

    const bounds = computeBounds(path.commands);
    expect(bounds).toEqual({ x: 0, y: 0, width: 50, height: 100 });
  });

  it('should return zero bounds for empty path', () => {
    const bounds = computeBounds(new Float64Array(0));
    expect(bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('should include control points in bounds for cubic curves', () => {
    const path = new PathBuilder().moveTo(0, 0).cubicTo(50, -100, 150, 200, 100, 0).build();
    const bounds = computeBounds(path.commands);
    // Control points extend to y=-100 and y=200
    expect(bounds.y).toBeLessThanOrEqual(-100);
    expect(bounds.height).toBeGreaterThanOrEqual(300);
  });

  it('should include control point in bounds for quadratic curves', () => {
    const path = new PathBuilder().moveTo(0, 0).quadTo(50, -50, 100, 0).build();
    const bounds = computeBounds(path.commands);
    expect(bounds.y).toBeLessThanOrEqual(-50);
  });

  it('should handle arc commands', () => {
    const path = new PathBuilder().moveTo(0, 0).arcTo(50, 50, 0, 1, 1, 100, 0).build();
    const bounds = computeBounds(path.commands);
    expect(bounds.width).toBeGreaterThanOrEqual(100);
  });

  it('kitchen-sink path with M, L, C, Q, A, Z — bounds should encompass all commands', () => {
    const path = new PathBuilder()
      .moveTo(10, 10)
      .lineTo(200, 10)
      .cubicTo(250, -50, 300, 150, 200, 100)
      .quadTo(100, 200, 50, 150)
      .arcTo(30, 30, 0, 0, 1, 10, 100)
      .close()
      .build();
    const bounds = computeBounds(path.commands);
    // Must reach at least as far as the control points of the cubic (x=300, y=-50)
    // and the quadratic (y=200)
    expect(bounds.x).toBeLessThanOrEqual(10);
    expect(bounds.y).toBeLessThanOrEqual(-50);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(300);
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(200);
  });

  it('degenerate single point (M only) — bounds should be zero-sized at that point', () => {
    const path = new PathBuilder().moveTo(5, 5).build();
    const bounds = computeBounds(path.commands);
    expect(bounds).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });

  it('path entirely in negative space — bounds should have negative x and y', () => {
    const path = new PathBuilder()
      .moveTo(-100, -200)
      .lineTo(-50, -200)
      .lineTo(-50, -100)
      .lineTo(-100, -100)
      .close()
      .build();
    const bounds = computeBounds(path.commands);
    expect(bounds.x).toBe(-100);
    expect(bounds.y).toBe(-200);
    expect(bounds.width).toBe(50);
    expect(bounds.height).toBe(100);
  });

  it('large cubic with control points far from endpoints — control points must be included', () => {
    // Endpoints are at (0,0) and (100,0), but control points reach (50,-500) and (50,500)
    const path = new PathBuilder().moveTo(0, 0).cubicTo(50, -500, 50, 500, 100, 0).build();
    const bounds = computeBounds(path.commands);
    expect(bounds.y).toBeLessThanOrEqual(-500);
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(500);
    // x range should at least cover endpoints
    expect(bounds.x).toBeLessThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(100);
  });

  it('should compute tight bounds for semicircular arc', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Arc, rx: 50, ry: 50, rotation: 0, largeArc: 0, sweep: 1, x: 100, y: 0 },
    ]);
    const bounds = computeBounds(cmds);
    expect(bounds.x).toBeCloseTo(0, 1);
    expect(bounds.y).toBeCloseTo(-50, 1);
    expect(bounds.width).toBeCloseTo(100, 1);
    expect(bounds.height).toBeCloseTo(50, 1);
  });

  it('arc after Close uses subpath start as start point', () => {
    // M 0 0 L 10 0 Z A 50 50 0 0 1 100 0
    // After Z, current point resets to subpath start (0,0), not (10,0).
    // Arc from (0,0) to (100,0) with sweep=1 is a semicircle reaching y=-50.
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 10, y: 0 },
      { type: PathCmd.Close },
      { type: PathCmd.Arc, rx: 50, ry: 50, rotation: 0, largeArc: 0, sweep: 1, x: 100, y: 0 },
    ]);
    const bounds = computeBounds(cmds);
    expect(bounds.y).toBeCloseTo(-50, 1);
    expect(bounds.width).toBeCloseTo(100, 1);
  });

  it('should handle large-arc flag correctly', () => {
    // start=(0,0), end=(60,0), r=50: two valid centers at (30,40) and (30,-40).
    // largeArc=1, sweep=1: selects center (30,-40), sweeping ~286° CW.
    // Arc passes through the topmost point of that circle at (30,-90).
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Arc, rx: 50, ry: 50, rotation: 0, largeArc: 1, sweep: 1, x: 60, y: 0 },
    ]);
    const bounds = computeBounds(cmds);
    // The arc reaches the topmost point (30, -90) on the circle
    expect(bounds.y).toBeCloseTo(-90, 0);
    expect(bounds.width).toBeGreaterThanOrEqual(60);
  });
});
