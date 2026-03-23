/**
 * @file Convert Point Type path operation — changes anchor point handle type
 *
 * Accessed via: Properties panel > Point Type (when anchor selected in vector mode)
 *
 * Assumptions: pointIndex addresses the vertex list (Move = index 0, each drawable
 *   endpoint = subsequent indices). Only the segments touching the target vertex are
 *   modified; the rest of the path is preserved verbatim.
 *
 * Point types:
 *   corner — incoming and outgoing handles are independent (no constraint). When
 *     converting from curves: the incoming/outgoing cubics become lines.
 *   smooth — outgoing handle is the reflection of the incoming handle across the
 *     vertex. When converting from lines: synthetic cubic handles are created at
 *     1/3 of the segment length along the path direction.
 *   symmetric — like smooth but both handles have equal length (true mirror).
 *     When converting from lines: identical to smooth since synthetic handles
 *     are equidistant by construction.
 *
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { decodeCommands, encodeCommands, PathCmd } from '../../path/commands';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

type PointType = 'corner' | 'smooth' | 'symmetric';

/** Reflected point: mirror P across pivot V. */
function reflect(px: number, py: number, vx: number, vy: number): { x: number; y: number } {
  return { x: 2 * vx - px, y: 2 * vy - py };
}

export const convertPointNode: NodeTypeDefinition = {
  type: 'convertPoint',
  label: 'Convert Point Type',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'pointIndex', type: 'number', default: 0, min: 0 },
    {
      name: 'pointType',
      type: 'enum',
      default: 'smooth',
      options: [
        { value: 'smooth', label: 'Smooth' },
        { value: 'corner', label: 'Corner' },
        { value: 'symmetric', label: 'Symmetric' },
      ],
    },
  ],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const path = pathInput.value as PathValue;
    const pointIndex = params.pointIndex as number;
    const pointType = params.pointType as PointType;

    const cmds = decodeCommands(path.commands);

    // Build vertex list. Each vertex records:
    //   cmdIndex  — the command that places this vertex (Move or drawable)
    //   prevCmdIndex — the command ARRIVING at this vertex (-1 for first vertex)
    interface VertexRecord {
      cmdIndex: number;
      prevCmdIndex: number;
      x: number;
      y: number;
    }

    const vertices: VertexRecord[] = [];

    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i];
      switch (cmd.type) {
        case PathCmd.Move:
          vertices.push({ cmdIndex: i, prevCmdIndex: -1, x: cmd.x, y: cmd.y });
          break;
        case PathCmd.Line:
        case PathCmd.Cubic:
        case PathCmd.Quad:
        case PathCmd.Arc: {
          const prevIdx = vertices.length > 0 ? vertices[vertices.length - 1].cmdIndex : -1;
          vertices.push({ cmdIndex: i, prevCmdIndex: prevIdx, x: cmd.x, y: cmd.y });
          break;
        }
        case PathCmd.Close:
          break;
      }
    }

    // Out-of-range index — return unchanged
    if (pointIndex < 0 || pointIndex >= vertices.length) {
      return { path: { type: 'path', value: { ...path } } };
    }

    const vertex = vertices[pointIndex];

    // Vertex coordinates
    const vx = vertex.x;
    const vy = vertex.y;

    // The command arriving at this vertex (incoming segment)
    const inCmd = vertex.cmdIndex;

    // The command leaving this vertex (outgoing segment) — the next drawable command
    let outCmd = -1;
    for (let i = inCmd + 1; i < cmds.length; i++) {
      const t = cmds[i].type;
      if (t === PathCmd.Line || t === PathCmd.Cubic || t === PathCmd.Quad || t === PathCmd.Arc) {
        outCmd = i;
        break;
      }
      if (t === PathCmd.Move) break; // next subpath — no outgoing
    }

    // Previous vertex coordinates (start of incoming segment)
    let prevX = 0;
    let prevY = 0;
    if (vertex.prevCmdIndex >= 0) {
      const prevCmd = cmds[vertex.prevCmdIndex];
      if (prevCmd.type === PathCmd.Move || prevCmd.type === PathCmd.Line) {
        prevX = prevCmd.x;
        prevY = prevCmd.y;
      } else if (prevCmd.type === PathCmd.Cubic || prevCmd.type === PathCmd.Quad || prevCmd.type === PathCmd.Arc) {
        prevX = prevCmd.x;
        prevY = prevCmd.y;
      }
    }

    // Next vertex coordinates (end of outgoing segment)
    let nextX = 0;
    let nextY = 0;
    if (outCmd >= 0) {
      const nextCmdObj = cmds[outCmd];
      if (nextCmdObj.type === PathCmd.Line || nextCmdObj.type === PathCmd.Cubic || nextCmdObj.type === PathCmd.Arc) {
        nextX = nextCmdObj.x;
        nextY = nextCmdObj.y;
      } else if (nextCmdObj.type === PathCmd.Quad) {
        nextX = nextCmdObj.x;
        nextY = nextCmdObj.y;
      }
    }

    const newCmds = [...cmds];

    if (pointType === 'corner') {
      // Corner: convert incoming and outgoing segments to lines, discarding handles.
      if (inCmd >= 0 && cmds[inCmd].type !== PathCmd.Move && cmds[inCmd].type !== PathCmd.Arc) {
        newCmds[inCmd] = { type: PathCmd.Line, x: vx, y: vy };
      }
      if (outCmd >= 0 && cmds[outCmd].type !== PathCmd.Arc) {
        newCmds[outCmd] = { type: PathCmd.Line, x: nextX, y: nextY };
      }
    } else {
      // smooth / symmetric: add cubic handles.
      // Incoming handle: control point 2 of the incoming cubic (cp2 → vertex).
      // Outgoing handle: control point 1 of the outgoing cubic (vertex → cp1).
      //
      // Strategy for lines → smooth: place handles at 1/3 of the segment length
      // along the tangent direction (chord direction), which produces a natural curve.

      const inCmdObj = cmds[inCmd];

      // Determine the existing incoming tangent (pointing FROM prev TO vertex)
      let inTanX: number;
      let inTanY: number;
      let inHandleX: number;
      let inHandleY: number;

      if (inCmdObj.type === PathCmd.Cubic) {
        // Existing incoming handle (cp2)
        inHandleX = inCmdObj.cx2;
        inHandleY = inCmdObj.cy2;
        inTanX = vx - inCmdObj.cx2;
        inTanY = vy - inCmdObj.cy2;
      } else {
        // Line or first vertex — tangent is the chord direction
        const dx = vx - prevX;
        const dy = vy - prevY;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 1e-10) {
          inTanX = dx;
          inTanY = dy;
        } else {
          inTanX = 1;
          inTanY = 0;
        }
        // Place handle at 1/3 of the segment from vertex back toward prev
        inHandleX = vx - inTanX / 3;
        inHandleY = vy - inTanY / 3;
      }

      // Outgoing handle: reflect the incoming handle for smooth/symmetric
      const outHandleReflected = reflect(inHandleX, inHandleY, vx, vy);

      // For symmetric: enforce equal length on both sides
      let outHandleX: number;
      let outHandleY: number;

      if (pointType === 'symmetric') {
        outHandleX = outHandleReflected.x;
        outHandleY = outHandleReflected.y;
      } else {
        // smooth: preserve outgoing handle length if the outgoing segment is already cubic
        if (outCmd >= 0 && cmds[outCmd].type === PathCmd.Cubic) {
          const existOut = cmds[outCmd] as {
            type: PathCmd.Cubic;
            cx1: number;
            cy1: number;
            cx2: number;
            cy2: number;
            x: number;
            y: number;
          };
          // Keep outgoing handle direction from reflection, but length from existing cx1
          const existLen = Math.sqrt(
            (existOut.cx1 - vx) * (existOut.cx1 - vx) + (existOut.cy1 - vy) * (existOut.cy1 - vy),
          );
          const reflLen = Math.sqrt(
            (outHandleReflected.x - vx) * (outHandleReflected.x - vx) +
              (outHandleReflected.y - vy) * (outHandleReflected.y - vy),
          );
          if (reflLen > 1e-10 && existLen > 1e-10) {
            const scale = existLen / reflLen;
            outHandleX = vx + (outHandleReflected.x - vx) * scale;
            outHandleY = vy + (outHandleReflected.y - vy) * scale;
          } else {
            outHandleX = outHandleReflected.x;
            outHandleY = outHandleReflected.y;
          }
        } else {
          outHandleX = outHandleReflected.x;
          outHandleY = outHandleReflected.y;
        }
      }

      // Rewrite the incoming segment as a cubic
      if (inCmd >= 0 && inCmdObj.type !== PathCmd.Move && inCmdObj.type !== PathCmd.Arc) {
        let inCx1: number;
        let inCy1: number;

        if (inCmdObj.type === PathCmd.Cubic) {
          // Preserve existing cp1
          inCx1 = inCmdObj.cx1;
          inCy1 = inCmdObj.cy1;
        } else {
          // Line → cubic: cp1 at 1/3 from prev to vertex
          inCx1 = prevX + (vx - prevX) / 3;
          inCy1 = prevY + (vy - prevY) / 3;
        }

        newCmds[inCmd] = {
          type: PathCmd.Cubic,
          cx1: inCx1,
          cy1: inCy1,
          cx2: inHandleX,
          cy2: inHandleY,
          x: vx,
          y: vy,
        };
      }

      // Rewrite the outgoing segment as a cubic
      if (outCmd >= 0) {
        const outCmdObj = cmds[outCmd];
        if (outCmdObj.type !== PathCmd.Arc) {
          let outCx2: number;
          let outCy2: number;

          if (outCmdObj.type === PathCmd.Cubic) {
            // Preserve existing cp2
            outCx2 = outCmdObj.cx2;
            outCy2 = outCmdObj.cy2;
          } else {
            // Line → cubic: cp2 at 2/3 from vertex to next
            outCx2 = vx + (2 * (nextX - vx)) / 3;
            outCy2 = vy + (2 * (nextY - vy)) / 3;
          }

          newCmds[outCmd] = {
            type: PathCmd.Cubic,
            cx1: outHandleX,
            cy1: outHandleY,
            cx2: outCx2,
            cy2: outCy2,
            x: nextX,
            y: nextY,
          };
        }
      }
    }

    return {
      path: {
        type: 'path',
        value: { commands: encodeCommands(newCmds), closed: path.closed },
      },
    };
  },
};
