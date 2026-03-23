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
  if (data.length < 4) return { vertices: [], segments: [], regions: [] };

  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    // Vertex count
    const vertexCount = view.getUint32(offset, true);
    offset += 4;
    const vertices: VectorVertex[] = [];
    for (let i = 0; i < vertexCount && offset + 8 <= data.length; i++) {
      vertices.push({
        x: view.getFloat32(offset, true),
        y: view.getFloat32(offset + 4, true),
      });
      offset += 8;
    }

    // Segment count
    if (offset + 4 > data.length) return { vertices, segments: [], regions: [] };
    const segmentCount = view.getUint32(offset, true);
    offset += 4;
    const segments: VectorSegment[] = [];
    for (let i = 0; i < segmentCount && offset + 24 <= data.length; i++) {
      segments.push({
        start: view.getUint32(offset, true),
        end: view.getUint32(offset + 4, true),
        tangentStart: {
          x: view.getFloat32(offset + 8, true),
          y: view.getFloat32(offset + 12, true),
        },
        tangentEnd: {
          x: view.getFloat32(offset + 16, true),
          y: view.getFloat32(offset + 20, true),
        },
      });
      offset += 24;
    }

    // Region count
    if (offset + 4 > data.length) return { vertices, segments, regions: [] };
    const regionCount = view.getUint32(offset, true);
    offset += 4;
    const regions: VectorRegion[] = [];
    for (let i = 0; i < regionCount && offset < data.length; i++) {
      const windingByte = view.getUint8(offset);
      offset += 1;
      const windingRule = windingByte === 0 ? ('evenOdd' as const) : ('nonZero' as const);
      if (offset + 4 > data.length) break;
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
