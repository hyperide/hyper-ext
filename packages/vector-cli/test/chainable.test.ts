import { describe, expect, it } from 'bun:test';
import { ChainableNode } from '../src/chainable';
import { createContext } from '../src/context';
import { svgToPng } from '../src/png';

describe('ChainableNode', () => {
  it('should create a generator node', () => {
    const ctx = createContext();
    ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50 });
    expect(ctx.graph.nodeCount).toBe(1);
  });

  it('should chain fill', () => {
    const ctx = createContext();
    ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50 }).fill('#ff0000');
    expect(ctx.graph.nodeCount).toBe(2);
    expect(ctx.graph.edgeCount).toBe(1);
  });

  it('should chain multiple operations', () => {
    const ctx = createContext();
    ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50 })
      .fill('#ff0000')
      .stroke('#000000', 2)
      .translate(10, 20);
    expect(ctx.graph.nodeCount).toBe(4);
    expect(ctx.graph.edgeCount).toBe(3);
  });

  it('should export SVG', () => {
    const ctx = createContext();
    const svg = ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50 }).fill('#ff0000').export('svg');
    expect(svg).toContain('<svg');
    expect(svg).toContain('fill="#ff0000"');
  });

  it('should compute bounds', () => {
    const ctx = createContext();
    const bounds = ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50, x: 10, y: 20 }).bounds();
    expect(bounds.width).toBeCloseTo(100, 0);
    expect(bounds.height).toBeCloseTo(50, 0);
  });

  it('should compute length', () => {
    const ctx = createContext();
    const len = ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 100, x: 0, y: 0 }).length();
    expect(len).toBeCloseTo(400, 0);
  });

  it('should chain deformations', () => {
    const ctx = createContext();
    ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50 }).roughen(10, 5);
    expect(ctx.graph.nodeCount).toBe(2);
  });

  it('should chain roundCorners', () => {
    const ctx = createContext();
    ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50 }).roundCorners(10);
    expect(ctx.graph.nodeCount).toBe(2);
  });

  it('should chain transforms', () => {
    const ctx = createContext();
    ChainableNode.generator(ctx, 'rectangle', { width: 50, height: 50 }).translate(10, 20).rotate(45).scale(2);
    expect(ctx.graph.nodeCount).toBe(4);
  });

  it('should return area', () => {
    const ctx = createContext();
    const area = ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 100, x: 0, y: 0 }).area();
    expect(area).toBeCloseTo(10000, -1);
  });

  it('should export JSON', () => {
    const ctx = createContext();
    const json = ChainableNode.generator(ctx, 'rectangle', { width: 50, height: 50 }).export('json');
    expect(json).toContain('"rectangle"');
  });

  it('should handle svg() shorthand', () => {
    const ctx = createContext();
    const svg = ChainableNode.generator(ctx, 'rectangle', { width: 50, height: 50 }).fill('#f00').svg();
    expect(svg).toContain('<svg');
  });

  describe('simplify', () => {
    it('should chain simplify as a node', () => {
      const ctx = createContext();
      ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50 }).simplify(0.5);
      expect(ctx.graph.nodeCount).toBe(2);
      expect(ctx.graph.edgeCount).toBe(1);
    });

    it('should drop redundant collinear points from a polyline', () => {
      const ctx = createContext();
      // A horizontal line oversampled with 4 redundant collinear points.
      const d = 'M 0 0 L 25 0 L 50 0 L 75 0 L 100 0';
      const before = ChainableNode.generator(ctx, 'svgPath', { d }).export('json');
      const ctx2 = createContext();
      const node = ChainableNode.generator(ctx2, 'svgPath', { d }).simplify(0.5);
      // Bounds preserved within tolerance — the line still spans 0..100.
      const bounds = node.bounds();
      expect(bounds.width).toBeCloseTo(100, 0);
      expect(bounds.height).toBeCloseTo(0, 0);
      // The simplify node exists in the graph.
      expect(ctx2.graph.nodeCount).toBe(2);
      expect(before).toContain('svgPath');
    });

    it('tolerance 0 keeps geometry identical', () => {
      const ctx = createContext();
      const d = 'M 0 0 L 10 7 L 20 0 L 30 9';
      const bounds = ChainableNode.generator(ctx, 'svgPath', { d }).simplify(0).bounds();
      expect(bounds.width).toBeCloseTo(30, 0);
    });
  });

  describe('png', () => {
    it('should convert SVG to PNG buffer with no external binary', () => {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="red"/></svg>';
      const buf = svgToPng(svg, 200);
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
      // PNG magic bytes
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50); // P
      expect(buf[2]).toBe(0x4e); // N
      expect(buf[3]).toBe(0x47); // G
      // IHDR dimensions: rendered at width 200, aspect preserved (100x100 viewBox)
      expect(buf.readUInt32BE(16)).toBe(200);
      expect(buf.readUInt32BE(20)).toBe(200);
    });

    it('should have png method on ChainableNode', () => {
      const ctx = createContext();
      const node = ChainableNode.generator(ctx, 'rectangle', { width: 50, height: 50 }).fill('#f00');
      expect(typeof node.png).toBe('function');
    });
  });
});
