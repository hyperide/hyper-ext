/**
 * @file CanvasKit PathOps — WASM backend for boolean path operations
 *
 * Accessed via: createDefaultRegistry({ pathOps: new CanvasKitPathOps(ck) })
 * Assumptions: CanvasKit instance must be initialized via initCanvasKit() before
 *   constructing CanvasKitPathOps. The caller owns the CanvasKit lifecycle.
 * Tradeoffs: ~1.4 MB gzipped WASM on first load. Path conversion overhead per call
 *   (decode Float64Array → build SkPath → execute → extract commands → re-encode).
 *   Offset is approximated via stroke+simplify — real offset needs Clipper2.
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import type { CanvasKit, Path as SkPath } from 'canvaskit-wasm';
import CanvasKitInit from 'canvaskit-wasm';
import { decodeCommands, encodeCommands, PathCmd, type PathCommand, type PathValue } from 'vector-engine';
import type { BooleanOp, PathOpsBackend } from './types';

/** Load and initialize CanvasKit WASM. Call once, reuse the returned instance. */
export async function initCanvasKit(): Promise<CanvasKit> {
  return CanvasKitInit();
}

/**
 * CanvasKit verb constants used in toCmds() output.
 * CanvasKit: 0=move, 1=line, 2=quad, 3=conic, 4=cubic, 5=close
 * These differ from PathCmd: 0=Move, 1=Line, 2=Cubic, 3=Quad, 4=Arc, 5=Close
 */
const CK_VERB_MOVE = 0;
const CK_VERB_LINE = 1;
const CK_VERB_QUAD = 2;
// const CK_VERB_CONIC = 3; // Not produced by our conversions
const CK_VERB_CUBIC = 4;
const CK_VERB_CLOSE = 5;

/** Coord counts per CK verb (following the verb value in toCmds output) */
const CK_VERB_COORDS: Record<number, number> = {
  [CK_VERB_MOVE]: 2,
  [CK_VERB_LINE]: 2,
  [CK_VERB_QUAD]: 4,
  3: 5, // conic: 4 coords + 1 weight
  [CK_VERB_CUBIC]: 6,
  [CK_VERB_CLOSE]: 0,
};

/** Convert engine PathValue to a CanvasKit SkPath. Caller must delete() the result. */
function pathValueToSkPath(ck: CanvasKit, pathValue: PathValue): SkPath {
  const cmds = decodeCommands(pathValue.commands);
  const skPath = new ck.Path();

  for (const cmd of cmds) {
    switch (cmd.type) {
      case PathCmd.Move:
        skPath.moveTo(cmd.x, cmd.y);
        break;
      case PathCmd.Line:
        skPath.lineTo(cmd.x, cmd.y);
        break;
      case PathCmd.Cubic:
        skPath.cubicTo(cmd.cx1, cmd.cy1, cmd.cx2, cmd.cy2, cmd.x, cmd.y);
        break;
      case PathCmd.Quad:
        skPath.quadTo(cmd.cx, cmd.cy, cmd.x, cmd.y);
        break;
      case PathCmd.Arc:
        skPath.arcToOval(
          ck.LTRBRect(cmd.x - cmd.rx, cmd.y - cmd.ry, cmd.x + cmd.rx, cmd.y + cmd.ry),
          cmd.rotation,
          cmd.largeArc !== 0 ? 360 : 180,
          false,
        );
        break;
      case PathCmd.Close:
        skPath.close();
        break;
    }
  }

  return skPath;
}

/** Convert a CanvasKit SkPath back to engine PathValue. Does NOT delete the SkPath. */
function skPathToPathValue(skPath: SkPath): PathValue {
  const rawCmds = skPath.toCmds();
  if (!rawCmds || rawCmds.length === 0) {
    return { commands: new Float64Array(0), closed: false };
  }

  const commands: PathCommand[] = [];
  let closed = false;
  let i = 0;

  while (i < rawCmds.length) {
    const verb = rawCmds[i++];
    switch (verb) {
      case CK_VERB_MOVE:
        commands.push({ type: PathCmd.Move, x: rawCmds[i++], y: rawCmds[i++] });
        break;
      case CK_VERB_LINE:
        commands.push({ type: PathCmd.Line, x: rawCmds[i++], y: rawCmds[i++] });
        break;
      case CK_VERB_QUAD:
        commands.push({
          type: PathCmd.Quad,
          cx: rawCmds[i++],
          cy: rawCmds[i++],
          x: rawCmds[i++],
          y: rawCmds[i++],
        });
        break;
      case CK_VERB_CUBIC:
        commands.push({
          type: PathCmd.Cubic,
          cx1: rawCmds[i++],
          cy1: rawCmds[i++],
          cx2: rawCmds[i++],
          cy2: rawCmds[i++],
          x: rawCmds[i++],
          y: rawCmds[i++],
        });
        break;
      case CK_VERB_CLOSE:
        commands.push({ type: PathCmd.Close });
        closed = true;
        break;
      default: {
        // Unknown verb (e.g. conic) — skip its coords to avoid corrupting the stream
        const coordCount = CK_VERB_COORDS[verb] ?? 0;
        i += coordCount;
        break;
      }
    }
  }

  return { commands: encodeCommands(commands), closed };
}

export class CanvasKitPathOps implements PathOpsBackend {
  private readonly ck: CanvasKit;

  constructor(ck: CanvasKit) {
    this.ck = ck;
  }

  boolean(op: BooleanOp, a: PathValue, b: PathValue): PathValue {
    const ck = this.ck;
    const opMap: Record<BooleanOp, typeof ck.PathOp.Union> = {
      union: ck.PathOp.Union,
      subtract: ck.PathOp.Difference,
      intersect: ck.PathOp.Intersect,
      xor: ck.PathOp.XOR,
    };

    const skA = pathValueToSkPath(ck, a);
    const skB = pathValueToSkPath(ck, b);
    try {
      const result = ck.Path.MakeFromOp(skA, skB, opMap[op]);
      if (!result) {
        // Operation failed — return first operand as fallback
        return a;
      }
      try {
        return skPathToPathValue(result);
      } finally {
        result.delete();
      }
    } finally {
      skA.delete();
      skB.delete();
    }
  }

  simplify(path: PathValue, _tolerance: number): PathValue {
    const ck = this.ck;
    const skPath = pathValueToSkPath(ck, path);
    try {
      const ok = skPath.simplify();
      if (!ok) return path;
      return skPathToPathValue(skPath);
    } finally {
      skPath.delete();
    }
  }

  flatten(path: PathValue, _maxError: number): PathValue {
    // CanvasKit doesn't have a direct flatten-to-polyline API.
    // Delegate to the TS flattenPath utility from vector-engine instead.
    // This method exists on PathOpsBackend for completeness — callers
    // that need polyline flattening should use flattenPath() directly.
    return path;
  }

  strokeToPath(path: PathValue, width: number, cap: string, join: string): PathValue {
    const ck = this.ck;
    const capMap: Record<string, typeof ck.StrokeCap.Butt> = {
      butt: ck.StrokeCap.Butt,
      round: ck.StrokeCap.Round,
      square: ck.StrokeCap.Square,
    };
    const joinMap: Record<string, typeof ck.StrokeJoin.Miter> = {
      miter: ck.StrokeJoin.Miter,
      round: ck.StrokeJoin.Round,
      bevel: ck.StrokeJoin.Bevel,
    };

    const skPath = pathValueToSkPath(ck, path);
    try {
      // stroke() mutates the path in-place and returns the same instance (or null on failure).
      // Do NOT delete the return value separately — it's the same object as skPath.
      const stroked = skPath.stroke({
        width,
        cap: capMap[cap] ?? ck.StrokeCap.Butt,
        join: joinMap[join] ?? ck.StrokeJoin.Miter,
      });
      if (!stroked) return { ...path, closed: true };
      return skPathToPathValue(stroked);
    } finally {
      skPath.delete();
    }
  }

  dash(path: PathValue, dashArray: number[], dashOffset: number): PathValue {
    if (dashArray.length < 2) return path;
    const ck = this.ck;
    const skPath = pathValueToSkPath(ck, path);
    try {
      // CanvasKit dash() takes (on, off, phase) — apply each pair
      // For more complex patterns, we iterate pairs
      const current = skPath.copy();
      try {
        for (let i = 0; i < dashArray.length; i += 2) {
          const on = dashArray[i];
          const off = dashArray[i + 1] ?? 0;
          const ok = current.dash(on, off, i === 0 ? dashOffset : 0);
          if (!ok) {
            return path;
          }
        }
        return skPathToPathValue(current);
      } finally {
        current.delete();
      }
    } finally {
      skPath.delete();
    }
  }

  offset(path: PathValue, distance: number): PathValue {
    if (distance === 0) return path;
    const ck = this.ck;

    // Approximate offset via stroke + boolean with original.
    // For positive distance: union(original, stroked_outline)
    // For negative distance: intersect(original, inner_stroked)
    // This is a rough approximation — real polygon offset uses Clipper2.
    const original = pathValueToSkPath(ck, path);
    // stroke() mutates in-place, so copy before stroking to preserve original
    const strokeCopy = original.copy();
    // stroke() returns the same object mutated, or null on failure
    const stroked = strokeCopy.stroke({ width: Math.abs(distance) * 2 });
    if (!stroked) {
      original.delete();
      strokeCopy.delete();
      return path;
    }
    const op = distance > 0 ? ck.PathOp.Union : ck.PathOp.Intersect;
    const result = ck.Path.MakeFromOp(original, stroked, op);
    original.delete();
    strokeCopy.delete(); // same as stroked after in-place mutation
    if (!result) return path;
    try {
      result.simplify();
      return skPathToPathValue(result);
    } finally {
      result.delete();
    }
  }

  removeSelfIntersections(path: PathValue): PathValue {
    const ck = this.ck;
    const skPath = pathValueToSkPath(ck, path);
    try {
      const ok = skPath.simplify();
      if (!ok) return path;
      return skPathToPathValue(skPath);
    } finally {
      skPath.delete();
    }
  }
}
