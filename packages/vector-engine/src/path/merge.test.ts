import { describe, expect, it } from 'bun:test';
import { PathBuilder } from './builder';
import { mergePaths } from './merge';

describe('mergePaths', () => {
  it('should concatenate two paths', () => {
    const a = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const b = new PathBuilder().moveTo(200, 0).lineTo(300, 0).build();
    const merged = mergePaths([a, b]);
    expect(merged.commands.length).toBe(a.commands.length + b.commands.length);
  });

  it('should return closed=true only when all paths are closed', () => {
    const closed = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).close().build();
    const open = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    expect(mergePaths([closed, closed]).closed).toBe(true);
    expect(mergePaths([closed, open]).closed).toBe(false);
    expect(mergePaths([open]).closed).toBe(false);
  });

  it('should handle empty array', () => {
    const merged = mergePaths([]);
    expect(merged.commands.length).toBe(0);
    expect(merged.closed).toBe(false);
  });
});
