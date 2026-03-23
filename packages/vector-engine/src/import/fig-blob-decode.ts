/**
 * @file FIG vectorNetworkBlob decoder — parse Figma binary path data
 *
 * Accessed via: FIG import pipeline for VECTOR node types
 * Assumptions: binary format based on OpenPencil's reverse-engineering.
 *   Format may change in future Figma versions. Returns empty network on
 *   unrecognized data — never throws.
 */

import type { VectorNetwork, VectorRegion, VectorSegment, VectorVertex } from '../network/types';

export function decodeVectorNetworkBlob(data: Uint8Array): VectorNetwork {
  if (data.length < 12) return { vertices: [], segments: [], regions: [] };

  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    // Header: all 3 counts together
    const vertexCount = view.getUint32(offset, true);
    offset += 4;
    const segmentCount = view.getUint32(offset, true);
    offset += 4;
    const regionCount = view.getUint32(offset, true);
    offset += 4;

    // Vertices: styleOverrideIdx(u32) + x(f32) + y(f32) = 12 bytes each
    const vertices: VectorVertex[] = [];
    for (let i = 0; i < vertexCount && offset + 12 <= data.length; i++) {
      offset += 4; // skip styleOverrideIdx
      const x = view.getFloat32(offset, true);
      offset += 4;
      const y = view.getFloat32(offset, true);
      offset += 4;
      vertices.push({ x, y });
    }

    // Segments: styleOverrideIdx(u32) + start(u32) + tsX(f32) + tsY(f32) + end(u32) + teX(f32) + teY(f32) = 28 bytes each
    const segments: VectorSegment[] = [];
    for (let i = 0; i < segmentCount && offset + 28 <= data.length; i++) {
      offset += 4; // skip styleOverrideIdx
      const start = view.getUint32(offset, true);
      offset += 4;
      const tsx = view.getFloat32(offset, true);
      offset += 4;
      const tsy = view.getFloat32(offset, true);
      offset += 4;
      const end = view.getUint32(offset, true);
      offset += 4;
      const tex = view.getFloat32(offset, true);
      offset += 4;
      const tey = view.getFloat32(offset, true);
      offset += 4;
      segments.push({
        start,
        end,
        tangentStart: { x: tsx, y: tsy },
        tangentEnd: { x: tex, y: tey },
      });
    }

    // Regions: windingRule(u32) + loopCount(u32) + loops
    const regions: VectorRegion[] = [];
    for (let i = 0; i < regionCount && offset + 8 <= data.length; i++) {
      const windingU32 = view.getUint32(offset, true);
      offset += 4;
      const windingRule = windingU32 === 0 ? ('evenOdd' as const) : ('nonZero' as const);
      const loopCount = view.getUint32(offset, true);
      offset += 4;
      const loops: number[][] = [];
      for (let j = 0; j < loopCount && offset + 4 <= data.length; j++) {
        const segCount = view.getUint32(offset, true);
        offset += 4;
        const loop: number[] = [];
        for (let k = 0; k < segCount && offset + 4 <= data.length; k++) {
          loop.push(view.getUint32(offset, true));
          offset += 4;
        }
        loops.push(loop);
      }
      regions.push({ windingRule, loops, fills: [] });
    }

    return { vertices, segments, regions };
  } catch {
    return { vertices: [], segments: [], regions: [] };
  }
}
