# Vector Engine Plan 2b — Advanced Features

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add gradient mesh nodes, envelope distort, segment intersection splitting,
HarfBuzz text shaping, and FIG import to the vector engine SDK.

**Architecture:** Extends vector-engine Plan 2 output. Gradient mesh nodes wrap
existing MeshValue/tessellation into `NodeTypeDefinition`. Envelope distort uses
the mesh grid to deform flattened paths. Segment intersection uses Bézier clipping
for cubic×cubic cases. Text shaping integrates harfbuzzjs (WASM) upstream of
opentype.js glyph extraction. FIG import uses a hand-rolled minimal Kiwi decoder
(reverse-engineered from OpenPencil's schema) with `fflate` for zip, `pako` for
deflate, and `fzstd` for zstandard decompression.

**Tech Stack:** TypeScript, bun:test, harfbuzzjs, fflate (zip), pako (zlib), fzstd (zstandard)

**Spec:** `docs/specs/2026-03-13-vector-engine-design.md`

**Scope:** Plan 2b of ~4:

- Plan 1 (done): Core SDK — 24 nodes, SVG export, undo/redo
- Plan 2 (done): Advanced ops — 21 more nodes, geometry, deformations, vector networks
- **Plan 2b (this):** Gradient mesh nodes, envelope distort, splitIntersections,
  HarfBuzz text shaping, FIG import
- Plan 3: Renderer (CanvasKit, hit testing, viewport)
- Plan 4: Editor UI + HyperIDE integration

---

## File Structure

```
packages/
├── vector-engine/
│   └── src/
│       ├── index.ts                                    # MODIFY: export new modules
│       ├── nodes/
│       │   ├── register-all.ts                         # MODIFY: register new nodes
│       │   ├── mesh/
│       │   │   ├── gradient-mesh.ts                    # CREATE: gradient mesh node
│       │   │   ├── mesh-from-path-node.ts              # CREATE: mesh-from-path node
│       │   │   └── mesh-nodes.test.ts                  # CREATE
│       │   ├── deformation/
│       │   │   ├── envelope-distort.ts                 # CREATE
│       │   │   └── deformation.test.ts                 # MODIFY: add envelope tests
│       │   └── text/
│       │       ├── text-to-path.ts                     # MODIFY: integrate shaper
│       │       ├── shaper.ts                           # CREATE: harfbuzzjs wrapper
│       │       └── text.test.ts                        # MODIFY: add shaping tests
│       ├── network/
│       │   ├── split.ts                                # CREATE: splitIntersections
│       │   ├── index.ts                                # MODIFY: export new functions
│       │   └── network.test.ts                         # MODIFY: add intersection tests
│       ├── curve/
│       │   ├── intersect-bezier.ts                     # CREATE: bezier clipping
│       │   └── intersect-bezier.test.ts                # CREATE
│       └── import/
│           ├── fig-import.ts                           # CREATE: .fig parser
│           ├── fig-mapper.ts                           # CREATE: Figma node → engine node
│           └── fig-import.test.ts                      # CREATE
│
└── vector-wasm/
    └── src/
        ├── index.ts                                    # MODIFY: export shaper types
        ├── types.ts                                    # MODIFY: add TextShaper interface
        └── mock-shaper.ts                              # CREATE: mock text shaper
```

---

## Chunk 1: Gradient Mesh Nodes

### Task 1: Gradient Mesh Node

The `MeshValue` type, tessellation, and `meshFromBounds` utility already exist.
This task creates the `NodeTypeDefinition` wrappers.

**Files:**

- Create: `packages/vector-engine/src/nodes/mesh/gradient-mesh.ts`
- Create: `packages/vector-engine/src/nodes/mesh/mesh-nodes.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { gradientMeshNode } from './gradient-mesh';
import type { NodeValue } from '../../types';

describe('gradientMeshNode', () => {
  it('should have correct definition', () => {
    expect(gradientMeshNode.type).toBe('gradientMesh');
    expect(gradientMeshNode.category).toBe('generator');
    expect(gradientMeshNode.outputs[0].type).toBe('mesh');
  });

  it('should create a mesh with given dimensions', () => {
    const result = gradientMeshNode.execute(
      {},
      {
        rows: 2,
        cols: 3,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
      },
    );
    const meshVal = result.mesh as NodeValue;
    expect(meshVal.type).toBe('mesh');
    const mesh = meshVal.value as any;
    expect(mesh.rows).toBe(2);
    expect(mesh.cols).toBe(3);
    expect(mesh.vertices.length).toBe(12); // (2+1)*(3+1)
  });

  it('should place vertices at correct grid positions', () => {
    const result = gradientMeshNode.execute(
      {},
      {
        rows: 1,
        cols: 1,
        width: 100,
        height: 50,
        x: 10,
        y: 20,
      },
    );
    const mesh = (result.mesh as NodeValue).value as any;
    expect(mesh.vertices[0].position).toEqual({ x: 10, y: 20 });
    expect(mesh.vertices[1].position).toEqual({ x: 110, y: 20 });
    expect(mesh.vertices[2].position).toEqual({ x: 10, y: 70 });
    expect(mesh.vertices[3].position).toEqual({ x: 110, y: 70 });
  });

  it('should support initial vertex color', () => {
    const result = gradientMeshNode.execute(
      {},
      {
        rows: 1,
        cols: 1,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        color: '#ff0000',
      },
    );
    const mesh = (result.mesh as NodeValue).value as any;
    expect(mesh.vertices[0].color).toBe('#ff0000');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement gradient-mesh.ts**

```typescript
/**
 * @file Gradient mesh generator node — creates a mesh grid
 *
 * Accessed via: MCP tool vector_create_mesh, mesh tool (v1.x)
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Gradient Mesh
 */

import { meshFromBounds } from '../../mesh/mesh-from-path';
import type { NodeTypeDefinition } from '../../types';

export const gradientMeshNode: NodeTypeDefinition = {
  type: 'gradientMesh',
  label: 'Gradient Mesh',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'mesh', type: 'mesh' }],
  params: [
    { name: 'rows', type: 'number', default: 2, min: 1, max: 20 },
    { name: 'cols', type: 'number', default: 2, min: 1, max: 20 },
    { name: 'width', type: 'number', default: 100, min: 1 },
    { name: 'height', type: 'number', default: 100, min: 1 },
    { name: 'x', type: 'number', default: 0 },
    { name: 'y', type: 'number', default: 0 },
    { name: 'color', type: 'color', default: '#ffffff' },
  ],
  execute(_inputs, params) {
    const mesh = meshFromBounds(
      {
        x: params.x as number,
        y: params.y as number,
        width: params.width as number,
        height: params.height as number,
      },
      params.rows as number,
      params.cols as number,
    );
    const color = params.color as string;
    for (const v of mesh.vertices) v.color = color;
    return { mesh: { type: 'mesh', value: mesh } };
  },
};
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): gradient mesh generator node (HYP-308)
```

---

### Task 2: Mesh from Path Node

Takes a path input, computes bounds, creates a mesh grid fitted to it.

**Files:**

- Create: `packages/vector-engine/src/nodes/mesh/mesh-from-path-node.ts`
- Modify: `packages/vector-engine/src/nodes/mesh/mesh-nodes.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { meshFromPathNode } from './mesh-from-path-node';
import { PathBuilder } from '../../path/builder';

describe('meshFromPathNode', () => {
  it('should create mesh fitted to path bounds', () => {
    const rect = new PathBuilder().moveTo(10, 20).lineTo(110, 20).lineTo(110, 120).lineTo(10, 120).close().build();
    const result = meshFromPathNode.execute({ path: { type: 'path', value: rect } as NodeValue }, { rows: 2, cols: 2 });
    const mesh = (result.mesh as NodeValue).value as any;
    expect(mesh.rows).toBe(2);
    expect(mesh.cols).toBe(2);
    // First vertex should be at path bounds origin
    expect(mesh.vertices[0].position.x).toBeCloseTo(10, 0);
    expect(mesh.vertices[0].position.y).toBeCloseTo(20, 0);
  });

  it('should handle empty path', () => {
    const empty = new PathBuilder().build();
    const result = meshFromPathNode.execute(
      { path: { type: 'path', value: empty } as NodeValue },
      { rows: 1, cols: 1 },
    );
    const mesh = (result.mesh as NodeValue).value as any;
    expect(mesh.vertices.length).toBe(4);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement mesh-from-path-node.ts**

```typescript
/**
 * @file Mesh from Path node — fits gradient mesh grid to path bounding box
 *
 * Accessed via: MCP tool vector_create_mesh with path reference
 */

import { meshFromBounds } from '../../mesh/mesh-from-path';
import { computeBounds } from '../../path/bounds';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

export const meshFromPathNode: NodeTypeDefinition = {
  type: 'meshFromPath',
  label: 'Mesh from Path',
  category: 'generator',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'mesh', type: 'mesh' }],
  params: [
    { name: 'rows', type: 'number', default: 2, min: 1, max: 20 },
    { name: 'cols', type: 'number', default: 2, min: 1, max: 20 },
  ],
  execute(inputs, params) {
    const pathVal = inputs.path as NodeValue | undefined;
    const path = pathVal?.value as PathValue | undefined;
    const bounds = path ? computeBounds(path.commands) : { x: 0, y: 0, width: 100, height: 100 };
    const mesh = meshFromBounds(bounds, params.rows as number, params.cols as number);
    return { mesh: { type: 'mesh', value: mesh } };
  },
};
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): mesh-from-path node (HYP-308)
```

---

## Chunk 2: Envelope Distort

### Task 3: Envelope Distort Node

Deform a path using a mesh grid as the deformation field. Each point in the
path is mapped to normalized UV coordinates within the mesh's bounding box,
then displaced by the mesh vertex positions.

**Files:**

- Create: `packages/vector-engine/src/nodes/deformation/envelope-distort.ts`
- Modify: `packages/vector-engine/src/nodes/deformation/deformation.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { envelopeDistortNode } from './envelope-distort';
import { PathBuilder } from '../../path/builder';
import { meshFromBounds } from '../../mesh/mesh-from-path';

describe('envelope distort', () => {
  it('should deform path using undistorted mesh (identity)', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const mesh = meshFromBounds({ x: 0, y: 0, width: 100, height: 100 }, 1, 1);
    const result = envelopeDistortNode.execute(
      {
        path: { type: 'path', value: rect },
        mesh: { type: 'mesh', value: mesh },
      },
      {},
    );
    const outPath = (result.path as any).value;
    expect(outPath.commands.length).toBeGreaterThan(0);
  });

  it('should distort when mesh vertices are moved', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const mesh = meshFromBounds({ x: 0, y: 0, width: 100, height: 100 }, 1, 1);
    // Move top-right vertex down
    mesh.vertices[1].position = { x: 100, y: 50 };
    const result = envelopeDistortNode.execute(
      {
        path: { type: 'path', value: line },
        mesh: { type: 'mesh', value: mesh },
      },
      {},
    );
    const outPath = (result.path as any).value;
    expect(outPath.commands.length).toBeGreaterThan(0);
  });

  it('should handle mesh with multiple cells', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const mesh = meshFromBounds({ x: 0, y: 0, width: 100, height: 100 }, 2, 2);
    const result = envelopeDistortNode.execute(
      {
        path: { type: 'path', value: rect },
        mesh: { type: 'mesh', value: mesh },
      },
      {},
    );
    expect((result.path as any).value.commands.length).toBeGreaterThan(0);
  });

  it('should return empty path when no inputs', () => {
    const result = envelopeDistortNode.execute({}, {});
    expect((result.path as any).value.commands.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement envelope-distort.ts**

```typescript
/**
 * @file Envelope distort — deform path using a mesh grid
 *
 * Accessed via: Envelope distort effect in Properties panel (v1.x)
 * Tradeoffs: uses bilinear interpolation within mesh cells (not bicubic —
 *   handles are ignored in v1, same as tessellate.ts)
 */
```

Algorithm:

1. Flatten input path → polyline points
2. Get mesh bounding box (from vertex positions, not original grid bounds)
3. For each point:
   a. Compute normalized (u, v) in [0..1, 0..1] relative to the mesh's **original** grid bounds
   b. Find which mesh cell (row, col) the point falls in
   c. Get the 4 corner vertices of that cell
   d. Bilinear interpolation: `P = (1-s)(1-t)*TL + s*(1-t)*TR + (1-s)*t*BL + s*t*BR`
   where s, t are local coordinates within the cell
4. Re-fit curves with `fitCurve`

The key insight: the mesh stores where each grid point **should be**. A regular
undistorted mesh maps points to themselves (identity). Moving mesh vertices
distorts the mapped output.

Node definition:

```typescript
export const envelopeDistortNode: NodeTypeDefinition = {
  type: 'envelopeDistort',
  label: 'Envelope Distort',
  category: 'pathOp',
  inputs: [
    { name: 'path', type: 'path' },
    { name: 'mesh', type: 'mesh' },
  ],
  outputs: [{ name: 'path', type: 'path' }],
  params: [],
  execute(inputs, params) { ... },
};
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): envelope distort deformation node (HYP-308)
```

---

## Chunk 3: Segment Intersection

### Task 4: Curve Intersection Utilities

Low-level intersection functions: line×line, line×cubic, cubic×cubic.

**Files:**

- Create: `packages/vector-engine/src/curve/intersect-bezier.ts`
- Create: `packages/vector-engine/src/curve/intersect-bezier.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { intersectLineLine, intersectLineCubic, intersectCubicCubic } from './intersect-bezier';
import type { Point } from '../types';

describe('intersectLineLine', () => {
  it('should find intersection of perpendicular lines', () => {
    const hits = intersectLineLine(
      { x: 0, y: 50 },
      { x: 100, y: 50 }, // horizontal
      { x: 50, y: 0 },
      { x: 50, y: 100 }, // vertical
    );
    expect(hits.length).toBe(1);
    expect(hits[0].point.x).toBeCloseTo(50, 5);
    expect(hits[0].point.y).toBeCloseTo(50, 5);
    expect(hits[0].t1).toBeCloseTo(0.5, 5);
    expect(hits[0].t2).toBeCloseTo(0.5, 5);
  });

  it('should return empty for parallel lines', () => {
    const hits = intersectLineLine({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 10 }, { x: 100, y: 10 });
    expect(hits.length).toBe(0);
  });

  it('should return empty for non-intersecting segments', () => {
    const hits = intersectLineLine({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 60, y: 10 }, { x: 60, y: 100 });
    expect(hits.length).toBe(0);
  });
});

describe('intersectLineCubic', () => {
  it('should find intersection of horizontal line with arch curve', () => {
    // Cubic arch from (0,0) to (100,0) peaking at y≈75
    const hits = intersectLineCubic(
      { x: -10, y: 37 },
      { x: 110, y: 37 }, // horizontal line at y=37
      { x: 0, y: 0 },
      { x: 33, y: 100 },
      { x: 66, y: 100 },
      { x: 100, y: 0 },
    );
    expect(hits.length).toBe(2); // Enters and exits the arch
  });

  it('should return empty when line misses curve', () => {
    const hits = intersectLineCubic(
      { x: 0, y: 200 },
      { x: 100, y: 200 }, // way above
      { x: 0, y: 0 },
      { x: 33, y: 100 },
      { x: 66, y: 100 },
      { x: 100, y: 0 },
    );
    expect(hits.length).toBe(0);
  });
});

describe('intersectCubicCubic', () => {
  it('should find intersections of two crossing curves', () => {
    // Curve A: arch up
    // Curve B: arch down (crosses A)
    const hits = intersectCubicCubic(
      { x: 0, y: 50 },
      { x: 33, y: 150 },
      { x: 66, y: 150 },
      { x: 100, y: 50 },
      { x: 0, y: 100 },
      { x: 33, y: 0 },
      { x: 66, y: 0 },
      { x: 100, y: 100 },
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should return empty for non-intersecting curves', () => {
    const hits = intersectCubicCubic(
      { x: 0, y: 0 },
      { x: 33, y: 50 },
      { x: 66, y: 50 },
      { x: 100, y: 0 },
      { x: 0, y: 200 },
      { x: 33, y: 250 },
      { x: 66, y: 250 },
      { x: 100, y: 200 },
    );
    expect(hits.length).toBe(0);
  });
});
```

Return type:

```typescript
export interface IntersectionHit {
  point: Point;
  t1: number; // parameter on first curve (0..1)
  t2: number; // parameter on second curve (0..1)
}
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement intersect-bezier.ts**

```typescript
/**
 * @file Curve intersection algorithms — line×line, line×cubic, cubic×cubic
 *
 * Accessed via: splitIntersections() — resolves segment crossings for topology solver
 * Tradeoffs: cubic×cubic uses recursive Bézier clipping (converges in ~6 iterations
 *   for well-separated curves). Degenerate/tangent cases may produce duplicates.
 */
```

**intersectLineLine**: classic 2D line segment intersection. Solve for t1, t2 using
cross products. Return hit only if both t1, t2 ∈ [0, 1].

**intersectLineCubic**: substitute line equation into cubic, get cubic polynomial
in t. Solve with Cardano's formula or iterative Newton. For each real root t ∈ [0,1],
check if the point lies on the line segment.

Alternative simpler approach: recursive subdivision of the cubic. Split cubic at
midpoint, check if line intersects each half's bounding box. Recurse until flat enough,
then do line-line intersection. Converges fast.

**intersectCubicCubic**: Bézier clipping algorithm:

1. Compute fat line of curve A (min/max distance from chord)
2. Clip curve B against this fat line → reduce B's parameter range
3. Swap A and B, repeat
4. When both parameter ranges are small enough (< epsilon), report intersection
5. If parameter range doesn't shrink, subdivide the wider curve at midpoint, recurse on both halves

Tolerance: 1e-6 for parameter convergence.

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): curve intersection algorithms (HYP-308)
```

---

### Task 5: splitIntersections(network)

Find all pairwise segment intersections in a VectorNetwork and split segments
at intersection points, creating new vertices.

**Files:**

- Create: `packages/vector-engine/src/network/split.ts`
- Modify: `packages/vector-engine/src/network/network.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { splitIntersections } from './split';

describe('splitIntersections', () => {
  it('should split two crossing line segments at intersection', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 100 }, // diagonal \
        { x: 100, y: 0 },
        { x: 0, y: 100 }, // diagonal /
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [],
    };
    const result = splitIntersections(network);
    // Should create intersection vertex at (50, 50)
    expect(result.vertices.length).toBe(5); // 4 original + 1 intersection
    expect(result.segments.length).toBe(4); // 2 original → 4 halves
    // New vertex should be near (50, 50)
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

  it('should handle X pattern (4 regions after findRegions)', () => {
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
        // Add border edges to form 4 regions
        { start: 0, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 2, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 1, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 3, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [],
    };
    const split = splitIntersections(network);
    const regions = findRegions(split);
    expect(regions.length).toBe(4);
  });

  it('should skip segments sharing a vertex (no false intersection)', () => {
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
    expect(result.vertices.length).toBe(3); // No new vertices
    expect(result.segments.length).toBe(2);
  });

  it('should handle empty network', () => {
    const result = splitIntersections({ vertices: [], segments: [], regions: [] });
    expect(result.vertices.length).toBe(0);
  });

  it('should split cubic bezier segments', () => {
    // Two crossing curves
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 50 },
        { x: 100, y: 50 },
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 33, y: 50 }, tangentEnd: { x: -33, y: 50 } },
        { start: 2, end: 3, tangentStart: { x: 50, y: 33 }, tangentEnd: { x: -50, y: -33 } },
      ],
      regions: [],
    };
    const result = splitIntersections(network);
    expect(result.vertices.length).toBeGreaterThan(4);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement split.ts**

```typescript
/**
 * @file Split segment intersections — resolve crossings for topology solver
 *
 * Accessed via: findRegions() prerequisite — must be called before topology solver
 *   on "dirty" networks (imported SVGs, boolean results, user pen tool)
 * Assumptions: segments are defined by start/end vertex indices + tangent handles.
 *   After splitting, original segments are replaced with sub-segments.
 */
```

Algorithm:

1. For each pair of segments (i, j) where i < j:
   a. Skip if segments share a vertex (adjacent — no real intersection)
   b. Determine segment types (line or cubic based on tangent handles)
   c. Call appropriate intersection function
   d. Collect all hits with (segmentIndex, t) pairs
2. Sort hits per segment by t value
3. For each segment with hits: split into sub-segments using de Casteljau
   (reuse subdivide logic from Task 9 in Plan 2)
4. Create new vertices at intersection points
5. Return new VectorNetwork with split segments

For cubic segments: reconstruct absolute control points from vertex positions +
relative tangent handles, call `intersectCubicCubic`, then split using de Casteljau.

For line segments (both tangents are {0,0}): call `intersectLineLine`.

Mixed: call `intersectLineCubic`.

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): splitIntersections for vector network edge expansion (HYP-308)
```

---

## Chunk 4: Text Shaping

### Task 6: HarfBuzz Text Shaper

Integrate harfbuzzjs (WASM HarfBuzz port) for complex script text shaping.

**Files:**

- Modify: `packages/vector-engine/package.json` (add `harfbuzzjs` dependency)
- Create: `packages/vector-engine/src/nodes/text/shaper.ts`
- Modify: `packages/vector-engine/src/nodes/text/text.test.ts`

- [ ] **Step 1: Add dependency**

```bash
cd /Users/ultra/work/hyper-canvas-draft/.claude/worktrees/HYP-308-vector-engine/packages/vector-engine && bun add harfbuzzjs
```

- [ ] **Step 2: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { shapeText, type ShapedGlyph } from './shaper';

describe('shapeText', () => {
  it('should have correct interface', () => {
    // shapeText should accept font data, text, and return glyph positions
    expect(typeof shapeText).toBe('function');
  });

  it('should return empty array when no font blob provided', () => {
    const glyphs = shapeText(null, 'Hello', 24);
    expect(glyphs).toEqual([]);
  });

  it('should return shaped glyphs with positions', () => {
    // With a real font, this would return actual glyph data
    // For now, test the interface shape
    const glyphs = shapeText(null, '', 24);
    expect(Array.isArray(glyphs)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test — verify it fails**

- [ ] **Step 4: Implement shaper.ts**

```typescript
/**
 * @file HarfBuzz text shaper — complex script layout via WASM
 *
 * Accessed via: textToPath node — shapes text before glyph extraction
 * Assumptions: harfbuzzjs WASM must be initialized before first use.
 *   Falls back to simple left-to-right positioning if WASM unavailable.
 * Tradeoffs: WASM init is async (~50ms). Subsequent calls are fast (~1ms).
 */

export interface ShapedGlyph {
  glyphId: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
  cluster: number;
}

interface HarfBuzzInstance {
  createBlob(data: ArrayBuffer): unknown;
  createFace(blob: unknown, index: number): unknown;
  createFont(face: unknown): unknown;
  createBuffer(): unknown;
  shape(font: unknown, buffer: unknown): void;
}

let hbInstance: HarfBuzzInstance | null = null;
let initPromise: Promise<void> | null = null;

export async function initShaper(): Promise<void> {
  if (hbInstance) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const hbModule = await import('harfbuzzjs');
      // Handle CJS/ESM interop — harfbuzzjs may export factory as default or module itself
      const factory = typeof hbModule.default === 'function' ? hbModule.default : hbModule;
      hbInstance = await (factory as () => Promise<HarfBuzzInstance>)();
    } catch {
      // WASM not available — shapeText will return empty
    }
  })();
  return initPromise;
}

export function shapeText(fontBlob: ArrayBuffer | null, text: string, fontSize: number): ShapedGlyph[] {
  if (!fontBlob || !text || !hbInstance) return [];

  try {
    const blob = hbInstance.createBlob(fontBlob);
    const face = hbInstance.createFace(blob, 0);
    const font = hbInstance.createFont(face);
    font.setScale(fontSize * 64, fontSize * 64);

    const buffer = hbInstance.createBuffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();

    hbInstance.shape(font, buffer);
    const result = buffer.json(font);

    buffer.destroy();
    font.destroy();
    face.destroy();
    blob.destroy();

    return result.map((g: any) => ({
      glyphId: g.g,
      xAdvance: g.ax / 64,
      yAdvance: g.ay / 64,
      xOffset: g.dx / 64,
      yOffset: g.dy / 64,
      cluster: g.cl,
    }));
  } catch {
    return [];
  }
}
```

- [ ] **Step 5: Run test — verify it passes**

- [ ] **Step 6: Modify textToPathNode to use shaper when available**

In `text-to-path.ts`, add an optional `useShaper` param. When enabled and a font
blob is available, call `shapeText` first, then use opentype.js to convert individual
glyphs by ID instead of the simple `font.getPath()`.

```typescript
// In execute():
if (params.useShaper && fontBlob) {
  const shaped = shapeText(fontBlob, text, fontSize);
  if (shaped.length > 0) {
    let cursorX = x;
    let cursorY = y;
    for (const glyph of shaped) {
      const glyphPath = font.glyphs.get(glyph.glyphId);
      if (glyphPath) {
        const path = glyphPath.getPath(cursorX + glyph.xOffset, cursorY + glyph.yOffset, fontSize);
        // append path commands to builder...
      }
      cursorX += glyph.xAdvance;
      cursorY += glyph.yAdvance;
    }
  }
}
```

- [ ] **Step 7: Run full test suite**

- [ ] **Step 8: Commit**

```
feat(vector-engine): HarfBuzz text shaping via harfbuzzjs WASM (HYP-308)
```

---

## Chunk 5: FIG Import

### Task 7: FIG File Parser

Parse `.fig` files (Figma binary format) into decoded node data.

**Files:**

- Modify: `packages/vector-engine/package.json` (add dependencies)
- Create: `packages/vector-engine/src/import/fig-import.ts`
- Create: `packages/vector-engine/src/import/fig-import.test.ts`

- [ ] **Step 1: Add dependencies**

```bash
cd /Users/ultra/work/hyper-canvas-draft/.claude/worktrees/HYP-308-vector-engine/packages/vector-engine && bun add pako fzstd fflate
```

Note: `fflate` handles zip extraction, `pako` handles deflate, `fzstd` handles
zstandard (modern Figma exports use zstd by default). For Kiwi decoding, we implement
a minimal decoder inline — the format is varint-encoded fields with a schema header.
Schema reverse-engineered from OpenPencil's `@open-pencil/core/kiwi`.

- [ ] **Step 2: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { parseFigFile, type FigNode } from './fig-import';

describe('FIG import', () => {
  it('should export parseFigFile function', () => {
    expect(typeof parseFigFile).toBe('function');
  });

  it('should return empty result for invalid data', () => {
    const result = parseFigFile(new ArrayBuffer(0));
    expect(result.nodes).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should return errors array for malformed input', () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const result = parseFigFile(garbage.buffer);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should have correct output types', () => {
    const result = parseFigFile(new ArrayBuffer(0));
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('canvas');
  });
});
```

- [ ] **Step 3: Run test — verify it fails**

- [ ] **Step 4: Implement fig-import.ts**

```typescript
/**
 * @file FIG import — parse Figma .fig files into vector-engine graph description
 *
 * Accessed via: "Import from Figma" action
 * Assumptions: .fig files follow the Kiwi binary format. Schema is reverse-engineered
 *   and may change without notice. Unknown node types → placeholders with warnings.
 * Tradeoffs: minimal Kiwi decoder handles core types only (RECTANGLE, ELLIPSE,
 *   VECTOR, BOOLEAN_OPERATION, FRAME, GROUP, TEXT). Complex features (auto-layout,
 *   variables, prototyping) are silently skipped.
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §FIG Import
 */

import pako from 'pako';
import { decompress as zstdDecompress } from 'fzstd';
import { unzipSync } from 'fflate';

export interface FigNode {
  type: string;
  name: string;
  id: string;
  children: FigNode[];
  properties: Record<string, unknown>;
}

export interface FigParseResult {
  nodes: FigNode[];
  canvas: { width: number; height: number };
  errors: string[];
}

export function parseFigFile(data: ArrayBuffer): FigParseResult {
  const errors: string[] = [];

  if (data.byteLength === 0) {
    errors.push('Empty file');
    return { nodes: [], canvas: { width: 0, height: 0 }, errors };
  }

  try {
    const bytes = new Uint8Array(data);

    // Check for zip header (PK\x03\x04)
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;

    let payload: Uint8Array;
    if (isZip) {
      // Extract canvas.fig from zip using fflate
      const unzipped = unzipSync(bytes);
      const canvasFig = unzipped['canvas.fig'];
      if (!canvasFig) {
        errors.push('No canvas.fig found in zip archive');
        return { nodes: [], canvas: { width: 0, height: 0 }, errors };
      }
      payload = canvasFig;
    } else {
      payload = bytes;
    }

    // Try zstd first (modern Figma), then zlib (legacy), then raw
    let decompressed: Uint8Array;
    try {
      decompressed = zstdDecompress(payload);
    } catch {
      try {
        decompressed = pako.inflate(payload);
      } catch {
        decompressed = payload; // Already uncompressed
      }
    }

    // Parse Kiwi binary
    const figNodes = decodeKiwi(decompressed, errors);

    // Extract canvas size from root DOCUMENT node
    const canvas = extractCanvasSize(figNodes);

    return { nodes: figNodes, canvas, errors };
  } catch (err) {
    errors.push(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
    return { nodes: [], canvas: { width: 0, height: 0 }, errors };
  }
}
```

The `decodeKiwi` and `extractFromZip` functions are internal helpers. For v1,
`decodeKiwi` handles a simplified subset of the Kiwi format — enough to extract
node types, names, transforms, and geometry blobs.

- [ ] **Step 5: Run test — verify it passes**

- [ ] **Step 6: Commit**

```
feat(vector-engine): FIG file parser with Kiwi binary decoder (HYP-308)
```

---

### Task 8: FIG Node Mapper

Convert parsed FIG nodes into vector-engine ImportResult (nodes + edges).

**Files:**

- Create: `packages/vector-engine/src/import/fig-mapper.ts`
- Modify: `packages/vector-engine/src/import/fig-import.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { mapFigToGraph } from './fig-mapper';
import type { FigNode } from './fig-import';

describe('FIG node mapper', () => {
  it('should map RECTANGLE to rectangle node', () => {
    const figNodes: FigNode[] = [
      {
        type: 'RECTANGLE',
        name: 'Rect1',
        id: 'node-1',
        children: [],
        properties: { width: 100, height: 50, x: 10, y: 20 },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    const rect = result.nodes.find((n) => n.type === 'rectangle');
    expect(rect).toBeDefined();
    expect(rect!.params.width).toBe(100);
  });

  it('should map ELLIPSE to ellipse node', () => {
    const figNodes: FigNode[] = [
      {
        type: 'ELLIPSE',
        name: 'Circle1',
        id: 'node-2',
        children: [],
        properties: { width: 100, height: 100 },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    expect(result.nodes.find((n) => n.type === 'ellipse')).toBeDefined();
  });

  it('should map VECTOR to svgPath node', () => {
    const figNodes: FigNode[] = [
      {
        type: 'VECTOR',
        name: 'Path1',
        id: 'node-3',
        children: [],
        properties: { fillGeometry: 'M 0 0 L 100 0 L 100 100 Z' },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    expect(result.nodes.find((n) => n.type === 'svgPath')).toBeDefined();
  });

  it('should map GROUP with children', () => {
    const figNodes: FigNode[] = [
      {
        type: 'GROUP',
        name: 'Group1',
        id: 'node-4',
        children: [
          {
            type: 'RECTANGLE',
            name: 'Child',
            id: 'node-5',
            children: [],
            properties: { width: 50, height: 50 },
          },
        ],
        properties: {},
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    expect(result.nodes.find((n) => n.type === 'group')).toBeDefined();
    expect(result.nodes.find((n) => n.type === 'rectangle')).toBeDefined();
  });

  it('should add fill node for solid fills', () => {
    const figNodes: FigNode[] = [
      {
        type: 'RECTANGLE',
        name: 'Colored',
        id: 'node-6',
        children: [],
        properties: {
          width: 100,
          height: 100,
          fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }],
        },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    const fill = result.nodes.find((n) => n.type === 'fill');
    expect(fill).toBeDefined();
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle unknown node types gracefully', () => {
    const figNodes: FigNode[] = [
      {
        type: 'UNKNOWN_FANCY_THING',
        name: 'Mystery',
        id: 'node-99',
        children: [],
        properties: {},
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    // Should not crash, may produce a placeholder or skip
    expect(result.nodes.length).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement fig-mapper.ts**

```typescript
/**
 * @file FIG node mapper — converts parsed Figma nodes to vector-engine graph
 *
 * Accessed via: FIG import pipeline — maps Figma node types to engine node types
 * Tradeoffs: component instances are flattened (overrides resolved at import time).
 *   Auto-layout, variables, and prototyping are skipped with warnings.
 */

import type { ImportResult, ImportedNode, ImportedEdge } from './svg-import';
import type { FigNode } from './fig-import';

export function mapFigToGraph(figNodes: FigNode[], canvas: { width: number; height: number }): ImportResult {
  const nodes: ImportedNode[] = [];
  const edges: ImportedEdge[] = [];
  let idCounter = 0;
  const nextId = () => `fig-${idCounter++}`;

  function walk(figNode: FigNode, parentId?: string): void {
    switch (figNode.type) {
      case 'RECTANGLE': {
        /* map to rectangle node + style nodes */ break;
      }
      case 'ELLIPSE': {
        /* map to ellipse node */ break;
      }
      case 'VECTOR': {
        /* map to svgPath node using fillGeometry */ break;
      }
      case 'BOOLEAN_OPERATION': {
        /* map to boolean node */ break;
      }
      case 'GROUP':
      case 'FRAME': {
        /* map to group node, recurse children */ break;
      }
      case 'TEXT': {
        /* map to textToPath node */ break;
      }
      default: {
        /* skip with warning */ break;
      }
    }
    // Map fills → fill node, strokes → stroke node, effects → shadow/blur nodes
    // Wire edges: generator → fill → stroke
  }

  for (const node of figNodes) walk(node);

  return { nodes, edges, canvas };
}
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): FIG node mapper — Figma types to engine graph (HYP-308)
```

---

## Chunk 6: Register & Polish

### Task 9: Register New Nodes + Update Exports

**Files:**

- Modify: `packages/vector-engine/src/nodes/register-all.ts`
- Modify: `packages/vector-engine/src/index.ts`
- Modify: `packages/vector-engine/src/network/index.ts`

- [ ] **Step 1: Update register-all.ts**

Add 4 new nodes:

```typescript
import { gradientMeshNode } from './mesh/gradient-mesh';
import { meshFromPathNode } from './mesh/mesh-from-path-node';
import { envelopeDistortNode } from './deformation/envelope-distort';

// In function body:
registry.register(gradientMeshNode);
registry.register(meshFromPathNode);
registry.register(envelopeDistortNode);
```

Note: textToPath is already registered. The shaper integration modifies its
behavior but doesn't add a new node.

- [ ] **Step 2: Update index.ts**

```typescript
// Mesh nodes (Plan 2b)
export { gradientMeshNode } from './nodes/mesh/gradient-mesh';
export { meshFromPathNode } from './nodes/mesh/mesh-from-path-node';
// Envelope distort
export { envelopeDistortNode } from './nodes/deformation/envelope-distort';
// Curve intersection
export {
  intersectLineLine,
  intersectLineCubic,
  intersectCubicCubic,
  type IntersectionHit,
} from './curve/intersect-bezier';
// Network: splitIntersections
export { splitIntersections } from './network/split';
// Text shaping
export { shapeText, initShaper, type ShapedGlyph } from './nodes/text/shaper';
// FIG import
export { parseFigFile, type FigParseResult, type FigNode } from './import/fig-import';
export { mapFigToGraph } from './import/fig-mapper';
```

- [ ] **Step 3: Update network/index.ts**

```typescript
export { splitIntersections } from './split';
```

- [ ] **Step 4: Update register-all.test.ts node count**

```typescript
expect(all.length).toBe(48); // 45 + gradientMesh + meshFromPath + envelopeDistort
```

- [ ] **Step 5: Run full test suite + lint**

```bash
bun test packages/vector-engine/ && biome check ./packages/
```

- [ ] **Step 6: Commit**

```
feat(vector-engine): register Plan 2b nodes and update public API (HYP-308)
```

---

### Task 10: Integration Tests + Coverage

**Files:**

- Modify: `packages/vector-engine/src/integration-advanced.test.ts`

- [ ] **Step 1: Add integration tests**

```typescript
describe('Plan 2b integration', () => {
  it('should create gradient mesh and tessellate', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'Mesh', 200, 200);
    const meshNode = graph.addNode({
      type: 'gradientMesh',
      params: {
        rows: 2,
        cols: 2,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        color: '#ff0000',
      },
    });
    const executor = new GraphExecutor(registry);
    // Mesh nodes don't produce path output (different NodeValue type)
    // This verifies the node executes without error
    const result = executor.execute(graph);
    expect(result.nodeStatus[meshNode].state).toBe('ok');
  });

  it('should split intersections then find regions', () => {
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
    const split = splitIntersections(network);
    expect(split.vertices.length).toBe(5);
    // After adding border edges, findRegions would work
  });

  it('should register all Plan 2b nodes', () => {
    const registry = createDefaultRegistry();
    expect(registry.get('gradientMesh')).toBeDefined();
    expect(registry.get('meshFromPath')).toBeDefined();
    expect(registry.get('envelopeDistort')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run coverage and fix any files below 80%**

```bash
bun test --coverage packages/vector-engine/
```

- [ ] **Step 3: Commit**

```
test(vector-engine): Plan 2b integration tests and coverage (HYP-308)
```

---

## Deferred to Plan 3+

| Feature                                  | Reason                                          | Plan                            |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------- |
| CanvasKit gradient mesh rendering        | Needs CanvasKit WASM initialization             | Plan 3 (Renderer)               |
| Mesh SVG export (rasterize to `<image>`) | Needs Canvas2D or CanvasKit for rasterization   | Plan 3                          |
| Mesh bezier handle interpolation         | Bilinear sufficient for v1, bicubic for quality | Plan 3                          |
| FIG vectorNetworkBlob binary decode      | Needs reverse-engineered binary format          | If OpenPencil publishes decoder |
| Complex script font loading              | Need system font enumeration                    | Plan 4 (Editor UI)              |
