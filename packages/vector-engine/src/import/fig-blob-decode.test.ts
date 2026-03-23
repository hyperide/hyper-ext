import { describe, expect, it } from 'bun:test';
import { decodeVectorNetworkBlob } from './fig-blob-decode';

function buildTriangleBlob(): Uint8Array {
  const buf = new ArrayBuffer(512);
  const view = new DataView(buf);
  let offset = 0;

  // Header: 3 counts together
  view.setUint32(offset, 3, true);
  offset += 4; // vertexCount
  view.setUint32(offset, 3, true);
  offset += 4; // segmentCount
  view.setUint32(offset, 1, true);
  offset += 4; // regionCount

  // 3 vertices: styleOverrideIdx(u32) + x(f32) + y(f32) = 12 bytes each
  for (const [x, y] of [
    [0, 0],
    [100, 0],
    [50, 86.6],
  ]) {
    view.setUint32(offset, 0, true);
    offset += 4; // styleOverrideIdx
    view.setFloat32(offset, x, true);
    offset += 4;
    view.setFloat32(offset, y, true);
    offset += 4;
  }

  // 3 segments: styleOverrideIdx(u32) + start(u32) + tsX(f32) + tsY(f32) + end(u32) + teX(f32) + teY(f32) = 28 bytes each
  for (const [s, e] of [
    [0, 1],
    [1, 2],
    [2, 0],
  ]) {
    view.setUint32(offset, 0, true);
    offset += 4; // styleOverrideIdx
    view.setUint32(offset, s, true);
    offset += 4; // start
    view.setFloat32(offset, 0, true);
    offset += 4; // tangentStart.x
    view.setFloat32(offset, 0, true);
    offset += 4; // tangentStart.y
    view.setUint32(offset, e, true);
    offset += 4; // end
    view.setFloat32(offset, 0, true);
    offset += 4; // tangentEnd.x
    view.setFloat32(offset, 0, true);
    offset += 4; // tangentEnd.y
  }

  // 1 region: windingRule(u32) + loopCount(u32) + loop
  view.setUint32(offset, 1, true);
  offset += 4; // nonZero = 1
  view.setUint32(offset, 1, true);
  offset += 4; // 1 loop
  view.setUint32(offset, 3, true);
  offset += 4; // 3 segments in loop
  for (const idx of [0, 1, 2]) {
    view.setUint32(offset, idx, true);
    offset += 4;
  }

  return new Uint8Array(buf, 0, offset);
}

describe('decodeVectorNetworkBlob', () => {
  it('should return empty for empty data', () => {
    const r = decodeVectorNetworkBlob(new Uint8Array(0));
    expect(r.vertices.length).toBe(0);
  });

  it('should return empty for tiny data', () => {
    const r = decodeVectorNetworkBlob(new Uint8Array([1, 2, 3]));
    expect(r.vertices.length).toBe(0);
  });

  it('should decode triangle blob', () => {
    const r = decodeVectorNetworkBlob(buildTriangleBlob());
    expect(r.vertices.length).toBe(3);
    expect(r.segments.length).toBe(3);
    expect(r.regions.length).toBe(1);
    expect(r.vertices[0].x).toBeCloseTo(0, 1);
    expect(r.vertices[1].x).toBeCloseTo(100, 1);
    expect(r.segments[0].start).toBe(0);
    expect(r.segments[0].end).toBe(1);
    expect(r.regions[0].windingRule).toBe('nonZero');
    expect(r.regions[0].loops[0]).toEqual([0, 1, 2]);
  });

  it('should handle truncated data gracefully', () => {
    const full = buildTriangleBlob();
    const truncated = full.slice(0, 20); // cut in the middle of vertices
    const r = decodeVectorNetworkBlob(truncated);
    expect(r.vertices.length).toBeLessThan(3);
    expect(r.segments.length).toBe(0);
  });

  it('should decode blob with bezier tangents', () => {
    const buf = new ArrayBuffer(256);
    const view = new DataView(buf);
    let offset = 0;
    // Header: 2 vertices, 1 segment, 0 regions
    view.setUint32(offset, 2, true);
    offset += 4;
    view.setUint32(offset, 1, true);
    offset += 4;
    view.setUint32(offset, 0, true);
    offset += 4;
    // Vertices (12 bytes each)
    view.setUint32(offset, 0, true);
    offset += 4; // styleOverrideIdx
    view.setFloat32(offset, 0, true);
    offset += 4;
    view.setFloat32(offset, 0, true);
    offset += 4;
    view.setUint32(offset, 0, true);
    offset += 4; // styleOverrideIdx
    view.setFloat32(offset, 100, true);
    offset += 4;
    view.setFloat32(offset, 0, true);
    offset += 4;
    // Segment (28 bytes): styleOverrideIdx, start, tsX, tsY, end, teX, teY
    view.setUint32(offset, 0, true);
    offset += 4; // styleOverrideIdx
    view.setUint32(offset, 0, true);
    offset += 4; // start
    view.setFloat32(offset, 33, true);
    offset += 4;
    view.setFloat32(offset, 100, true);
    offset += 4;
    view.setUint32(offset, 1, true);
    offset += 4; // end
    view.setFloat32(offset, -34, true);
    offset += 4;
    view.setFloat32(offset, 100, true);
    offset += 4;
    const r = decodeVectorNetworkBlob(new Uint8Array(buf, 0, offset));
    expect(r.segments[0].tangentStart.x).toBeCloseTo(33, 1);
    expect(r.segments[0].tangentEnd.x).toBeCloseTo(-34, 1);
  });
});
