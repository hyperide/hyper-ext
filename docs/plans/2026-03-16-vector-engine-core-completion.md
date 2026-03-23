# Vector Engine Core Completion — Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the headless vector engine SDK: tight bounds, missing path ops,
hit testing, CanvasKit/Clipper2 WASM backends, renderer interface, persistence format,
version migration, and graph reconciliation.

**Architecture:** Tight bounds and hit testing are pure math additions to existing
path modules. CanvasKit PathOps and Clipper2 offset replace MockPathOps with production
backends (lazy-loaded WASM). Persistence adds VectorGraphFile format with operation log
and snapshot cache. Graph reconciliation computes structural diffs between JSON-edited
graphs and live state. SVGStringRenderer wraps existing sceneToSvg with VectorRenderer
interface.

**Tech Stack:** TypeScript, bun:test, canvaskit-wasm, clipper2-wasm

**Spec:** `docs/specs/2026-03-13-vector-engine-design.md`

**Scope:** Plan 3 of ~4:
- Plan 1 (done): Core SDK — 24 nodes, SVG export, undo/redo
- Plan 2 (done): Advanced ops — 21 more nodes, deformations, vector networks
- Plan 2b (done): Gradient mesh, envelope distort, splitIntersections, HarfBuzz, FIG import
- **Plan 3 (this):** Core completion — tight bounds, hit testing, CanvasKit/Clipper2
  backends, persistence, renderer interface, reconciliation
- Plan 4: Editor UI + HyperIDE integration

---

## File Structure

```
packages/
├── vector-engine/
│   └── src/
│       ├── types.ts                              # MODIFY: add HitResult, VectorGraphFile, etc.
│       ├── index.ts                              # MODIFY: export new modules
│       ├── path/
│       │   ├── bounds.ts                         # MODIFY: tight cubic/quad bounds
│       │   ├── bounds.test.ts                    # MODIFY: add tight bounds tests
│       │   ├── hit-test.ts                       # CREATE: point-in-path, point-on-stroke
│       │   ├── hit-test.test.ts                  # CREATE
│       │   ├── nearest.ts                        # CREATE: nearest point on path
│       │   └── nearest.test.ts                   # CREATE
│       ├── nodes/
│       │   ├── register-all.ts                   # MODIFY: register new nodes
│       │   └── path-ops/
│       │       ├── add-point.ts                  # CREATE
│       │       ├── remove-point.ts               # CREATE
│       │       ├── convert-point.ts              # CREATE
│       │       ├── split-path.ts                 # CREATE
│       │       └── path-ops-plan3.test.ts        # CREATE
│       ├── persistence/
│       │   ├── types.ts                          # CREATE: VectorGraphFile, GraphOperation, etc.
│       │   ├── serialize.ts                      # CREATE: save/load JSON
│       │   ├── operation-log.ts                  # CREATE: append, compact, replay
│       │   ├── snapshot.ts                       # CREATE: SnapshotManager
│       │   ├── auto-save.ts                      # CREATE: debounced persistence
│       │   └── persistence.test.ts               # CREATE
│       ├── reconcile/
│       │   ├── diff.ts                           # CREATE: ReconciliationDiff computation
│       │   ├── apply.ts                          # CREATE: apply diff as operations
│       │   └── reconcile.test.ts                 # CREATE
│       ├── migration/
│       │   ├── migrate.ts                        # CREATE: version pipeline
│       │   └── migrate.test.ts                   # CREATE
│       └── render/
│           ├── types.ts                          # CREATE: VectorRenderer, HitResult
│           ├── svg-renderer.ts                   # CREATE: SVGStringRenderer
│           └── render.test.ts                    # CREATE
│
└── vector-wasm/
    └── src/
        ├── types.ts                              # (existing)
        ├── mock-pathops.ts                       # (existing)
        ├── canvaskit-pathops.ts                  # CREATE: real CanvasKit PathOps
        ├── canvaskit-pathops.test.ts             # CREATE: integration tests
        ├── clipper-offset.ts                     # CREATE: real Clipper2 offset
        └── clipper-offset.test.ts                # CREATE: integration tests
```

---

## Chunk 1: Tight Bounds & Missing Path Ops

### Task 1: Tight Cubic Bounds

Replace control-point hull approximation with derivative root solving for cubics.

**Files:**
- Modify: `packages/vector-engine/src/path/bounds.ts`
- Modify: `packages/vector-engine/src/path/bounds.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('tight cubic bounds', () => {
  it('should compute tight bounds for cubic with distant control point', () => {
    // Cubic from (0,0) to (100,0) with cp1=(50,200) cp2=(50,-200)
    // Control-point hull would give y:[-200, 200]
    // Tight bounds: the curve never reaches y=±200
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Cubic, cx1: 50, cy1: 200, cx2: 50, cy2: -200, x: 100, y: 0 },
    ]);
    const bounds = computeBounds(cmds);
    // Tight bounds should be much smaller than ±200
    expect(bounds.y).toBeGreaterThan(-200);
    expect(bounds.y + bounds.height).toBeLessThan(200);
    // The curve extrema should be approximately ±77 (derivative root at t≈0.21 and t≈0.79)
    expect(bounds.height).toBeLessThan(200); // Much less than 400 (control-point hull)
  });

  it('should still include endpoints', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 10, y: 20 },
      { type: PathCmd.Cubic, cx1: 50, cy1: 50, cx2: 80, cy2: 50, x: 90, y: 30 },
    ]);
    const bounds = computeBounds(cmds);
    expect(bounds.x).toBeLessThanOrEqual(10);
    expect(bounds.y).toBeLessThanOrEqual(20);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(90);
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(30);
  });
});
```

- [ ] **Step 2: Run test — verify it fails (or passes with loose bounds)**

- [ ] **Step 3: Implement tight cubic bounds**

For a cubic bezier B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3:
- B'(t) = 3[(1-t)²(P1-P0) + 2(1-t)t(P2-P1) + t²(P3-P2)]
- This is a quadratic in t: at² + bt + c = 0
- Solve for x and y independently: find t values where B'x(t)=0 and B'y(t)=0
- For each real root in [0,1]: evaluate B(t) and track

Replace the Cubic case in `computeBounds`:
```typescript
case PathCmd.Cubic: {
  // Track endpoints
  track(cmd.x, cmd.y);
  // Solve B'(t) = 0 for x and y separately
  // B'(t) = at² + bt + c where:
  // a = -3*P0 + 9*P1 - 9*P2 + 3*P3
  // b = 6*P0 - 12*P1 + 6*P2
  // c = -3*P0 + 3*P1
  for (const [p0, p1, p2, p3] of [
    [lastX, cmd.cx1, cmd.cx2, cmd.x],  // x component
    [lastY, cmd.cy1, cmd.cy2, cmd.y],  // y component
  ]) {
    const a = -3*p0 + 9*p1 - 9*p2 + 3*p3;
    const b = 6*p0 - 12*p1 + 6*p2;
    const c = -3*p0 + 3*p1;
    // Solve quadratic at² + bt + c = 0
    const roots = solveQuadratic(a, b, c);
    for (const t of roots) {
      if (t > 0 && t < 1) {
        const val = cubicAt(t, p0, p1, p2, p3);
        // Track only the relevant axis
      }
    }
  }
  break;
}
```

Helper: `cubicAt(t, p0, p1, p2, p3)` = `(1-t)³p0 + 3(1-t)²tp1 + 3(1-t)t²p2 + t³p3`

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Do the same for Quad bounds**

For quadratic B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2:
- B'(t) = 2[(1-t)(P1-P0) + t(P2-P1)] = linear in t
- Solve: t = (P0-P1) / (P0-2P1+P2)

- [ ] **Step 6: Update existing bounds tests**

Existing tests in `bounds.test.ts` assert control-point hull behavior (e.g.
"should include control points in bounds"). These are intentionally wrong now —
tight bounds are tighter than the hull. Update these tests to assert tight bounds
instead. Document the reason in the commit message: "Behavior change: tight bounds
replace control-point hull approximation."

- [ ] **Step 7: Run full test suite**

- [ ] **Step 8: Commit**

```
fix(vector-engine): tight cubic and quad bounding box via derivative root solving (HYP-308)
```

---

### Task 2: Add Point & Remove Point Nodes

**Files:**
- Create: `packages/vector-engine/src/nodes/path-ops/add-point.ts`
- Create: `packages/vector-engine/src/nodes/path-ops/remove-point.ts`
- Create: `packages/vector-engine/src/nodes/path-ops/path-ops-plan3.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('add point', () => {
  it('should add point on a line segment at given position', () => {
    const path = new PathBuilder()
      .moveTo(0, 0).lineTo(100, 0).build();
    const result = addPointNode.execute(
      { path: { type: 'path', value: path } },
      { segmentIndex: 0, t: 0.5 },
    );
    const cmds = decodeCommands((result.path as any).value.commands);
    expect(cmds.filter((c) => c.type === PathCmd.Line).length).toBe(2);
  });
});

describe('remove point', () => {
  it('should remove a vertex and merge adjacent segments', () => {
    const path = new PathBuilder()
      .moveTo(0, 0).lineTo(50, 0).lineTo(100, 0).build();
    const result = removePointNode.execute(
      { path: { type: 'path', value: path } },
      { pointIndex: 1 },
    );
    const cmds = decodeCommands((result.path as any).value.commands);
    // Middle point removed → single line from (0,0) to (100,0)
    expect(cmds.filter((c) => c.type === PathCmd.Line).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement**

`addPointNode` — reuses `subdivide` logic (de Casteljau) but exposes as "add anchor point".
`removePointNode` — removes a vertex by index, connects prev→next with a line (or cubic if adjacent segments were curves).

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): add point and remove point path operations (HYP-308)
```

---

### Task 3: Convert Point Type & Split Path Nodes

**Files:**
- Create: `packages/vector-engine/src/nodes/path-ops/convert-point.ts`
- Create: `packages/vector-engine/src/nodes/path-ops/split-path.ts`
- Modify: `packages/vector-engine/src/nodes/path-ops/path-ops-plan3.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('convert point type', () => {
  it('should convert corner to smooth (add cubic handles)', () => {
    const zigzag = new PathBuilder()
      .moveTo(0, 0).lineTo(50, 100).lineTo(100, 0).build();
    const result = convertPointNode.execute(
      { path: { type: 'path', value: zigzag } },
      { pointIndex: 1, pointType: 'smooth' },
    );
    const cmds = decodeCommands((result.path as any).value.commands);
    const hasCubics = cmds.some((c) => c.type === PathCmd.Cubic);
    expect(hasCubics).toBe(true);
  });

  it('should convert smooth to corner (remove handles)', () => {
    const curve = new PathBuilder()
      .moveTo(0, 0).cubicTo(33, 100, 66, 100, 100, 0).build();
    const result = convertPointNode.execute(
      { path: { type: 'path', value: curve } },
      { pointIndex: 1, pointType: 'corner' },
    );
    const cmds = decodeCommands((result.path as any).value.commands);
    // Endpoint of cubic → line
    const hasLine = cmds.some((c) => c.type === PathCmd.Line);
    expect(hasLine).toBe(true);
  });
});

describe('split path', () => {
  it('should split path at offset into two sub-paths', () => {
    const path = new PathBuilder()
      .moveTo(0, 0).lineTo(100, 0).lineTo(200, 0).build();
    const result = splitPathNode.execute(
      { path: { type: 'path', value: path } },
      { offset: 0.5 },
    );
    // Should output two paths
    expect((result.pathA as any).type).toBe('path');
    expect((result.pathB as any).type).toBe('path');
  });
});
```

- [ ] **Step 2: Implement and test**

`convertPointNode` — changes point type: `smooth` adds symmetric cubic handles, `corner` replaces curves with lines, `symmetric` mirrors handle lengths.

`splitPathNode` — two outputs (`pathA`, `pathB`). Uses `pointAtOffset` to find cut point, `subdivide` to split at that segment, then separates into two PathValues.

- [ ] **Step 3: Commit**

```
feat(vector-engine): convert point type and split path operations (HYP-308)
```

---

## Chunk 2: Hit Testing

### Task 4: Point-in-Path (Winding Number)

**Files:**
- Create: `packages/vector-engine/src/path/hit-test.ts`
- Create: `packages/vector-engine/src/path/hit-test.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { pointInPath, pointOnStroke } from './hit-test';
import { PathBuilder } from './builder';

describe('pointInPath', () => {
  it('should return true for point inside closed rectangle', () => {
    const rect = new PathBuilder()
      .moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    expect(pointInPath({ x: 50, y: 50 }, rect)).toBe(true);
  });

  it('should return false for point outside rectangle', () => {
    const rect = new PathBuilder()
      .moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    expect(pointInPath({ x: 150, y: 50 }, rect)).toBe(false);
  });

  it('should return false for open path', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    expect(pointInPath({ x: 50, y: 0 }, line)).toBe(false);
  });

  it('should handle concave polygon', () => {
    // L-shaped polygon
    const L = new PathBuilder()
      .moveTo(0, 0).lineTo(50, 0).lineTo(50, 50)
      .lineTo(100, 50).lineTo(100, 100).lineTo(0, 100).close().build();
    expect(pointInPath({ x: 25, y: 25 }, L)).toBe(true);   // inside
    expect(pointInPath({ x: 75, y: 25 }, L)).toBe(false);  // in the notch
    expect(pointInPath({ x: 75, y: 75 }, L)).toBe(true);   // inside
  });

  it('should handle path with curves', () => {
    // Circle approximated with cubics
    const k = 0.5522847498;
    const r = 50;
    const circle = new PathBuilder()
      .moveTo(r, 0)
      .cubicTo(r, r*k, r*k, r, 0, r)
      .cubicTo(-r*k, r, -r, r*k, -r, 0)
      .cubicTo(-r, -r*k, -r*k, -r, 0, -r)
      .cubicTo(r*k, -r, r, -r*k, r, 0)
      .close().build();
    expect(pointInPath({ x: 0, y: 0 }, circle)).toBe(true);
    expect(pointInPath({ x: 60, y: 0 }, circle)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement pointInPath**

Algorithm: Ray casting (even-odd rule) or winding number.
1. Flatten path to polyline (tolerance 0.5)
2. Cast horizontal ray from point to +infinity
3. Count intersections with polygon edges
4. Odd count → inside, even → outside

```typescript
/**
 * @file Hit testing — point-in-path and point-on-stroke
 *
 * Accessed via: Selection tool click — determines which shape was clicked
 * Tradeoffs: uses flattened polyline for hit testing (not exact curve geometry).
 *   Tolerance 0.5px provides pixel-accurate results at normal zoom levels.
 */
```

- [ ] **Step 3: Run test — verify it passes**

- [ ] **Step 4: Commit**

```
feat(vector-engine): point-in-path hit testing via ray casting (HYP-308)
```

---

### Task 5: Point-on-Stroke & Nearest Point

**Files:**
- Modify: `packages/vector-engine/src/path/hit-test.ts` (add pointOnStroke)
- Create: `packages/vector-engine/src/path/nearest.ts`
- Create: `packages/vector-engine/src/path/nearest.test.ts`
- Modify: `packages/vector-engine/src/path/hit-test.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('pointOnStroke', () => {
  it('should return true for point near stroke', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    expect(pointOnStroke({ x: 50, y: 2 }, line, 5)).toBe(true); // within 5px
  });

  it('should return false for point far from stroke', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    expect(pointOnStroke({ x: 50, y: 20 }, line, 5)).toBe(false);
  });
});

// nearest.test.ts
describe('nearestPointOnPath', () => {
  it('should find nearest point on horizontal line', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = nearestPointOnPath({ x: 50, y: 30 }, line);
    expect(result.point.x).toBeCloseTo(50, 1);
    expect(result.point.y).toBeCloseTo(0, 1);
    expect(result.distance).toBeCloseTo(30, 1);
  });

  it('should clamp to endpoints', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = nearestPointOnPath({ x: -50, y: 0 }, line);
    expect(result.point.x).toBeCloseTo(0, 1);
    expect(result.distance).toBeCloseTo(50, 1);
  });
});
```

- [ ] **Step 2: Implement**

`pointOnStroke(point, path, tolerance)` — flatten path, check if minimum distance to any segment < tolerance.

`nearestPointOnPath(point, path)` — flatten path, find closest segment, project point onto segment, return closest point + distance + offset along path.

```typescript
export interface NearestResult {
  point: Point;
  distance: number;
  offset: number; // 0..1 normalized offset along path
}
```

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```
feat(vector-engine): point-on-stroke and nearest point on path (HYP-308)
```

---

## Chunk 3: Renderer Interface

### Task 6: VectorRenderer Interface + HitResult Types

**Files:**
- Create: `packages/vector-engine/src/render/types.ts`
- Create: `packages/vector-engine/src/render/svg-renderer.ts`
- Create: `packages/vector-engine/src/render/render.test.ts`

- [ ] **Step 1: Define types**

```typescript
// render/types.ts
/**
 * @file Renderer interface — abstraction over rendering backends
 *
 * Accessed via: Editor viewport — renders scene graph to canvas or SVG string
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Renderer
 */

import type { Point, SceneGraph } from '../types';

export interface HitResult {
  itemId: string;
  point: Point;
  /** 'fill' if point is inside shape, 'stroke' if on edge */
  hitType: 'fill' | 'stroke';
}

export interface VectorRenderer {
  render(scene: SceneGraph): string | void;
  hitTest(point: Point, scene: SceneGraph): HitResult | null;
  dispose(): void;
}
```

- [ ] **Step 2: Implement SVGStringRenderer**

```typescript
// render/svg-renderer.ts
/**
 * @file SVG string renderer — headless renderer for server-side and export
 *
 * Accessed via: SVG export, server-side rendering, AI agent tools
 * Tradeoffs: no interactive features (no hover, no selection highlight).
 *   Hit testing uses flattened polyline approximation.
 */

import { sceneToSvg } from '../export/svg';
import { pointInPath } from '../path/hit-test';
import type { Point, SceneGraph, SceneItem } from '../types';
import { isSceneItem } from '../types';
import type { HitResult, VectorRenderer } from './types';

export class SVGStringRenderer implements VectorRenderer {
  render(scene: SceneGraph): string {
    return sceneToSvg(scene);
  }

  hitTest(point: Point, scene: SceneGraph): HitResult | null {
    // Walk scene items back-to-front (last = topmost)
    for (let i = scene.items.length - 1; i >= 0; i--) {
      const entry = scene.items[i];
      if (isSceneItem(entry) && entry.visible) {
        // Check fill first (higher priority)
        if (entry.style.fill && pointInPath(point, entry.path)) {
          return { itemId: entry.id, point, hitType: 'fill' };
        }
        // Check stroke (tolerance = stroke width or 3px minimum)
        const strokeWidth = entry.style.stroke?.width ?? 0;
        if (strokeWidth > 0 && pointOnStroke(point, entry.path, Math.max(strokeWidth / 2, 1.5))) {
          return { itemId: entry.id, point, hitType: 'stroke' };
        }
      }
    }
    return null;
  }

  dispose(): void {
    // No-op for string renderer
  }
}
```

- [ ] **Step 3: Write tests**

```typescript
describe('SVGStringRenderer', () => {
  it('should render scene to SVG string', () => {
    const renderer = new SVGStringRenderer();
    const scene: SceneGraph = {
      items: [],
      canvas: { width: 100, height: 100 },
    };
    const svg = renderer.render(scene);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 100 100"');
  });

  it('should hit test items back-to-front', () => {
    // ... build scene with two overlapping rectangles
    // hit test at overlap point → should return top item
  });
});
```

- [ ] **Step 4: Commit**

```
feat(vector-engine): VectorRenderer interface and SVGStringRenderer (HYP-308)
```

---

## Chunk 4: Persistence

### Task 7: VectorGraphFile Types + Serialization

**Files:**
- Create: `packages/vector-engine/src/persistence/types.ts`
- Create: `packages/vector-engine/src/persistence/serialize.ts`
- Create: `packages/vector-engine/src/persistence/persistence.test.ts`

- [ ] **Step 1: Define types**

```typescript
// persistence/types.ts
import type { GraphDiff, GraphEdge, GraphNode } from '../types';

export interface VectorGraphMeta {
  componentPath: string;
  svgElementId?: string;
  lastExportTimestamp?: number;
}

export interface VectorGraphState {
  canvas: { width: number; height: number };
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
  muted: string[];
}

export interface GraphOperation {
  timestamp: number;
  description: string;
  diffs: GraphDiff[];
}

export interface VectorGraphFile {
  version: number;
  meta: VectorGraphMeta;
  base: VectorGraphState;
  operations: GraphOperation[];
  undoPointer: number;
  viewport: { zoom: number; panX: number; panY: number };
}
```

- [ ] **Step 2: Write tests for serialization**

```typescript
describe('VectorGraphFile serialization', () => {
  it('should serialize and deserialize graph to JSON', () => {
    const graph = VectorGraphModel.create('test', 'Test', 100, 100);
    graph.addNode({ type: 'rectangle', params: { width: 50, height: 50 } });
    const file = serializeGraph(graph, { componentPath: 'src/App.tsx' });
    const json = JSON.stringify(file);
    const loaded = deserializeGraph(JSON.parse(json));
    expect(loaded.model.nodeCount).toBe(1);
    expect(loaded.meta.componentPath).toBe('src/App.tsx');
  });

  it('should include operation log from history', () => {
    // Create graph, make changes via HistoryManager, serialize
    // Verify operations array contains the history entries
  });

  it('should reconstruct graph state from base + operations', () => {
    // Serialize graph with operations
    // Deserialize and verify final state matches
  });
});
```

- [ ] **Step 3: Add public accessors to HistoryManager**

`HistoryManager.entries` is private. Persistence needs to read and replay entries.
Add to `graph/history.ts`:
```typescript
/** All history entries (for persistence serialization) */
getEntries(): readonly HistoryEntry[] { return this.entries; }

/** Apply diffs forward onto a graph (for deserialization replay) */
applyDiffs(graph: VectorGraphModel, diffs: GraphDiff[], description: string): void { ... }
```

- [ ] **Step 4: Implement serialize/deserialize**

```typescript
export function serializeGraph(
  model: VectorGraphModel,
  meta: VectorGraphMeta,
  history?: HistoryManager,
): VectorGraphFile { ... }

export function deserializeGraph(file: VectorGraphFile): {
  model: VectorGraphModel;
  meta: VectorGraphMeta;
  history: HistoryManager;
} { ... }
```

- [ ] **Step 5: Commit**

```
feat(vector-engine): VectorGraphFile persistence format (HYP-308)
```

---

### Task 8: Operation Log + Log Compaction

**Files:**
- Create: `packages/vector-engine/src/persistence/operation-log.ts`
- Modify: `packages/vector-engine/src/persistence/persistence.test.ts`

- [ ] **Step 1: Write tests**

```typescript
describe('operation log', () => {
  it('should append operations', () => {
    const log = new OperationLog();
    log.append({ timestamp: 1, description: 'test', diffs: [] });
    expect(log.length).toBe(1);
  });

  it('should compact old operations into base state', () => {
    const log = new OperationLog();
    // Add 150 operations
    for (let i = 0; i < 150; i++) {
      log.append({ timestamp: i, description: `op-${i}`, diffs: [] });
    }
    const baseState: VectorGraphState = { canvas: { width: 100, height: 100 }, nodes: {}, edges: [], muted: [] };
    const compacted = log.compact(baseState, 100); // keep last 100
    expect(compacted.operations.length).toBeLessThanOrEqual(100);
    // Base state should have absorbed the first 50 operations
  });

  it('should replay operations onto base state', () => {
    // Create base state, add operations that add a node, replay
    // Verify the node exists in the replayed state
  });
});
```

- [ ] **Step 2: Implement OperationLog**

- [ ] **Step 3: Commit**

```
feat(vector-engine): operation log with compaction (HYP-308)
```

---

### Task 9: Snapshot Manager

**Files:**
- Create: `packages/vector-engine/src/persistence/snapshot.ts`
- Modify: `packages/vector-engine/src/persistence/persistence.test.ts`

- [ ] **Step 1: Write tests + implement SnapshotManager**

Interface-based (no actual file I/O — uses abstract storage interface):

```typescript
export interface SnapshotStorage {
  save(key: string, data: string): Promise<void>;
  load(key: string): Promise<string | null>;
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
}

export class SnapshotManager {
  constructor(private storage: SnapshotStorage) {}

  async save(graphHash: string, cache: ExecutionCache): Promise<void> { ... }
  async loadBest(graphHash: string, nodeHashes: Record<string, string>): Promise<ExecutionCache | null> { ... }
  async cleanup(prefix: string, keepCount: number): Promise<void> { ... }
}
```

Tests use in-memory `MapStorage` implementing `SnapshotStorage`.

- [ ] **Step 2: Commit**

```
feat(vector-engine): snapshot manager for execution cache persistence (HYP-308)
```

---

### Task 10: Auto-Save Infrastructure

**Files:**
- Create: `packages/vector-engine/src/persistence/auto-save.ts`
- Modify: `packages/vector-engine/src/persistence/persistence.test.ts`

- [ ] **Step 1: Implement debounced auto-save**

```typescript
/**
 * @file Auto-save — debounced persistence trigger
 *
 * Accessed via: Every graph mutation triggers debounced save
 */

export class AutoSave {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(
    private save: () => Promise<void>,
    private debounceMs: number = 500,
  ) {}

  markDirty(): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await this.save();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
```

- [ ] **Step 2: Tests + commit**

```
feat(vector-engine): debounced auto-save infrastructure (HYP-308)
```

---

## Chunk 5: CanvasKit & Clipper2 Backends

### Task 11: CanvasKit PathOps Backend

**Files:**
- Modify: `packages/vector-wasm/package.json` (add canvaskit-wasm)
- Create: `packages/vector-wasm/src/canvaskit-pathops.ts`
- Create: `packages/vector-wasm/src/canvaskit-pathops.test.ts`

- [ ] **Step 1: Add dependency**

```bash
cd packages/vector-wasm && bun add canvaskit-wasm
```

- [ ] **Step 2: Write failing tests**

```typescript
import { describe, expect, it, beforeAll } from 'bun:test';
import { CanvasKitPathOps, initCanvasKit } from './canvaskit-pathops';
import { PathBuilder } from 'vector-engine';

describe('CanvasKitPathOps', () => {
  let pathOps: CanvasKitPathOps;

  beforeAll(async () => {
    const ck = await initCanvasKit();
    pathOps = new CanvasKitPathOps(ck);
  }, 10000);

  it('should compute boolean union of two rectangles', () => {
    const a = new PathBuilder()
      .moveTo(0, 0).lineTo(60, 0).lineTo(60, 60).lineTo(0, 60).close().build();
    const b = new PathBuilder()
      .moveTo(40, 40).lineTo(100, 40).lineTo(100, 100).lineTo(40, 100).close().build();
    const result = pathOps.boolean('union', a, b);
    expect(result.commands.length).toBeGreaterThan(0);
    expect(result.closed).toBe(true);
  });

  it('should convert stroke to filled path', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = pathOps.strokeToPath(line, 10, 'round', 'round');
    expect(result.closed).toBe(true);
  });

  it('should remove self-intersections', () => {
    const figure8 = new PathBuilder()
      .moveTo(0, 50).lineTo(100, 100).lineTo(100, 0).lineTo(0, 50).close().build();
    const result = pathOps.removeSelfIntersections(figure8);
    expect(result.commands.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Implement canvaskit-pathops.ts**

```typescript
/**
 * @file CanvasKit PathOps — WASM backend for boolean path operations
 *
 * Accessed via: createDefaultRegistry({ pathOps: new CanvasKitPathOps(ck) })
 * Assumptions: CanvasKit instance must be initialized via initCanvasKit() first.
 * Tradeoffs: ~1.4MB gzipped WASM on first load. Path conversion overhead per call.
 */
```

Key implementation:
- `pathValueToSkPath(ck, pathValue)` — decode Float64Array → CanvasKit Path
- `skPathToPathValue(ck, skPath)` — iterate CanvasKit Path verbs → Float64Array
- Each PathOpsBackend method: convert inputs, call CanvasKit API, convert result
- `initCanvasKit()` — lazy WASM loader, returns CanvasKit instance

- [ ] **Step 4: Run test — verify it passes**

If canvaskit-wasm doesn't load in bun test environment, the `beforeAll` will throw
and all tests skip. This is acceptable — the MockPathOps unit tests still run.

- [ ] **Step 5: Commit**

```
feat(vector-wasm): CanvasKit PathOps backend (HYP-308)
```

---

### Task 12: Clipper2 Path Offset Backend

**Files:**
- Modify: `packages/vector-wasm/package.json` (add clipper2-wasm)
- Create: `packages/vector-wasm/src/clipper-offset.ts`
- Create: `packages/vector-wasm/src/clipper-offset.test.ts`

- [ ] **Step 1: Add dependency**

```bash
cd packages/vector-wasm && bun add clipper2-wasm
```

Note: `clipper2-wasm` (npm, BSL-1.0) is the correct package for Clipper2.
NOT `js-angusj-clipper` (which wraps the older Clipper1).

- [ ] **Step 2: Write failing tests**

```typescript
import { describe, expect, it, beforeAll } from 'bun:test';
import { Clipper2Offset, initClipper2 } from './clipper-offset';
import { PathBuilder } from 'vector-engine';

describe('Clipper2Offset', () => {
  let clipper: Clipper2Offset;

  beforeAll(async () => {
    const c2 = await initClipper2();
    clipper = new Clipper2Offset(c2);
  }, 10000);

  it('should inflate a rectangle', () => {
    const rect = new PathBuilder()
      .moveTo(10, 10).lineTo(90, 10).lineTo(90, 90).lineTo(10, 90).close().build();
    const result = clipper.offset(rect, 5);
    expect(result.commands.length).toBeGreaterThan(rect.commands.length);
  });

  it('should deflate a rectangle', () => {
    const rect = new PathBuilder()
      .moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = clipper.offset(rect, -10);
    expect(result.commands.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Implement clipper-offset.ts**

```typescript
/**
 * @file Clipper2 offset — inflate/deflate path contours
 *
 * Accessed via: Path Offset node — grow or shrink shape outlines
 * Assumptions: uses integer-coordinate Clipper2 internally. Float coords
 *   are scaled by SCALE_FACTOR (1000) before processing.
 */

const SCALE_FACTOR = 1000;
```

Convert PathValue → integer Clipper2 points (×1000), run ClipperOffset, convert back (÷1000).

- [ ] **Step 4: Run test, commit**

```
feat(vector-wasm): Clipper2 path offset backend (HYP-308)
```

---

## Chunk 6: Version Migration

### Task 13: Version Migration Pipeline

**Files:**
- Create: `packages/vector-engine/src/migration/migrate.ts`
- Create: `packages/vector-engine/src/migration/migrate.test.ts`

- [ ] **Step 1: Write tests**

```typescript
describe('version migration', () => {
  it('should migrate v1 graph to current version', () => {
    const v1Graph: VectorGraphFile = {
      version: 1,
      meta: { componentPath: '' },
      base: { canvas: { width: 100, height: 100 }, nodes: {}, edges: [], muted: [] },
      operations: [],
      undoPointer: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
    };
    const migrated = migrateGraph(v1Graph);
    expect(migrated.version).toBe(CURRENT_VERSION);
  });

  it('should refuse to open future version', () => {
    const futureGraph: VectorGraphFile = {
      version: 999,
      meta: { componentPath: '' },
      base: { canvas: { width: 100, height: 100 }, nodes: {}, edges: [], muted: [] },
      operations: [],
      undoPointer: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
    };
    expect(() => migrateGraph(futureGraph)).toThrow(/version/i);
  });

  it('should apply migrations sequentially', () => {
    // Register a v1→v2 migration that adds a field
    // Verify the field exists after migration
  });
});
```

- [ ] **Step 2: Implement**

```typescript
export const CURRENT_VERSION = 1;

type Migration = (graph: VectorGraphFile) => VectorGraphFile;
const migrations: Map<number, Migration> = new Map();

export function registerMigration(fromVersion: number, fn: Migration): void {
  migrations.set(fromVersion, fn);
}

export function migrateGraph(graph: VectorGraphFile): VectorGraphFile {
  if (graph.version > CURRENT_VERSION) {
    throw new Error(`Cannot open graph version ${graph.version} (current: ${CURRENT_VERSION})`);
  }
  let current = graph;
  while (current.version < CURRENT_VERSION) {
    const fn = migrations.get(current.version);
    if (!fn) throw new Error(`No migration from v${current.version}`);
    current = fn(current);
  }
  return current;
}
```

- [ ] **Step 3: Commit**

```
feat(vector-engine): version migration pipeline (HYP-308)
```

---

## Chunk 7: Graph Reconciliation

### Task 14: Reconciliation Diff

**Files:**
- Create: `packages/vector-engine/src/reconcile/diff.ts`
- Create: `packages/vector-engine/src/reconcile/reconcile.test.ts`

- [ ] **Step 1: Write tests**

```typescript
describe('reconciliation diff', () => {
  it('should detect added node', () => {
    const current: VectorGraphState = {
      canvas: { width: 100, height: 100 },
      nodes: { n1: { id: 'n1', type: 'rectangle', params: {} } },
      edges: [],
      muted: [],
    };
    const modified: VectorGraphState = {
      ...current,
      nodes: {
        n1: current.nodes.n1,
        n2: { id: 'n2', type: 'ellipse', params: {} },
      },
    };
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.added.nodes.length).toBe(1);
    expect(diff.added.nodes[0].id).toBe('n2');
  });

  it('should detect removed node', () => { ... });
  it('should detect param change', () => { ... });
  it('should detect mute toggle', () => { ... });
  it('should detect added/removed edges', () => { ... });
});
```

- [ ] **Step 2: Implement ReconciliationDiff**

```typescript
export interface ReconciliationDiff {
  added: { nodes: GraphNode[]; edges: GraphEdge[] };
  removed: { nodeIds: string[]; edgeIds: string[] };
  modified: {
    params: Array<{ nodeId: string; changes: Record<string, { old: unknown; new: unknown }> }>;
    reordered: Array<{
      edgeId: string;
      old: { source: string; target: string };
      new: { source: string; target: string };
    }>;
    muted: { added: string[]; removed: string[] };
  };
  meta: { canvasChanged: boolean; viewportChanged: boolean };
}

export function computeReconciliationDiff(
  current: VectorGraphState,
  modified: VectorGraphState,
): ReconciliationDiff { ... }
```

- [ ] **Step 3: Commit**

```
feat(vector-engine): graph reconciliation diff algorithm (HYP-308)
```

---

### Task 15: Apply Reconciliation

**Files:**
- Create: `packages/vector-engine/src/reconcile/apply.ts`
- Modify: `packages/vector-engine/src/reconcile/reconcile.test.ts`

- [ ] **Step 1: Write tests**

```typescript
describe('apply reconciliation', () => {
  it('should apply diff as undoable operations', () => {
    const graph = VectorGraphModel.create('test', 'Test', 100, 100);
    graph.addNode({ type: 'rectangle', params: { width: 50, height: 50 } });
    const history = new HistoryManager(graph);

    const diff: ReconciliationDiff = {
      added: { nodes: [{ id: 'new-1', type: 'ellipse', params: { rx: 25, ry: 25 } }], edges: [] },
      removed: { nodeIds: [], edgeIds: [] },
      modified: { params: [], reordered: [], muted: { added: [], removed: [] } },
      meta: { canvasChanged: false, viewportChanged: false },
    };

    applyReconciliation(graph, history, diff);
    expect(graph.nodeCount).toBe(2); // original + added
    // Should be undoable
    history.undo(graph);
    expect(graph.nodeCount).toBe(1);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
export function applyReconciliation(
  graph: VectorGraphModel,
  history: HistoryManager,
  diff: ReconciliationDiff,
): void {
  // Convert diff to GraphDiff[] array
  // Apply via history.applyDiffs(graph, diffs, 'Reconciled from JSON edit')
}
```

- [ ] **Step 3: Commit**

```
feat(vector-engine): apply reconciliation as undoable operations (HYP-308)
```

---

## Chunk 8: Register & Polish

### Task 16: Register New Nodes + Update Exports

**Files:**
- Modify: `packages/vector-engine/src/nodes/register-all.ts`
- Modify: `packages/vector-engine/src/index.ts`

Add new nodes: addPointNode, removePointNode, convertPointNode, splitPathNode.
Export all new modules: hit-test, nearest, render/*, persistence/*, reconcile/*, migration/*.

Update node count test.

- [ ] **Step 1: Wire everything**

- [ ] **Step 2: Run full test suite + lint + coverage**

```bash
bun test packages/vector-engine/ && bun test --coverage packages/vector-engine/ && biome check ./packages/
```

Verify ≥80% line coverage on all new files.

- [ ] **Step 3: Commit**

```
feat(vector-engine): register Plan 3 nodes and update public API (HYP-308)
```

---

### Task 17: Integration Tests + Coverage

**Files:**
- Modify: `packages/vector-engine/src/integration-advanced.test.ts`

- [ ] **Step 1: Add comprehensive integration tests**

```typescript
describe('Plan 3 integration', () => {
  it('should compute tight bounds for curve-heavy path', () => { ... });
  it('should hit test shapes in a multi-item scene', () => { ... });
  it('should serialize, deserialize, and reconstruct graph', () => { ... });
  it('should reconcile JSON edits into live graph', () => { ... });
  it('should split and add points on paths', () => { ... });
});
```

- [ ] **Step 2: Fix any coverage gaps**

- [ ] **Step 3: Commit**

```
test(vector-engine): Plan 3 integration tests and coverage (HYP-308)
```

---

## Deferred to Plan 4 (Integration)

| Feature | Reason |
|---------|--------|
| Kiwi binary serialization | JSON works for v1. Kiwi codec adds complexity without immediate value. |
| TSX semantic diff (reverse sync) | Needs file watcher + HyperIDE integration context. |
| CanvasKitRenderer | Needs HTMLCanvasElement (browser/webview). SVGStringRenderer serves for headless. |
| Graph file watcher | Environment-dependent (VS Code, SaaS, CLI all different). |
| Toolbar integration | Plan 4 — Editor UI. |
