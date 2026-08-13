/**
 * @file Simplify node — polyline point-decimation (RDP) + WASM geometric simplify
 *
 * Accessed via: Vector engine graph — add "Simplify" node; CLI `path.simplify(tolerance)`.
 * Assumptions: PathOpsBackend is injected at registry creation and is stateless. Two distinct
 *   operations are composed here and BOTH are intentional (do not collapse them):
 *     1. Point-decimation (path/decimate.ts) — tolerance-driven; drops redundant vertices.
 *        Pure TS, works even with the MockPathOps backend. The `method` param selects the
 *        algorithm: 'rdp' (default, Ramer-Douglas-Peucker, perpendicular-distance bound) or
 *        'vw' (Visvalingam-Whyatt, effective-triangle-area greedy). `tolerance` is the RDP
 *        epsilon (max perpendicular distance) or the VW area threshold respectively.
 *     2. Geometric simplify (backend.simplify, vector-wasm/canvaskit-pathops.ts) — removes
 *        self-intersections / overlaps via CanvasKit. No-op under MockPathOps.
 *   `tolerance <= 0` is a near-identity: no decimation, no backend pass (both methods return
 *   the input unchanged for a non-positive threshold).
 * Architecture: docs/specs/2026-06-03-vecli-vector-cli-decomposition.md §VECLI-2 + §VECLI-3
 */

import type { PathOpsBackend } from 'vector-wasm';
import { decimateRDP, decimateVW } from '../../path/decimate';
import { decodeCommands, encodeCommands, PathCmd, type PathCommand } from '../../path/commands';
import type { NodeTypeDefinition, NodeValue, PathValue, Point } from '../../types';

const DEFAULT_TOLERANCE = 1;

/**
 * True when the path is a plain polyline, possibly compound: only Move / Line /
 * Close commands (no curves or arcs). A Close may appear anywhere it ends a
 * contour — i.e. it is the final command, or it is immediately followed by a Move
 * that starts the next contour (`M … Z M … Z`, common for icons/glyphs). This
 * mirrors splitContours(), which already decimates each contour independently.
 */
function isPolyline(cmds: PathCommand[]): boolean {
  if (cmds.length === 0) return false;
  for (let i = 0; i < cmds.length; i++) {
    const t = cmds[i].type;
    if (t === PathCmd.Line) continue;
    if (t === PathCmd.Move) continue;
    if (t === PathCmd.Close && (i === cmds.length - 1 || cmds[i + 1].type === PathCmd.Move)) continue;
    return false;
  }
  return true;
}

/** One sub-path of a polyline: its vertices plus whether it ended with a Close command. */
interface Contour {
  points: Point[];
  closed: boolean;
}

/**
 * Split a polyline command stream into contours by Move command. Each new Move starts a
 * fresh contour; a Close marks the current contour closed. Caller must have verified the
 * stream is a plain polyline (isPolyline).
 */
function splitContours(cmds: PathCommand[]): Contour[] {
  const contours: Contour[] = [];
  let current: Contour | null = null;
  for (const c of cmds) {
    if (c.type === PathCmd.Move) {
      current = { points: [{ x: c.x, y: c.y }], closed: false };
      contours.push(current);
    } else if (c.type === PathCmd.Line) {
      if (!current) {
        current = { points: [], closed: false };
        contours.push(current);
      }
      current.points.push({ x: c.x, y: c.y });
    } else if (c.type === PathCmd.Close && current) {
      current.closed = true;
    }
  }
  return contours;
}

/** Re-emit decimated contours as a Move+Line* stream, re-appending Close per closed contour. */
function contoursToPath(contours: Contour[]): PathValue {
  const out: PathCommand[] = [];
  let anyClosed = false;
  for (const contour of contours) {
    const pts = contour.points;
    for (let i = 0; i < pts.length; i++) {
      out.push(
        i === 0 ? { type: PathCmd.Move, x: pts[i].x, y: pts[i].y } : { type: PathCmd.Line, x: pts[i].x, y: pts[i].y },
      );
    }
    if (contour.closed && pts.length > 0) {
      out.push({ type: PathCmd.Close });
      anyClosed = true;
    }
  }
  return { commands: encodeCommands(out), closed: anyClosed };
}

export function createSimplifyNode(backend: PathOpsBackend): NodeTypeDefinition {
  return {
    type: 'simplify',
    label: 'Simplify',
    category: 'pathOp',
    inputs: [{ name: 'path', type: 'path' }],
    outputs: [{ name: 'path', type: 'path' }],
    params: [
      { name: 'tolerance', type: 'number', default: DEFAULT_TOLERANCE, min: 0, step: 0.1 },
      {
        name: 'method',
        type: 'enum',
        default: 'rdp',
        options: [
          { value: 'rdp', label: 'Ramer-Douglas-Peucker' },
          { value: 'vw', label: 'Visvalingam-Whyatt' },
        ],
      },
    ],
    execute(
      inputs: Record<string, NodeValue | NodeValue[]>,
      params: Record<string, unknown>,
    ): Record<string, NodeValue> {
      const pathVal = inputs.path as NodeValue | undefined;
      if (!pathVal) {
        return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
      }
      const path = pathVal.value as PathValue;
      const raw = params.tolerance;
      const tolerance = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_TOLERANCE;
      // RDP is the default; any value other than 'vw' (including an omitted/invalid param) is RDP.
      const method: 'rdp' | 'vw' = params.method === 'vw' ? 'vw' : 'rdp';
      const decimate = method === 'vw' ? decimateVW : decimateRDP;

      // tolerance <= 0 → identity (no decimation, no backend pass).
      if (tolerance <= 0) {
        return { path: { type: 'path', value: path } };
      }

      const cmds = decodeCommands(path.commands);

      // Step 1: point-decimation. Only applied to plain polylines, where decimating the
      // exact vertices is lossless apart from the tolerance budget. Each contour (sub-path
      // between Move commands) is decimated independently so compound polylines keep their
      // separate sub-paths. The `method` param picks RDP (perpendicular-distance bound) or
      // VW (effective-triangle-area greedy); `tolerance` is the RDP epsilon or the VW area
      // threshold respectively. Curved paths (cubic/quad/arc) are passed through untouched —
      // flattening them to line segments here would silently destroy the curves, and
      // re-fitting (curve/fit.ts) after decimation is a deliberate follow-up.
      const decimated: PathValue = isPolyline(cmds)
        ? contoursToPath(
            splitContours(cmds).map((contour) => ({
              points: decimate(contour.points, tolerance),
              closed: contour.closed,
            })),
          )
        : path;

      // Step 2: geometric simplify via the WASM backend (self-intersection / overlap
      // removal). No-op under MockPathOps. CanvasKit's simplify() takes no tolerance, so
      // deviation tolerance is honored upstream by the RDP pass above — see the comment at
      // vector-wasm/src/canvaskit-pathops.ts simplify().
      const result = backend.simplify(decimated, tolerance);
      return { path: { type: 'path', value: result } };
    },
  };
}
