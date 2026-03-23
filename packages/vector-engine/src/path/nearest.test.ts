import { describe, expect, it } from 'bun:test';
import { PathBuilder } from './builder';
import { nearestPointOnPath } from './nearest';

describe('nearestPointOnPath', () => {
  it('should find nearest point on horizontal line', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = nearestPointOnPath({ x: 50, y: 30 }, line);
    expect(result.point.x).toBeCloseTo(50, 1);
    expect(result.point.y).toBeCloseTo(0, 1);
    expect(result.distance).toBeCloseTo(30, 1);
  });

  it('should clamp to start endpoint', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = nearestPointOnPath({ x: -50, y: 0 }, line);
    expect(result.point.x).toBeCloseTo(0, 1);
    expect(result.distance).toBeCloseTo(50, 1);
    expect(result.offset).toBeCloseTo(0, 2);
  });

  it('should clamp to end endpoint', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = nearestPointOnPath({ x: 150, y: 0 }, line);
    expect(result.point.x).toBeCloseTo(100, 1);
    expect(result.distance).toBeCloseTo(50, 1);
    expect(result.offset).toBeCloseTo(1, 2);
  });

  it('should return midpoint offset for perpendicular projection', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = nearestPointOnPath({ x: 50, y: 10 }, line);
    expect(result.offset).toBeCloseTo(0.5, 2);
  });

  it('should handle empty path', () => {
    const empty = new PathBuilder().build();
    const result = nearestPointOnPath({ x: 50, y: 50 }, empty);
    expect(result.distance).toBe(Infinity);
  });

  it('should work with multi-segment path', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).build();
    const result = nearestPointOnPath({ x: 110, y: 50 }, path);
    expect(result.point.x).toBeCloseTo(100, 1);
    expect(result.point.y).toBeCloseTo(50, 1);
  });
});
