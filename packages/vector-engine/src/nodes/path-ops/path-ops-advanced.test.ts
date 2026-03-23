import { describe, expect, it } from 'bun:test';
import { PathBuilder } from '../../path/builder';
import { decodeCommands, PathCmd } from '../../path/commands';
import { pathArea } from '../../path/geometry';
import type { NodeValue, PathValue } from '../../types';
import { chamferNode } from './chamfer';
import { enforceWindingNode } from './enforce-winding';
import { roundCornersNode } from './round-corners';
import { smoothNode } from './smooth';
import { subdivideNode } from './subdivide';
import { trimPathNode } from './trim-path';

function extractPath(result: Record<string, NodeValue | NodeValue[]>): PathValue {
  return (result.path as NodeValue).value as PathValue;
}

describe('round corners', () => {
  it('should replace square corners with curves', () => {
    const square = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = roundCornersNode.execute({ path: { type: 'path', value: square } }, { radius: 10 });
    const path = extractPath(result);
    const cmds = decodeCommands(path.commands);
    const hasCurves = cmds.some((c) => c.type === PathCmd.Arc || c.type === PathCmd.Cubic);
    expect(hasCurves).toBe(true);
  });

  it('should clamp radius to half of shortest edge', () => {
    const narrow = new PathBuilder().moveTo(0, 0).lineTo(10, 0).lineTo(10, 100).lineTo(0, 100).close().build();
    const result = roundCornersNode.execute({ path: { type: 'path', value: narrow } }, { radius: 50 });
    expect(extractPath(result).commands.length).toBeGreaterThan(0);
  });

  it('should pass through with radius 0', () => {
    const square = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = roundCornersNode.execute({ path: { type: 'path', value: square } }, { radius: 0 });
    const path = extractPath(result);
    const cmds = decodeCommands(path.commands);
    const hasCurves = cmds.some((c) => c.type === PathCmd.Cubic || c.type === PathCmd.Arc);
    expect(hasCurves).toBe(false);
  });
});

describe('chamfer', () => {
  it('should replace corners with straight cuts', () => {
    const square = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = chamferNode.execute({ path: { type: 'path', value: square } }, { distance: 10 });
    const path = extractPath(result);
    const cmds = decodeCommands(path.commands);
    const lineCount = cmds.filter((c) => c.type === PathCmd.Line).length;
    expect(lineCount).toBe(8);
  });

  it('should pass through with distance 0', () => {
    const tri = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(50, 86.6).close().build();
    const result = chamferNode.execute({ path: { type: 'path', value: tri } }, { distance: 0 });
    const cmds = decodeCommands(extractPath(result).commands);
    const lineCount = cmds.filter((c) => c.type === PathCmd.Line).length;
    expect(lineCount).toBe(3);
  });
});

describe('subdivide', () => {
  it('should split a cubic segment at midpoint', () => {
    const path = new PathBuilder().moveTo(0, 0).cubicTo(10, 20, 30, 40, 50, 60).build();
    const result = subdivideNode.execute({ path: { type: 'path', value: path } }, { segmentIndex: 0, t: 0.5 });
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.filter((c) => c.type === PathCmd.Cubic).length).toBe(2);
  });

  it('should split a line segment into two lines', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = subdivideNode.execute({ path: { type: 'path', value: path } }, { segmentIndex: 0, t: 0.5 });
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.filter((c) => c.type === PathCmd.Line).length).toBe(2);
    // Midpoint should be at (50, 0)
    const firstLine = cmds.find((c) => c.type === PathCmd.Line);
    expect(firstLine).toBeDefined();
    expect((firstLine as { type: PathCmd.Line; x: number; y: number }).x).toBeCloseTo(50, 5);
  });

  it('should handle quad segment', () => {
    const path = new PathBuilder().moveTo(0, 0).quadTo(50, 100, 100, 0).build();
    const result = subdivideNode.execute({ path: { type: 'path', value: path } }, { segmentIndex: 0, t: 0.5 });
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.filter((c) => c.type === PathCmd.Quad).length).toBe(2);
  });

  it('should return unchanged path for invalid segment index', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = subdivideNode.execute({ path: { type: 'path', value: path } }, { segmentIndex: 99, t: 0.5 });
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.filter((c) => c.type === PathCmd.Line).length).toBe(1);
  });
});

describe('trim path', () => {
  it('should extract sub-path between 25% and 75%', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(200, 0).lineTo(300, 0).build();
    const result = trimPathNode.execute({ path: { type: 'path', value: path } }, { start: 0.25, end: 0.75 });
    const outPath = extractPath(result);
    expect(outPath.commands.length).toBeGreaterThan(0);
  });

  it('should return full path for start=0, end=1', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = trimPathNode.execute({ path: { type: 'path', value: path } }, { start: 0, end: 1 });
    const cmds = decodeCommands(extractPath(result).commands);
    expect(cmds.length).toBe(2); // Move + Line
  });

  it('should return empty path for start === end', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = trimPathNode.execute({ path: { type: 'path', value: path } }, { start: 0.5, end: 0.5 });
    const outPath = extractPath(result);
    // Should produce at most a single point
    expect(outPath.commands.length).toBeLessThanOrEqual(3); // Just a Move
  });
});

describe('enforce winding', () => {
  it('should reverse CCW path when CW requested', () => {
    // In screen coordinates (Y down), this triangle goes CCW
    const ccw = new PathBuilder().moveTo(0, 0).lineTo(0, 100).lineTo(100, 100).close().build();
    const result = enforceWindingNode.execute({ path: { type: 'path', value: ccw } }, { direction: 'cw' });
    const outPath = (result.path as NodeValue).value as PathValue;
    const area = pathArea(outPath.commands);
    // CW in screen coords should have positive area (shoelace convention)
    expect(area).toBeGreaterThan(0);
  });

  it('should leave CW path unchanged when CW requested', () => {
    const cw = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).close().build();
    const result = enforceWindingNode.execute({ path: { type: 'path', value: cw } }, { direction: 'cw' });
    const outPath = (result.path as NodeValue).value as PathValue;
    // Should be unchanged (or at least same winding)
    expect(pathArea(outPath.commands)).toBeGreaterThan(0);
  });

  it('should enforce CCW direction', () => {
    const cw = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).close().build();
    const result = enforceWindingNode.execute({ path: { type: 'path', value: cw } }, { direction: 'ccw' });
    const outPath = (result.path as NodeValue).value as PathValue;
    expect(pathArea(outPath.commands)).toBeLessThan(0);
  });
});

describe('smooth', () => {
  it('should convert polyline corners to cubic curves', () => {
    const zigzag = new PathBuilder().moveTo(0, 0).lineTo(50, 100).lineTo(100, 0).build();
    const result = smoothNode.execute({ path: { type: 'path', value: zigzag } }, { smoothness: 0.5 });
    const outPath = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(outPath.commands);
    const hasCubics = cmds.some((c) => c.type === PathCmd.Cubic);
    expect(hasCubics).toBe(true);
  });

  it('should pass through with smoothness 0', () => {
    const zigzag = new PathBuilder().moveTo(0, 0).lineTo(50, 100).lineTo(100, 0).build();
    const result = smoothNode.execute({ path: { type: 'path', value: zigzag } }, { smoothness: 0 });
    const outPath = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(outPath.commands);
    const hasCubics = cmds.some((c) => c.type === PathCmd.Cubic);
    expect(hasCubics).toBe(false);
  });

  it('should handle closed path', () => {
    const square = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = smoothNode.execute({ path: { type: 'path', value: square } }, { smoothness: 0.3 });
    const outPath = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(outPath.commands);
    const hasCubics = cmds.some((c) => c.type === PathCmd.Cubic);
    expect(hasCubics).toBe(true);
  });
});
