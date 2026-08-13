# Vector Engine Advanced Ops — Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add geometry queries, path operations, structural nodes, deformation effects,
variable stroke, text-to-path, gradient mesh, vector networks, and SVG import to the
vector engine SDK — all without UI, renderer, or HyperIDE integration.

**Architecture:** Extends the existing vector-engine package from Plan 1. New node types
follow the same `NodeTypeDefinition` pattern. Geometry queries are utility functions
(not graph nodes). WASM-backed ops use mock backend for tests (real CanvasKit deferred
to Plan 3). Vector networks add a new `NodeValue` variant (`network`) with a topology
solver for automatic region detection.

**Tech Stack:** TypeScript, bun:test, graphology, fit-curve, opentype.js, txml (SVG parser)

**Spec:** `docs/specs/2026-03-13-vector-engine-design.md`

**Scope:** This is Plan 2 of ~4:

- Plan 1 (done): Core SDK — types, graph, executor, 23 nodes, SVG export, undo/redo
- **Plan 2 (this):** Advanced ops — geometry, path ops, deformations, variable stroke,
  groups, text, gradient mesh, vector networks, SVG import
- Plan 3: Renderer (CanvasKit, hit testing, viewport)
- Plan 4: Editor UI + HyperIDE integration (tools, panels, toolbar, MCP tools)

**Known bugs from Plan 1** (fixed in Chunk 1):

- HYP-311: VectorGraphModel rejects valid parallel edges (`multi=false`)
- HYP-310: `computeBounds` arc extents underestimate sweep geometry

---

## File Structure

```
packages/
├── vector-engine/
│   └── src/
│       ├── types.ts                              # MODIFY: add NodeValue variants (network, mesh, points)
│       ├── index.ts                              # MODIFY: export new modules
│       ├── path/
│       │   ├── commands.ts                       # (existing)
│       │   ├── builder.ts                        # (existing)
│       │   ├── bounds.ts                         # MODIFY: proper arc bounds
│       │   ├── flatten.ts                        # CREATE: adaptive polyline approximation
│       │   ├── flatten.test.ts                   # CREATE
│       │   ├── geometry.ts                       # CREATE: length, pointAt, tangent, normal, area
│       │   ├── geometry.test.ts                  # CREATE
│       │   ├── merge.ts                          # CREATE: merge/split compound paths
│       │   └── merge.test.ts                     # CREATE
│       ├── curve/
│       │   ├── fit.ts                            # CREATE: fit-curve wrapper
│       │   └── fit.test.ts                       # CREATE
│       ├── graph/
│       │   ├── vector-graph.ts                   # MODIFY: multi=true
│       │   ├── vector-graph.test.ts              # MODIFY: parallel edge tests
│       │   ├── executor.ts                       # MODIFY: mute type-check, group terminal handling
│       │   ├── executor.test.ts                  # MODIFY: mute semantics tests
│       │   ├── scene-builder.ts                  # MODIFY: SceneGroup building
│       │   └── scene-builder.test.ts             # MODIFY: group scene tests
│       ├── nodes/
│       │   ├── register-all.ts                   # MODIFY: register new nodes
│       │   ├── generators/
│       │   │   └── svg-path.ts                   # CREATE: raw d-attribute generator
│       │   ├── path-ops/
│       │   │   ├── basic-ops.ts                  # (existing)
│       │   │   ├── round-corners.ts              # CREATE
│       │   │   ├── chamfer.ts                    # CREATE
│       │   │   ├── smooth.ts                     # CREATE
│       │   │   ├── subdivide.ts                  # CREATE
│       │   │   ├── trim-path.ts                  # CREATE
│       │   │   ├── enforce-winding.ts            # CREATE
│       │   │   ├── offset.ts                     # CREATE (Clipper2 via backend)
│       │   │   ├── stroke-to-path.ts             # CREATE (CanvasKit via backend)
│       │   │   ├── dash-path.ts                  # CREATE (CanvasKit via backend)
│       │   │   ├── path-ops-advanced.test.ts     # CREATE
│       │   │   └── wasm-ops.test.ts              # CREATE
│       │   ├── deformation/
│       │   │   ├── roughen.ts                    # CREATE
│       │   │   ├── zigzag.ts                     # CREATE
│       │   │   ├── pucker-bloat.ts               # CREATE
│       │   │   ├── twist.ts                      # CREATE
│       │   │   ├── warp.ts                       # CREATE
│       │   │   └── deformation.test.ts           # CREATE
│       │   ├── style/
│       │   │   ├── shadow.ts                     # CREATE
│       │   │   ├── blur.ts                       # CREATE
│       │   │   └── style.test.ts                 # MODIFY: add shadow/blur tests
│       │   ├── structural/
│       │   │   ├── group.ts                      # CREATE
│       │   │   ├── alpha-mask.ts                 # CREATE
│       │   │   └── structural.test.ts            # CREATE
│       │   ├── stroke/
│       │   │   ├── variable-stroke.ts            # CREATE
│       │   │   └── variable-stroke.test.ts       # CREATE
│       │   └── text/
│       │       ├── text-to-path.ts               # CREATE
│       │       └── text.test.ts                  # CREATE
│       ├── mesh/
│       │   ├── types.ts                          # CREATE: MeshValue, MeshVertex, MeshHandle
│       │   ├── tessellate.ts                     # CREATE: bezier patch → triangles
│       │   ├── mesh-from-path.ts                 # CREATE: fit grid to path bounds
│       │   └── mesh.test.ts                      # CREATE
│       ├── network/
│       │   ├── types.ts                          # CREATE: VectorNetwork, VectorVertex, etc.
│       │   ├── topology.ts                       # CREATE: minimal cycle basis solver
│       │   ├── convert.ts                        # CREATE: network ↔ PathValue[]
│       │   └── network.test.ts                   # CREATE
│       ├── import/
│       │   ├── svg-import.ts                     # CREATE: SVG string → graph nodes (via txml)
│       │   └── svg-import.test.ts                # CREATE
│       └── integration-advanced.test.ts          # CREATE: end-to-end tests
│
└── vector-wasm/
    └── src/
        ├── types.ts                              # MODIFY: add offset, removeSelfIntersections
        └── mock-pathops.ts                       # MODIFY: add mock implementations
```

---

## Chunk 1: Bug Fixes & Foundation

### Task 1: Fix Parallel Edges (HYP-311)

VectorGraphModel uses `DirectedGraph` with `multi=false` (graphology default).
Two edges between the same nodes on different ports throw before cycle checking.

**Files:**

- Modify: `packages/vector-engine/src/graph/vector-graph.ts:41`
- Modify: `packages/vector-engine/src/graph/vector-graph.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// In vector-graph.test.ts
it("should allow parallel edges between same nodes on different ports", () => {
  const graph = VectorGraphModel.create("test", "Test", 100, 100);
  const a = graph.addNode({ type: "generator", params: {} });
  const b = graph.addNode({ type: "consumer", params: {} });

  const e1 = graph.addEdge(a, "path", b, "path");
  const e2 = graph.addEdge(a, "transform", b, "transform");

  expect(e1).toBeTruthy();
  expect(e2).toBeTruthy();
  expect(graph.edgeCount).toBe(2);
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
bun test packages/vector-engine/src/graph/vector-graph.test.ts
```

Expected: FAIL — graphology throws on second addDirectedEdge.

- [ ] **Step 3: Fix — enable multi-graph**

In `vector-graph.ts:41`, change:

```typescript
this.g = new DirectedGraph<NodeAttrs, EdgeAttrs>({ multi: true });
```

- [ ] **Step 4: Run test — verify it passes**

```bash
bun test packages/vector-engine/src/graph/vector-graph.test.ts
```

- [ ] **Step 5: Commit**

```
fix(vector-engine): allow parallel edges between same nodes (HYP-311)
```

---

### Task 2: Fix Arc Bounds (HYP-310)

`computeBounds` uses endpoint ± radii approximation for arcs. Proper implementation
requires SVG arc-to-center parameterization (spec §B.2.4) to find actual angular extent.

**Files:**

- Modify: `packages/vector-engine/src/path/bounds.ts`
- Modify: `packages/vector-engine/src/path/bounds.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// Arc sweeping 180° from (0,0) to (100,0) with radius 50.
// Control-point approx gives {x:-50, y:-50, w:200, h:100}
// Correct tight bounds: {x:0, y:-50, w:100, h:50}
it("should compute tight bounds for semicircular arc", () => {
  const cmds = encodeCommands([
    { type: PathCmd.Move, x: 0, y: 0 },
    { type: PathCmd.Arc, rx: 50, ry: 50, rotation: 0, largeArc: 0, sweep: 1, x: 100, y: 0 },
  ]);
  const bounds = computeBounds(cmds);
  expect(bounds.x).toBeCloseTo(0, 1);
  expect(bounds.y).toBeCloseTo(-50, 1);
  expect(bounds.width).toBeCloseTo(100, 1);
  expect(bounds.height).toBeCloseTo(50, 1);
});

it("should handle large-arc flag correctly", () => {
  // Large arc from (50,0) to (50,100) with rx=50, ry=50
  // Sweeps > 180° → covers more area
  const cmds = encodeCommands([
    { type: PathCmd.Move, x: 50, y: 0 },
    { type: PathCmd.Arc, rx: 50, ry: 50, rotation: 0, largeArc: 1, sweep: 1, x: 50, y: 100 },
  ]);
  const bounds = computeBounds(cmds);
  // Large arc goes around the left side, extending to x=0
  expect(bounds.x).toBeCloseTo(0, 0);
  expect(bounds.width).toBeGreaterThanOrEqual(50);
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement arc-to-center parameterization**

Replace the Arc case in `computeBounds` with proper SVG endpoint-to-center conversion:
compute center, start/end angles, then check if the arc crosses 0°, 90°, 180°, 270°
extremes. Track the actual extreme points on the ellipse at those angles.

Algorithm (from SVG spec §B.2.4):

1. Compute (x1', y1') in rotated frame
2. Compute center (cx', cy') from formula
3. Compute startAngle, deltaAngle
4. For each axis-aligned extreme angle (0°, 90°, 180°, 270°):
   if the angle lies within the sweep → track the ellipse point at that angle

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Run full test suite**

```bash
bun test packages/vector-engine/
```

- [ ] **Step 6: Commit**

```
fix(vector-engine): proper arc bounds via center parameterization (HYP-310)
```

---

### Task 3: Mute Pass-through Type Checking

Current mute logic forwards first input → first output regardless of types.
Per spec: if output type differs from input type, dependents receive nothing.

**Files:**

- Modify: `packages/vector-engine/src/graph/executor.ts:124-134`
- Modify: `packages/vector-engine/src/graph/executor.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it("should skip muted node when input/output types mismatch", () => {
  // A node that takes 'path' input but outputs 'style' — muting should
  // not forward the path to the style output
  const registry = new NodeRegistry();
  registry.register({
    type: "type-changer",
    label: "Type Changer",
    category: "utility",
    inputs: [{ name: "path", type: "path" }],
    outputs: [{ name: "style", type: "style" }],
    params: [],
    execute() {
      return { style: { type: "style", value: {} } };
    },
  });
  // ... build graph with muted type-changer, verify downstream gets no output
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Add type check to mute passthrough**

In `executor.ts`, mute block: check that `typeDef.inputs[0].type === typeDef.outputs[0].type`
before forwarding. If mismatch, output empty `{}`.

```typescript
if (isMuted) {
  const outputs: Record<string, NodeValue | NodeValue[]> = {};
  if (typeDef && typeDef.inputs.length > 0 && typeDef.outputs.length > 0) {
    const firstInDef = typeDef.inputs[0];
    const firstOutDef = typeDef.outputs[0];
    // Only pass through if types match (spec: mute semantics)
    if (firstInDef.type === firstOutDef.type) {
      const val = resolvedInputs[firstInDef.name];
      if (val !== undefined) outputs[firstOutDef.name] = val;
    }
  }
  // Forward implicit ports even when muted (transform cascade)
  for (const portName of IMPLICIT_PORTS) {
    if (resolvedInputs[portName] !== undefined) {
      outputs[portName] = resolvedInputs[portName];
    }
  }
  nodeOutputs.set(nodeId, outputs);
  nodeStatus[nodeId] = { state: "skipped" };
}
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
fix(vector-engine): mute pass-through checks input/output type match (HYP-308)
```

---

### Task 4: Path Flattening Utility

Convert cubic/quad beziers and arcs to polylines (array of points). Needed by
deformation nodes which operate on vertex arrays, then re-fit curves.

**Files:**

- Create: `packages/vector-engine/src/path/flatten.ts`
- Create: `packages/vector-engine/src/path/flatten.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { flattenPath } from "./flatten";
import { encodeCommands, PathCmd } from "./commands";

describe("flattenPath", () => {
  it("should pass through line segments as-is", () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
    ]);
    const points = flattenPath(cmds, 1.0);
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  it("should subdivide cubic bezier into line segments", () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Cubic, cx1: 0, cy1: 100, cx2: 100, cy2: 100, x: 100, y: 0 },
    ]);
    const points = flattenPath(cmds, 1.0);
    // Should produce multiple points approximating the curve
    expect(points.length).toBeGreaterThan(2);
    // First and last points should match
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it("should produce fewer points with higher tolerance", () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Cubic, cx1: 0, cy1: 100, cx2: 100, cy2: 100, x: 100, y: 0 },
    ]);
    const fine = flattenPath(cmds, 0.1);
    const coarse = flattenPath(cmds, 5.0);
    expect(fine.length).toBeGreaterThan(coarse.length);
  });

  it("should handle closed paths", () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Close },
    ]);
    const points = flattenPath(cmds, 1.0);
    expect(points.length).toBe(3); // Close doesn't add duplicate start point
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement flattenPath**

```typescript
/**
 * @file Adaptive polyline approximation — converts curves to line segments
 *
 * Accessed via: Deformation nodes (roughen, zigzag, etc.) — operate on flattened vertices
 * Tradeoffs: uses recursive midpoint subdivision with flatness test, not de Casteljau optimal
 */

import type { Point } from "../types";
import { decodeCommands, PathCmd } from "./commands";

export function flattenPath(commands: Float64Array, tolerance: number): Point[] {
  // Decode, iterate, subdivide cubics/quads/arcs adaptively
}
```

Adaptive subdivision: for each cubic, compute midpoint distance to chord.
If distance < tolerance, emit endpoint. Otherwise, split at t=0.5 and recurse.
Same for quads. Arcs: convert to cubics first (Bézier approximation of arc).

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): adaptive path flattening utility (HYP-308)
```

---

## Chunk 2: Geometry Queries

### Task 5: Path Length & Area

Compute total arc-length of a path and signed area (for winding direction).

**Files:**

- Create: `packages/vector-engine/src/path/geometry.ts`
- Create: `packages/vector-engine/src/path/geometry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { pathLength, pathArea } from "./geometry";
import { encodeCommands, PathCmd } from "./commands";

describe("pathLength", () => {
  it("should compute line segment length", () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
    ]);
    expect(pathLength(cmds)).toBeCloseTo(100, 5);
  });

  it("should compute polyline length", () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
    ]);
    expect(pathLength(cmds)).toBeCloseTo(200, 5);
  });

  it("should approximate cubic bezier length via Gauss-Legendre", () => {
    // Quarter-circle approximation: known length ≈ π/2 * 50 ≈ 78.54
    const k = 0.5522847498; // cubic approx constant for circle
    const r = 50;
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: r, y: 0 },
      { type: PathCmd.Cubic, cx1: r, cy1: r * k, cx2: r * k, cy2: r, x: 0, y: r },
    ]);
    expect(pathLength(cmds)).toBeCloseTo((Math.PI / 2) * r, 0);
  });
});

describe("pathArea", () => {
  it("should compute area of a unit square", () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Line, x: 0, y: 100 },
      { type: PathCmd.Close },
    ]);
    expect(Math.abs(pathArea(cmds))).toBeCloseTo(10000, 0);
  });

  it("should return positive for CW winding, negative for CCW", () => {
    const cw = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Close },
    ]);
    const ccw = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 0, y: 100 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Close },
    ]);
    // Signs should differ
    expect(Math.sign(pathArea(cw))).not.toBe(Math.sign(pathArea(ccw)));
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement**

```typescript
/**
 * @file Geometry queries — path length, area, point-at-offset, tangent, normal
 *
 * Accessed via: Properties panel geometry readouts, variable stroke calculations,
 *   trim path operations
 * Tradeoffs: cubic length uses 5-point Gauss-Legendre quadrature (fast, ~0.01% error).
 *   Area uses shoelace on flattened polyline for curves.
 */
```

- Length: sum segment lengths. Lines: Euclidean distance. Cubics: Gauss-Legendre
  quadrature of `|B'(t)|`. Quads: same. Arcs: analytical (ellipse arc length integral).
- Area: shoelace formula. Flatten curves to polyline first (tolerance 0.5px).

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): path length and area geometry queries (HYP-308)
```

---

### Task 6: Point/Tangent/Normal at Offset

Given a path and a normalized offset (0..1), compute the point, tangent vector,
and normal vector at that position along the path.

**Files:**

- Modify: `packages/vector-engine/src/path/geometry.ts`
- Modify: `packages/vector-engine/src/path/geometry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("pointAtOffset", () => {
  it("should return start point at offset 0", () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
    ]);
    const pt = pointAtOffset(cmds, 0);
    expect(pt.point.x).toBeCloseTo(0, 5);
    expect(pt.point.y).toBeCloseTo(0, 5);
  });

  it("should return midpoint at offset 0.5", () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
    ]);
    const pt = pointAtOffset(cmds, 0.5);
    expect(pt.point.x).toBeCloseTo(50, 5);
  });

  it("should return tangent direction", () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
    ]);
    const pt = pointAtOffset(cmds, 0.5);
    // Tangent along horizontal line should be (1, 0)
    expect(pt.tangent.x).toBeCloseTo(1, 5);
    expect(pt.tangent.y).toBeCloseTo(0, 5);
  });

  it("should return perpendicular normal", () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
    ]);
    const pt = pointAtOffset(cmds, 0.5);
    // Normal perpendicular to (1,0) → (0, -1) or (0, 1)
    expect(Math.abs(pt.normal.x)).toBeCloseTo(0, 5);
    expect(Math.abs(pt.normal.y)).toBeCloseTo(1, 5);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement pointAtOffset**

```typescript
export interface PointAtOffsetResult {
  point: Point;
  tangent: Point;
  normal: Point;
}

export function pointAtOffset(commands: Float64Array, offset: number): PointAtOffsetResult;
```

Algorithm:

1. Compute total path length
2. Target distance = offset × totalLength
3. Walk segments accumulating length until reaching target
4. Find t parameter within the target segment
5. Evaluate point and derivative at t (de Casteljau for beziers, direct for lines)
6. Normal = rotate tangent 90° CCW

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): point/tangent/normal at path offset (HYP-308)
```

---

### Task 7: Curve Fit (fit-curve Integration)

Fit smooth bezier curves through an array of points. Used by deformation nodes
after operating on flattened polylines.

**Files:**

- Modify: `packages/vector-engine/package.json` (add `fit-curve` dependency)
- Create: `packages/vector-engine/src/curve/fit.ts`
- Create: `packages/vector-engine/src/curve/fit.test.ts`

- [ ] **Step 1: Add dependency**

```bash
cd packages/vector-engine && bun add fit-curve
```

- [ ] **Step 2: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { fitCurve } from "./fit";
import type { Point } from "../types";

describe("fitCurve", () => {
  it("should fit straight line points to a single cubic", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    const path = fitCurve(points, 1.0);
    expect(path.commands.length).toBeGreaterThan(0);
    expect(path.closed).toBe(false);
  });

  it("should produce a closed path when first === last", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ];
    const path = fitCurve(points, 1.0);
    expect(path.closed).toBe(true);
  });

  it("should approximate a circle arc", () => {
    // 8 points on a quarter circle
    const points: Point[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * (Math.PI / 2);
      points.push({ x: 50 * Math.cos(t), y: 50 * Math.sin(t) });
    }
    const path = fitCurve(points, 2.0);
    // Should produce cubic beziers, not just lines
    expect(path.commands.length).toBeGreaterThan(6); // More than M + L
  });
});
```

- [ ] **Step 3: Run test — verify it fails**

- [ ] **Step 4: Implement fitCurve wrapper**

```typescript
/**
 * @file Curve fitting — convert point array to smooth bezier path
 *
 * Accessed via: Deformation nodes — re-fit curves after operating on flattened vertices
 * Assumptions: input points are ordered and reasonably spaced
 */

import fitCurveLib from "fit-curve";
import { PathBuilder } from "../path/builder";
import type { PathValue, Point } from "../types";

export function fitCurve(points: Point[], error: number): PathValue {
  // fit-curve expects [[x,y],...] and returns [[p0, cp1, cp2, p3], ...]
  const input = points.map((p) => [p.x, p.y] as [number, number]);
  const beziers = fitCurveLib(input, error);
  const builder = new PathBuilder();
  // First bezier starts at its p0
  if (beziers.length > 0) {
    builder.moveTo(beziers[0][0][0], beziers[0][0][1]);
    for (const [, cp1, cp2, p3] of beziers) {
      builder.cubicTo(cp1[0], cp1[1], cp2[0], cp2[1], p3[0], p3[1]);
    }
  }
  // Close if first and last points coincide
  const first = points[0];
  const last = points[points.length - 1];
  const isClosed = first && last && Math.abs(first.x - last.x) < 0.01 && Math.abs(first.y - last.y) < 0.01;
  if (isClosed) builder.close();
  return builder.build();
}
```

- [ ] **Step 5: Run test — verify it passes**

- [ ] **Step 6: Commit**

```
feat(vector-engine): fit-curve wrapper for polyline → bezier conversion (HYP-308)
```

---

## Chunk 3: Path Operations (TypeScript)

### Task 8: Round Corners & Chamfer

Round corners replaces sharp vertices with arcs. Chamfer replaces with straight cuts.

**Files:**

- Create: `packages/vector-engine/src/nodes/path-ops/round-corners.ts`
- Create: `packages/vector-engine/src/nodes/path-ops/chamfer.ts`
- Create: `packages/vector-engine/src/nodes/path-ops/path-ops-advanced.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { roundCornersNode } from "./round-corners";
import { chamferNode } from "./chamfer";
import { PathBuilder } from "../../path/builder";
import { decodeCommands, PathCmd } from "../../path/commands";

describe("round corners", () => {
  it("should replace square corners with arcs", () => {
    const square = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = roundCornersNode.execute({ path: { type: "path", value: square } }, { radius: 10 });
    const path = (result.path as any).value;
    const cmds = decodeCommands(path.commands);
    // Should contain Arc commands (or cubics approximating arcs)
    const hasCurves = cmds.some((c) => c.type === PathCmd.Arc || c.type === PathCmd.Cubic);
    expect(hasCurves).toBe(true);
  });

  it("should clamp radius to half of shortest edge", () => {
    const narrow = new PathBuilder().moveTo(0, 0).lineTo(10, 0).lineTo(10, 100).lineTo(0, 100).close().build();
    const result = roundCornersNode.execute(
      { path: { type: "path", value: narrow } },
      { radius: 50 }, // More than half of 10px edge
    );
    // Should not crash, radius should be clamped
    expect((result.path as any).value.commands.length).toBeGreaterThan(0);
  });
});

describe("chamfer", () => {
  it("should replace corners with straight cuts", () => {
    const square = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = chamferNode.execute({ path: { type: "path", value: square } }, { distance: 10 });
    const path = (result.path as any).value;
    const cmds = decodeCommands(path.commands);
    // Chamfer adds extra line segments (8 edges instead of 4)
    const lineCount = cmds.filter((c) => c.type === PathCmd.Line).length;
    expect(lineCount).toBe(8);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement round-corners.ts**

Node definition following existing pattern. Algorithm:

1. Decode path to commands
2. For each pair of adjacent line segments meeting at a vertex:
   - Compute the angle between segments
   - Clamp radius to `min(radius, halfEdge1, halfEdge2)`
   - Replace the vertex with an arc (or cubic bezier approximation)
3. Encode and return

- [ ] **Step 4: Implement chamfer.ts**

Same structure, but replace vertex with two points (cut line) instead of arc.

- [ ] **Step 5: Run test — verify it passes**

- [ ] **Step 6: Commit**

```
feat(vector-engine): round corners and chamfer path operations (HYP-308)
```

---

### Task 9: Subdivide, Split Path, Trim Path

- **Subdivide**: Split a bezier segment at parameter t (de Casteljau).
- **Split Path**: Cut a path at a normalized offset into two sub-paths.
- **Trim Path**: Extract sub-path between start% and end% (After Effects style).

**Files:**

- Create: `packages/vector-engine/src/nodes/path-ops/subdivide.ts`
- Create: `packages/vector-engine/src/nodes/path-ops/trim-path.ts`
- Modify: `packages/vector-engine/src/nodes/path-ops/path-ops-advanced.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("subdivide", () => {
  it("should split a cubic segment at midpoint", () => {
    const path = new PathBuilder().moveTo(0, 0).cubicTo(10, 20, 30, 40, 50, 60).build();
    const result = subdivideNode.execute({ path: { type: "path", value: path } }, { segmentIndex: 0, t: 0.5 });
    const cmds = decodeCommands((result.path as any).value.commands);
    // One cubic becomes two cubics
    expect(cmds.filter((c) => c.type === PathCmd.Cubic).length).toBe(2);
  });
});

describe("trim path", () => {
  it("should extract sub-path between 25% and 75%", () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(200, 0).lineTo(300, 0).build();
    const result = trimPathNode.execute({ path: { type: "path", value: path } }, { start: 0.25, end: 0.75 });
    // Result path should be ~half the original length
    const outPath = (result.path as any).value;
    expect(outPath.commands.length).toBeGreaterThan(0);
  });

  it("should handle wrap-around (start > end)", () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = trimPathNode.execute({ path: { type: "path", value: path } }, { start: 0.75, end: 0.25 });
    expect((result.path as any).value.commands.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement subdivide.ts**

De Casteljau subdivision: split cubic at t → two cubics with exact control points.
Quad: same. Line: trivial (insert midpoint).

- [ ] **Step 4: Implement trim-path.ts**

Uses `pointAtOffset` from geometry.ts to find cut points, then `subdivide` to
split segments at those points, then extract the sub-path between them.

- [ ] **Step 5: Run test — verify it passes**

- [ ] **Step 6: Commit**

```
feat(vector-engine): subdivide and trim path operations (HYP-308)
```

---

### Task 10: Enforce Winding & Smooth Path

- **Enforce Winding**: Ensure path goes CW or CCW (using signed area from Task 5).
- **Smooth**: Convert corner vertices to smooth (symmetric tangent handles).

**Files:**

- Create: `packages/vector-engine/src/nodes/path-ops/enforce-winding.ts`
- Create: `packages/vector-engine/src/nodes/path-ops/smooth.ts`
- Modify: `packages/vector-engine/src/nodes/path-ops/path-ops-advanced.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("enforce winding", () => {
  it("should reverse CCW path when CW requested", () => {
    const ccw = new PathBuilder().moveTo(0, 0).lineTo(0, 100).lineTo(100, 100).close().build();
    const result = enforceWindingNode.execute({ path: { type: "path", value: ccw } }, { direction: "cw" });
    const outPath = (result.path as any).value;
    // The output area should have the requested sign
    expect(pathArea(outPath.commands)).toBeGreaterThan(0);
  });
});

describe("smooth", () => {
  it("should convert polyline corners to cubic curves", () => {
    const zigzag = new PathBuilder().moveTo(0, 0).lineTo(50, 100).lineTo(100, 0).build();
    const result = smoothNode.execute({ path: { type: "path", value: zigzag } }, { smoothness: 0.5 });
    const cmds = decodeCommands((result.path as any).value.commands);
    const hasCubics = cmds.some((c) => c.type === PathCmd.Cubic);
    expect(hasCubics).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement enforce-winding.ts**

Compute `pathArea()`. If sign doesn't match desired direction, call `reversePathNode`.

- [ ] **Step 4: Implement smooth.ts**

For each vertex with adjacent line segments, compute symmetric tangent handles
based on the direction between previous and next vertices, scaled by `smoothness`.

- [ ] **Step 5: Run test — verify it passes**

- [ ] **Step 6: Commit**

```
feat(vector-engine): enforce winding and smooth path operations (HYP-308)
```

---

## Chunk 4: WASM Path Operations

### Task 11: Extend PathOpsBackend

Add `offset` and `removeSelfIntersections` to the WASM backend interface and mock.

**Files:**

- Modify: `packages/vector-wasm/src/types.ts`
- Modify: `packages/vector-wasm/src/mock-pathops.ts`
- Modify: `packages/vector-wasm/src/index.ts`

- [ ] **Step 1: Extend interface**

```typescript
export interface PathOpsBackend {
  boolean(op: BooleanOp, a: PathValue, b: PathValue): PathValue;
  simplify(path: PathValue, tolerance: number): PathValue;
  flatten(path: PathValue, maxError: number): PathValue;
  strokeToPath(path: PathValue, width: number, cap: string, join: string): PathValue;
  dash(path: PathValue, dashArray: number[], dashOffset: number): PathValue;
  offset(path: PathValue, distance: number): PathValue;
  removeSelfIntersections(path: PathValue): PathValue;
}
```

- [ ] **Step 2: Add mock implementations**

```typescript
offset(path: PathValue, _distance: number): PathValue {
  return path;
}
removeSelfIntersections(path: PathValue): PathValue {
  return path;
}
```

- [ ] **Step 3: Verify compilation**

```bash
bun test packages/vector-engine/
```

- [ ] **Step 4: Commit**

```
feat(vector-wasm): extend PathOpsBackend with offset, removeSelfIntersections (HYP-308)
```

---

### Task 12: WASM-Backed Node Definitions

Create node definitions for operations that delegate to PathOpsBackend.

**Files:**

- Create: `packages/vector-engine/src/nodes/path-ops/offset.ts`
- Create: `packages/vector-engine/src/nodes/path-ops/stroke-to-path.ts`
- Create: `packages/vector-engine/src/nodes/path-ops/dash-path.ts`
- Create: `packages/vector-engine/src/nodes/path-ops/wasm-ops.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { MockPathOps } from "vector-wasm";
import { createOffsetNode } from "./offset";
import { createStrokeToPathNode } from "./stroke-to-path";
import { createDashNode } from "./dash-path";
import { PathBuilder } from "../../path/builder";

describe("WASM path ops nodes", () => {
  const backend = new MockPathOps();
  const offsetNode = createOffsetNode(backend);
  const strokeToPathNode = createStrokeToPathNode(backend);
  const dashNode = createDashNode(backend);

  it("should run offset node without error", () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = offsetNode.execute({ path: { type: "path", value: rect } }, { distance: 10 });
    expect((result.path as any).type).toBe("path");
  });

  it("should run stroke-to-path node", () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = strokeToPathNode.execute(
      { path: { type: "path", value: line } },
      { width: 10, cap: "round", join: "round" },
    );
    expect((result.path as any).value.closed).toBe(true);
  });

  it("should run dash node", () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = dashNode.execute({ path: { type: "path", value: line } }, { dashArray: [10, 5], dashOffset: 0 });
    expect((result.path as any).type).toBe("path");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement node factories**

Each follows the `createBooleanNodes` pattern — factory function receiving `PathOpsBackend`:

```typescript
// offset.ts
export function createOffsetNode(backend: PathOpsBackend): NodeTypeDefinition {
  return {
    type: "offset",
    label: "Path Offset",
    category: "pathOp",
    inputs: [{ name: "path", type: "path" }],
    outputs: [{ name: "path", type: "path" }],
    params: [{ name: "distance", type: "number", default: 10, step: 1 }],
    execute(inputs, params) {
      const pathVal = inputs.path as NodeValue;
      const result = backend.offset(pathVal.value as PathValue, params.distance as number);
      return { path: { type: "path", value: result } };
    },
  };
}
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Register in register-all.ts**

- [ ] **Step 6: Commit**

```
feat(vector-engine): WASM-backed path ops nodes — offset, stroke-to-path, dash (HYP-308)
```

---

## Chunk 5: Structural Nodes & Style

### Task 13: Group Node + Scene Builder Hierarchy

Group node collects multiple path inputs into a SceneGroup with shared transform/opacity.

**Files:**

- Create: `packages/vector-engine/src/nodes/structural/group.ts`
- Create: `packages/vector-engine/src/nodes/structural/structural.test.ts`
- Modify: `packages/vector-engine/src/graph/executor.ts` (group terminal handling)
- Modify: `packages/vector-engine/src/graph/executor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { groupNode } from "./group";
import { PathBuilder } from "../../path/builder";
import type { NodeValue } from "../../types";

describe("group node", () => {
  it("should merge multiple paths into compound path output", () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const circle = new PathBuilder()
      .moveTo(50, 0)
      .arcTo(50, 50, 0, 1, 1, 50, 100)
      .arcTo(50, 50, 0, 1, 1, 50, 0)
      .close()
      .build();

    const result = groupNode.execute(
      {
        children: [
          { type: "path", value: rect },
          { type: "path", value: circle },
        ] as NodeValue[],
      },
      { opacity: 0.8 },
    );

    // Group output is a path (compound) for downstream consumption
    expect((result.path as any).type).toBe("path");
    // Group metadata stored for scene builder
    expect((result.path as any).value.commands.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement group.ts**

Design decision: Group node takes `children` (multiple path) input and outputs
a compound path (all sub-paths concatenated). The group's opacity/transform are
forwarded via implicit ports. The scene builder detects groups and creates SceneGroup.

```typescript
export const groupNode: NodeTypeDefinition = {
  type: "group",
  label: "Group",
  category: "utility",
  inputs: [{ name: "children", type: "path", multiple: true }],
  outputs: [
    { name: "path", type: "path" },
    { name: "transform", type: "transform" },
  ],
  params: [{ name: "opacity", type: "number", default: 1, min: 0, max: 1, step: 0.01 }],
  execute(inputs, params) {
    const childInput = inputs.children;
    const children = Array.isArray(childInput)
      ? childInput.map((c) => (c as NodeValue).value as PathValue)
      : childInput
        ? [(childInput as NodeValue).value as PathValue]
        : [];

    // Merge all child paths into a compound path
    const merged = mergePaths(children);

    const transform = inputs.transform;

    return {
      path: { type: "path", value: merged },
      ...(transform ? { transform } : {}),
    };
  },
};
```

- [ ] **Step 4: Create path merge utility**

```typescript
// packages/vector-engine/src/path/merge.ts
export function mergePaths(paths: PathValue[]): PathValue {
  let totalSize = 0;
  for (const p of paths) totalSize += p.commands.length;
  const merged = new Float64Array(totalSize);
  let offset = 0;
  for (const p of paths) {
    merged.set(p.commands, offset);
    offset += p.commands.length;
  }
  return { commands: merged, closed: paths.length > 0 && paths.every((p) => p.closed) };
}
```

- [ ] **Step 5: Run test — verify it passes**

- [ ] **Step 6: Register in register-all.ts and export from index.ts**

- [ ] **Step 7: Commit**

```
feat(vector-engine): group node with compound path output (HYP-308)
```

---

### Task 14: Alpha Mask Node

Mask content by another path's opacity. Different from clip (hard edge) — alpha mask
uses gradient opacity for feathered edges.

**Files:**

- Create: `packages/vector-engine/src/nodes/structural/alpha-mask.ts`
- Modify: `packages/vector-engine/src/nodes/structural/structural.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("alpha mask node", () => {
  it("should output path with mask metadata in style", () => {
    const content = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const mask = new PathBuilder().moveTo(20, 20).lineTo(80, 20).lineTo(80, 80).lineTo(20, 80).close().build();

    const result = alphaMaskNode.execute(
      {
        content: { type: "path", value: content },
        mask: { type: "path", value: mask },
      },
      {},
    );

    expect((result.path as any).type).toBe("path");
    // Mask path should be stored for SVG <mask> export
    expect((result.clipPath as any).type).toBe("path");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement alpha-mask.ts**

The alpha mask node outputs the content path with a `clipPath` output that the
executor's implicit port forwarding mechanism picks up.

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): alpha mask structural node (HYP-308)
```

---

### Task 15: Shadow & Blur Style Nodes

Shadow and blur are already supported in `StyleValue` and SVG export (filter elements).
Just need dedicated node definitions.

**Files:**

- Create: `packages/vector-engine/src/nodes/style/shadow.ts`
- Create: `packages/vector-engine/src/nodes/style/blur.ts`
- Modify: `packages/vector-engine/src/nodes/style/style.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("shadow node", () => {
  it("should add shadow to style", () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = shadowNode.execute(
      {
        path: { type: "path", value: rect },
        style: { type: "style", value: { fill: { type: "solid", color: "#ff0000" } } },
      },
      { color: "#000000", offsetX: 2, offsetY: 4, blur: 6 },
    );
    const style = (result.style as any).value;
    expect(style.shadow).toEqual({
      color: "#000000",
      offsetX: 2,
      offsetY: 4,
      blur: 6,
    });
    // Original fill preserved
    expect(style.fill.type).toBe("solid");
    // Path passed through
    expect((result.path as any).type).toBe("path");
  });
});

describe("blur node", () => {
  it("should add blur to style", () => {
    const result = blurNode.execute({ style: { type: "style", value: {} } }, { radius: 5 });
    expect((result.style as any).value.blur).toBe(5);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement shadow.ts and blur.ts**

Follow fillNode/strokeNode pattern — take style input, merge shadow/blur params:

```typescript
export const shadowNode: NodeTypeDefinition = {
  type: "shadow",
  label: "Shadow",
  category: "style",
  inputs: [
    { name: "path", type: "path" },
    { name: "style", type: "style" },
  ],
  outputs: [
    { name: "path", type: "path" },
    { name: "style", type: "style" },
  ],
  params: [
    { name: "color", type: "color", default: "#00000066" },
    { name: "offsetX", type: "number", default: 2 },
    { name: "offsetY", type: "number", default: 4 },
    { name: "blur", type: "number", default: 6, min: 0 },
  ],
  execute(inputs, params) {
    const existingStyle = inputs.style ? ((inputs.style as NodeValue).value as StyleValue) : {};
    return {
      path: inputs.path,
      style: {
        type: "style",
        value: {
          ...existingStyle,
          shadow: {
            color: params.color as string,
            offsetX: params.offsetX as number,
            offsetY: params.offsetY as number,
            blur: params.blur as number,
          },
        },
      },
    };
  },
};
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Register in register-all.ts**

- [ ] **Step 6: Commit**

```
feat(vector-engine): shadow and blur style nodes (HYP-308)
```

---

## Chunk 6: Deformation Nodes

All deformations follow the same pipeline:

1. Flatten input path to polyline (using `flattenPath` from Task 4)
2. Manipulate vertex positions
3. Re-fit curves (using `fitCurve` from Task 7)

### Task 16: Roughen & Zigzag

**Files:**

- Create: `packages/vector-engine/src/nodes/deformation/roughen.ts`
- Create: `packages/vector-engine/src/nodes/deformation/zigzag.ts`
- Create: `packages/vector-engine/src/nodes/deformation/deformation.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { roughenNode } from "./roughen";
import { zigzagNode } from "./zigzag";
import { PathBuilder } from "../../path/builder";

describe("roughen", () => {
  it("should distort a straight line", () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = roughenNode.execute(
      { path: { type: "path", value: line } },
      { size: 10, detail: 5, type: "corner", seed: 42 },
    );
    const outPath = (result.path as any).value;
    // Output should have more commands than input
    expect(outPath.commands.length).toBeGreaterThan(line.commands.length);
  });

  it("should produce deterministic output with same seed", () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const r1 = roughenNode.execute(
      { path: { type: "path", value: line } },
      { size: 10, detail: 5, type: "corner", seed: 42 },
    );
    const r2 = roughenNode.execute(
      { path: { type: "path", value: line } },
      { size: 10, detail: 5, type: "corner", seed: 42 },
    );
    expect((r1.path as any).value.commands).toEqual((r2.path as any).value.commands);
  });
});

describe("zigzag", () => {
  it("should create zigzag pattern along path", () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = zigzagNode.execute(
      { path: { type: "path", value: line } },
      { size: 10, ridgesPerSegment: 5, type: "corner" },
    );
    const outPath = (result.path as any).value;
    expect(outPath.commands.length).toBeGreaterThan(line.commands.length);
  });

  it("should support smooth type (cubic curves)", () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = zigzagNode.execute(
      { path: { type: "path", value: line } },
      { size: 10, ridgesPerSegment: 3, type: "smooth" },
    );
    const outPath = (result.path as any).value;
    expect(outPath.commands.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement roughen.ts**

Algorithm:

1. Flatten path → polyline points
2. Between each pair of points, insert `detail` intermediate points
3. Offset each intermediate point by random amount (seeded PRNG) perpendicular to segment
4. `size` controls max displacement magnitude
5. If `type === 'smooth'`: re-fit with `fitCurve`. If `'corner'`: output lines.

Seeded PRNG: simple mulberry32 based on `seed` param — ensures deterministic output.

- [ ] **Step 4: Implement zigzag.ts**

Algorithm:

1. Flatten path → polyline points
2. For each segment, compute `ridgesPerSegment` evenly-spaced points
3. Alternate displacement direction (left/right of segment normal)
4. `size` controls zigzag amplitude
5. If `type === 'smooth'`: output cubic curves. If `'corner'`: output lines.

- [ ] **Step 5: Run test — verify it passes**

- [ ] **Step 6: Commit**

```
feat(vector-engine): roughen and zigzag deformation nodes (HYP-308)
```

---

### Task 17: Pucker/Bloat & Twist

**Files:**

- Create: `packages/vector-engine/src/nodes/deformation/pucker-bloat.ts`
- Create: `packages/vector-engine/src/nodes/deformation/twist.ts`
- Modify: `packages/vector-engine/src/nodes/deformation/deformation.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("pucker/bloat", () => {
  it("should pull points toward center (pucker, amount > 0)", () => {
    const square = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = puckerBloatNode.execute({ path: { type: "path", value: square } }, { amount: 50 });
    const outPath = (result.path as any).value;
    expect(outPath.commands.length).toBeGreaterThan(0);
  });

  it("should push points away from center (bloat, amount < 0)", () => {
    const square = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = puckerBloatNode.execute({ path: { type: "path", value: square } }, { amount: -50 });
    expect((result.path as any).value.commands.length).toBeGreaterThan(0);
  });
});

describe("twist", () => {
  it("should rotate points around center by angle proportional to distance", () => {
    const square = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = twistNode.execute({ path: { type: "path", value: square } }, { angle: 45 });
    expect((result.path as any).value.commands.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement pucker-bloat.ts**

Algorithm:

1. Flatten path, compute centroid (average of all points)
2. For each point: move toward/away from centroid by `amount/100` proportion
3. Re-fit curves with fitCurve

- [ ] **Step 4: Implement twist.ts**

Algorithm:

1. Flatten path, compute centroid and max radius
2. For each point: compute normalized distance from center (0..1)
3. Rotate point around centroid by `angle × distance/maxRadius` degrees
4. Re-fit curves

- [ ] **Step 5: Run test — verify it passes**

- [ ] **Step 6: Commit**

```
feat(vector-engine): pucker/bloat and twist deformation nodes (HYP-308)
```

---

### Task 18: Warp

Warp distorts a path along a predefined shape (arc, flag, wave, etc.).

**Files:**

- Create: `packages/vector-engine/src/nodes/deformation/warp.ts`
- Modify: `packages/vector-engine/src/nodes/deformation/deformation.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("warp", () => {
  it("should bend a path along an arc", () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 50).lineTo(0, 50).close().build();
    const result = warpNode.execute({ path: { type: "path", value: rect } }, { warpType: "arc", bend: 50 });
    expect((result.path as any).value.commands.length).toBeGreaterThan(0);
  });

  it("should support wave warp type", () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 50).lineTo(0, 50).close().build();
    const result = warpNode.execute({ path: { type: "path", value: rect } }, { warpType: "wave", bend: 30 });
    expect((result.path as any).value.commands.length).toBeGreaterThan(0);
  });

  it("should return identity at bend=0", () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 50).lineTo(0, 50).close().build();
    const result = warpNode.execute({ path: { type: "path", value: rect } }, { warpType: "arc", bend: 0 });
    // With bend=0, output should approximate input
    expect((result.path as any).value.commands.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement warp.ts**

Supported warp types (Illustrator parity):

- `arc`: bend top/bottom edges along circular arc
- `wave`: sinusoidal distortion
- `flag`: alternating wave across horizontal axis
- `bulge`: radial expansion from center

Algorithm:

1. Flatten path, compute bounding box
2. Normalize each point to (0..1, 0..1) relative to bbox
3. Apply warp function based on type + bend%
4. Map back to world coordinates
5. Re-fit curves

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): warp deformation node with arc/wave/flag/bulge types (HYP-308)
```

---

## Chunk 7: Variable Width Stroke

### Task 19: Variable Width Stroke Node

Width profile defines stroke width at different positions along the path.
The node generates an outlined fill path (offset left + offset right + caps).

**Files:**

- Create: `packages/vector-engine/src/nodes/stroke/variable-stroke.ts`
- Create: `packages/vector-engine/src/nodes/stroke/variable-stroke.test.ts`
- Modify: `packages/vector-engine/src/types.ts` (add WidthPoint type)

- [ ] **Step 1: Add WidthPoint to types.ts**

```typescript
export interface WidthPoint {
  offset: number; // 0..1 along path length
  width: number; // stroke width at this point
  taper?: "sharp" | "round"; // endpoint taper style
}
```

- [ ] **Step 2: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { variableStrokeNode } from "./variable-stroke";
import { PathBuilder } from "../../path/builder";

describe("variable stroke", () => {
  it("should generate outlined path from uniform width profile", () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = variableStrokeNode.execute(
      { path: { type: "path", value: line } },
      {
        profile: JSON.stringify([
          { offset: 0, width: 10 },
          { offset: 1, width: 10 },
        ]),
        cap: "round",
      },
    );
    const outPath = (result.path as any).value;
    expect(outPath.closed).toBe(true); // Outline is always closed
    expect(outPath.commands.length).toBeGreaterThan(0);
  });

  it("should taper from thick to thin", () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = variableStrokeNode.execute(
      { path: { type: "path", value: line } },
      {
        profile: JSON.stringify([
          { offset: 0, width: 20 },
          { offset: 1, width: 2 },
        ]),
        cap: "butt",
      },
    );
    const outPath = (result.path as any).value;
    expect(outPath.closed).toBe(true);
  });

  it("should handle curved input path", () => {
    const curve = new PathBuilder().moveTo(0, 0).cubicTo(33, 50, 66, 50, 100, 0).build();
    const result = variableStrokeNode.execute(
      { path: { type: "path", value: curve } },
      {
        profile: JSON.stringify([
          { offset: 0, width: 5 },
          { offset: 0.5, width: 15 },
          { offset: 1, width: 5 },
        ]),
        cap: "round",
      },
    );
    expect((result.path as any).value.commands.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run test — verify it fails**

- [ ] **Step 4: Implement variable-stroke.ts**

Algorithm:

1. Sample N points along path using `pointAtOffset` (N = path length / 2px)
2. At each sample point, interpolate width from profile
3. Compute left and right offset points using normal × width/2
4. Build outline: forward along left side, backward along right side
5. Add cap geometry (butt: straight line, round: semicircle)
6. Close path

```typescript
export const variableStrokeNode: NodeTypeDefinition = {
  type: "variableStroke",
  label: "Variable Stroke",
  category: "pathOp",
  inputs: [{ name: "path", type: "path" }],
  outputs: [{ name: "path", type: "path" }],
  params: [
    { name: "profile", type: "json", default: '[{"offset":0,"width":10},{"offset":1,"width":10}]' },
    {
      name: "cap",
      type: "enum",
      default: "round",
      options: [
        { value: "butt", label: "Butt" },
        { value: "round", label: "Round" },
        { value: "square", label: "Square" },
      ],
    },
  ],
  execute(inputs, params) {
    // ...
  },
};
```

- [ ] **Step 5: Run test — verify it passes**

- [ ] **Step 6: Register in register-all.ts**

- [ ] **Step 7: Commit**

```
feat(vector-engine): variable width stroke node (HYP-308)
```

---

## Chunk 8: Text & Gradient Mesh

### Task 20: Text to Path (opentype.js)

Convert text string + font to path outlines. Latin scripts only (no complex shaping).

**Files:**

- Modify: `packages/vector-engine/package.json` (add `opentype.js` dependency)
- Create: `packages/vector-engine/src/nodes/text/text-to-path.ts`
- Create: `packages/vector-engine/src/nodes/text/text.test.ts`

- [ ] **Step 1: Add dependency**

```bash
cd packages/vector-engine && bun add opentype.js
```

- [ ] **Step 2: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { textToPathNode } from "./text-to-path";
import { decodeCommands, PathCmd } from "../../path/commands";

describe("text to path", () => {
  // Note: tests use a mock font loader since we can't load real fonts in unit tests.
  // Integration tests will use real fonts.

  it("should have correct node definition", () => {
    expect(textToPathNode.type).toBe("textToPath");
    expect(textToPathNode.category).toBe("generator");
    expect(textToPathNode.params.map((p) => p.name)).toContain("text");
    expect(textToPathNode.params.map((p) => p.name)).toContain("fontSize");
  });

  it("should output empty path when no font loaded", () => {
    const result = textToPathNode.execute(
      {},
      {
        text: "Hello",
        fontSize: 24,
        fontUrl: "",
      },
    );
    const pathVal = (result.path as any).value;
    // Without a font, should output an empty path (not crash)
    expect(pathVal.commands.length).toBe(0);
  });
});
```

- [ ] **Step 3: Run test — verify it fails**

- [ ] **Step 4: Implement text-to-path.ts**

```typescript
/**
 * @file Text to Path — convert text string to vector outlines via opentype.js
 *
 * Accessed via: Vector toolbar > Text tool (vector mode)
 * Assumptions: font file must be loadable. Latin scripts only in v1.
 *   Complex scripts (Arabic, Devanagari) need rustybuzz shaping (Plan 2b).
 */

import type { NodeTypeDefinition } from "../../types";
import { PathBuilder } from "../../path/builder";

// Font cache to avoid re-parsing on every execution
const fontCache = new Map<string, any>();

export const textToPathNode: NodeTypeDefinition = {
  type: "textToPath",
  label: "Text to Path",
  category: "generator",
  inputs: [],
  outputs: [{ name: "path", type: "path" }],
  params: [
    { name: "text", type: "string", default: "Hello" },
    { name: "fontSize", type: "number", default: 48, min: 1 },
    { name: "fontUrl", type: "string", default: "" },
    { name: "x", type: "number", default: 0 },
    { name: "y", type: "number", default: 0 },
  ],
  execute(_inputs, params) {
    // opentype.js loaded dynamically — returns empty path if unavailable
    const builder = new PathBuilder();
    try {
      const font = fontCache.get(params.fontUrl as string);
      if (!font) {
        return { path: { type: "path", value: builder.build() } };
      }
      const opentypePath = font.getPath(
        params.text as string,
        params.x as number,
        params.y as number,
        params.fontSize as number,
      );
      // Convert opentype commands to our PathBuilder
      for (const cmd of opentypePath.commands) {
        switch (cmd.type) {
          case "M":
            builder.moveTo(cmd.x, cmd.y);
            break;
          case "L":
            builder.lineTo(cmd.x, cmd.y);
            break;
          case "C":
            builder.cubicTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
            break;
          case "Q":
            builder.quadTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
            break;
          case "Z":
            builder.close();
            break;
        }
      }
    } catch {
      // Font not available — return empty path
    }
    return { path: { type: "path", value: builder.build() } };
  },
};
```

- [ ] **Step 5: Run test — verify it passes**

- [ ] **Step 6: Commit**

```
feat(vector-engine): text-to-path node via opentype.js (HYP-308)
```

---

### Task 21: Gradient Mesh Types & Tessellation

Add MeshValue type and tessellation algorithm (bezier patches → triangles).

**Files:**

- Create: `packages/vector-engine/src/mesh/types.ts`
- Create: `packages/vector-engine/src/mesh/tessellate.ts`
- Create: `packages/vector-engine/src/mesh/mesh-from-path.ts`
- Create: `packages/vector-engine/src/mesh/mesh.test.ts`
- Modify: `packages/vector-engine/src/types.ts` (add mesh to NodeValue)

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { createMesh, meshFromBounds } from "./mesh-from-path";
import { tessellateMesh } from "./tessellate";

describe("gradient mesh", () => {
  it("should create a 2x2 mesh from bounds", () => {
    const mesh = meshFromBounds({ x: 0, y: 0, width: 100, height: 100 }, 2, 2);
    expect(mesh.rows).toBe(2);
    expect(mesh.cols).toBe(2);
    // (rows+1) × (cols+1) = 9 vertices
    expect(mesh.vertices.length).toBe(9);
  });

  it("should tessellate mesh into triangles", () => {
    const mesh = meshFromBounds({ x: 0, y: 0, width: 100, height: 100 }, 1, 1);
    const triangles = tessellateMesh(mesh, 4); // subdivision level
    // Each quad → subdivided → triangulated
    expect(triangles.positions.length).toBeGreaterThan(0);
    expect(triangles.colors.length).toBe(triangles.positions.length);
    // Positions should be [x,y] pairs, colors should be hex strings
    expect(triangles.positions.length % 2).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement mesh types**

```typescript
// packages/vector-engine/src/mesh/types.ts
import type { Point } from "../types";

export interface MeshVertex {
  position: Point;
  color: string;
  opacity?: number;
}

export interface MeshHandle {
  cp1: Point;
  cp2: Point;
}

export interface MeshValue {
  rows: number;
  cols: number;
  vertices: MeshVertex[];
  handles: MeshHandle[];
}

export interface TessellatedMesh {
  positions: number[]; // flat [x1,y1, x2,y2, ...]
  colors: string[]; // per-vertex color (one per position pair)
  indices: number[]; // triangle indices
}
```

- [ ] **Step 4: Implement tessellate.ts**

Bilinear subdivision of each bezier patch:

1. For each cell (row, col), get 4 corner vertices
2. Subdivide along both axes `subdivisionLevel` times
3. Interpolate positions bilinearly (with bezier handles if present)
4. Interpolate colors bilinearly
5. Output triangle list (2 triangles per sub-quad)

- [ ] **Step 5: Implement mesh-from-path.ts**

Create a regular grid mesh fitted to a bounding box with default colors.

- [ ] **Step 6: Add `mesh` to NodeValue union in types.ts**

```typescript
export type NodeValue =
  | { type: "path"; value: PathValue }
  | { type: "style"; value: StyleValue }
  | { type: "number"; value: number }
  | { type: "color"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "transform"; value: TransformMatrix }
  | { type: "mesh"; value: MeshValue };
```

- [ ] **Step 7: Run test — verify it passes**

- [ ] **Step 8: Commit**

```
feat(vector-engine): gradient mesh types and tessellation (HYP-308)
```

---

## Chunk 9: Vector Networks

### Task 22: VectorNetwork Types + NodeValue Extension

Types from Figma model: vertices, segments, regions.

**Files:**

- Create: `packages/vector-engine/src/network/types.ts`
- Modify: `packages/vector-engine/src/types.ts` (add network to NodeValue)
- Create: `packages/vector-engine/src/network/network.test.ts`

- [ ] **Step 1: Define types**

```typescript
// packages/vector-engine/src/network/types.ts
/**
 * @file Vector network types — graph-based path model (Figma-style)
 *
 * Accessed via: Pen tool in vector mode — the primary interactive editing model
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Vector Networks
 */

import type { FillStyle, Point } from "../types";

export interface VectorVertex {
  x: number;
  y: number;
  cornerRadius?: number;
  handleMirroring?: "none" | "angle" | "angleAndLength";
}

export interface VectorSegment {
  start: number; // vertex index
  end: number; // vertex index
  tangentStart: Point; // bezier control handle (0,0 = straight line)
  tangentEnd: Point;
}

export interface VectorRegion {
  windingRule: "evenOdd" | "nonZero";
  loops: number[][]; // arrays of segment indices forming closed chains
  fills: FillStyle[];
}

export interface VectorNetwork {
  vertices: VectorVertex[];
  segments: VectorSegment[];
  regions: VectorRegion[];
}
```

- [ ] **Step 2: Add `network` to NodeValue union in types.ts**

```typescript
export type NodeValue =
  | { type: "path"; value: PathValue }
  | { type: "style"; value: StyleValue }
  | { type: "number"; value: number }
  | { type: "color"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "transform"; value: TransformMatrix }
  | { type: "mesh"; value: MeshValue }
  | { type: "network"; value: VectorNetwork };
```

- [ ] **Step 3: Write a basic construction test**

```typescript
describe("VectorNetwork types", () => {
  it("should create a simple triangle network", () => {
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
          windingRule: "nonZero",
          loops: [[0, 1, 2]],
          fills: [{ type: "solid", color: "#ff0000" }],
        },
      ],
    };
    expect(network.vertices.length).toBe(3);
    expect(network.segments.length).toBe(3);
    expect(network.regions.length).toBe(1);
  });
});
```

- [ ] **Step 4: Verify compilation**

```bash
bun test packages/vector-engine/src/network/
```

- [ ] **Step 5: Commit**

```
feat(vector-engine): vector network types and NodeValue extension (HYP-308)
```

---

### Task 23: Path ↔ VectorNetwork Conversions

Convert between sequential SVG paths and graph-based vector networks.

**Files:**

- Create: `packages/vector-engine/src/network/convert.ts`
- Modify: `packages/vector-engine/src/network/network.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { pathToNetwork, networkToPaths } from "./convert";
import { PathBuilder } from "../path/builder";

describe("path → network → path roundtrip", () => {
  it("should convert a closed triangle", () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(50, 86.6).close().build();

    const network = pathToNetwork(path);
    expect(network.vertices.length).toBe(3);
    expect(network.segments.length).toBe(3);
    expect(network.regions.length).toBe(1);

    const paths = networkToPaths(network);
    expect(paths.length).toBe(1);
    expect(paths[0].closed).toBe(true);
  });

  it("should convert a cubic bezier curve", () => {
    const path = new PathBuilder().moveTo(0, 0).cubicTo(33, 100, 66, 100, 100, 0).build();

    const network = pathToNetwork(path);
    expect(network.vertices.length).toBe(2);
    expect(network.segments.length).toBe(1);
    // Tangent handles should carry bezier control points
    const seg = network.segments[0];
    expect(seg.tangentStart.x).toBeCloseTo(33, 1);
    expect(seg.tangentStart.y).toBeCloseTo(100, 1);
  });

  it("should handle compound paths (multiple sub-paths)", () => {
    const builder = new PathBuilder();
    // Two separate triangles
    builder.moveTo(0, 0).lineTo(50, 0).lineTo(25, 43).close();
    builder.moveTo(100, 0).lineTo(150, 0).lineTo(125, 43).close();
    const path = builder.build();

    const network = pathToNetwork(path);
    expect(network.vertices.length).toBe(6);
    expect(network.segments.length).toBe(6);
  });

  it("should convert T-junction network to multiple paths", () => {
    // T-junction: vertex at center connected to 3 endpoints
    const network: VectorNetwork = {
      vertices: [
        { x: 50, y: 50 }, // center
        { x: 0, y: 50 }, // left
        { x: 100, y: 50 }, // right
        { x: 50, y: 0 }, // top
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 0, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 0, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [], // No closed regions in a T
    };

    const paths = networkToPaths(network);
    // T-junction → 3 open paths (one per segment)
    expect(paths.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement convert.ts**

```typescript
/**
 * @file VectorNetwork ↔ PathValue[] conversions
 *
 * Accessed via: SVG import (path → network), SVG export (network → paths)
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Vector Networks §Conversions
 */

// pathToNetwork:
// 1. Walk decoded commands, each M creates a new vertex
// 2. Each L/C/Q creates a segment between previous endpoint and current endpoint
// 3. Close command adds segment back to sub-path start
// 4. Tangent handles are computed from bezier control points
//    (relative to their vertex position)
// 5. Regions: single region per closed sub-path

// networkToPaths:
// 1. For each region: traverse loops, emit M/L/C/Z per segment
// 2. For segments not in any region: emit as individual open paths
// 3. Tangent handles → bezier control points (vertex position + tangent)
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): path ↔ vector network conversions (HYP-308)
```

---

### Task 24: Topology Solver (Minimal Cycle Basis)

Find fillable regions from a vector network's segment graph. This is the core
algorithm that makes vector networks useful — automatic region detection.

**Files:**

- Create: `packages/vector-engine/src/network/topology.ts`
- Modify: `packages/vector-engine/src/network/network.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { findRegions } from "./topology";

describe("topology solver", () => {
  it("should find one region in a triangle", () => {
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

  it("should find two regions in a square with diagonal", () => {
    // Square ABCD with diagonal AC → 2 triangular regions
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 0 }, // A
        { x: 100, y: 0 }, // B
        { x: 100, y: 100 }, // C
        { x: 0, y: 100 }, // D
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }, // AB
        { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }, // BC
        { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }, // CD
        { start: 3, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }, // DA
        { start: 0, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }, // AC diagonal
      ],
      regions: [],
    };
    const regions = findRegions(network);
    expect(regions.length).toBe(2);
  });

  it("should handle T-junction (no closed regions)", () => {
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
    expect(regions.length).toBe(0); // No closed regions
  });

  it("should remove filaments (dead-end vertices)", () => {
    // Triangle with a dangling tail from one vertex
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
        { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }, // filament
      ],
      regions: [],
    };
    const regions = findRegions(network);
    expect(regions.length).toBe(1); // Only the triangle
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement topology.ts**

```typescript
/**
 * @file Minimal Cycle Basis topology solver for vector networks
 *
 * Accessed via: Pen tool interactions — auto-detects fillable regions after segment edits
 * Assumptions: all segment intersections have been resolved to vertices before calling
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Topology Solver
 */
```

Algorithm (from spec):

1. Build adjacency list from segments (bidirectional)
2. Find leftmost vertex
3. Travel clockwise from first vertex (relative to imaginary edge below)
4. At each vertex, select the counter-clockwise edge (vector determinant):
   - Sort outgoing edges by angle relative to incoming edge
   - Pick the first CCW edge (smallest positive angle)
5. Continue until returning to start → one closed region found
6. Remove first edge of the found cycle from graph
7. Remove filaments (vertices with only 1 connection, recursively)
8. Repeat until graph exhausted

Vector determinant: `cross(v1, v2) = v1.x * v2.y - v1.y * v2.x`
Positive → v2 is CCW from v1. Used to sort edges at a vertex.

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): minimal cycle basis topology solver (HYP-308)
```

---

### Task 25: Vector Network Integration

Wire VectorNetwork into the scene builder and SVG export pipeline.

**Files:**

- Modify: `packages/vector-engine/src/graph/executor.ts`
- Modify: `packages/vector-engine/src/graph/scene-builder.ts`
- Modify: `packages/vector-engine/src/index.ts`
- Create: `packages/vector-engine/src/network/index.ts`

- [ ] **Step 1: Write failing integration test**

```typescript
// In network.test.ts
describe("VectorNetwork integration", () => {
  it("should convert network to paths for scene/SVG export", () => {
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
      ],
      regions: [
        {
          windingRule: "nonZero",
          loops: [[0, 1, 2, 3]],
          fills: [{ type: "solid", color: "#ff0000" }],
        },
      ],
    };

    const paths = networkToPaths(network);
    expect(paths.length).toBe(1);
    expect(paths[0].closed).toBe(true);

    // Should produce valid SVG d attribute
    const d = commandsToSvgD(paths[0].commands);
    expect(d).toContain("M");
    expect(d).toContain("Z");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Create network/index.ts and wire exports**

```typescript
export type { VectorNetwork, VectorVertex, VectorSegment, VectorRegion } from "./types";
export { pathToNetwork, networkToPaths } from "./convert";
export { findRegions } from "./topology";
```

Add to main `index.ts`:

```typescript
// Vector networks
export * from "./network";
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): vector network integration and public API exports (HYP-308)
```

---

## Chunk 10: SVG Import

### Task 26: SVG Path Literal Node

A generator node that stores a raw SVG `d` string. Used by SVG import for `<path>`
elements that don't map to a specific generator (rectangle, ellipse, etc.).

**Files:**

- Create: `packages/vector-engine/src/nodes/generators/svg-path.ts`
- Modify: `packages/vector-engine/src/nodes/generators/generators.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("svgPath generator", () => {
  it("should parse d attribute into PathValue", () => {
    const result = svgPathNode.execute({}, { d: "M 0 0 L 100 0 L 100 100 Z" });
    const path = (result.path as any).value;
    expect(path.commands.length).toBeGreaterThan(0);
    expect(path.closed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement svg-path.ts**

```typescript
export const svgPathNode: NodeTypeDefinition = {
  type: "svgPath",
  label: "SVG Path",
  category: "generator",
  inputs: [],
  outputs: [{ name: "path", type: "path" }],
  params: [{ name: "d", type: "string", default: "" }],
  execute(_inputs, params) {
    const d = params.d as string;
    if (!d) return { path: { type: "path", value: { commands: new Float64Array(0), closed: false } } };
    const commands = svgDToCommands(d);
    const closed = d.toUpperCase().includes("Z");
    return { path: { type: "path", value: { commands, closed } } };
  },
};
```

- [ ] **Step 4: Register in register-all.ts**

- [ ] **Step 5: Run test — verify it passes**

- [ ] **Step 6: Commit**

```
feat(vector-engine): svgPath generator node for raw d-attribute paths (HYP-308)
```

---

### Task 27: SVG Import Pipeline

Parse SVG string into vector-engine graph nodes. Uses `txml` (4KB, zero-dep, MIT)
for XML parsing — no regex tokenizer.

**Files:**

- Modify: `packages/vector-engine/package.json` (add `txml` dependency)
- Create: `packages/vector-engine/src/import/svg-import.ts`
- Create: `packages/vector-engine/src/import/svg-import.test.ts`

- [ ] **Step 1: Add txml dependency**

```bash
cd packages/vector-engine && bun add txml
```

- [ ] **Step 2: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { svgToGraph } from "./svg-import";

describe("SVG import", () => {
  it("should import a simple rectangle", () => {
    const svg = '<svg viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80"/></svg>';
    const result = svgToGraph(svg);
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    const rectNode = result.nodes.find((n) => n.type === "rectangle");
    expect(rectNode).toBeDefined();
    expect(rectNode!.params.width).toBe(80);
    expect(rectNode!.params.height).toBe(80);
  });

  it("should import a path element as svgPath node with parsed commands", () => {
    const svg = '<svg viewBox="0 0 100 100"><path d="M 0 0 L 100 0 L 100 100 Z"/></svg>';
    const result = svgToGraph(svg);
    const pathNode = result.nodes.find((n) => n.type === "svgPath");
    expect(pathNode).toBeDefined();
    expect(pathNode!.params.d).toBe("M 0 0 L 100 0 L 100 100 Z");
  });

  it("should import fill and stroke styles", () => {
    const svg =
      '<svg viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" fill="#ff0000" stroke="#000" stroke-width="2"/></svg>';
    const result = svgToGraph(svg);
    const fillNode = result.nodes.find((n) => n.type === "fill");
    expect(fillNode).toBeDefined();
    expect(fillNode!.params.color).toBe("#ff0000");
  });

  it("should import groups with transforms", () => {
    const svg = '<svg viewBox="0 0 200 200"><g transform="translate(50,50)"><rect width="100" height="100"/></g></svg>';
    const result = svgToGraph(svg);
    const translateNode = result.nodes.find((n) => n.type === "translate");
    expect(translateNode).toBeDefined();
  });

  it("should import circle and ellipse as generator nodes", () => {
    const svg =
      '<svg viewBox="0 0 200 200"><circle cx="50" cy="50" r="40"/><ellipse cx="150" cy="50" rx="40" ry="20"/></svg>';
    const result = svgToGraph(svg);
    const ellipseNodes = result.nodes.filter((n) => n.type === "ellipse");
    expect(ellipseNodes.length).toBe(2);
  });

  it("should import polygon with points attribute as svgPath", () => {
    const svg = '<svg viewBox="0 0 100 100"><polygon points="50,0 100,100 0,100"/></svg>';
    const result = svgToGraph(svg);
    const pathNode = result.nodes.find((n) => n.type === "svgPath");
    expect(pathNode).toBeDefined();
    expect(pathNode!.params.d as string).toContain("M");
  });

  it("should import polyline with points attribute as svgPath", () => {
    const svg = '<svg viewBox="0 0 100 100"><polyline points="0,0 50,50 100,0"/></svg>';
    const result = svgToGraph(svg);
    const pathNode = result.nodes.find((n) => n.type === "svgPath");
    expect(pathNode).toBeDefined();
  });

  it("should import linear gradient", () => {
    const svg = `<svg viewBox="0 0 100 100">
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#000"/>
          <stop offset="1" stop-color="#fff"/>
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill="url(#g1)"/>
    </svg>`;
    const result = svgToGraph(svg);
    const fillNode = result.nodes.find((n) => n.type === "fill");
    expect(fillNode).toBeDefined();
    expect(fillNode!.params.type).toBe("linearGradient");
  });

  it("should handle viewBox canvas dimensions", () => {
    const svg = '<svg viewBox="0 0 400 300"><rect width="100" height="100"/></svg>';
    const result = svgToGraph(svg);
    expect(result.canvas).toEqual({ width: 400, height: 300 });
  });

  it("should return edges connecting nodes", () => {
    const svg = '<svg viewBox="0 0 100 100"><rect fill="#f00" width="100" height="100"/></svg>';
    const result = svgToGraph(svg);
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 3: Run test — verify it fails**

- [ ] **Step 4: Implement svg-import.ts**

```typescript
/**
 * @file SVG import — parse SVG string into vector-engine graph description
 *
 * Accessed via: "Open SVG" action, import from JSX component
 * Tradeoffs: uses txml (4KB, MIT) for XML parsing. Handles well-formed SVG from
 *   design tools. No CSS cascade or advanced features (filters, patterns).
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §SVG Import
 */

import { parse as parseXml } from "txml";

export interface ImportedNode {
  id: string;
  type: string;
  params: Record<string, unknown>;
}

export interface ImportedEdge {
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface ImportResult {
  nodes: ImportedNode[];
  edges: ImportedEdge[];
  canvas: { width: number; height: number };
}

export function svgToGraph(svgString: string): ImportResult {
  // 1. Parse SVG via txml into element tree
  // 2. Extract viewBox → canvas dimensions
  // 3. Collect <defs> (gradients, clipPaths)
  // 4. Walk element tree:
  //    - <rect> → rectangle node + fill/stroke nodes
  //    - <circle>, <ellipse> → ellipse node
  //    - <line> → line node
  //    - <polygon>, <polyline> → svgPath node (convert points to d attribute)
  //    - <path> → svgPath node (stores raw d attribute)
  //    - <g> → group node + transform node
  //    - fill/stroke attributes → style nodes
  //    - transform attribute → transform node
  // 5. Create edges connecting generators → styles → transforms
  // 6. Return ImportResult
}
```

- [ ] **Step 5: Run test — verify it passes**

- [ ] **Step 6: Commit**

```
feat(vector-engine): SVG import pipeline via txml (HYP-308)
```

---

### Task 28: End-to-End Integration Tests

Full pipeline: create graph → execute → export SVG → import SVG → compare.

**Files:**

- Create: `packages/vector-engine/src/integration-advanced.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, expect, it } from "bun:test";
import {
  VectorGraphModel,
  GraphExecutor,
  createDefaultRegistry,
  sceneToSvg,
  PathBuilder,
  computeBounds,
} from "./index";
import { pathLength, pointAtOffset } from "./path/geometry";
import { flattenPath } from "./path/flatten";
import { svgToGraph } from "./import/svg-import";

describe("advanced integration", () => {
  it("should export SVG then import back as svgPath nodes", () => {
    // Note: round-trip loses generator semantics — exported <path> elements
    // import as svgPath nodes, not the original rectangle/ellipse generators.
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create("test", "RT", 200, 200);

    const rect = graph.addNode({ type: "rectangle", params: { width: 100, height: 50, x: 10, y: 10 } });
    const fill = graph.addNode({ type: "fill", params: { type: "solid", color: "#ff0000" } });
    graph.addEdge(rect, "path", fill, "path");

    const executor = new GraphExecutor(registry);
    const result = executor.execute(graph);
    const svg = sceneToSvg(result.scene);

    // Import the SVG back — gets svgPath nodes (not rectangle)
    const imported = svgToGraph(svg);
    expect(imported.nodes.length).toBeGreaterThanOrEqual(1);
    expect(imported.canvas).toEqual({ width: 200, height: 200 });
    // Exported SVG uses <path>, so import creates svgPath nodes
    const pathNodes = imported.nodes.filter((n) => n.type === "svgPath");
    expect(pathNodes.length).toBeGreaterThanOrEqual(1);
  });

  it("should compute geometry on generated shapes", () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create("test", "Geo", 100, 100);
    const rect = graph.addNode({ type: "rectangle", params: { width: 100, height: 100, x: 0, y: 0 } });
    const executor = new GraphExecutor(registry);
    const result = executor.execute(graph);
    const item = result.scene.items[0];
    if ("path" in item) {
      const len = pathLength(item.path.commands);
      expect(len).toBeCloseTo(400, 0); // Perimeter of 100x100 square
    }
  });

  it("should flatten and re-fit a curved path", () => {
    const curve = new PathBuilder().moveTo(0, 0).cubicTo(33, 100, 66, 100, 100, 0).build();

    const points = flattenPath(curve.commands, 1.0);
    expect(points.length).toBeGreaterThan(2);

    // Points should approximate the curve
    const midIdx = Math.floor(points.length / 2);
    // Midpoint of this curve is around (50, 75)
    expect(points[midIdx].y).toBeGreaterThan(50);
  });

  it("should register all new nodes without conflicts", () => {
    const registry = createDefaultRegistry();
    const all = registry.listAll();
    // Plan 1: 23 nodes. Plan 2 adds 21: svgPath, group, alphaMask, shadow,
    // blur, roundCorners, chamfer, smooth, subdivide, trimPath, enforceWinding,
    // offset, strokeToPath, dashPath, roughen, zigzag, puckerBloat, twist,
    // warp, variableStroke, textToPath
    expect(all.length).toBeGreaterThanOrEqual(44);
    // No duplicate type names
    const types = all.map((n) => n.type);
    expect(new Set(types).size).toBe(types.length);
  });
});
```

- [ ] **Step 2: Run full test suite**

```bash
bun test packages/vector-engine/
```

- [ ] **Step 3: Fix any failures**

- [ ] **Step 4: Update index.ts with all new exports**

- [ ] **Step 5: Commit**

```
test(vector-engine): advanced ops end-to-end integration tests (HYP-308)
```

---

## Chunk 11: Register & Polish

### Task 29: Register All New Nodes + Update Exports

Wire all new nodes into register-all.ts and index.ts.

**Files:**

- Modify: `packages/vector-engine/src/nodes/register-all.ts`
- Modify: `packages/vector-engine/src/index.ts`

- [ ] **Step 1: Update register-all.ts**

Add imports and registrations for all new nodes (21 total):

- Generators: svgPathNode
- Structural: groupNode, alphaMaskNode
- Style: shadowNode, blurNode
- Path ops: roundCornersNode, chamferNode, smoothNode, subdivideNode, trimPathNode,
  enforceWindingNode, createOffsetNode, createStrokeToPathNode, createDashNode
- Deformation: roughenNode, zigzagNode, puckerBloatNode, twistNode, warpNode
- Stroke: variableStrokeNode
- Text: textToPathNode

- [ ] **Step 2: Update index.ts**

Export all new modules:

```typescript
// Path utilities
export { flattenPath } from "./path/flatten";
export { pathLength, pathArea, pointAtOffset } from "./path/geometry";
export { mergePaths } from "./path/merge";
export { fitCurve } from "./curve/fit";
// Structural nodes
export { groupNode } from "./nodes/structural/group";
export { alphaMaskNode } from "./nodes/structural/alpha-mask";
// Style nodes
export { shadowNode } from "./nodes/style/shadow";
export { blurNode } from "./nodes/style/blur";
// Deformation nodes
export { roughenNode } from "./nodes/deformation/roughen";
export { zigzagNode } from "./nodes/deformation/zigzag";
export { puckerBloatNode } from "./nodes/deformation/pucker-bloat";
export { twistNode } from "./nodes/deformation/twist";
export { warpNode } from "./nodes/deformation/warp";
// Variable stroke
export { variableStrokeNode } from "./nodes/stroke/variable-stroke";
// Text
export { textToPathNode } from "./nodes/text/text-to-path";
// Mesh
export type { MeshValue, MeshVertex, MeshHandle, TessellatedMesh } from "./mesh/types";
export { tessellateMesh } from "./mesh/tessellate";
export { meshFromBounds } from "./mesh/mesh-from-path";
// Vector networks
export * from "./network";
// Import
export { svgToGraph } from "./import/svg-import";
// Additional types
export type { WidthPoint } from "./types";
```

- [ ] **Step 3: Run full test suite + lint**

```bash
bun run test && bun run lint
```

- [ ] **Step 4: Update register-all.test.ts node count**

- [ ] **Step 5: Update file header in register-all.ts** (node count in comment)

- [ ] **Step 6: Commit**

```
feat(vector-engine): register all Plan 2 nodes and update public API (HYP-308)
```

---

## Deferred to Plan 2b

These features are excluded from Plan 2 to keep scope manageable:

| Feature                       | Reason                                                          | Dependency                   |
| ----------------------------- | --------------------------------------------------------------- | ---------------------------- |
| FIG import (.fig parser)      | Needs `@open-pencil/core` dep, reverse-engineered schema        | Vector networks, Group nodes |
| rustybuzz-wasm text shaping   | WASM build pipeline, complex scripts only                       | Text to Path node            |
| Envelope Distort              | Needs mesh deformation grid, most complex deformation           | Gradient mesh types          |
| Gradient mesh nodes           | Node definitions need mesh NodeValue (added but nodes deferred) | Mesh tessellation            |
| Kiwi binary serialization     | File format concern, not SDK functionality                      | All node types stable        |
| Snapshot cache / persistence  | Runtime concern for Plan 3 (renderer)                           | Executor, HistoryManager     |
| `splitIntersections(network)` | Edge expansion prerequisite for `findRegions` in production     | Topology solver              |
| Divide / Trim / Crop path ops | CanvasKit-specific boolean variants, need real backend          | PathOpsBackend               |
