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

  it('should compute tight bounds for cubic curves', () => {
    const path = new PathBuilder().moveTo(0, 0).cubicTo(50, -100, 150, 200, 100, 0).build();
    const bounds = computeBounds(path.commands);
    // Tight bounds: derivative root solving yields extrema well inside the control-point hull.
    // Curve extends below y=0 but nowhere near the control point at y=-100.
    expect(bounds.y).toBeLessThan(0);
    expect(bounds.y).toBeGreaterThan(-100);
    expect(bounds.y + bounds.height).toBeGreaterThan(0);
    expect(bounds.y + bounds.height).toBeLessThan(200);
    // Endpoints must be included
    expect(bounds.x).toBeLessThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(100);
  });

  it('should compute tight bounds for quadratic curves', () => {
    const path = new PathBuilder().moveTo(0, 0).quadTo(50, -50, 100, 0).build();
    const bounds = computeBounds(path.commands);
    // Tight quad bound: extremum at t=0.5 gives y = 2*0.5*0.5*(-50) = -25, not -50.
    expect(bounds.y).toBeCloseTo(-25, 1);
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
    // Tight bounds: must cover all endpoints and actual curve extrema.
    // The cubic from (200,10) to (200,100) with cp=(250,-50),(300,150) yields
    // tight y slightly below 10, but not as far as the hull at -50.
    // The quadratic from (200,100) to (50,150) with cp=(100,200) has extremum
    // at t=0.5, well inside the hull — bounds reach y > 150 but < 200.
    expect(bounds.x).toBeLessThanOrEqual(10);
    expect(bounds.y).toBeLessThan(10);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(200);
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(150);
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

  it('large S-curve cubic — tight bounds extend well beyond endpoints but not to control points', () => {
    // Endpoints are at (0,0) and (100,0), control points at (50,-500) and (50,500).
    // Tight bounds: derivative roots at t≈0.211 and t≈0.789, yielding y ≈ ±144.
    const path = new PathBuilder().moveTo(0, 0).cubicTo(50, -500, 50, 500, 100, 0).build();
    const bounds = computeBounds(path.commands);
    // Tight bounds extend significantly but not to the hull's ±500
    expect(bounds.y).toBeLessThan(-100);
    expect(bounds.y).toBeGreaterThan(-500);
    expect(bounds.y + bounds.height).toBeGreaterThan(100);
    expect(bounds.y + bounds.height).toBeLessThan(500);
    // x range must cover endpoints
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

describe('tight cubic bounds', () => {
  it('should compute tight bounds for cubic with distant control point', () => {
    // Cubic from (0,0) to (100,0) with cp1=(50,200) cp2=(50,-200)
    // Control-point hull gives y:[-200, 200] height=400
    // Tight bounds should be much smaller
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Cubic, cx1: 50, cy1: 200, cx2: 50, cy2: -200, x: 100, y: 0 },
    ]);
    const bounds = computeBounds(cmds);
    expect(bounds.height).toBeLessThan(200); // Much less than 400 (hull)
  });

  it('should still include endpoints', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 10, y: 20 },
      { type: PathCmd.Cubic, cx1: 50, cy1: 50, cx2: 80, cy2: 50, x: 90, y: 30 },
    ]);
    const bounds = computeBounds(cmds);
    expect(bounds.x).toBeLessThanOrEqual(10);
    expect(bounds.y).toBeLessThanOrEqual(20);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(90);
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(30);
  });

  it('should handle S-curve correctly', () => {
    // S-curve: control points on opposite sides
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 50 },
      { type: PathCmd.Cubic, cx1: 33, cy1: 0, cx2: 66, cy2: 100, x: 100, y: 50 },
    ]);
    const bounds = computeBounds(cmds);
    // Should extend beyond y=0 and y=100 slightly but not hugely
    expect(bounds.y).toBeLessThan(50);
    expect(bounds.y + bounds.height).toBeGreaterThan(50);
  });
});

describe('tight quad bounds', () => {
  it('should compute tight bounds for quad with distant control point', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Quad, cx: 50, cy: 200, x: 100, y: 0 },
    ]);
    const bounds = computeBounds(cmds);
    // Tight quad bounds: extremum at t = (P0-P1)/(P0-2P1+P2) for y
    // P0=0, P1=200, P2=0 → t = (0-200)/(0-400+0) = 0.5
    // B(0.5) = 0.25*0 + 2*0.5*0.5*200 + 0.25*0 = 100
    // So height should be 100, not 200
    expect(bounds.height).toBeLessThanOrEqual(101); // Allow small tolerance
    expect(bounds.height).toBeGreaterThan(90);
  });
});
