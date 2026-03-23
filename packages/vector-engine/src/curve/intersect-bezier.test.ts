/**
 * @file Tests for curve intersection algorithms
 *
 * Accessed via: Internal module — test suite for intersect-bezier.ts
 */

import { describe, expect, it } from 'bun:test';
import { intersectCubicCubic, intersectLineCubic, intersectLineLine } from './intersect-bezier';

describe('intersectLineLine', () => {
  it('should find intersection of perpendicular lines', () => {
    const hits = intersectLineLine({ x: 0, y: 50 }, { x: 100, y: 50 }, { x: 50, y: 0 }, { x: 50, y: 100 });
    expect(hits.length).toBe(1);
    expect(hits[0].point.x).toBeCloseTo(50, 5);
    expect(hits[0].point.y).toBeCloseTo(50, 5);
    expect(hits[0].t1).toBeCloseTo(0.5, 5);
    expect(hits[0].t2).toBeCloseTo(0.5, 5);
  });

  it('should return empty for parallel lines', () => {
    const hits = intersectLineLine({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 10 }, { x: 100, y: 10 });
    expect(hits.length).toBe(0);
  });

  it('should return empty for non-intersecting segments', () => {
    const hits = intersectLineLine({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 60, y: 10 }, { x: 60, y: 100 });
    expect(hits.length).toBe(0);
  });

  it('should find intersection of diagonal lines', () => {
    const hits = intersectLineLine({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 });
    expect(hits.length).toBe(1);
    expect(hits[0].point.x).toBeCloseTo(50, 5);
    expect(hits[0].point.y).toBeCloseTo(50, 5);
  });

  it('should handle intersection at endpoint', () => {
    const hits = intersectLineLine({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 });
    // t1=1.0, t2=0.0 — at the endpoint boundary
    expect(hits.length).toBe(1);
    expect(hits[0].point.x).toBeCloseTo(100, 5);
    expect(hits[0].point.y).toBeCloseTo(0, 5);
  });
});

describe('intersectLineCubic', () => {
  it('should find intersections of horizontal line with arch curve', () => {
    const hits = intersectLineCubic(
      { x: -10, y: 37 },
      { x: 110, y: 37 },
      { x: 0, y: 0 },
      { x: 33, y: 100 },
      { x: 66, y: 100 },
      { x: 100, y: 0 },
    );
    expect(hits.length).toBe(2);
  });

  it('should return empty when line misses curve', () => {
    const hits = intersectLineCubic(
      { x: 0, y: 200 },
      { x: 100, y: 200 },
      { x: 0, y: 0 },
      { x: 33, y: 100 },
      { x: 66, y: 100 },
      { x: 100, y: 0 },
    );
    expect(hits.length).toBe(0);
  });

  it('should find single tangent intersection at curve peak', () => {
    // Line at y=75 — the peak of the arch (0,0)-(33,100)-(66,100)-(100,0) is at y=75
    // The max height of this cubic is at t=0.5: y(0.5) = 3*0.25*100 + 3*0.25*100 = 75
    const hits = intersectLineCubic(
      { x: -10, y: 75 },
      { x: 110, y: 75 },
      { x: 0, y: 0 },
      { x: 33, y: 100 },
      { x: 66, y: 100 },
      { x: 100, y: 0 },
    );
    // At peak, line is tangent — expect 1 intersection (or 2 very close together)
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should return correct t parameters', () => {
    // Horizontal line at y=0 through cubic arch — intersects at t=0 and t=1
    const hits = intersectLineCubic(
      { x: -10, y: 0 },
      { x: 110, y: 0 },
      { x: 0, y: 0 },
      { x: 33, y: 100 },
      { x: 66, y: 100 },
      { x: 100, y: 0 },
    );
    expect(hits.length).toBe(2);
    // One hit near t2=0, another near t2=1
    const ts = hits.map((h) => h.t2).sort((a, b) => a - b);
    expect(ts[0]).toBeCloseTo(0, 2);
    expect(ts[1]).toBeCloseTo(1, 2);
  });
});

describe('intersectCubicCubic', () => {
  it('should find intersections of two crossing curves', () => {
    const hits = intersectCubicCubic(
      { x: 0, y: 50 },
      { x: 33, y: 150 },
      { x: 66, y: 150 },
      { x: 100, y: 50 },
      { x: 0, y: 100 },
      { x: 33, y: 0 },
      { x: 66, y: 0 },
      { x: 100, y: 100 },
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should return empty for non-intersecting curves', () => {
    const hits = intersectCubicCubic(
      { x: 0, y: 0 },
      { x: 33, y: 50 },
      { x: 66, y: 50 },
      { x: 100, y: 0 },
      { x: 0, y: 200 },
      { x: 33, y: 250 },
      { x: 66, y: 250 },
      { x: 100, y: 200 },
    );
    expect(hits.length).toBe(0);
  });

  it('should return hits with valid t parameters', () => {
    const hits = intersectCubicCubic(
      { x: 0, y: 50 },
      { x: 33, y: 150 },
      { x: 66, y: 150 },
      { x: 100, y: 50 },
      { x: 0, y: 100 },
      { x: 33, y: 0 },
      { x: 66, y: 0 },
      { x: 100, y: 100 },
    );
    for (const hit of hits) {
      expect(hit.t1).toBeGreaterThanOrEqual(0);
      expect(hit.t1).toBeLessThanOrEqual(1);
      expect(hit.t2).toBeGreaterThanOrEqual(0);
      expect(hit.t2).toBeLessThanOrEqual(1);
    }
  });
});
