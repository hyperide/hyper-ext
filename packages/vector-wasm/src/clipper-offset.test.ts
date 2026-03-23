/**
 * @file Path offset tests — polygon inflate/deflate
 *
 * Accessed via: bun run test -- packages/vector-wasm/src/clipper-offset.test.ts
 */

import { describe, expect, it } from 'bun:test';
import { decodeCommands, PathBuilder, PathCmd } from 'vector-engine';
import { OffsetPathOps, offsetPath } from './clipper-offset';
import { MockPathOps } from './mock-pathops';

describe('offsetPath', () => {
  describe('inflate (positive distance)', () => {
    it('should inflate a square outward', () => {
      const rect = new PathBuilder().moveTo(10, 10).lineTo(90, 10).lineTo(90, 90).lineTo(10, 90).close().build();

      const result = offsetPath(rect, 5);

      expect(result.commands.length).toBeGreaterThan(0);
      expect(result.closed).toBe(true);

      // Verify the offset path has vertex commands
      const decoded = decodeCommands(result.commands);
      const moves = decoded.filter((c) => c.type === PathCmd.Move);
      const lines = decoded.filter((c) => c.type === PathCmd.Line);
      expect(moves.length).toBe(1);
      // 4-vertex polygon: 1 Move + 3 Lines + Close
      expect(lines.length).toBeGreaterThanOrEqual(3);
    });

    it('should produce a larger bounding area when inflating', () => {
      const rect = new PathBuilder().moveTo(20, 20).lineTo(80, 20).lineTo(80, 80).lineTo(20, 80).close().build();

      const result = offsetPath(rect, 10, 'miter');
      const decoded = decodeCommands(result.commands);

      // Find X/Y extents of the offset path
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const cmd of decoded) {
        if (cmd.type === PathCmd.Move || cmd.type === PathCmd.Line) {
          minX = Math.min(minX, cmd.x);
          maxX = Math.max(maxX, cmd.x);
          minY = Math.min(minY, cmd.y);
          maxY = Math.max(maxY, cmd.y);
        }
      }

      // Original rect: 20..80. After +10 offset, should extend beyond
      expect(minX).toBeLessThan(20);
      expect(maxX).toBeGreaterThan(80);
      expect(minY).toBeLessThan(20);
      expect(maxY).toBeGreaterThan(80);
    });
  });

  describe('deflate (negative distance)', () => {
    it('should deflate a square inward', () => {
      const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();

      const result = offsetPath(rect, -10);

      expect(result.commands.length).toBeGreaterThan(0);
      expect(result.closed).toBe(true);

      // Verify inward offset
      const decoded = decodeCommands(result.commands);
      let minX = Infinity;
      let maxX = -Infinity;
      for (const cmd of decoded) {
        if (cmd.type === PathCmd.Move || cmd.type === PathCmd.Line) {
          minX = Math.min(minX, cmd.x);
          maxX = Math.max(maxX, cmd.x);
        }
      }

      // Should be smaller than original (0..100)
      expect(minX).toBeGreaterThan(0);
      expect(maxX).toBeLessThan(100);
    });
  });

  describe('zero distance', () => {
    it('should return original path unchanged', () => {
      const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();

      const result = offsetPath(rect, 0);
      expect(result).toBe(rect);
    });
  });

  describe('join types', () => {
    it('should handle round join', () => {
      const triangle = new PathBuilder().moveTo(50, 0).lineTo(100, 100).lineTo(0, 100).close().build();

      const result = offsetPath(triangle, 5, 'round');
      expect(result.commands.length).toBeGreaterThan(0);
      expect(result.closed).toBe(true);

      // Round joins produce more vertices than miter
      const miterResult = offsetPath(triangle, 5, 'miter');
      const roundDecoded = decodeCommands(result.commands);
      const miterDecoded = decodeCommands(miterResult.commands);
      expect(roundDecoded.length).toBeGreaterThanOrEqual(miterDecoded.length);
    });

    it('should handle square/bevel join', () => {
      const triangle = new PathBuilder().moveTo(50, 0).lineTo(100, 100).lineTo(0, 100).close().build();

      const result = offsetPath(triangle, 5, 'square');
      expect(result.commands.length).toBeGreaterThan(0);
      expect(result.closed).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle a triangle', () => {
      const triangle = new PathBuilder().moveTo(50, 0).lineTo(100, 86.6).lineTo(0, 86.6).close().build();

      const result = offsetPath(triangle, 3);
      expect(result.commands.length).toBeGreaterThan(0);
    });

    it('should handle a path with too few points', () => {
      const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();

      // 2 points can't form a polygon — should return original
      const result = offsetPath(line, 5);
      expect(result).toBe(line);
    });
  });
});

describe('OffsetPathOps', () => {
  it('should delegate boolean to inner backend', () => {
    const inner = new MockPathOps();
    const ops = new OffsetPathOps(inner);

    const a = new PathBuilder().moveTo(0, 0).lineTo(10, 0).lineTo(10, 10).close().build();
    const b = new PathBuilder().moveTo(5, 5).lineTo(15, 5).lineTo(15, 15).close().build();

    const result = ops.boolean('union', a, b);
    // MockPathOps concatenates commands
    expect(result.commands.length).toBe(a.commands.length + b.commands.length);
  });

  it('should use polygon offset for offset()', () => {
    const inner = new MockPathOps();
    const ops = new OffsetPathOps(inner);

    const rect = new PathBuilder().moveTo(10, 10).lineTo(90, 10).lineTo(90, 90).lineTo(10, 90).close().build();

    const result = ops.offset(rect, 5);
    // OffsetPathOps should NOT delegate to inner (which returns path unchanged)
    // Instead it should produce actual offset geometry
    expect(result.commands.length).toBeGreaterThan(0);
    expect(result.closed).toBe(true);
  });
});
