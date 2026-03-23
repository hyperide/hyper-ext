import { describe, expect, it } from 'bun:test';
import { runBatch } from '../src/batch';
import { createContext } from '../src/context';
import { runInSandbox } from '../src/sandbox';

describe('vecli integration', () => {
  it('should create icon from script', () => {
    const output = runBatch({
      expression: `
        canvas(24, 24);
        const bg = rect(24, 24).fill("#4A90D9").roundCorners(4);
        const a = path("M 7 12 L 12 7 L 17 12").stroke("#fff", 2);
        return group(bg, a).svg();
      `,
      canvasWidth: 24,
      canvasHeight: 24,
    });
    expect(output).toContain('<svg');
  });

  it('should chain complex operations', () => {
    const output = runBatch({
      expression: `
        const r = rect(100, 100);
        const c = circle(30).translate(50, 50);
        return subtract(r, c).fill("#ff0000").roundCorners(5).svg();
      `,
    });
    expect(output).toContain('<svg');
  });

  it('should use variables and loops', () => {
    const ctx = createContext(200, 200);
    runInSandbox(
      ctx,
      `
      for (let i = 0; i < 5; i++) {
        circle(8).translate(i * 25 + 20, 100).fill("#333");
      }
    `,
    );
    expect(ctx.graph.nodeCount).toBe(15);
  });

  it('should support mute/unmute workflow', () => {
    const ctx = createContext();
    runInSandbox(
      ctx,
      `
      const r = rect(100, 50).fill("#ff0000");
      mute(r);
    `,
    );
    // r is the fill node (last in chain); verify at least one node is muted
    const order = ctx.graph.topologicalOrder();
    const anyMuted = order.some((id) => ctx.graph.isMuted(id));
    expect(anyMuted).toBe(true);
  });

  it('should support set param', () => {
    const ctx = createContext();
    runInSandbox(
      ctx,
      `
      const r = rect(100, 50);
      set(r, "width", 200);
    `,
    );
    const node = ctx.graph.getNode(ctx.graph.topologicalOrder()[0]);
    expect(node?.params.width).toBe(200);
  });

  it('should auto-export SVG when no return', () => {
    const output = runBatch({
      expression: 'rect(100, 50).fill("#ff0000")',
    });
    expect(output).toContain('<svg');
    expect(output).toContain('fill="#ff0000"');
  });

  it('should handle canvas() + complex scene', () => {
    const output = runBatch({
      expression: `
        canvas(200, 200);
        const bg = rect(200, 200).fill("#f5f5f5");
        const c1 = circle(30).translate(100, 100).fill("#ff0000");
        const c2 = circle(20).translate(100, 100).fill("#ffffff");
        return group(bg, c1, c2).svg();
      `,
      canvasWidth: 200,
      canvasHeight: 200,
    });
    expect(output).toContain('<svg');
    expect(output).toContain('200');
  });
});
