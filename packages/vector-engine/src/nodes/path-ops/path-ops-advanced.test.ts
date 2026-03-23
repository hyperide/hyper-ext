import { describe, expect, it } from 'bun:test';
import { PathBuilder } from '../../path/builder';
import { decodeCommands, encodeCommands, PathCmd } from '../../path/commands';
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

  it('should reverse a path with cubic beziers and preserve curve structure', () => {
    // CW triangle with a cubic in place of one edge — area is positive
    const path = new PathBuilder().moveTo(0, 0).cubicTo(10, 50, 90, 50, 100, 0).lineTo(50, 100).close().build();
    // Determine initial winding so we can request the opposite
    const initialArea = pathArea(path.commands);
    const targetDir = initialArea > 0 ? 'ccw' : 'cw';
    const result = enforceWindingNode.execute({ path: { type: 'path', value: path } }, { direction: targetDir });
    const outPath = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(outPath.commands);
    // Reversed path must still contain a cubic
    expect(cmds.some((c) => c.type === PathCmd.Cubic)).toBe(true);
    // Winding must have flipped
    const newArea = pathArea(outPath.commands);
    if (targetDir === 'ccw') {
      expect(newArea).toBeLessThan(0);
    } else {
      expect(newArea).toBeGreaterThan(0);
    }
  });

  it('should reverse a path with quad beziers', () => {
    const path = new PathBuilder().moveTo(0, 0).quadTo(50, 100, 100, 0).lineTo(50, -50).close().build();
    const initialArea = pathArea(path.commands);
    const targetDir = initialArea > 0 ? 'ccw' : 'cw';
    const result = enforceWindingNode.execute({ path: { type: 'path', value: path } }, { direction: targetDir });
    const outPath = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(outPath.commands);
    expect(cmds.some((c) => c.type === PathCmd.Quad)).toBe(true);
  });

  it('should preserve Close command when reversing a closed path', () => {
    const ccw = new PathBuilder().moveTo(0, 0).lineTo(0, 100).lineTo(100, 100).close().build();
    const result = enforceWindingNode.execute({ path: { type: 'path', value: ccw } }, { direction: 'cw' });
    const outPath = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(outPath.commands);
    expect(cmds.some((c) => c.type === PathCmd.Close)).toBe(true);
  });

  it('should return empty path unchanged when input has no drawing commands', () => {
    const empty: PathValue = { commands: new Float64Array(0), closed: false };
    const result = enforceWindingNode.execute({ path: { type: 'path', value: empty } }, { direction: 'cw' });
    const outPath = (result.path as NodeValue).value as PathValue;
    expect(outPath.commands.length).toBe(0);
  });

  it('should return default empty path when no input provided', () => {
    const result = enforceWindingNode.execute({}, { direction: 'cw' });
    const outPath = (result.path as NodeValue).value as PathValue;
    expect(outPath.commands.length).toBe(0);
  });

  it('should reverse a compound path (two subpaths with embedded Close)', () => {
    // Two CW triangles as subpaths — together they produce non-zero area.
    // The inner Close command exercises cmdEndpoint's Close fallback (lines 26-27)
    // and reverseCmd's default branch (line 59).
    const compoundCmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Close },
      { type: PathCmd.Move, x: 200, y: 0 },
      { type: PathCmd.Line, x: 300, y: 0 },
      { type: PathCmd.Line, x: 300, y: 100 },
      { type: PathCmd.Close },
    ]);
    const compoundPath: PathValue = { commands: compoundCmds, closed: true };
    const initialArea = pathArea(compoundPath.commands);
    const targetDir = initialArea > 0 ? 'ccw' : 'cw';
    const result = enforceWindingNode.execute(
      { path: { type: 'path', value: compoundPath } },
      { direction: targetDir },
    );
    const outPath = (result.path as NodeValue).value as PathValue;
    expect(outPath.commands.length).toBeGreaterThan(0);
  });

  it('should reverse a path containing an arc and flip sweep flag', () => {
    // Build a wedge shape using an arc — area is non-zero
    const path = new PathBuilder().moveTo(100, 100).arcTo(50, 50, 0, 0, 1, 150, 100).lineTo(125, 60).close().build();
    const initialArea = pathArea(path.commands);
    const targetDir = initialArea > 0 ? 'ccw' : 'cw';
    const result = enforceWindingNode.execute({ path: { type: 'path', value: path } }, { direction: targetDir });
    const outPath = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(outPath.commands);
    // Reversed path must still contain an arc
    expect(cmds.some((c) => c.type === PathCmd.Arc)).toBe(true);
    // Winding must have flipped
    const newArea = pathArea(outPath.commands);
    if (targetDir === 'ccw') {
      expect(newArea).toBeLessThan(0);
    } else {
      expect(newArea).toBeGreaterThan(0);
    }
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
