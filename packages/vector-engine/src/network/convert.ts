/**
 * @file VectorNetwork <-> PathValue[] conversions
 *
 * Accessed via: SVG import (path -> network), SVG export (network -> paths)
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Vector Networks §Conversions
 */

import type { PathCommand } from '../path/commands';
import { decodeCommands, encodeCommands, PathCmd } from '../path/commands';
import type { PathValue, Point } from '../types';
import type { VectorNetwork, VectorRegion, VectorSegment, VectorVertex } from './types';

/**
 * Convert a PathValue (encoded commands) into a VectorNetwork.
 *
 * Each sub-path (starting with M) creates vertices and segments.
 * Closed sub-paths produce a region with one loop.
 */
export function pathToNetwork(path: PathValue): VectorNetwork {
  const commands = decodeCommands(path.commands);
  const vertices: VectorVertex[] = [];
  const segments: VectorSegment[] = [];
  const regions: VectorRegion[] = [];

  let subPathStart = -1;
  let currentVertex = -1;
  let subPathSegments: number[] = [];

  function addVertex(x: number, y: number): number {
    vertices.push({ x, y });
    return vertices.length - 1;
  }

  function addSegment(start: number, end: number, tangentStart: Point, tangentEnd: Point): number {
    segments.push({ start, end, tangentStart, tangentEnd });
    const idx = segments.length - 1;
    subPathSegments.push(idx);
    return idx;
  }

  const ZERO: Point = { x: 0, y: 0 };

  for (const cmd of commands) {
    switch (cmd.type) {
      case PathCmd.Move: {
        subPathStart = addVertex(cmd.x, cmd.y);
        currentVertex = subPathStart;
        subPathSegments = [];
        break;
      }

      case PathCmd.Line: {
        const next = addVertex(cmd.x, cmd.y);
        addSegment(currentVertex, next, ZERO, ZERO);
        currentVertex = next;
        break;
      }

      case PathCmd.Cubic: {
        const startVtx = vertices[currentVertex];
        const next = addVertex(cmd.x, cmd.y);
        const tangentStart: Point = {
          x: cmd.cx1 - startVtx.x,
          y: cmd.cy1 - startVtx.y,
        };
        const tangentEnd: Point = {
          x: cmd.cx2 - cmd.x,
          y: cmd.cy2 - cmd.y,
        };
        addSegment(currentVertex, next, tangentStart, tangentEnd);
        currentVertex = next;
        break;
      }

      case PathCmd.Quad: {
        const startVtx = vertices[currentVertex];
        const next = addVertex(cmd.x, cmd.y);
        const tangentStart: Point = {
          x: cmd.cx - startVtx.x,
          y: cmd.cy - startVtx.y,
        };
        const tangentEnd: Point = {
          x: cmd.cx - cmd.x,
          y: cmd.cy - cmd.y,
        };
        addSegment(currentVertex, next, tangentStart, tangentEnd);
        currentVertex = next;
        break;
      }

      case PathCmd.Close: {
        if (currentVertex !== subPathStart && subPathStart >= 0) {
          addSegment(currentVertex, subPathStart, ZERO, ZERO);
        }
        if (subPathSegments.length > 0) {
          regions.push({
            windingRule: 'nonZero',
            loops: [[...subPathSegments]],
            fills: [],
          });
        }
        currentVertex = subPathStart;
        subPathSegments = [];
        break;
      }

      // Arc commands are not directly representable in vector networks.
      // Skip for now — production code should approximate arcs with cubics first.
      case PathCmd.Arc:
        break;
    }
  }

  return { vertices, segments, regions };
}

/**
 * Convert a VectorNetwork back into PathValue[].
 *
 * Regions produce closed paths (one per loop).
 * Segments not belonging to any region produce individual open paths.
 */
export function networkToPaths(network: VectorNetwork): PathValue[] {
  const paths: PathValue[] = [];
  const usedSegments = new Set<number>();

  // Emit region loops as closed paths
  for (const region of network.regions) {
    for (const loop of region.loops) {
      const path = loopToPath(network, loop, true);
      if (path) {
        paths.push(path);
        for (const segIdx of loop) {
          usedSegments.add(segIdx);
        }
      }
    }
  }

  // Emit remaining segments as individual open paths
  for (let i = 0; i < network.segments.length; i++) {
    if (usedSegments.has(i)) continue;
    const path = segmentToPath(network, i);
    if (path) paths.push(path);
  }

  return paths;
}

function isStraight(p: Point): boolean {
  return p.x === 0 && p.y === 0;
}

/**
 * Convert a loop (sequence of segment indices) into a single closed PathValue.
 * Segments in a loop form a chain: seg[i].end connects to seg[i+1].start,
 * but segments may need to be traversed in reverse.
 */
function loopToPath(network: VectorNetwork, loop: number[], closed: boolean): PathValue | undefined {
  if (loop.length === 0) return undefined;

  const commands: PathCommand[] = [];

  // Walk the chain, figuring out segment direction
  let prevEnd = -1;

  for (let i = 0; i < loop.length; i++) {
    const seg = network.segments[loop[i]];

    // Determine traversal direction
    let startIdx: number;
    let endIdx: number;
    let tStart: Point;
    let tEnd: Point;

    if (i === 0) {
      // First segment: pick forward direction, or check next segment to decide
      if (loop.length > 1) {
        const nextSeg = network.segments[loop[1]];
        // If seg.end connects to next segment's start or end, go forward
        if (seg.end === nextSeg.start || seg.end === nextSeg.end) {
          startIdx = seg.start;
          endIdx = seg.end;
          tStart = seg.tangentStart;
          tEnd = seg.tangentEnd;
        } else {
          startIdx = seg.end;
          endIdx = seg.start;
          tStart = seg.tangentEnd;
          tEnd = seg.tangentStart;
        }
      } else {
        startIdx = seg.start;
        endIdx = seg.end;
        tStart = seg.tangentStart;
        tEnd = seg.tangentEnd;
      }
    } else if (prevEnd === seg.start) {
      startIdx = seg.start;
      endIdx = seg.end;
      tStart = seg.tangentStart;
      tEnd = seg.tangentEnd;
    } else {
      // Reversed traversal
      startIdx = seg.end;
      endIdx = seg.start;
      tStart = seg.tangentEnd;
      tEnd = seg.tangentStart;
    }

    const startVtx = network.vertices[startIdx];
    const endVtx = network.vertices[endIdx];

    // Emit M for first segment
    if (i === 0) {
      commands.push({ type: PathCmd.Move, x: startVtx.x, y: startVtx.y });
    }

    // Emit segment command
    if (isStraight(tStart) && isStraight(tEnd)) {
      commands.push({ type: PathCmd.Line, x: endVtx.x, y: endVtx.y });
    } else {
      // Cubic bezier: absolute control points from relative tangent handles
      const cx1 = startVtx.x + tStart.x;
      const cy1 = startVtx.y + tStart.y;
      const cx2 = endVtx.x + tEnd.x;
      const cy2 = endVtx.y + tEnd.y;
      commands.push({
        type: PathCmd.Cubic,
        cx1,
        cy1,
        cx2,
        cy2,
        x: endVtx.x,
        y: endVtx.y,
      });
    }

    prevEnd = endIdx;
  }

  if (closed) {
    commands.push({ type: PathCmd.Close });
  }

  return {
    commands: encodeCommands(commands),
    closed,
  };
}

/** Convert a single unattached segment to an open path. */
function segmentToPath(network: VectorNetwork, segIdx: number): PathValue {
  const seg = network.segments[segIdx];
  const startVtx = network.vertices[seg.start];
  const endVtx = network.vertices[seg.end];

  const commands: PathCommand[] = [{ type: PathCmd.Move, x: startVtx.x, y: startVtx.y }];

  if (isStraight(seg.tangentStart) && isStraight(seg.tangentEnd)) {
    commands.push({ type: PathCmd.Line, x: endVtx.x, y: endVtx.y });
  } else {
    commands.push({
      type: PathCmd.Cubic,
      cx1: startVtx.x + seg.tangentStart.x,
      cy1: startVtx.y + seg.tangentStart.y,
      cx2: endVtx.x + seg.tangentEnd.x,
      cy2: endVtx.y + seg.tangentEnd.y,
      x: endVtx.x,
      y: endVtx.y,
    });
  }

  return {
    commands: encodeCommands(commands),
    closed: false,
  };
}
