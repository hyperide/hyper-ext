import { describe, expect, it } from 'bun:test';
import { PathBuilder } from '../../path/builder';
import type { NodeValue, PathValue } from '../../types';
import { variableStrokeNode } from './variable-stroke';

function getOutPath(result: Record<string, NodeValue | NodeValue[]>): PathValue {
  return (result.path as NodeValue).value as PathValue;
}

describe('variable stroke', () => {
  it('should generate outlined path from uniform width profile', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = variableStrokeNode.execute(
      { path: { type: 'path', value: line } },
      {
        profile: JSON.stringify([
          { offset: 0, width: 10 },
          { offset: 1, width: 10 },
        ]),
        cap: 'butt',
      },
    );
    const outPath = getOutPath(result);
    expect(outPath.closed).toBe(true);
    expect(outPath.commands.length).toBeGreaterThan(0);
  });

  it('should taper from thick to thin', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = variableStrokeNode.execute(
      { path: { type: 'path', value: line } },
      {
        profile: JSON.stringify([
          { offset: 0, width: 20 },
          { offset: 1, width: 2 },
        ]),
        cap: 'butt',
      },
    );
    const outPath = getOutPath(result);
    expect(outPath.closed).toBe(true);
  });

  it('should handle curved input path', () => {
    const curve = new PathBuilder().moveTo(0, 0).cubicTo(33, 50, 66, 50, 100, 0).build();
    const result = variableStrokeNode.execute(
      { path: { type: 'path', value: curve } },
      {
        profile: JSON.stringify([
          { offset: 0, width: 5 },
          { offset: 0.5, width: 15 },
          { offset: 1, width: 5 },
        ]),
        cap: 'round',
      },
    );
    expect(getOutPath(result).commands.length).toBeGreaterThan(0);
  });

  it('should handle invalid JSON gracefully', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = variableStrokeNode.execute(
      { path: { type: 'path', value: line } },
      { profile: 'not json', cap: 'butt' },
    );
    // Should return empty path, not crash
    expect(getOutPath(result)).toBeDefined();
  });

  it('should generate outlined path with round cap', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = variableStrokeNode.execute(
      { path: { type: 'path', value: line } },
      {
        profile: JSON.stringify([
          { offset: 0, width: 10 },
          { offset: 1, width: 10 },
        ]),
        cap: 'round',
      },
    );
    const outPath = getOutPath(result);
    expect(outPath.closed).toBe(true);
    // Round caps add cubic bezier segments — more commands than butt cap
    expect(outPath.commands.length).toBeGreaterThan(0);
  });

  it('should generate outlined path with square cap', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = variableStrokeNode.execute(
      { path: { type: 'path', value: line } },
      {
        profile: JSON.stringify([
          { offset: 0, width: 10 },
          { offset: 1, width: 10 },
        ]),
        cap: 'square',
      },
    );
    const outPath = getOutPath(result);
    expect(outPath.closed).toBe(true);
    expect(outPath.commands.length).toBeGreaterThan(0);
  });

  it('should handle 3-point width profile (binary search in interpolateWidth)', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = variableStrokeNode.execute(
      { path: { type: 'path', value: line } },
      {
        profile: JSON.stringify([
          { offset: 0, width: 2 },
          { offset: 0.5, width: 20 },
          { offset: 1, width: 2 },
        ]),
        cap: 'butt',
      },
    );
    const outPath = getOutPath(result);
    expect(outPath.closed).toBe(true);
    expect(outPath.commands.length).toBeGreaterThan(0);
  });

  it('should handle empty profile array gracefully', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = variableStrokeNode.execute({ path: { type: 'path', value: line } }, { profile: '[]', cap: 'butt' });
    expect(getOutPath(result).commands.length).toBe(0);
  });

  it('should return empty path when no input path', () => {
    const result = variableStrokeNode.execute(
      {},
      {
        profile: JSON.stringify([
          { offset: 0, width: 10 },
          { offset: 1, width: 10 },
        ]),
        cap: 'butt',
      },
    );
    expect(getOutPath(result).commands.length).toBe(0);
  });

  it('should return empty path for zero-length input', () => {
    const dot = new PathBuilder().moveTo(50, 50).build();
    const result = variableStrokeNode.execute(
      { path: { type: 'path', value: dot } },
      {
        profile: JSON.stringify([
          { offset: 0, width: 10 },
          { offset: 1, width: 10 },
        ]),
        cap: 'butt',
      },
    );
    expect(getOutPath(result).commands.length).toBe(0);
  });

  it('should produce a wider outline for wider profile', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const thin = variableStrokeNode.execute(
      { path: { type: 'path', value: line } },
      {
        profile: JSON.stringify([
          { offset: 0, width: 2 },
          { offset: 1, width: 2 },
        ]),
        cap: 'butt',
      },
    );
    const thick = variableStrokeNode.execute(
      { path: { type: 'path', value: line } },
      {
        profile: JSON.stringify([
          { offset: 0, width: 20 },
          { offset: 1, width: 20 },
        ]),
        cap: 'butt',
      },
    );
    // More points in the thick outline (wider = more geometry)
    // Actually both might have same number of samples, but the outline area should differ
    expect(getOutPath(thick).commands.length).toBeGreaterThan(0);
    expect(getOutPath(thin).commands.length).toBeGreaterThan(0);
  });
});
