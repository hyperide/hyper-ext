import { describe, expect, it } from 'bun:test';
import { createContext } from '../src/context';
import { runInSandbox } from '../src/sandbox';

describe('sandbox', () => {
  it('should execute simple expression', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(100, 50)');
    expect(ctx.graph.nodeCount).toBe(1);
  });

  it('should execute chained expression', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(100, 50).fill("#ff0000").stroke("#000", 2)');
    expect(ctx.graph.nodeCount).toBe(3);
  });

  it('should support variables', () => {
    const ctx = createContext();
    runInSandbox(
      ctx,
      `
      const r = rect(100, 50);
      const c = circle(30);
      union(r, c).fill("#00f");
    `,
    );
    expect(ctx.graph.nodeCount).toBe(4);
  });

  it('should support loops', () => {
    const ctx = createContext();
    runInSandbox(
      ctx,
      `
      for (let i = 0; i < 3; i++) {
        circle(10).translate(i * 30, 0);
      }
    `,
    );
    expect(ctx.graph.nodeCount).toBe(6);
  });

  it('should not expose process', () => {
    const ctx = createContext();
    expect(() => runInSandbox(ctx, 'process.exit()')).toThrow();
  });

  it('should not expose require', () => {
    const ctx = createContext();
    expect(() => runInSandbox(ctx, 'require("fs")')).toThrow();
  });

  it('should return last expression result', () => {
    const ctx = createContext();
    const result = runInSandbox(ctx, 'return rect(100, 50).fill("#f00").svg()');
    expect(result).toContain('<svg');
  });

  it('should handle syntax errors', () => {
    const ctx = createContext();
    expect(() => runInSandbox(ctx, 'rect(100, }')).toThrow(/syntax/i);
  });

  it('should allow Math usage', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'circle(Math.sqrt(100))');
    expect(ctx.graph.nodeCount).toBe(1);
  });

  it('should handle multi-line with return', () => {
    const ctx = createContext();
    const svg = runInSandbox(
      ctx,
      `
      const r = rect(100, 100);
      return r.fill("#f00").svg();
    `,
    );
    expect(svg).toContain('<svg');
  });
});
