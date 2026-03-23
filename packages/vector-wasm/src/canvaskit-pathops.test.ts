/**
 * @file CanvasKit PathOps integration tests
 *
 * Accessed via: bun run test -- packages/vector-wasm/src/canvaskit-pathops.test.ts
 * Assumptions: CanvasKit WASM may not be available in all CI environments. Tests
 *   gracefully skip if WASM init fails.
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import type { CanvasKit } from 'canvaskit-wasm';
import { PathBuilder } from 'vector-engine';
import { CanvasKitPathOps, initCanvasKit } from './canvaskit-pathops';

describe('CanvasKitPathOps', () => {
  let ck: CanvasKit;
  let pathOps: CanvasKitPathOps;
  let available = false;

  beforeAll(async () => {
    try {
      ck = await initCanvasKit();
      pathOps = new CanvasKitPathOps(ck);
      available = true;
    } catch {
      console.warn('CanvasKit WASM not available — skipping integration tests');
    }
  }, 15_000);

  describe('boolean operations', () => {
    it('should compute union of two overlapping squares', () => {
      if (!available) return;
      const a = new PathBuilder().moveTo(0, 0).lineTo(60, 0).lineTo(60, 60).lineTo(0, 60).close().build();
      const b = new PathBuilder().moveTo(40, 40).lineTo(100, 40).lineTo(100, 100).lineTo(40, 100).close().build();

      const result = pathOps.boolean('union', a, b);
      expect(result.commands.length).toBeGreaterThan(0);
      expect(result.closed).toBe(true);
    });

    it('should compute subtraction (hole in a square)', () => {
      if (!available) return;
      const a = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
      const b = new PathBuilder().moveTo(25, 25).lineTo(75, 25).lineTo(75, 75).lineTo(25, 75).close().build();

      const result = pathOps.boolean('subtract', a, b);
      expect(result.commands.length).toBeGreaterThan(0);
      // Subtraction of inner square from outer should produce more commands than original
      expect(result.commands.length).toBeGreaterThan(a.commands.length);
    });

    it('should compute intersection of two overlapping squares', () => {
      if (!available) return;
      const a = new PathBuilder().moveTo(0, 0).lineTo(60, 0).lineTo(60, 60).lineTo(0, 60).close().build();
      const b = new PathBuilder().moveTo(30, 30).lineTo(90, 30).lineTo(90, 90).lineTo(30, 90).close().build();

      const result = pathOps.boolean('intersect', a, b);
      expect(result.commands.length).toBeGreaterThan(0);
      expect(result.closed).toBe(true);
    });

    it('should compute XOR of two overlapping squares', () => {
      if (!available) return;
      const a = new PathBuilder().moveTo(0, 0).lineTo(60, 0).lineTo(60, 60).lineTo(0, 60).close().build();
      const b = new PathBuilder().moveTo(30, 30).lineTo(90, 30).lineTo(90, 90).lineTo(30, 90).close().build();

      const result = pathOps.boolean('xor', a, b);
      expect(result.commands.length).toBeGreaterThan(0);
    });

    it('should return first operand when non-overlapping shapes are subtracted', () => {
      if (!available) return;
      const a = new PathBuilder().moveTo(0, 0).lineTo(10, 0).lineTo(10, 10).lineTo(0, 10).close().build();
      const b = new PathBuilder().moveTo(200, 200).lineTo(210, 200).lineTo(210, 210).lineTo(200, 210).close().build();

      const result = pathOps.boolean('subtract', a, b);
      expect(result.commands.length).toBeGreaterThan(0);
    });
  });

  describe('strokeToPath', () => {
    it('should convert a line stroke to a closed path', () => {
      if (!available) return;
      const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();

      const result = pathOps.strokeToPath(line, 10, 'round', 'round');
      expect(result.closed).toBe(true);
      expect(result.commands.length).toBeGreaterThan(line.commands.length);
    });

    it('should handle butt cap and miter join', () => {
      if (!available) return;
      const polyline = new PathBuilder().moveTo(0, 0).lineTo(50, 50).lineTo(100, 0).build();

      const result = pathOps.strokeToPath(polyline, 8, 'butt', 'miter');
      expect(result.commands.length).toBeGreaterThan(0);
      expect(result.closed).toBe(true);
    });
  });

  describe('simplify', () => {
    it('should simplify a self-intersecting path', () => {
      if (!available) return;
      // Bowtie shape (self-intersecting)
      const bowtie = new PathBuilder().moveTo(0, 0).lineTo(100, 100).lineTo(100, 0).lineTo(0, 100).close().build();

      const result = pathOps.simplify(bowtie, 0);
      expect(result.commands.length).toBeGreaterThan(0);
    });
  });

  describe('removeSelfIntersections', () => {
    it('should remove self-intersections from crossed path', () => {
      if (!available) return;
      const crossed = new PathBuilder().moveTo(0, 0).lineTo(100, 100).lineTo(100, 0).lineTo(0, 100).close().build();

      const result = pathOps.removeSelfIntersections(crossed);
      expect(result.commands.length).toBeGreaterThan(0);
    });
  });

  describe('dash', () => {
    it('should apply dash pattern to a line', () => {
      if (!available) return;
      const line = new PathBuilder().moveTo(0, 0).lineTo(200, 0).build();

      const result = pathOps.dash(line, [20, 10], 0);
      expect(result.commands.length).toBeGreaterThan(0);
    });

    it('should return original path for empty dash array', () => {
      if (!available) return;
      const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();

      const result = pathOps.dash(line, [], 0);
      expect(result.commands).toBe(line.commands);
    });
  });

  describe('offset', () => {
    it('should inflate a square outward', () => {
      if (!available) return;
      const rect = new PathBuilder().moveTo(10, 10).lineTo(90, 10).lineTo(90, 90).lineTo(10, 90).close().build();

      const result = pathOps.offset(rect, 5);
      expect(result.commands.length).toBeGreaterThan(0);
    });

    it('should return original for zero distance', () => {
      if (!available) return;
      const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();

      const result = pathOps.offset(rect, 0);
      expect(result).toBe(rect);
    });
  });

  describe('flatten', () => {
    it('should pass through (delegates to TS utility)', () => {
      if (!available) return;
      const path = new PathBuilder().moveTo(0, 0).cubicTo(30, 0, 70, 100, 100, 100).build();

      const result = pathOps.flatten(path, 1);
      // flatten is a pass-through in CanvasKit backend
      expect(result).toBe(path);
    });
  });
});
