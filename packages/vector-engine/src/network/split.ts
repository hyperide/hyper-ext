/**
 * @file Split segment intersections — resolve crossings for topology solver
 *
 * Accessed via: findRegions() prerequisite — must be called before topology solver
 *   on "dirty" networks (imported SVGs, boolean results)
 * Assumptions: segments use relative tangent handles. After splitting, original
 *   segments are replaced with sub-segments with correctly computed tangent handles.
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Vector Networks §Split
 */

import {
  type IntersectionHit,
  intersectCubicCubic,
  intersectLineCubic,
  intersectLineLine,
  splitCubicAt,
} from '../curve/intersect-bezier';
import type { Point } from '../types';
import type { VectorNetwork, VectorSegment, VectorVertex } from './types';

/** Threshold for treating t values at endpoints as "at the vertex" (skip splitting) */
const T_ENDPOINT_EPSILON = 1e-6;

/**
 * Find and split all segment intersections in a vector network.
 *
 * For each pair of segments that cross (and don't share a vertex),
 * inserts a new vertex at the intersection point and splits both
 * segments into sub-segments with correct tangent handles.
 */
export function splitIntersections(network: VectorNetwork): VectorNetwork {
  if (network.segments.length < 2) {
    return { ...network };
  }

  const vertices: VectorVertex[] = network.vertices.map((v) => ({ ...v }));
  let segments: VectorSegment[] = network.segments.map((s) => ({
    start: s.start,
    end: s.end,
    tangentStart: { ...s.tangentStart },
    tangentEnd: { ...s.tangentEnd },
  }));

  // Iterate until no more intersections are found (splitting may create new pairs)
  let changed = true;
  while (changed) {
    changed = false;
    const splits = findAllIntersections(vertices, segments);
    if (splits.length === 0) break;

    changed = true;
    // Group splits by segment index, sort by t descending (split from end to avoid index shifting)
    const splitsBySegment = groupSplitsBySegment(splits);
    const replacements = applySplits(vertices, segments, splitsBySegment);
    segments = replacements;
  }

  return { vertices, segments, regions: [] };
}

interface SegmentSplit {
  segIdx: number;
  t: number;
  vertexIdx: number; // index into vertices array (shared between both segments of a pair)
}

/**
 * Find all pairwise intersections between segments.
 * Creates shared vertices for intersection points upfront so both
 * segments in a crossing pair reference the same vertex.
 */
function findAllIntersections(vertices: VectorVertex[], segments: VectorSegment[]): SegmentSplit[] {
  const splits: SegmentSplit[] = [];

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const si = segments[i];
      const sj = segments[j];

      // Skip if segments share a vertex
      if (si.start === sj.start || si.start === sj.end || si.end === sj.start || si.end === sj.end) {
        continue;
      }

      const hits = intersectSegmentPair(vertices, si, sj);
      for (const hit of hits) {
        // Skip hits at endpoints
        if (hit.t1 < T_ENDPOINT_EPSILON || hit.t1 > 1 - T_ENDPOINT_EPSILON) continue;
        if (hit.t2 < T_ENDPOINT_EPSILON || hit.t2 > 1 - T_ENDPOINT_EPSILON) continue;

        // Create a single shared vertex for this intersection point
        vertices.push({ x: hit.point.x, y: hit.point.y });
        const vIdx = vertices.length - 1;

        splits.push({ segIdx: i, t: hit.t1, vertexIdx: vIdx });
        splits.push({ segIdx: j, t: hit.t2, vertexIdx: vIdx });
      }
    }
  }

  return splits;
}

function isLine(seg: VectorSegment): boolean {
  return seg.tangentStart.x === 0 && seg.tangentStart.y === 0 && seg.tangentEnd.x === 0 && seg.tangentEnd.y === 0;
}

/** Get absolute cubic control points from a segment with relative tangent handles. */
function segmentToAbsolute(
  vertices: VectorVertex[],
  seg: VectorSegment,
): { p0: Point; p1: Point; p2: Point; p3: Point } {
  const p0: Point = { x: vertices[seg.start].x, y: vertices[seg.start].y };
  const p3: Point = { x: vertices[seg.end].x, y: vertices[seg.end].y };
  const p1: Point = { x: p0.x + seg.tangentStart.x, y: p0.y + seg.tangentStart.y };
  const p2: Point = { x: p3.x + seg.tangentEnd.x, y: p3.y + seg.tangentEnd.y };
  return { p0, p1, p2, p3 };
}

function intersectSegmentPair(vertices: VectorVertex[], si: VectorSegment, sj: VectorSegment): IntersectionHit[] {
  const iIsLine = isLine(si);
  const jIsLine = isLine(sj);

  if (iIsLine && jIsLine) {
    return intersectLineLine(vertices[si.start], vertices[si.end], vertices[sj.start], vertices[sj.end]);
  }

  if (iIsLine && !jIsLine) {
    const { p0, p1, p2, p3 } = segmentToAbsolute(vertices, sj);
    return intersectLineCubic(vertices[si.start], vertices[si.end], p0, p1, p2, p3);
  }

  if (!iIsLine && jIsLine) {
    const { p0, p1, p2, p3 } = segmentToAbsolute(vertices, si);
    const hits = intersectLineCubic(vertices[sj.start], vertices[sj.end], p0, p1, p2, p3);
    // Swap t1/t2 since we passed the line as first arg for lineCubic
    return hits.map((h) => ({ point: h.point, t1: h.t2, t2: h.t1 }));
  }

  // Both cubics
  const a = segmentToAbsolute(vertices, si);
  const b = segmentToAbsolute(vertices, sj);
  return intersectCubicCubic(a.p0, a.p1, a.p2, a.p3, b.p0, b.p1, b.p2, b.p3);
}

/** Group splits by segment index, sorted by t within each group. */
function groupSplitsBySegment(splits: SegmentSplit[]): Map<number, SegmentSplit[]> {
  const map = new Map<number, SegmentSplit[]>();
  for (const split of splits) {
    let group = map.get(split.segIdx);
    if (!group) {
      group = [];
      map.set(split.segIdx, group);
    }
    group.push(split);
  }
  // Sort each group by t ascending
  for (const group of map.values()) {
    group.sort((a, b) => a.t - b.t);
  }
  return map;
}

/**
 * Apply all splits and produce a new segments array.
 * For each segment that has splits, replace it with sub-segments.
 */
function applySplits(
  vertices: VectorVertex[],
  segments: VectorSegment[],
  splitsBySegment: Map<number, SegmentSplit[]>,
): VectorSegment[] {
  const newSegments: VectorSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const splits = splitsBySegment.get(i);
    if (!splits || splits.length === 0) {
      newSegments.push(segments[i]);
      continue;
    }

    const seg = segments[i];
    const segIsLine = isLine(seg);

    if (segIsLine) {
      splitLineSegment(seg, splits, newSegments);
    } else {
      splitCubicSegment(vertices, seg, splits, newSegments);
    }
  }

  return newSegments;
}

/** Split a line segment at intersection points. Vertices are already created. */
function splitLineSegment(seg: VectorSegment, splits: SegmentSplit[], out: VectorSegment[]): void {
  const ZERO: Point = { x: 0, y: 0 };

  // Build chain: start -> split0 -> split1 -> ... -> end
  let prevIdx = seg.start;
  for (const split of splits) {
    out.push({ start: prevIdx, end: split.vertexIdx, tangentStart: { ...ZERO }, tangentEnd: { ...ZERO } });
    prevIdx = split.vertexIdx;
  }
  out.push({ start: prevIdx, end: seg.end, tangentStart: { ...ZERO }, tangentEnd: { ...ZERO } });
}

/** Split a cubic segment at intersection points using de Casteljau. Vertices are already created. */
function splitCubicSegment(
  vertices: VectorVertex[],
  seg: VectorSegment,
  splits: SegmentSplit[],
  out: VectorSegment[],
): void {
  const { p0, p1, p2, p3 } = segmentToAbsolute(vertices, seg);

  // Progressively split: for each t, split the remaining curve
  // Remap t values as we split off pieces from the left
  let currentP0 = p0;
  let currentP1 = p1;
  let currentP2 = p2;
  let currentP3 = p3;
  let prevVertexIdx = seg.start;
  let consumedT = 0;

  for (const split of splits) {
    // Remap global t into the remaining curve's parameter space
    const localT = (split.t - consumedT) / (1 - consumedT);
    const clamped = Math.max(0, Math.min(1, localT));

    const { left, right } = splitCubicAt(currentP0, currentP1, currentP2, currentP3, clamped);

    // Left half becomes a segment: prevVertexIdx -> split.vertexIdx
    out.push({
      start: prevVertexIdx,
      end: split.vertexIdx,
      tangentStart: { x: left[1].x - left[0].x, y: left[1].y - left[0].y },
      tangentEnd: { x: left[2].x - left[3].x, y: left[2].y - left[3].y },
    });

    // Continue with the right half
    currentP0 = right[0];
    currentP1 = right[1];
    currentP2 = right[2];
    currentP3 = right[3];
    prevVertexIdx = split.vertexIdx;
    consumedT = split.t;
  }

  // Final piece: prevVertexIdx -> seg.end
  out.push({
    start: prevVertexIdx,
    end: seg.end,
    tangentStart: { x: currentP1.x - currentP0.x, y: currentP1.y - currentP0.y },
    tangentEnd: { x: currentP2.x - currentP3.x, y: currentP2.y - currentP3.y },
  });
}
