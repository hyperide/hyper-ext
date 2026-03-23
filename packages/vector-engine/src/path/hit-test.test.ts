import { describe, expect, it } from 'bun:test';
import { PathBuilder } from './builder';
import { pointInPath, pointOnStroke } from './hit-test';

describe('pointInPath', () => {
  it('should return true for point inside closed rectangle', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    expect(pointInPath({ x: 50, y: 50 }, rect)).toBe(true);
  });

  it('should return false for point outside rectangle', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    expect(pointInPath({ x: 150, y: 50 }, rect)).toBe(false);
  });

  it('should return false for open path', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    expect(pointInPath({ x: 50, y: 0 }, line)).toBe(false);
  });

  it('should handle concave polygon', () => {
    const L = new PathBuilder()
      .moveTo(0, 0)
      .lineTo(50, 0)
      .lineTo(50, 50)
      .lineTo(100, 50)
      .lineTo(100, 100)
      .lineTo(0, 100)
      .close()
      .build();
    expect(pointInPath({ x: 25, y: 25 }, L)).toBe(true);
    expect(pointInPath({ x: 75, y: 25 }, L)).toBe(false);
    expect(pointInPath({ x: 75, y: 75 }, L)).toBe(true);
  });

  it('should handle path with curves', () => {
    const k = 0.5522847498;
    const r = 50;
    const circle = new PathBuilder()
      .moveTo(r, 0)
      .cubicTo(r, r * k, r * k, r, 0, r)
      .cubicTo(-r * k, r, -r, r * k, -r, 0)
      .cubicTo(-r, -r * k, -r * k, -r, 0, -r)
      .cubicTo(r * k, -r, r, -r * k, r, 0)
      .close()
      .build();
    expect(pointInPath({ x: 0, y: 0 }, circle)).toBe(true);
    expect(pointInPath({ x: 60, y: 0 }, circle)).toBe(false);
  });
});

describe('pointOnStroke', () => {
  it('should return true for point near stroke', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    expect(pointOnStroke({ x: 50, y: 2 }, line, 5)).toBe(true);
  });

  it('should return false for point far from stroke', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    expect(pointOnStroke({ x: 50, y: 20 }, line, 5)).toBe(false);
  });

  it('should detect point near curve', () => {
    const curve = new PathBuilder().moveTo(0, 0).cubicTo(33, 100, 66, 100, 100, 0).build();
    // Point near the apex of the curve (~y=75 at x=50)
    expect(pointOnStroke({ x: 50, y: 73 }, curve, 5)).toBe(true);
  });

  it('should work with closed path stroke', () => {
    const rect = new PathBuilder().moveTo(10, 10).lineTo(90, 10).lineTo(90, 90).lineTo(10, 90).close().build();
    expect(pointOnStroke({ x: 50, y: 11 }, rect, 3)).toBe(true); // near top edge
    expect(pointOnStroke({ x: 50, y: 50 }, rect, 3)).toBe(false); // center, away from edges
  });
});
