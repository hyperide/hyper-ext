/**
 * @file Minimal Cycle Basis topology solver for vector networks
 *
 * Accessed via: Pen tool interactions — auto-detects fillable regions after segment edits
 * Assumptions: all segment intersections have been resolved to vertices before calling.
 *   splitIntersections() is needed for production use (deferred to Plan 2b).
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Topology Solver
 */

import type { VectorNetwork, VectorRegion } from './types';

/** Half-edge in the planar graph: directed edge from `from` to `to`. */
interface HalfEdge {
  from: number;
  to: number;
  segmentIdx: number;
  /** Outgoing angle from `from` toward `to`, in radians [-PI, PI]. */
  angle: number;
}

/**
 * Find all minimal fillable regions in a planar vector network.
 *
 * Uses the planar face traversal algorithm:
 * 1. Build a half-edge structure with angular sorting at each vertex
 * 2. For each unused half-edge, trace the face to the left (next = most-CW turn)
 * 3. Discard the unbounded outer face (largest absolute area)
 */
export function findRegions(network: VectorNetwork): VectorRegion[] {
  if (network.segments.length === 0) return [];

  // Build half-edges
  const halfEdges = buildHalfEdges(network);
  if (halfEdges.length === 0) return [];

  // Build adjacency: for each vertex, sorted outgoing half-edges by angle
  const adjacency = buildAdjacency(halfEdges, network.vertices.length);

  // Remove filaments (degree-1 vertices, recursively) from the adjacency
  removeFilaments(adjacency);

  // Build the "next" map: for half-edge (u->v), the next half-edge in the face
  // is the one leaving v that comes just after the reverse of (u->v) in CW order.
  const nextMap = buildNextMap(halfEdges, adjacency);

  // Trace all faces
  const used = new Set<string>();
  const faces: number[][] = []; // each face is a list of segment indices

  for (const he of halfEdges) {
    const key = halfEdgeKey(he);
    if (used.has(key)) continue;
    // Skip edges removed during filament pruning
    if (!adjacency[he.from]?.some((e) => e.to === he.to && e.segmentIdx === he.segmentIdx)) {
      continue;
    }

    const face = traceFace(he, nextMap, used);
    if (face) faces.push(face);
  }

  if (faces.length === 0) return [];

  // Compute signed areas to identify the outer face
  const areas = faces.map((face) => computeFaceArea(face, network));
  let outerIdx = 0;
  let maxAbsArea = 0;
  for (let i = 0; i < areas.length; i++) {
    const abs = Math.abs(areas[i]);
    if (abs > maxAbsArea) {
      maxAbsArea = abs;
      outerIdx = i;
    }
  }

  // Convert interior faces to regions (skip the outer face)
  const regions: VectorRegion[] = [];
  for (let i = 0; i < faces.length; i++) {
    if (i === outerIdx) continue;
    // Deduplicate segment indices within a face
    const segIndices = [...new Set(faces[i])];
    regions.push({
      windingRule: 'nonZero',
      loops: [segIndices],
      fills: [],
    });
  }

  return regions;
}

function halfEdgeKey(he: HalfEdge): string {
  return `${he.from}->${he.to}:${he.segmentIdx}`;
}

function buildHalfEdges(network: VectorNetwork): HalfEdge[] {
  const edges: HalfEdge[] = [];

  for (let i = 0; i < network.segments.length; i++) {
    const seg = network.segments[i];
    const vStart = network.vertices[seg.start];
    const vEnd = network.vertices[seg.end];

    // Forward half-edge: start -> end
    const angleForward = Math.atan2(vEnd.y - vStart.y, vEnd.x - vStart.x);
    edges.push({ from: seg.start, to: seg.end, segmentIdx: i, angle: angleForward });

    // Reverse half-edge: end -> start
    const angleReverse = Math.atan2(vStart.y - vEnd.y, vStart.x - vEnd.x);
    edges.push({ from: seg.end, to: seg.start, segmentIdx: i, angle: angleReverse });
  }

  return edges;
}

/** Build adjacency lists sorted by angle (CW order = descending angle). */
function buildAdjacency(halfEdges: HalfEdge[], vertexCount: number): HalfEdge[][] {
  const adj: HalfEdge[][] = Array.from({ length: vertexCount }, () => []);

  for (const he of halfEdges) {
    adj[he.from].push(he);
  }

  // Sort each vertex's edges by angle (ascending = CCW)
  for (const list of adj) {
    list.sort((a, b) => a.angle - b.angle);
  }

  return adj;
}

/** Recursively remove vertices with degree <= 1 (filaments / dangling edges). */
function removeFilaments(adjacency: HalfEdge[][]): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let v = 0; v < adjacency.length; v++) {
      if (adjacency[v].length === 1) {
        const he = adjacency[v][0];
        // Remove the edge from both ends
        adjacency[v] = [];
        adjacency[he.to] = adjacency[he.to].filter((e) => !(e.to === v && e.segmentIdx === he.segmentIdx));
        changed = true;
      }
    }
  }
}

/**
 * Build the "next half-edge" map for face traversal.
 *
 * For half-edge u->v, the next half-edge in the left face is determined by:
 * - Find the reverse edge v->u in v's adjacency list
 * - The next half-edge is the one just BEFORE v->u in v's sorted list
 *   (i.e. the most CW turn from the incoming direction)
 *
 * This follows the standard planar subdivision face traversal.
 */
function buildNextMap(halfEdges: HalfEdge[], adjacency: HalfEdge[][]): Map<string, HalfEdge> {
  const nextMap = new Map<string, HalfEdge>();

  for (const he of halfEdges) {
    const vAdj = adjacency[he.to];
    if (vAdj.length === 0) continue;

    // Find the reverse edge (v -> u with same segment) in v's adjacency
    const reverseIdx = vAdj.findIndex((e) => e.to === he.from && e.segmentIdx === he.segmentIdx);
    if (reverseIdx === -1) continue;

    // Next in face = the edge just before the reverse in the sorted list (wrapping)
    // "Before" in ascending-angle order = the previous index
    const prevIdx = (reverseIdx - 1 + vAdj.length) % vAdj.length;
    nextMap.set(halfEdgeKey(he), vAdj[prevIdx]);
  }

  return nextMap;
}

/** Trace a face starting from the given half-edge. Returns segment indices. */
function traceFace(start: HalfEdge, nextMap: Map<string, HalfEdge>, used: Set<string>): number[] | undefined {
  const segmentIndices: number[] = [];
  let current = start;
  const limit = nextMap.size + 1; // safety limit

  for (let i = 0; i < limit; i++) {
    const key = halfEdgeKey(current);
    if (used.has(key)) {
      // If we've already used this edge, we've gone in a circle that was already traced
      if (current === start && segmentIndices.length > 0) break;
      return undefined;
    }
    used.add(key);
    segmentIndices.push(current.segmentIdx);

    const next = nextMap.get(key);
    if (!next) return undefined;

    if (next.from === start.from && next.to === start.to && next.segmentIdx === start.segmentIdx) {
      // Back to start
      break;
    }

    current = next;
  }

  return segmentIndices.length >= 3 ? segmentIndices : undefined;
}

/**
 * Compute signed area of a face (list of segment indices).
 * Uses the shoelace formula on the face vertex loop.
 * Positive area = CCW (interior face in screen coords), negative = CW (outer face).
 */
function computeFaceArea(segmentIndices: number[], network: VectorNetwork): number {
  // Reconstruct vertex sequence from segment chain
  const vertexLoop = segmentsToVertexLoop(segmentIndices, network);
  if (vertexLoop.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < vertexLoop.length; i++) {
    const curr = network.vertices[vertexLoop[i]];
    const next = network.vertices[vertexLoop[(i + 1) % vertexLoop.length]];
    area += curr.x * next.y - next.x * curr.y;
  }

  return area / 2;
}

/**
 * Convert a chain of segment indices into an ordered list of vertex indices.
 * Handles segments that may need to be traversed in either direction.
 */
function segmentsToVertexLoop(segmentIndices: number[], network: VectorNetwork): number[] {
  if (segmentIndices.length === 0) return [];

  const vertices: number[] = [];
  let prevEnd = -1;

  for (let i = 0; i < segmentIndices.length; i++) {
    const seg = network.segments[segmentIndices[i]];

    let startIdx: number;
    let endIdx: number;

    if (i === 0) {
      // For the first segment, check next to determine direction
      if (segmentIndices.length > 1) {
        const nextSeg = network.segments[segmentIndices[1]];
        if (seg.end === nextSeg.start || seg.end === nextSeg.end) {
          startIdx = seg.start;
          endIdx = seg.end;
        } else {
          startIdx = seg.end;
          endIdx = seg.start;
        }
      } else {
        startIdx = seg.start;
        endIdx = seg.end;
      }
    } else if (prevEnd === seg.start) {
      startIdx = seg.start;
      endIdx = seg.end;
    } else {
      startIdx = seg.end;
      endIdx = seg.start;
    }

    if (i === 0) vertices.push(startIdx);
    vertices.push(endIdx);
    prevEnd = endIdx;
  }

  return vertices;
}
