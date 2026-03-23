import { describe, expect, it } from 'bun:test';
import type { Point } from '../types';
import { fitCurve } from './fit';

describe('fitCurve', () => {
  it('should fit straight line points to a path', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    const path = fitCurve(points, 1.0);
    expect(path.commands.length).toBeGreaterThan(0);
    expect(path.closed).toBe(false);
  });

  it('should produce a closed path when first ≈ last', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ];
    const path = fitCurve(points, 1.0);
    expect(path.closed).toBe(true);
  });

  it('should approximate a circle arc', () => {
    const points: Point[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * (Math.PI / 2);
      points.push({ x: 50 * Math.cos(t), y: 50 * Math.sin(t) });
    }
    const path = fitCurve(points, 2.0);
    // Should produce cubic beziers, not just lines
    expect(path.commands.length).toBeGreaterThan(6);
  });

  it('should handle minimum 2 points', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ];
    const path = fitCurve(points, 1.0);
    expect(path.commands.length).toBeGreaterThan(0);
  });

  it('should return empty path for single point', () => {
    const points: Point[] = [{ x: 50, y: 50 }];
    const path = fitCurve(points, 1.0);
    expect(path.commands.length).toBe(0);
  });

  it('should return empty path for empty array', () => {
    const path = fitCurve([], 1.0);
    expect(path.commands.length).toBe(0);
  });

  it('should close path when closed=true even without duplicated endpoint', () => {
    // Simulates a flattened closed path where the start point is NOT repeated
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const path = fitCurve(points, 1.0, true);
    expect(path.closed).toBe(true);
  });

  it('should not close path when closed=false even when endpoints coincide', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 0 },
    ];
    const path = fitCurve(points, 1.0, false);
    expect(path.closed).toBe(false);
  });
});
