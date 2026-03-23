/**
 * @file Combined tests for vector network types, conversions, and topology solver
 *
 * Accessed via: Internal module — test suite for packages/vector-engine/src/network/
 */

import { describe, expect, it } from 'bun:test';
import { PathBuilder } from '../path/builder';
import { commandsToSvgD } from '../path/commands';
import { networkToPaths, pathToNetwork } from './convert';
import { splitIntersections } from './split';
import { findRegions } from './topology';
import type { VectorNetwork } from './types';

// -- Task 22: Types validation --

describe('VectorNetwork types', () => {
  it('should create a valid VectorNetwork structure', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 86.6 },
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 2, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [
        {
          windingRule: 'nonZero',
          loops: [[0, 1, 2]],
          fills: [{ type: 'solid', color: '#ff0000' }],
        },
      ],
    };
    expect(network.vertices.length).toBe(3);
    expect(network.segments.length).toBe(3);
    expect(network.regions.length).toBe(1);
  });

  it('should support optional vertex properties', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 0, cornerRadius: 5, handleMirroring: 'angle' },
        { x: 100, y: 0, handleMirroring: 'angleAndLength' },
        { x: 50, y: 86.6, handleMirroring: 'none' },
      ],
      segments: [],
      regions: [],
    };
    expect(network.vertices[0].cornerRadius).toBe(5);
    expect(network.vertices[0].handleMirroring).toBe('angle');
  });
});

// -- Task 23: Path <-> VectorNetwork Conversions --

describe('pathToNetwork', () => {
  it('should convert closed triangle', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(50, 86.6).close().build();
    const network = pathToNetwork(path);
    expect(network.vertices.length).toBe(3);
    expect(network.segments.length).toBe(3);
    expect(network.regions.length).toBe(1);
    expect(network.regions[0].loops[0].length).toBe(3);
  });

  it('should convert cubic bezier', () => {
    const path = new PathBuilder().moveTo(0, 0).cubicTo(33, 100, 66, 100, 100, 0).build();
    const network = pathToNetwork(path);
    expect(network.vertices.length).toBe(2);
    expect(network.segments.length).toBe(1);
    const seg = network.segments[0];
    // Tangent handles are relative to vertex positions
    expect(seg.tangentStart.x).toBeCloseTo(33, 1);
    expect(seg.tangentStart.y).toBeCloseTo(100, 1);
    expect(seg.tangentEnd.x).toBeCloseTo(66 - 100, 1); // relative to end vertex
    expect(seg.tangentEnd.y).toBeCloseTo(100 - 0, 1);
  });

  it('should convert compound paths (multiple sub-paths)', () => {
    const builder = new PathBuilder();
    builder.moveTo(0, 0).lineTo(50, 0).lineTo(25, 43).close();
    const path1 = builder.build();

    const path2 = new PathBuilder().moveTo(100, 0).lineTo(150, 0).lineTo(125, 43).close().build();

    const net1 = pathToNetwork(path1);
    expect(net1.vertices.length).toBe(3);

    const net2 = pathToNetwork(path2);
    expect(net2.vertices.length).toBe(3);
  });

  it('should handle open path (no regions)', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).build();
    const network = pathToNetwork(path);
    expect(network.vertices.length).toBe(3);
    expect(network.segments.length).toBe(2);
    expect(network.regions.length).toBe(0);
  });

  it('should convert quad bezier', () => {
    const path = new PathBuilder().moveTo(0, 0).quadTo(50, 100, 100, 0).build();
    const network = pathToNetwork(path);
    expect(network.vertices.length).toBe(2);
    expect(network.segments.length).toBe(1);
    const seg = network.segments[0];
    // Quad tangent: control point relative to start
    expect(seg.tangentStart.x).toBeCloseTo(50, 1);
    expect(seg.tangentStart.y).toBeCloseTo(100, 1);
    // Control point relative to end
    expect(seg.tangentEnd.x).toBeCloseTo(50 - 100, 1);
    expect(seg.tangentEnd.y).toBeCloseTo(100 - 0, 1);
  });
});

describe('networkToPaths', () => {
  it('should convert triangle network back to path', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 86.6 },
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 2, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [
        {
          windingRule: 'nonZero',
          loops: [[0, 1, 2]],
          fills: [{ type: 'solid', color: '#ff0000' }],
        },
      ],
    };
    const paths = networkToPaths(network);
    expect(paths.length).toBe(1);
    expect(paths[0].closed).toBe(true);
    const d = commandsToSvgD(paths[0].commands);
    expect(d).toContain('M');
    expect(d).toContain('Z');
  });

  it('should convert T-junction to open paths', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 50, y: 50 },
        { x: 0, y: 50 },
        { x: 100, y: 50 },
        { x: 50, y: 0 },
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 0, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 0, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [],
    };
    const paths = networkToPaths(network);
    expect(paths.length).toBe(3);
  });

  it('should produce cubic bezier from tangent handles', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      segments: [
        {
          start: 0,
          end: 1,
          tangentStart: { x: 33, y: 100 },
          tangentEnd: { x: -34, y: 100 },
        },
      ],
      regions: [],
    };
    const paths = networkToPaths(network);
    expect(paths.length).toBe(1);
    const d = commandsToSvgD(paths[0].commands);
    expect(d).toContain('C');
  });
});

describe('round-trip', () => {
  it('should preserve triangle through path -> network -> path', () => {
    const original = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(50, 86.6).close().build();
    const network = pathToNetwork(original);
    const paths = networkToPaths(network);
    expect(paths.length).toBe(1);
    expect(paths[0].closed).toBe(true);
    const d = commandsToSvgD(paths[0].commands);
    expect(d).toContain('100 0');
    expect(d).toContain('50 86.6');
  });

  it('should preserve cubic bezier through round-trip', () => {
    const original = new PathBuilder().moveTo(0, 0).cubicTo(33, 100, 66, 100, 100, 0).build();
    const network = pathToNetwork(original);
    const paths = networkToPaths(network);
    expect(paths.length).toBe(1);
    const d = commandsToSvgD(paths[0].commands);
    expect(d).toContain('C');
    expect(d).toContain('33 100');
    expect(d).toContain('66 100');
    expect(d).toContain('100 0');
  });
});

// -- Task 24: Topology Solver --

describe('topology solver', () => {
  it('should find one region in a triangle', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 100 },
        { x: 100, y: 100 },
        { x: 50, y: 0 },
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 2, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [],
    };
    const regions = findRegions(network);
    expect(regions.length).toBe(1);
    expect(regions[0].loops[0].length).toBe(3);
  });

  it('should find two regions in square with diagonal', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 3, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 0, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [],
    };
    const regions = findRegions(network);
    expect(regions.length).toBe(2);
  });

  it('should handle T-junction (no closed regions)', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 50, y: 50 },
        { x: 0, y: 50 },
        { x: 100, y: 50 },
        { x: 50, y: 0 },
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 0, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 0, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [],
    };
    const regions = findRegions(network);
    expect(regions.length).toBe(0);
  });

  it('should remove filaments', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 100 },
        { x: 100, y: 100 },
        { x: 50, y: 0 },
        { x: 50, y: -50 }, // dangling
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 2, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [],
    };
    const regions = findRegions(network);
    expect(regions.length).toBe(1);
  });

  it('should handle single edge (no region)', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      segments: [{ start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }],
      regions: [],
    };
    const regions = findRegions(network);
    expect(regions.length).toBe(0);
  });

  it('should handle empty network', () => {
    const regions = findRegions({ vertices: [], segments: [], regions: [] });
    expect(regions.length).toBe(0);
  });
});

// -- Task 4-5: splitIntersections --

describe('splitIntersections', () => {
  it('should split two crossing line segments', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [],
    };
    const result = splitIntersections(network);
    expect(result.vertices.length).toBe(5);
    expect(result.segments.length).toBe(4);
    const newV = result.vertices[4];
    expect(newV.x).toBeCloseTo(50, 1);
    expect(newV.y).toBeCloseTo(50, 1);
  });

  it('should not split non-intersecting segments', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [],
    };
    const result = splitIntersections(network);
    expect(result.vertices.length).toBe(4);
    expect(result.segments.length).toBe(2);
  });

  it('should skip segments sharing a vertex', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 100 },
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [],
    };
    const result = splitIntersections(network);
    expect(result.vertices.length).toBe(3);
    expect(result.segments.length).toBe(2);
  });

  it('should handle empty network', () => {
    const result = splitIntersections({ vertices: [], segments: [], regions: [] });
    expect(result.vertices.length).toBe(0);
  });

  it('should enable findRegions on X pattern after splitting', () => {
    // Two crossing diagonals + 4 border edges = should get 4 regions after split
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      segments: [
        // Border
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 3, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        // Diagonals (cross at center)
        { start: 0, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 1, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [],
    };
    const split = splitIntersections(network);
    // Diagonals cross at (50,50) — new vertex, diagonals split into 4 segments
    expect(split.vertices.length).toBe(5);
    expect(split.segments.length).toBe(8); // 4 border + 4 half-diagonals
    const regions = findRegions(split);
    expect(regions.length).toBe(4);
  });
});
