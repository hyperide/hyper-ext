/**
 * @file Tests for the simplify node — RDP point-decimation + WASM geometric simplify
 *
 * Accessed via: Internal module, not exposed
 */

import { describe, expect, it } from 'bun:test';
import { MockPathOps } from 'vector-wasm';
import { decodeCommands, PathCmd } from '../../path/commands';
import { PathBuilder } from '../../path/builder';
import type { NodeValue, PathValue } from '../../types';
import { createSimplifyNode } from './simplify';

const backend = new MockPathOps();
const simplifyNode = createSimplifyNode(backend);

/** A line subdivided into many collinear segments — pure redundancy. */
function redundantLine(segments: number): PathValue {
  const b = new PathBuilder().moveTo(0, 0);
  for (let i = 1; i <= segments; i++) b.lineTo((i / segments) * 100, 0);
  return b.build();
}

function cmdCount(path: PathValue): number {
  return decodeCommands(path.commands).length;
}

describe('simplify node', () => {
  it('has correct node type definition', () => {
    expect(simplifyNode.type).toBe('simplify');
    expect(simplifyNode.category).toBe('pathOp');
    expect(simplifyNode.inputs).toEqual([{ name: 'path', type: 'path' }]);
    expect(simplifyNode.outputs).toEqual([{ name: 'path', type: 'path' }]);
  });

  it('collapses a long collinear run to its endpoints with tolerance', () => {
    const path = redundantLine(20);
    const before = cmdCount(path); // Move + 20 lines = 21
    const result = simplifyNode.execute({ path: { type: 'path', value: path } }, { tolerance: 0.5 }).path as NodeValue;
    const out = result.value as PathValue;
    expect(cmdCount(out)).toBeLessThan(before);
    // A straight line should collapse to Move + single Line.
    const cmds = decodeCommands(out.commands);
    expect(cmds.length).toBe(2);
    expect(cmds[0].type).toBe(PathCmd.Move);
    expect(cmds[1].type).toBe(PathCmd.Line);
  });

  it('reduces command count monotonically as tolerance grows', () => {
    // Gentle zigzag so different tolerances drop different amounts.
    const b = new PathBuilder().moveTo(0, 0);
    for (let i = 1; i <= 60; i++) b.lineTo(i, ((i % 2) - 0.5) * 0.8 + i * 0.02);
    const path = b.build();

    const low = cmdCount(
      (simplifyNode.execute({ path: { type: 'path', value: path } }, { tolerance: 0.05 }).path as NodeValue)
        .value as PathValue,
    );
    const mid = cmdCount(
      (simplifyNode.execute({ path: { type: 'path', value: path } }, { tolerance: 0.5 }).path as NodeValue)
        .value as PathValue,
    );
    const high = cmdCount(
      (simplifyNode.execute({ path: { type: 'path', value: path } }, { tolerance: 2 }).path as NodeValue)
        .value as PathValue,
    );
    expect(mid).toBeLessThanOrEqual(low);
    expect(high).toBeLessThanOrEqual(mid);
  });

  it('tolerance 0 is near-identity in point count', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 7).lineTo(20, 0).lineTo(30, 9).build();
    const before = cmdCount(path);
    const out = (simplifyNode.execute({ path: { type: 'path', value: path } }, { tolerance: 0 }).path as NodeValue)
      .value as PathValue;
    expect(cmdCount(out)).toBe(before);
  });

  it('defaults tolerance when param omitted', () => {
    const path = redundantLine(10);
    const out = (simplifyNode.execute({ path: { type: 'path', value: path } }, {}).path as NodeValue)
      .value as PathValue;
    expect(cmdCount(out)).toBeLessThan(cmdCount(path));
  });

  it('preserves separate sub-paths in a multi-contour polyline', () => {
    // Two distinct horizontal segments, each oversampled with a redundant midpoint.
    const path = new PathBuilder()
      .moveTo(0, 0)
      .lineTo(5, 0)
      .lineTo(10, 0)
      .moveTo(100, 0)
      .lineTo(105, 0)
      .lineTo(110, 0)
      .build();
    const out = (simplifyNode.execute({ path: { type: 'path', value: path } }, { tolerance: 0.5 }).path as NodeValue)
      .value as PathValue;
    const cmds = decodeCommands(out.commands);
    // Each contour collapses to Move+Line; the second Move must survive (no merge into one line).
    const moves = cmds.filter((c) => c.type === PathCmd.Move);
    expect(moves.length).toBe(2);
    // Second contour still starts at x=100, not merged with the first.
    expect((moves[1] as { x: number }).x).toBe(100);
    // No phantom line spanning the gap (0→110).
    const lines = cmds.filter((c) => c.type === PathCmd.Line) as Array<{ x: number }>;
    expect(lines.some((l) => l.x === 10)).toBe(true);
    expect(lines.some((l) => l.x === 110)).toBe(true);
  });

  it('returns an empty path when input is missing', () => {
    const out = (simplifyNode.execute({}, { tolerance: 1 }).path as NodeValue).value as PathValue;
    expect(out.commands.length).toBe(0);
  });

  it('preserves geometry within tolerance', () => {
    const b = new PathBuilder().moveTo(0, 0);
    const orig: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
    for (let i = 1; i <= 40; i++) {
      const x = i;
      const y = Math.sin(i / 5) * 4;
      b.lineTo(x, y);
      orig.push({ x, y });
    }
    const path = b.build();
    const tol = 0.5;
    const out = (simplifyNode.execute({ path: { type: 'path', value: path } }, { tolerance: tol }).path as NodeValue)
      .value as PathValue;
    const outPts = decodeCommands(out.commands)
      .filter((c) => c.type === PathCmd.Move || c.type === PathCmd.Line)
      .map((c) => ({ x: (c as { x: number }).x, y: (c as { y: number }).y }));
    for (const p of orig) {
      let best = Infinity;
      for (let i = 0; i < outPts.length - 1; i++) {
        best = Math.min(best, pointSegDist(p, outPts[i], outPts[i + 1]));
      }
      expect(best).toBeLessThanOrEqual(tol + 1e-6);
    }
  });

  it('decimates each contour of a CLOSED compound polyline (M…Z M…Z)', () => {
    // Two collinear-redundant contours, each closed — common for icons/glyphs.
    // Before the isPolyline fix, the first non-trailing Close made RDP skip the
    // whole path; now each contour is decimated independently.
    const b = new PathBuilder();
    b.moveTo(0, 0);
    for (let i = 1; i <= 10; i++) b.lineTo((i / 10) * 100, 0);
    b.close();
    b.moveTo(0, 50);
    for (let i = 1; i <= 10; i++) b.lineTo((i / 10) * 100, 50);
    b.close();
    const path = b.build();
    const before = cmdCount(path);

    const out = (simplifyNode.execute({ path: { type: 'path', value: path } }, { tolerance: 0.5 }).path as NodeValue)
      .value as PathValue;
    const cmds = decodeCommands(out.commands);

    expect(cmds.length).toBeLessThan(before); // both contours actually simplified
    expect(cmds.filter((c) => c.type === PathCmd.Move).length).toBe(2); // one Move per contour
    expect(cmds.filter((c) => c.type === PathCmd.Close).length).toBe(2); // both Closes preserved
  });
});

function pointSegDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
