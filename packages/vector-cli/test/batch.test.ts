import { describe, expect, it } from 'bun:test';
import { runBatch } from '../src/batch';

describe('batch mode', () => {
  it('should execute inline expression and return SVG', () => {
    const output = runBatch({ expression: 'return rect(100,50).fill("#f00").svg()' });
    expect(output).toContain('<svg');
  });

  it('should auto-export when no explicit export', () => {
    const output = runBatch({ expression: 'rect(100, 50).fill("#ff0000")' });
    expect(output).toContain('<svg');
    expect(output).toContain('fill="#ff0000"');
  });

  it('should execute multi-line script', () => {
    const output = runBatch({
      script: `
      const r = rect(100, 50);
      return r.fill("#ff0000").svg();
    `,
    });
    expect(output).toContain('<svg');
  });

  it('should respect canvas size', () => {
    const output = runBatch({
      expression: 'rect(50,50)',
      canvasWidth: 200,
      canvasHeight: 150,
    });
    expect(output).toContain('viewBox="0 0 200 150"');
  });

  it('should handle errors', () => {
    expect(() => runBatch({ expression: 'nonexistent()' })).toThrow();
  });

  it('should return empty for empty input', () => {
    expect(runBatch({})).toBe('');
  });

  it('should support variables and loops', () => {
    const output = runBatch({
      expression: `
      for (let i = 0; i < 3; i++) {
        circle(10).translate(i * 30, 0).fill("#333");
      }
    `,
    });
    expect(output).toContain('<svg');
  });
});
