/**
 * @file Real PathOps backend wiring (HYP-509 / GAP-1)
 *
 * Accessed via: bun test packages/vector-cli/test/real-backend.test.ts
 * Assumptions: CanvasKit WASM loads in this environment (verified in
 *   packages/vector-wasm canvaskit-pathops.test.ts). These tests fail loud if
 *   it does not — a skipped test would be a false green for the wiring this
 *   ticket fixes.
 *
 * The mock backend's boolean() is a naive concat: union of two overlapping
 * paths yields two separate subpaths (two `M` commands) and never contains the
 * edge-intersection vertices that a real union boundary passes through. The real
 * CanvasKit backend merges them into a single contour (one `M`). These tests
 * assert the geometry the mock provably cannot produce, proving the real backend
 * actually runs through the CLI surface (runBatch).
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { CanvasKitPathOps, initCanvasKit, OffsetPathOps, type PathOpsBackend } from 'vector-wasm';
import { runBatch } from '../src/batch';

/** Count `M` (moveTo) subpath starts in an SVG path `d` attribute. */
function countSubpaths(svg: string): number {
  const match = svg.match(/ d="([^"]*)"/);
  if (!match) return 0;
  return (match[1].match(/M/g) ?? []).length;
}

describe('real PathOps backend wired into CLI (HYP-509 / GAP-1)', () => {
  let backend: PathOpsBackend;

  beforeAll(async () => {
    // Fail loud, not skip, if WASM cannot load — a false green hides the bug.
    const ck = await initCanvasKit();
    backend = new OffsetPathOps(new CanvasKitPathOps(ck));
  }, 15_000);

  it('union of two overlapping paths merges into a single contour', () => {
    const out = runBatch({
      expression:
        'union(path("M0 0 L60 0 L60 60 L0 60 Z"), path("M40 40 L100 40 L100 100 L40 100 Z")).fill("#f00").svg()',
      pathOps: backend,
    });
    // Mock concat → 2 subpaths. Real union → 1 merged contour.
    expect(countSubpaths(out)).toBe(1);
  });

  it('union boundary passes through an edge-intersection vertex absent from both inputs', () => {
    const out = runBatch({
      expression:
        'union(path("M0 0 L60 0 L60 60 L0 60 Z"), path("M40 40 L100 40 L100 100 L40 100 Z")).fill("#f00").svg()',
      pathOps: backend,
    });
    const d = out.match(/ d="([^"]*)"/)?.[1] ?? '';
    // The two paths occupy [0..60]² and [40..100]². Their union outline turns at
    // the reflex corners (60,40) and (40,60) — points present in NEITHER input
    // path's vertices, so the mock's concat can never contain them.
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const has = (x: number, y: number) =>
      nums.some((_, i) => i + 1 < nums.length && nums[i] === x && nums[i + 1] === y);
    expect(has(60, 40) && has(40, 60)).toBe(true);
  });

  it('mock backend (default) still concats — keeps the contrast explicit', () => {
    const out = runBatch({
      expression:
        'union(path("M0 0 L60 0 L60 60 L0 60 Z"), path("M40 40 L100 40 L100 100 L40 100 Z")).fill("#f00").svg()',
    });
    // Default (no pathOps) = MockPathOps = naive concat = 2 subpaths.
    expect(countSubpaths(out)).toBe(2);
  });
});
