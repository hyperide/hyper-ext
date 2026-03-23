/**
 * @file Semantic diff — match SVG shapes to graph terminal outputs by geometry
 *
 * Accessed via: Reverse sync pipeline — when TSX file changes externally
 * Assumptions: shapes are matched by path data hash (FNV-1a of Float64Array).
 *   Position/size matching is fallback when path data differs.
 * Tradeoffs: O(n*m) matching for n current x m incoming shapes. Fine for
 *   typical SVG files (<100 shapes). Large files may need spatial indexing.
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Reverse Sync
 */

import { computeBounds } from '../path/bounds';
import type { BoundingBox, PathValue, SceneItem, StyleValue } from '../types';

export interface SemanticMatch {
  currentId: string;
  incomingItem: SceneItem;
  styleChanged: boolean;
  geometryChanged: boolean;
}

export interface SemanticDiff {
  matched: SemanticMatch[];
  added: SceneItem[];
  removed: SceneItem[];
  ambiguous: boolean;
}

/** FNV-1a 32-bit hash of a Float64Array's raw bytes. */
function pathHash(path: PathValue): number {
  let h = 0x811c9dc5;
  const view = new Uint8Array(path.commands.buffer, path.commands.byteOffset, path.commands.byteLength);
  for (let i = 0; i < view.length; i++) {
    h ^= view[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function stylesEqual(a: StyleValue, b: StyleValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function getBounds(path: PathValue): BoundingBox {
  if (path.bounds) return path.bounds;
  return computeBounds(path.commands);
}

/** Compute intersection area of two axis-aligned bounding boxes. */
function intersectionArea(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

function boxArea(b: BoundingBox): number {
  return b.width * b.height;
}

/**
 * Compute semantic diff between current scene items and incoming scene items.
 *
 * Pass 1: exact path hash match.
 * Pass 2: bounding box similarity for unmatched shapes (overlap > 70%, area ratio < 2x).
 */
export function computeSemanticDiff(current: SceneItem[], incoming: SceneItem[]): SemanticDiff {
  const matched: SemanticMatch[] = [];
  const usedCurrent = new Set<number>();
  const usedIncoming = new Set<number>();

  // Pre-compute hashes
  const currentHashes = current.map((item) => pathHash(item.path));
  const incomingHashes = incoming.map((item) => pathHash(item.path));

  // Pass 1: exact path hash match
  for (let i = 0; i < incoming.length; i++) {
    if (usedIncoming.has(i)) continue;
    for (let c = 0; c < current.length; c++) {
      if (usedCurrent.has(c)) continue;
      if (incomingHashes[i] === currentHashes[c]) {
        usedCurrent.add(c);
        usedIncoming.add(i);
        matched.push({
          currentId: current[c].id,
          incomingItem: incoming[i],
          styleChanged: !stylesEqual(current[c].style, incoming[i].style),
          geometryChanged: false,
        });
        break;
      }
    }
  }

  // Pass 2: bounding box similarity for unmatched shapes
  for (let i = 0; i < incoming.length; i++) {
    if (usedIncoming.has(i)) continue;
    const inBounds = getBounds(incoming[i].path);
    const inArea = boxArea(inBounds);

    let bestIdx = -1;
    let bestOverlap = 0;

    for (let c = 0; c < current.length; c++) {
      if (usedCurrent.has(c)) continue;
      const curBounds = getBounds(current[c].path);
      const curArea = boxArea(curBounds);

      // Zero-area shapes can't be meaningfully compared by overlap
      if (inArea === 0 || curArea === 0) continue;

      const areaRatio = Math.max(inArea, curArea) / Math.min(inArea, curArea);
      if (areaRatio >= 2) continue;

      const overlap = intersectionArea(inBounds, curBounds);
      const overlapRatio = overlap / Math.min(inArea, curArea);
      if (overlapRatio > 0.7 && overlapRatio > bestOverlap) {
        bestOverlap = overlapRatio;
        bestIdx = c;
      }
    }

    if (bestIdx >= 0) {
      usedCurrent.add(bestIdx);
      usedIncoming.add(i);
      matched.push({
        currentId: current[bestIdx].id,
        incomingItem: incoming[i],
        styleChanged: !stylesEqual(current[bestIdx].style, incoming[i].style),
        geometryChanged: true,
      });
    }
  }

  // Collect unmatched
  const added: SceneItem[] = [];
  for (let i = 0; i < incoming.length; i++) {
    if (!usedIncoming.has(i)) added.push(incoming[i]);
  }
  const removed: SceneItem[] = [];
  for (let c = 0; c < current.length; c++) {
    if (!usedCurrent.has(c)) removed.push(current[c]);
  }

  // Ambiguous when matched count < 50% of max(current.length, incoming.length)
  const maxLen = Math.max(current.length, incoming.length);
  const ambiguous = maxLen > 0 && matched.length < maxLen * 0.5;

  return { matched, added, removed, ambiguous };
}
