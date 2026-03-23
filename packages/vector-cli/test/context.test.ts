import { describe, expect, it } from 'bun:test';
import { createContext, executeAndRender } from '../src/context';

describe('EvalContext', () => {
  it('should create context with default canvas', () => {
    const ctx = createContext();
    expect(ctx.graph.nodeCount).toBe(0);
    expect(ctx.canvasWidth).toBe(100);
  });

  it('should create context with custom canvas', () => {
    const ctx = createContext(200, 300);
    expect(ctx.canvasWidth).toBe(200);
    expect(ctx.canvasHeight).toBe(300);
  });

  it('should execute empty graph to SVG', () => {
    const ctx = createContext();
    const svg = executeAndRender(ctx);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 100 100"');
  });
});
