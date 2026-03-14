import { describe, expect, it } from 'bun:test';
import { PathBuilder } from './builder';
import { decodeCommands, PathCmd } from './commands';

describe('PathBuilder', () => {
  it('should build a rectangle path', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 50).lineTo(0, 50).close().build();

    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    expect(cmds).toHaveLength(5);
    expect(cmds[0]).toEqual({ type: PathCmd.Move, x: 0, y: 0 });
    expect(cmds[4]).toEqual({ type: PathCmd.Close });
  });

  it('should build an open path', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 100).build();

    expect(path.closed).toBe(false);
  });

  it('should support cubic bezier curves', () => {
    const path = new PathBuilder().moveTo(0, 0).cubicTo(10, 20, 30, 40, 50, 60).close().build();

    const cmds = decodeCommands(path.commands);
    expect(cmds[1]).toEqual({
      type: PathCmd.Cubic,
      cx1: 10,
      cy1: 20,
      cx2: 30,
      cy2: 40,
      x: 50,
      y: 60,
    });
  });

  it('should support quadratic bezier curves', () => {
    const path = new PathBuilder().moveTo(0, 0).quadTo(50, 100, 100, 0).close().build();

    const cmds = decodeCommands(path.commands);
    expect(cmds[1]).toEqual({
      type: PathCmd.Quad,
      cx: 50,
      cy: 100,
      x: 100,
      y: 0,
    });
  });

  it('should support arc commands', () => {
    const path = new PathBuilder().moveTo(0, 0).arcTo(25, 25, 0, 1, 0, 50, 0).build();

    const cmds = decodeCommands(path.commands);
    expect(cmds[1]).toEqual({
      type: PathCmd.Arc,
      rx: 25,
      ry: 25,
      rotation: 0,
      largeArc: 1,
      sweep: 0,
      x: 50,
      y: 0,
    });
  });

  it('should be safe to reuse after build()', () => {
    const builder = new PathBuilder();

    // First path: a closed rectangle
    const path1 = builder.moveTo(0, 0).lineTo(10, 0).lineTo(10, 10).close().build();
    expect(path1.closed).toBe(true);
    expect(decodeCommands(path1.commands)).toHaveLength(4);

    // Second path using the same builder instance: open line
    const path2 = builder.moveTo(5, 5).lineTo(20, 20).build();
    expect(path2.closed).toBe(false);
    const cmds2 = decodeCommands(path2.commands);
    expect(cmds2).toHaveLength(2);
    expect(cmds2[0]).toEqual({ type: PathCmd.Move, x: 5, y: 5 });
    expect(cmds2[1]).toEqual({ type: PathCmd.Line, x: 20, y: 20 });
  });
});
