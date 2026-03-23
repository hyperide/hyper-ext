import { describe, expect, it } from 'bun:test';
import { PathBuilder } from '../../path/builder';
import { decodeCommands, PathCmd } from '../../path/commands';
import type { NodeValue, PathValue } from '../../types';
import { addPointNode } from './add-point';
import { convertPointNode } from './convert-point';
import { removePointNode } from './remove-point';
import { splitPathNode } from './split-path';

function extractPath(result: Record<string, NodeValue | NodeValue[]>): PathValue {
  return (result.path as NodeValue).value as PathValue;
}

describe('add point', () => {
  it('should add point on a line segment', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = addPointNode.execute({ path: { type: 'path', value: path } }, { segmentIndex: 0, t: 0.5 });
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.filter((c) => c.type === PathCmd.Line).length).toBe(2);
  });

  it('should add point on a cubic segment', () => {
    const path = new PathBuilder().moveTo(0, 0).cubicTo(33, 100, 66, 100, 100, 0).build();
    const result = addPointNode.execute({ path: { type: 'path', value: path } }, { segmentIndex: 0, t: 0.5 });
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.filter((c) => c.type === PathCmd.Cubic).length).toBe(2);
  });

  it('should handle invalid segment index gracefully', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = addPointNode.execute({ path: { type: 'path', value: path } }, { segmentIndex: 99, t: 0.5 });
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.filter((c) => c.type === PathCmd.Line).length).toBe(1);
  });

  it('should place the new point at t=0.5 midpoint on a line', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = addPointNode.execute({ path: { type: 'path', value: path } }, { segmentIndex: 0, t: 0.5 });
    const cmds = decodeCommands(extractPath(result).commands);
    const lines = cmds.filter((c) => c.type === PathCmd.Line) as Array<{ type: PathCmd.Line; x: number; y: number }>;
    expect(lines[0].x).toBeCloseTo(50, 5);
    expect(lines[0].y).toBeCloseTo(0, 5);
    expect(lines[1].x).toBeCloseTo(100, 5);
  });

  it('should add point on a quad segment', () => {
    const path = new PathBuilder().moveTo(0, 0).quadTo(50, 100, 100, 0).build();
    const result = addPointNode.execute({ path: { type: 'path', value: path } }, { segmentIndex: 0, t: 0.5 });
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.filter((c) => c.type === PathCmd.Quad).length).toBe(2);
  });
});

describe('remove point', () => {
  it('should remove middle vertex from polyline', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(50, 50).lineTo(100, 0).build();
    const result = removePointNode.execute({ path: { type: 'path', value: path } }, { pointIndex: 1 });
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.filter((c) => c.type === PathCmd.Line).length).toBe(1);
  });

  it('should handle removing first point', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(50, 50).lineTo(100, 0).build();
    const result = removePointNode.execute({ path: { type: 'path', value: path } }, { pointIndex: 0 });
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.length).toBeGreaterThan(0);
    // Path now starts at (50, 50)
    const move = cmds.find((c) => c.type === PathCmd.Move) as { type: PathCmd.Move; x: number; y: number } | undefined;
    expect(move).toBeDefined();
    expect(move?.x).toBeCloseTo(50, 5);
    expect(move?.y).toBeCloseTo(50, 5);
  });

  it('should handle invalid index gracefully', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = removePointNode.execute({ path: { type: 'path', value: path } }, { pointIndex: 99 });
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.filter((c) => c.type === PathCmd.Line).length).toBe(1);
  });

  it('should produce shorter path after removing last vertex', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(50, 50).lineTo(100, 0).build();
    const result = removePointNode.execute({ path: { type: 'path', value: path } }, { pointIndex: 2 });
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.length).toBeGreaterThan(0);
  });
});

describe('convert point type', () => {
  it('should convert corner to smooth — lines become cubics', () => {
    const zigzag = new PathBuilder().moveTo(0, 0).lineTo(50, 100).lineTo(100, 0).build();
    const result = convertPointNode.execute(
      { path: { type: 'path', value: zigzag } },
      { pointIndex: 1, pointType: 'smooth' },
    );
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.some((c) => c.type === PathCmd.Cubic)).toBe(true);
  });

  it('should convert smooth to corner — cubics become lines', () => {
    const curve = new PathBuilder().moveTo(0, 0).cubicTo(33, 100, 66, 100, 100, 0).build();
    const result = convertPointNode.execute(
      { path: { type: 'path', value: curve } },
      { pointIndex: 1, pointType: 'corner' },
    );
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.some((c) => c.type === PathCmd.Line)).toBe(true);
  });

  it('should convert to symmetric — outgoing handle mirrors incoming', () => {
    const zigzag = new PathBuilder().moveTo(0, 0).lineTo(50, 100).lineTo(100, 0).build();
    const result = convertPointNode.execute(
      { path: { type: 'path', value: zigzag } },
      { pointIndex: 1, pointType: 'symmetric' },
    );
    const cmds = decodeCommands(extractPath(result).commands);
    const cubics = cmds.filter((c) => c.type === PathCmd.Cubic) as Array<{
      type: PathCmd.Cubic;
      cx1: number;
      cy1: number;
      cx2: number;
      cy2: number;
      x: number;
      y: number;
    }>;
    // Both segments should have been converted to cubics
    expect(cubics.length).toBe(2);
    // For symmetric: distance from vertex to cp2 of incoming == distance from vertex to cp1 of outgoing
    const vx = 50;
    const vy = 100;
    const inHandle = { x: cubics[0].cx2, y: cubics[0].cy2 };
    const outHandle = { x: cubics[1].cx1, y: cubics[1].cy1 };
    const inDist = Math.sqrt((inHandle.x - vx) ** 2 + (inHandle.y - vy) ** 2);
    const outDist = Math.sqrt((outHandle.x - vx) ** 2 + (outHandle.y - vy) ** 2);
    expect(inDist).toBeCloseTo(outDist, 3);
  });

  it('should return unchanged path for out-of-range pointIndex', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const original = decodeCommands(path.commands);
    const result = convertPointNode.execute(
      { path: { type: 'path', value: path } },
      { pointIndex: 99, pointType: 'smooth' },
    );
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.length).toBe(original.length);
  });
});

describe('split path', () => {
  it('should split into two sub-paths', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(200, 0).build();
    const result = splitPathNode.execute({ path: { type: 'path', value: path } }, { offset: 0.5 });
    expect((result.pathA as NodeValue).type).toBe('path');
    expect((result.pathB as NodeValue).type).toBe('path');
    expect(((result.pathA as NodeValue).value as PathValue).commands.length).toBeGreaterThan(0);
    expect(((result.pathB as NodeValue).value as PathValue).commands.length).toBeGreaterThan(0);
  });

  it('should handle offset=0 (everything in pathB)', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = splitPathNode.execute({ path: { type: 'path', value: path } }, { offset: 0 });
    expect(((result.pathB as NodeValue).value as PathValue).commands.length).toBeGreaterThan(0);
    expect(((result.pathA as NodeValue).value as PathValue).commands.length).toBe(0);
  });

  it('should handle offset=1 (everything in pathA)', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = splitPathNode.execute({ path: { type: 'path', value: path } }, { offset: 1 });
    expect(((result.pathA as NodeValue).value as PathValue).commands.length).toBeGreaterThan(0);
    expect(((result.pathB as NodeValue).value as PathValue).commands.length).toBe(0);
  });

  it('should split at midpoint — both halves have content', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = splitPathNode.execute({ path: { type: 'path', value: path } }, { offset: 0.5 });
    const aCmds = decodeCommands(((result.pathA as NodeValue).value as PathValue).commands);
    const bCmds = decodeCommands(((result.pathB as NodeValue).value as PathValue).commands);
    // pathA: Move(0,0) + Line(50,0)
    expect(aCmds.filter((c) => c.type === PathCmd.Line).length).toBe(1);
    // pathB: Move(50,0) + Line(100,0)
    expect(bCmds.filter((c) => c.type === PathCmd.Line).length).toBe(1);
    // Split point should be at x=50
    const aEnd = aCmds.at(-1) as { type: PathCmd.Line; x: number; y: number };
    expect(aEnd.x).toBeCloseTo(50, 1);
    const bStart = bCmds[0] as { type: PathCmd.Move; x: number; y: number };
    expect(bStart.x).toBeCloseTo(50, 1);
  });

  it('should return empty paths for empty input', () => {
    const empty = { commands: new Float64Array(0), closed: false };
    const result = splitPathNode.execute({ path: { type: 'path', value: empty } }, { offset: 0.5 });
    expect(((result.pathA as NodeValue).value as PathValue).commands.length).toBe(0);
    expect(((result.pathB as NodeValue).value as PathValue).commands.length).toBe(0);
  });
});
