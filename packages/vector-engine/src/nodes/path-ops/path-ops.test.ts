import { describe, expect, it } from 'bun:test';
import { MockPathOps } from 'vector-wasm';
import { PathBuilder } from '../../path/builder';
import { decodeCommands, PathCmd } from '../../path/commands';
import type { NodeValue, PathValue } from '../../types';
import { breakApartPaths, closeOpenNode, joinPathsNode, reversePathNode } from './basic-ops';
import { createBooleanNodes } from './boolean';

describe('Boolean operation nodes', () => {
  const mockOps = new MockPathOps();
  const nodes = createBooleanNodes(mockOps);

  const rectPath = () => new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();

  it('should return empty path when input a is missing', () => {
    const union = nodes[0];
    const result = union.execute({ b: { type: 'path', value: rectPath() } }, {});
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.commands.length).toBe(0);
    expect(path.closed).toBe(false);
  });

  it('should return empty path when input b is missing', () => {
    const union = nodes[0];
    const result = union.execute({ a: { type: 'path', value: rectPath() } }, {});
    const path = (result.path as NodeValue).value as PathValue;
    expect(path.commands.length).toBe(0);
    expect(path.closed).toBe(false);
  });

  it('should have union, subtract, intersect, xor nodes', () => {
    expect(nodes.map((n) => n.type)).toEqual(['boolean-union', 'boolean-subtract', 'boolean-intersect', 'boolean-xor']);
  });

  it('should accept 2 path inputs and produce 1 path output', () => {
    for (const node of nodes) {
      expect(node.inputs).toHaveLength(2);
      expect(node.outputs).toHaveLength(1);
      expect(node.outputs[0].type).toBe('path');
    }
  });

  it('should execute union via backend', () => {
    const union = nodes[0];
    const result = union.execute(
      {
        a: { type: 'path', value: rectPath() },
        b: { type: 'path', value: rectPath() },
      },
      {},
    );
    expect((result.path as NodeValue).type).toBe('path');
  });

  it('should execute all 4 ops without error', () => {
    for (const node of nodes) {
      const result = node.execute(
        {
          a: { type: 'path', value: rectPath() },
          b: { type: 'path', value: rectPath() },
        },
        {},
      );
      expect((result.path as NodeValue).type).toBe('path');
    }
  });
});

describe('Reverse Path', () => {
  it('should reverse command order (endpoints become startpoints)', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).close().build();
    const result = reversePathNode.execute({ path: { type: 'path', value: path } }, {});
    const reversed = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(reversed.commands);
    // Reversed: M(100,100) → L(100,0) → L(0,0) → Z
    expect(cmds[0]).toMatchObject({ type: PathCmd.Move, x: 100, y: 100 });
    expect(cmds[1]).toMatchObject({ type: PathCmd.Line, x: 100, y: 0 });
    expect(cmds[2]).toMatchObject({ type: PathCmd.Line, x: 0, y: 0 });
    expect(cmds[3]).toEqual({ type: PathCmd.Close });
  });

  it('should reverse open path', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(50, 50).lineTo(100, 0).build();
    const result = reversePathNode.execute({ path: { type: 'path', value: path } }, {});
    const reversed = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(reversed.commands);
    expect(cmds[0]).toMatchObject({ type: PathCmd.Move, x: 100, y: 0 });
    expect(cmds[1]).toMatchObject({ type: PathCmd.Line, x: 50, y: 50 });
    expect(cmds[2]).toMatchObject({ type: PathCmd.Line, x: 0, y: 0 });
  });

  it('should handle cubic bezier reversal (swap control points)', () => {
    const path = new PathBuilder().moveTo(0, 0).cubicTo(10, 20, 30, 40, 50, 60).build();
    const result = reversePathNode.execute({ path: { type: 'path', value: path } }, {});
    const reversed = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(reversed.commands);
    expect(cmds[0]).toMatchObject({ type: PathCmd.Move, x: 50, y: 60 });
    // Reversed cubic: C(cx2=30,cy2=40 → cp1, cx1=10,cy1=20 → cp2, endpoint=0,0)
    expect(cmds[1]).toMatchObject({ type: PathCmd.Cubic, cx1: 30, cy1: 40, cx2: 10, cy2: 20, x: 0, y: 0 });
  });
});

describe('Close/Open Path', () => {
  it('should close an open path', () => {
    const open = new PathBuilder().moveTo(0, 0).lineTo(100, 100).build();
    expect(open.closed).toBe(false);
    const result = closeOpenNode.execute({ path: { type: 'path', value: open } }, { action: 'close' });
    expect(((result.path as NodeValue).value as PathValue).closed).toBe(true);
  });

  it('should open a closed path', () => {
    const closed = new PathBuilder().moveTo(0, 0).lineTo(100, 100).close().build();
    expect(closed.closed).toBe(true);
    const result = closeOpenNode.execute({ path: { type: 'path', value: closed } }, { action: 'open' });
    expect(((result.path as NodeValue).value as PathValue).closed).toBe(false);
  });
});

describe('Join Paths', () => {
  it('should join two open paths at nearest endpoints', () => {
    const p1 = new PathBuilder().moveTo(0, 0).lineTo(50, 0).build();
    const p2 = new PathBuilder().moveTo(50, 0).lineTo(100, 0).build();
    const result = joinPathsNode.execute(
      {
        a: { type: 'path', value: p1 },
        b: { type: 'path', value: p2 },
      },
      {},
    );
    const joined = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(joined.commands);
    // Should be M(0,0) L(50,0) L(100,0)
    expect(cmds).toHaveLength(3);
  });
});

describe('Reverse Path — round-trip and specific command types', () => {
  it('should be idempotent: reverse(reverse(path)) produces original commands', () => {
    const path = new PathBuilder().moveTo(10, 20).lineTo(30, 0).lineTo(50, 40).close().build();
    const once = reversePathNode.execute({ path: { type: 'path', value: path } }, {});
    const reversedOnce = (once.path as NodeValue).value as PathValue;
    const twice = reversePathNode.execute({ path: { type: 'path', value: reversedOnce } }, {});
    const reversedTwice = (twice.path as NodeValue).value as PathValue;

    const originalCmds = decodeCommands(path.commands);
    const roundTripCmds = decodeCommands(reversedTwice.commands);
    expect(roundTripCmds).toEqual(originalCmds);
  });

  it('should flip the arc sweep flag when reversing a path with an arc', () => {
    // Original arc has sweep=1; reversed path should have sweep=0 (travel opposite direction)
    const path = new PathBuilder().moveTo(0, 0).arcTo(25, 25, 0, 0, 1, 50, 0).build();
    const result = reversePathNode.execute({ path: { type: 'path', value: path } }, {});
    const reversed = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(reversed.commands);

    // Reversed: M(50, 0) → Arc(sweep=0) → ends at (0, 0)
    expect(cmds[0]).toMatchObject({ type: PathCmd.Move, x: 50, y: 0 });
    const arc = cmds[1];
    expect(arc.type).toBe(PathCmd.Arc);
    if (arc.type === PathCmd.Arc) {
      expect(arc.sweep).toBe(0);
      expect(arc.rx).toBe(25);
      expect(arc.ry).toBe(25);
      expect(arc.x).toBe(0);
      expect(arc.y).toBe(0);
    }
  });

  it('should preserve arc sweep=0→1 flip in both directions', () => {
    // Ensure the flip is symmetric: sweep=0 → 1 when reversed
    const path = new PathBuilder().moveTo(0, 0).arcTo(40, 40, 0, 1, 0, 80, 0).build();
    const result = reversePathNode.execute({ path: { type: 'path', value: path } }, {});
    const reversed = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(reversed.commands);

    const arc = cmds[1];
    expect(arc.type).toBe(PathCmd.Arc);
    if (arc.type === PathCmd.Arc) {
      expect(arc.sweep).toBe(1);
      expect(arc.largeArc).toBe(1);
    }
  });

  it('should reverse a path with a quadratic bezier, endpoint goes to original start', () => {
    // Q control point stays at absolute position in the current implementation;
    // endpoint flips from original end to original start.
    const path = new PathBuilder().moveTo(0, 0).quadTo(50, 100, 100, 0).build();
    const result = reversePathNode.execute({ path: { type: 'path', value: path } }, {});
    const reversed = (result.path as NodeValue).value as PathValue;
    const cmds = decodeCommands(reversed.commands);

    // Reversed: M(100, 0) → Q(cx=50, cy=100, x=0, y=0)
    expect(cmds[0]).toMatchObject({ type: PathCmd.Move, x: 100, y: 0 });
    expect(cmds[1]).toMatchObject({ type: PathCmd.Quad, cx: 50, cy: 100, x: 0, y: 0 });
  });
});

describe('breakApartPaths (utility function, not a node)', () => {
  it('should split compound path into sub-paths at Move commands', () => {
    const cmds1 = new PathBuilder().moveTo(0, 0).lineTo(10, 0).lineTo(10, 10).close().build().commands;
    const cmds2 = new PathBuilder().moveTo(20, 20).lineTo(30, 20).lineTo(30, 30).close().build().commands;
    const compound = new Float64Array(cmds1.length + cmds2.length);
    compound.set(cmds1);
    compound.set(cmds2, cmds1.length);

    const subPaths = breakApartPaths({ commands: compound, closed: true });
    expect(subPaths).toHaveLength(2);
    expect(subPaths[0].closed).toBe(true);
    expect(subPaths[1].closed).toBe(true);
    const cmds = decodeCommands(subPaths[0].commands);
    expect(cmds[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('should return single path if no compound', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).close().build();
    const subPaths = breakApartPaths(path);
    expect(subPaths).toHaveLength(1);
  });
});
