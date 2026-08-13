import { describe, expect, it } from 'bun:test';
import { evaluateExpression } from '../src/tui/evaluate';

describe('tui evaluateExpression', () => {
  it('returns svg for a valid expression', () => {
    const result = evaluateExpression('rect(20,10).fill("#f00").svg()');
    expect(result.error).toBeUndefined();
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('#f00');
  });

  it('auto-exports when expression has no explicit .svg()', () => {
    const result = evaluateExpression('rect(100,50).fill("#ff0000")');
    expect(result.error).toBeUndefined();
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('fill="#ff0000"');
  });

  it('captures an error instead of throwing', () => {
    const result = evaluateExpression('nonexistent()');
    expect(result.svg).toBe('');
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
  });

  it('returns empty (no svg, no error) for empty input', () => {
    const result = evaluateExpression('');
    expect(result.svg).toBe('');
    expect(result.error).toBeUndefined();
  });

  it('respects custom canvas size in the viewBox', () => {
    const result = evaluateExpression('rect(50,50)', { canvasWidth: 200, canvasHeight: 150 });
    expect(result.svg).toContain('viewBox="0 0 200 150"');
  });
});
