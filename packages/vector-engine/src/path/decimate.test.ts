/**
 * @file Tests for polyline point-decimation — RDP + Visvalingam-Whyatt
 *
 * Accessed via: Internal module, not exposed
 */

import { describe, expect, it } from 'bun:test';
import { decimateRDP, decimateVW } from './decimate';
import type { Point } from '../types';

describe('decimateRDP — Ramer-Douglas-Peucker', () => {
  it('keeps endpoints and drops a collinear midpoint', () => {
    // A straight line with a redundant point in the middle.
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ];
    const out = decimateRDP(pts, 0.1);
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it('preserves a corner whose deviation exceeds epsilon', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
    ];
    // Peak deviates by 5 from the baseline; epsilon 1 must keep it.
    const out = decimateRDP(pts, 1);
    expect(out).toEqual(pts);
  });

  it('drops a near-collinear point below epsilon but keeps it above', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0.5 },
      { x: 10, y: 0 },
    ];
    expect(decimateRDP(pts, 1).length).toBe(2); // 0.5 < 1 → drop
    expect(decimateRDP(pts, 0.1).length).toBe(3); // 0.5 > 0.1 → keep
  });

  it('reduces point count monotonically as epsilon grows', () => {
    // Dense noisy-ish polyline along a gentle arc.
    const pts: Point[] = [];
    for (let i = 0; i <= 50; i++) {
      const x = i;
      const y = Math.sin(i / 8) * 3;
      pts.push({ x, y });
    }
    const small = decimateRDP(pts, 0.05).length;
    const mid = decimateRDP(pts, 0.5).length;
    const big = decimateRDP(pts, 3).length;
    expect(small).toBeLessThanOrEqual(pts.length);
    expect(mid).toBeLessThanOrEqual(small);
    expect(big).toBeLessThanOrEqual(mid);
    // Endpoints always survive.
    expect(decimateRDP(pts, 3)[0]).toEqual(pts[0]);
    expect(decimateRDP(pts, 3).at(-1)).toEqual(pts.at(-1));
  });

  it('every kept point lies within epsilon of the input hull is irrelevant; check max deviation bound', () => {
    const pts: Point[] = [];
    for (let i = 0; i <= 30; i++) pts.push({ x: i, y: Math.cos(i / 5) * 4 });
    const eps = 0.5;
    const out = decimateRDP(pts, eps);
    // Every original point must be within eps of the simplified polyline.
    for (const p of pts) {
      let best = Infinity;
      for (let i = 0; i < out.length - 1; i++) {
        best = Math.min(best, pointSegDist(p, out[i], out[i + 1]));
      }
      expect(best).toBeLessThanOrEqual(eps + 1e-9);
    }
  });

  it('returns input unchanged for fewer than 3 points', () => {
    expect(decimateRDP([{ x: 1, y: 2 }], 1)).toEqual([{ x: 1, y: 2 }]);
    const two: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(decimateRDP(two, 1)).toEqual(two);
  });

  it('tolerance 0 is identity (no points dropped)', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(decimateRDP(pts, 0)).toEqual(pts);
  });
});

describe('decimateVW — Visvalingam-Whyatt', () => {
  it('removes the lowest-area vertex first', () => {
    // Middle point forms a tiny-area triangle; the other a large one.
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0.1 }, // tiny area
      { x: 10, y: 0 },
      { x: 15, y: 10 }, // large area
      { x: 20, y: 0 },
    ];
    // areaThreshold between the tiny and the large triangle.
    const out = decimateVW(pts, 5);
    // tiny-area vertex (5,0.1) dropped, large-area vertex (15,10) kept.
    expect(out).toContainEqual({ x: 15, y: 10 });
    expect(out).not.toContainEqual({ x: 5, y: 0.1 });
    // endpoints survive
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out.at(-1)).toEqual({ x: 20, y: 0 });
  });

  it('reduces point count monotonically as area threshold grows', () => {
    const pts: Point[] = [];
    for (let i = 0; i <= 40; i++) pts.push({ x: i, y: Math.sin(i / 6) * 5 });
    const a = decimateVW(pts, 0.1).length;
    const b = decimateVW(pts, 2).length;
    const c = decimateVW(pts, 20).length;
    expect(b).toBeLessThanOrEqual(a);
    expect(c).toBeLessThanOrEqual(b);
    expect(c).toBeGreaterThanOrEqual(2); // endpoints always kept
  });

  it('threshold 0 is identity', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 1 },
      { x: 10, y: 0 },
    ];
    expect(decimateVW(pts, 0)).toEqual(pts);
  });

  it('returns input unchanged for fewer than 3 points', () => {
    const two: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(decimateVW(two, 5)).toEqual(two);
  });
});

/** Perpendicular distance from p to segment a→b (test helper, independent of impl). */
function pointSegDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}
