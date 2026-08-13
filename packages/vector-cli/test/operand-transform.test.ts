/**
 * @file Operand transform baking for boolean / clip ops (HYP-519)
 *
 * Accessed via: bun test packages/vector-cli/test/operand-transform.test.ts
 * Assumptions: CanvasKit WASM loads in this environment (see real-backend.test.ts).
 *   These tests fail loud, not skip, if it does not.
 *
 * Bug (latent under MockPathOps, real with CanvasKit, #355): boolean / clip nodes
 * combined the operands' RAW paths, ignoring each operand's accumulated scene
 * transform (translate/rotate/scale). So `union(a, b.translate(dx,dy))` combined the
 * UNtransformed b. These tests drive the real backend through the CLI surface
 * (runBatch → executor → graph) and assert geometry that only the baked-transform
 * result can produce: a translated operand actually moves before the op runs.
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { CanvasKitPathOps, initCanvasKit, OffsetPathOps, type PathOpsBackend } from 'vector-wasm';
import { runBatch } from '../src/batch';
import { createContext } from '../src/context';
import { createGlobals } from '../src/globals';

/** Extract the numeric coordinates from the first SVG path `d` attribute. */
function pathCoords(svg: string): number[] {
  const d = svg.match(/ d="([^"]*)"/)?.[1] ?? '';
  return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Whether the path passes through the vertex (x, y). */
function hasVertex(coords: number[], x: number, y: number): boolean {
  for (let i = 0; i + 1 < coords.length; i++) {
    if (coords[i] === x && coords[i + 1] === y) return true;
  }
  return false;
}

describe('boolean operand transform baking (HYP-519)', () => {
  let backend: PathOpsBackend;

  beforeAll(async () => {
    const ck = await initCanvasKit();
    backend = new OffsetPathOps(new CanvasKitPathOps(ck));
  }, 15_000);

  // rectA occupies [0,60]². rectB is the SAME unit rect translated by (40,40),
  // so its baked extent is [40,100]². Their union is an L-shaped contour whose
  // outline turns at the reflex corners (60,40) and (40,60) and reaches (100,100).
  // If the operand transform is NOT baked, b stays at [0,60]² — coincident with a
  // — and the union is just the [0,60]² square: no reflex corners, max coord 60.
  const overlapUnion = () =>
    runBatch({
      expression:
        'union(path("M0 0 L60 0 L60 60 L0 60 Z"), path("M0 0 L60 0 L60 60 L0 60 Z").translate(40, 40)).fill("#f00").svg()',
      pathOps: backend,
    });

  it('translated operand reaches its post-transform extent (100,100)', () => {
    const coords = pathCoords(overlapUnion());
    // Unbaked: b coincident with a → max coord 60. Baked: b at [40,100]² → 100.
    expect(Math.max(...coords)).toBe(100);
  });

  it('union outline turns at reflex corners only the translated overlap produces', () => {
    const coords = pathCoords(overlapUnion());
    // (60,40) and (40,60) are the reflex corners of the L-shaped union of
    // [0,60]² and [40,100]². They exist in NEITHER input rect's vertices and only
    // appear when b is actually translated before the union runs.
    expect(hasVertex(coords, 60, 40)).toBe(true);
    expect(hasVertex(coords, 40, 60)).toBe(true);
  });

  it('re-evaluating after the operand transform changes does not return stale geometry', () => {
    // The operand transform rides in the node's cache fingerprint, so changing the
    // translate on a SHARED executor must re-run the union (guards the TUI case
    // where the same executor is reused across edits).
    const ctx = createContext(undefined, undefined, backend);
    const g = createGlobals(ctx);
    const a = g.rect(60, 60);
    const b = g.rect(60, 60).translate(40, 40);
    const u = g.union(a, b);
    expect(Math.max(...pathCoords(u.svg()))).toBe(100);
    // Move b further out; the union must follow.
    ctx.graph.setParam(b.nodeId, 'dx', 140);
    ctx.graph.setParam(b.nodeId, 'dy', 140);
    ctx.executor.invalidate(b.nodeId);
    expect(Math.max(...pathCoords(u.svg()))).toBe(200);
  });
});

describe('clip operand transform baking (HYP-519)', () => {
  let backend: PathOpsBackend;

  beforeAll(async () => {
    const ck = await initCanvasKit();
    backend = new OffsetPathOps(new CanvasKitPathOps(ck));
  }, 15_000);

  it('clip mask is baked at its translated position, not its raw position', () => {
    // Content is a full [0,100]² square at identity. The mask is a [0,60]² square
    // translated by (40,40) → baked [40,100]². The emitted <clipPath> must reflect
    // the TRANSLATED mask (max coord 100), not the raw [0,60]² (max coord 60).
    const out = runBatch({
      expression:
        'clip(path("M0 0 L100 0 L100 100 L0 100 Z"), path("M0 0 L60 0 L60 60 L0 60 Z").translate(40, 40)).fill("#0f0").svg()',
      pathOps: backend,
    });
    const clipMatch = out.match(/<clipPath[^>]*>\s*<path d="([^"]*)"/);
    const d = clipMatch?.[1] ?? '';
    const coords = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    expect(coords.length).toBeGreaterThan(0);
    // Unbaked mask: [0,60]² → max 60. Baked mask: [40,100]² → max 100.
    expect(Math.max(...coords)).toBe(100);
  });
});
