# Vector Engine Core SDK — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless vector engine SDK — create shapes, apply operations,
execute the node graph, export SVG — all without UI, renderer, or HyperIDE integration.

**Architecture:** Two packages: `vector-engine` (graph, nodes, types, export) and
`vector-wasm` (CanvasKit/Clipper2 wrappers). TypeScript orchestrates, WASM calculates.
Graph model uses `graphology` + `graphology-dag`. Nodes are pure functions registered
in a type registry. Execution follows topological order with hash-based caching.

**Tech Stack:** TypeScript, bun:test, graphology, canvaskit-wasm, clipper2-wasm, fit-curve

**Spec:** `docs/specs/2026-03-13-vector-engine-design.md`

**Scope:** This is Plan 1 of ~4:

- **Plan 1 (this):** Core SDK — types, graph, executor, generators, path ops, style,
  transform, undo/redo, SVG export
- Plan 2: Advanced ops (deformations, variable stroke, gradient mesh, text, FIG import,
  **vector networks** — Figma-style vertex/segment/region model with topology solver)
- Plan 3: Renderer (CanvasKit, hit testing, viewport)
- Plan 4: Editor UI + HyperIDE integration (tools, panels, toolbar, MCP tools)

---

## Plan 2: Vector Networks — Reference Architecture

Vector networks replace sequential SVG paths with a graph-based model where
vertices can have any number of connected segments, enabling branching (T-junctions),
automatic region detection, and non-linear editing.

**Reference:** OpenPencil (`@open-pencil/core`) — MIT, TypeScript, ~5-7K LOC

### Types (from Figma/OpenPencil model)

```typescript
interface VectorVertex {
  x: number;
  y: number;
  strokeCap?: StrokeCap;
  strokeJoin?: StrokeJoin;
  cornerRadius?: number;
  handleMirroring?: 'none' | 'angle' | 'angleAndLength';
}

interface VectorSegment {
  start: number; // vertex index
  end: number; // vertex index
  tangentStart: Point; // bezier control handle (0,0 = straight line)
  tangentEnd: Point; // bezier control handle
}

interface VectorRegion {
  windingRule: 'evenOdd' | 'nonZero';
  loops: number[][]; // arrays of segment indices forming closed chains
  fills: FillStyle[];
}

interface VectorNetwork {
  vertices: VectorVertex[];
  segments: VectorSegment[];
  regions: VectorRegion[];
}
```

### Key Algorithms

| Algorithm                    | Purpose                                       | Reference                       |
| ---------------------------- | --------------------------------------------- | ------------------------------- |
| **Minimal Cycle Basis**      | Find fillable regions from segment graph      | OpenPencil topology solver      |
| **Vector Determinant**       | Determine CW/CCW edge orientation at vertices | Standard computational geometry |
| **De Casteljau Subdivision** | Split bezier segments at parameter t          | Already in path module          |
| **Winding Number**           | Point-in-region test for fills                | Even-odd / non-zero rule        |
| **Edge Expansion**           | Replace intersections with new vertices       | O(E²) sweep line                |

### Conversions

- **VectorNetwork → PathValue[]**: Traverse each region's loops, emit M/L/C/Z per segment.
  One PathValue per region (closed, fillable).
- **PathValue → VectorNetwork**: Each command endpoint becomes a vertex, each segment
  between consecutive commands becomes a VectorSegment. Single region = entire path.
- **FIG blob → VectorNetwork**: Decode `vectorNetworkBlob` binary format via
  OpenPencil's `packages/core/src/vector.ts` encoder/decoder.

### Integration Points

- `VectorNetwork` stored as a new `NodeValue` type: `{ type: 'network'; value: VectorNetwork }`
- Generator nodes can output either `PathValue` or `VectorNetwork`
- Boolean ops accept both (convert network→paths for CanvasKit, convert result→network)
- Scene builder converts `VectorNetwork` → `PathValue[]` for SVG export
- Pen tool (Plan 4) edits `VectorNetwork` directly — the primary editing model

---

## Test Reference Sources

When implementing tests, pull edge cases and test data from these open-source projects.
Don't just write happy-path tests — these projects found real bugs that we'd hit too.

### svg-path-commander (thednp) — MIT, TypeScript

**GitHub:** `thednp/svg-path-commander`, tests in `test/`
**Relevant for:** Tasks 3 (path commands), 5 (bounds), 14 (basic ops)

| Area              | What to port                                                                                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SVG parsing**   | Implicit L after M (overloaded moveTo), shorthand S/T expansion, H/V→L conversion, relative→absolute, condensed arc flags (`00-2` = flag 0 + flag 0 + number -2), scientific notation, leading zero rejection (`M04...`), after-Z-only-M rule |
| **reversePath**   | 4 command types (line, cubic, quad, arc), arc sweep flag flip (0↔1), composite path (each sub-path reversed independently), round-trip `reverse(reverse(x)) === x`                                                                            |
| **splitPath**     | Split compound paths at M commands, count verification                                                                                                                                                                                        |
| **getPathBBox**   | **TIGHT bounds** (not control-point bounds!) for Q and C curves, rotated elliptical arcs (issue #47), empty path → zeros, kitchen-sink path with all command types                                                                            |
| **normalizePath** | `s`→`C` reflected CP, `t`→`Q` reflected CP, `v`/`h`→`L`, relative→absolute                                                                                                                                                                    |

Key insight: their bbox uses **tight bounds** (solving curve derivatives), not control-point approximation. Our Task 5 uses control-point approximation as v1 — but tests should document expected tight bounds for future upgrade.

### Paper.js — MIT, JavaScript

**GitHub:** `paperjs/paper.js`, tests in `test/tests/`
**Relevant for:** Tasks 13-14 (path ops), 17 (transforms), 20 (SVG export)

| File                      | What to port                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Path_Boolean.js**       | ~40 tests: identical paths (all 4 ops), non-intersecting paths, compound paths with holes, self-intersecting + resolveCrossings, floating-point precision (#865), chained operations |
| **Path.js**               | `reverse()`, `flatten()`, `simplify()`, `join()`, path `length()`, `area()`, `equals()`, `interpolate()` (morphing), `arcTo()` collinear edge case                                   |
| **Path_Constructors.js**  | All shapes + oversized corner radius for rounded rect                                                                                                                                |
| **Path_Intersections.js** | Tangent (non-crossing) points, endpoint intersections (t=0/1), self-intersections, nearly coincident geometry                                                                        |
| **SvgExport.js**          | Precision control, rotated shapes, non-invertible matrices, gradient transforms, clipping defs                                                                                       |
| **Matrix.js**             | Decompose rotation at 0/1/45/90/135/180/270°, non-uniform scaling, combined rotate+scale decomposition                                                                               |
| **PathItem_Contains.js**  | Point containment for compound paths, fill rules, rotated shapes                                                                                                                     |

### Graphite Editor — AGPL-3.0 (tests only as reference, not code copy)

**GitHub:** `GraphiteEditor/Graphite`, inline `#[cfg(test)]` modules
**Relevant for:** Tasks 7-8 (graph/executor), 10-11 (generators), 17 (transforms), 19 (history)

| File                        | What to port                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **vector_nodes.rs**         | Bounding box with rotation → AABB expands, beveling: excessive bevel → clamping, degenerate zero-length segment → no crash, path length with scale transform |
| **generator_nodes.rs**      | Degenerate angles (0°, 90°) → no crash/division by zero                                                                                                      |
| **proto.rs**                | Topological sort correctness, cycle detection returns error, reorder is idempotent, stable hash-based IDs                                                    |
| **intersection.rs**         | Commutative: result same regardless of operand order, line-quadratic/cubic-line/cubic-quadratic                                                              |
| **linesweeper topology.rs** | Square/diamond contour extraction, nested squares + winding, self-touching paths, proptest perturbation robustness                                           |

Key pattern: **proptest** (property-based testing) for numerical robustness — random coordinate perturbations must not crash. Consider using `fast-check` npm for similar fuzz testing.

### OpenPencil — MIT, TypeScript + Bun

**GitHub:** `open-pencil/open-pencil`, tests in `tests/`
**Relevant for:** Tasks 3 (path encoding), 5 (bounds), 20 (SVG export)

| File                   | What to port                                                                                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **vector.test.ts**     | Binary encode/decode round-trips, bezier tangent preservation, bounds with control points extending beyond endpoints, empty network bounds, region winding rules                                                                             |
| **svg-export.test.ts** | 47 scenarios: all shape types, text with style runs, opacity, rotation, stroke patterns (dash/cap/join), gradients (linear/radial), effects (drop shadow, blur, inner shadow), blend modes, clipping, flip transforms, hidden node exclusion |

### Bezier.js (Pomax) — MIT, JavaScript

**GitHub:** `Pomax/bezierjs`, tests in `test/`
**Relevant for:** Plan 2 (advanced ops), but curve property assertions useful now

| Tests               | What to port                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| **cubic.test.js**   | length, derivatives at t=0/0.5/1, normals, inflections, bbox, classify (line/cusp/loop/serpentine) |
| **outline.test.js** | Offset: uniform + graduated, horizontal/vertical/angled, validates 4-segment closed outline        |

### SVG.js — MIT, JavaScript

**GitHub:** `svgdotjs/svg.js`, tests in `spec/spec/types/`
**Relevant for:** Task 17 (transforms)

| File             | What to port                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Matrix.js**    | Decompose/recompose round-trip, multiply (multiple input formats), inverse (+ error for non-invertible), flip with center, skew with center, `around()` for origin-relative ops |
| **PathArray.js** | move/resize with proportional scaling across different SVG command types (M, H, V, L, C, S, T, Q, A)                                                                            |

### Fabric.js — MIT, JavaScript

**GitHub:** `fabricjs/fabric.js`, tests in `src/util/path/`
**Relevant for:** Task 3 (path parsing)

| Tests             | What to port                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **index.spec.ts** | Arc flag parsing without spaces, scientific notation, NaN handling in makePathSimpler, getRegularPolygonPath (pentagon, hexagon), matrix transform application to path data |

---

## File Structure

```
packages/
├── vector-engine/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                        # Public API re-exports
│       ├── types.ts                        # All value types, interfaces
│       ├── path/
│       │   ├── commands.ts                 # PathCmd enum, encode/decode Float64Array
│       │   ├── commands.test.ts
│       │   ├── builder.ts                  # Fluent PathBuilder (moveTo/lineTo/cubicTo/close)
│       │   ├── builder.test.ts
│       │   ├── bounds.ts                   # Bounding box from path commands
│       │   └── bounds.test.ts
│       ├── graph/
│       │   ├── vector-graph.ts             # VectorGraph wrapper around graphology
│       │   ├── vector-graph.test.ts
│       │   ├── executor.ts                 # Topological sort, execute, dirty tracking, cache
│       │   ├── executor.test.ts
│       │   ├── scene-builder.ts            # Executor results → SceneGraph
│       │   ├── scene-builder.test.ts
│       │   ├── history.ts                  # GraphDiff, HistoryManager (undo/redo)
│       │   └── history.test.ts
│       ├── nodes/
│       │   ├── registry.ts                 # NodeTypeDefinition registration + lookup
│       │   ├── registry.test.ts
│       │   ├── generators/
│       │   │   ├── rectangle.ts
│       │   │   ├── ellipse.ts
│       │   │   ├── polygon.ts
│       │   │   ├── star.ts
│       │   │   ├── line.ts
│       │   │   ├── arc.ts
│       │   │   ├── spiral.ts
│       │   │   ├── arrow.ts
│       │   │   └── generators.test.ts      # Tests for all generators
│       │   ├── path-ops/
│       │   │   ├── boolean.ts              # Union, Subtract, Intersect, XOR
│       │   │   ├── basic-ops.ts            # Reverse, Close/Open, Join, Break Apart
│       │   │   └── path-ops.test.ts
│       │   ├── style/
│       │   │   ├── fill.ts
│       │   │   ├── stroke.ts
│       │   │   ├── opacity.ts
│       │   │   ├── blend-mode.ts
│       │   │   └── style.test.ts
│       │   └── transform/
│       │       ├── translate.ts
│       │       ├── rotate.ts
│       │       ├── scale.ts
│       │       ├── skew.ts
│       │       └── transform.test.ts
│       └── export/
│           ├── svg.ts                      # SceneGraph → SVG string
│           └── svg.test.ts
│
└── vector-wasm/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts                        # Re-exports
        ├── types.ts                        # PathOpsBackend interface
        ├── mock-pathops.ts                 # Mock backend for unit tests
        ├── canvaskit-pathops.ts            # Real CanvasKit PathOps wrapper
        └── canvaskit-pathops.test.ts       # Integration test (loads WASM)
```

---

## Chunk 1: Infrastructure

### Task 1: Monorepo Workspace Setup

**Files:**

- Modify: `package.json` (add workspaces)
- Modify: `tsconfig.json` (add path aliases)
- Modify: `biome.jsonc` (add packages/ to includes if needed)
- Create: `packages/vector-engine/package.json`
- Create: `packages/vector-engine/tsconfig.json`
- Create: `packages/vector-engine/src/index.ts`
- Create: `packages/vector-wasm/package.json`
- Create: `packages/vector-wasm/tsconfig.json`
- Create: `packages/vector-wasm/src/index.ts`

- [ ] **Step 1: Add workspace config to root package.json**

Add `"workspaces"` field:

```jsonc
{
  "workspaces": ["packages/*"],
}
```

- [ ] **Step 2: Create vector-engine package**

`packages/vector-engine/package.json`:

```json
{
  "name": "vector-engine",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "graphology": "^0.25.4",
    "graphology-dag": "^0.4.1",
    "graphology-types": "^0.24.7"
  }
}
```

`packages/vector-engine/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "paths": {
      "vector-wasm": ["../vector-wasm/src"]
    }
  },
  "include": ["src"]
}
```

`packages/vector-engine/src/index.ts`:

```typescript
/**
 * @file Vector Engine — core SDK entry point
 *
 * Accessed via: Internal module, imported as "vector-engine" workspace package
 */
export {};
```

- [ ] **Step 3: Create vector-wasm package**

`packages/vector-wasm/package.json`:

```json
{
  "name": "vector-wasm",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "canvaskit-wasm": "^0.39.1"
  }
}
```

`packages/vector-wasm/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/vector-wasm/src/index.ts`:

```typescript
/**
 * @file WASM wrappers for compute-intensive geometry operations
 *
 * Accessed via: Internal module, imported as "vector-wasm" workspace package
 */
export {};
```

- [ ] **Step 4: Add path aliases to root tsconfig.json**

Add to `compilerOptions.paths`:

```jsonc
"@vector-engine/*": ["./packages/vector-engine/src/*"],
"@vector-wasm/*": ["./packages/vector-wasm/src/*"],
"vector-engine": ["./packages/vector-engine/src"],
"vector-wasm": ["./packages/vector-wasm/src"]
```

- [ ] **Step 5: Update root test and lint scripts**

In root `package.json`, add `./packages/` to the `test` and `lint` scripts:

```
"test": "bun test ./client/ ./lib/ ./server/ ./shared/ ./vscode-extension/hypercanvas-preview/src/ ./vscode-extension/hypercanvas-code-server/src/ ./packages/",
"lint": "biome check ./client/ ./lib/ ./server/ ./shared/ ./vscode-extension/hypercanvas-preview/src/ ./vscode-extension/hypercanvas-code-server/src/ ./packages/ && tsc --noEmit",
```

- [ ] **Step 6: Install dependencies and verify**

```bash
bun install
bun run test    # all existing tests still pass
bun run lint    # no new errors
```

- [ ] **Step 7: Commit**

```bash
git add packages/ package.json tsconfig.json biome.jsonc
git commit -m "chore: scaffold vector-engine and vector-wasm workspace packages (HYP-308)"
```

---

### Task 2: Core Types

**Files:**

- Create: `packages/vector-engine/src/types.ts`

All types from spec §Core Type System. These are the contract for the entire engine.

- [ ] **Step 1: Write types file**

```typescript
/**
 * @file Core type system for the vector engine
 *
 * Accessed via: import { PathValue, StyleValue, ... } from 'vector-engine'
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Core Type System
 */

// -- Primitives --

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 2D affine transform matrix [a, b, c, d, e, f] */
export type TransformMatrix = [number, number, number, number, number, number];

/** Identity transform */
export const IDENTITY_TRANSFORM: TransformMatrix = [1, 0, 0, 1, 0, 0];

// -- Path --

export interface PathValue {
  /** SVG path commands encoded as Float64Array for WASM interop */
  commands: Float64Array;
  /** Bounding box (computed lazily, cached) */
  bounds?: BoundingBox;
  /** Whether the path is closed */
  closed: boolean;
}

// -- Style --

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'colorDodge'
  | 'colorBurn'
  | 'hardLight'
  | 'softLight'
  | 'difference'
  | 'exclusion';

export interface GradientStop {
  offset: number;
  color: string;
}

export interface FillStyle {
  type: 'solid' | 'linearGradient' | 'radialGradient' | 'conicGradient';
  color?: string;
  stops?: GradientStop[];
  from?: Point;
  to?: Point;
  center?: Point;
  radius?: number;
}

export interface StrokeStyle {
  color: string;
  width: number;
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  dashArray?: number[];
  dashOffset?: number;
}

export interface ShadowStyle {
  color: string;
  offsetX: number;
  offsetY: number;
  blur: number;
}

export interface StyleValue {
  fill?: FillStyle;
  stroke?: StrokeStyle;
  opacity?: number;
  blendMode?: BlendMode;
  shadow?: ShadowStyle;
  blur?: number;
}

// -- Node value (discriminated union) --

export type NodeValue =
  | { type: 'path'; value: PathValue }
  | { type: 'style'; value: StyleValue }
  | { type: 'number'; value: number }
  | { type: 'color'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'transform'; value: TransformMatrix };

export type NodeValueType = NodeValue['type'];

// -- Graph --

export type ParamType = 'number' | 'string' | 'color' | 'boolean' | 'enum' | 'point' | 'gradient' | 'json';

export interface ParamDefinition {
  name: string;
  type: ParamType;
  default: unknown;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
}

export interface PortDefinition {
  name: string;
  type: NodeValueType;
  multiple?: boolean;
}

export type NodeCategory = 'generator' | 'pathOp' | 'style' | 'transform' | 'utility';

export interface NodeTypeDefinition {
  type: string;
  label: string;
  category: NodeCategory;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  params: ParamDefinition[];
  execute(
    inputs: Record<string, NodeValue | NodeValue[]>,
    params: Record<string, unknown>,
  ): Record<string, NodeValue | NodeValue[]>;
}

export interface GraphNode {
  id: string;
  type: string;
  params: Record<string, unknown>;
  position?: Point;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourcePort: string;
  targetPort: string;
}

export interface VectorGraph {
  version: number;
  id: string;
  name: string;
  canvas: { width: number; height: number };
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
  muted: string[];
  viewport: { zoom: number; panX: number; panY: number };
}

// -- Scene Graph --

export interface SceneItem {
  id: string;
  path: PathValue;
  style: StyleValue;
  transform: TransformMatrix;
  clipPath?: PathValue;
  visible: boolean;
  name?: string;
}

export interface SceneGroup {
  id: string;
  children: SceneEntry[];
  transform: TransformMatrix;
  opacity?: number;
  clipPath?: PathValue;
  visible: boolean;
  name?: string;
}

export type SceneEntry = SceneItem | SceneGroup;

export interface SceneGraph {
  items: SceneEntry[];
  canvas: { width: number; height: number };
  background?: string;
}

// -- Execution --

export type NodeExecutionState = 'ok' | 'error' | 'skipped' | 'cached';

export interface NodeExecutionStatus {
  state: NodeExecutionState;
  error?: string;
  executionTimeMs?: number;
}

export interface ExecutionResult {
  scene: SceneGraph;
  nodeStatus: Record<string, NodeExecutionStatus>;
  executionTimeMs: number;
}

// -- History --

export type GraphDiff =
  | { kind: 'paramChange'; nodeId: string; param: string; oldValue: unknown; newValue: unknown }
  | { kind: 'addNode'; node: GraphNode }
  | { kind: 'removeNode'; node: GraphNode; removedEdges: GraphEdge[] }
  | { kind: 'addEdge'; edge: GraphEdge }
  | { kind: 'removeEdge'; edge: GraphEdge }
  | { kind: 'muteNode'; nodeId: string; muted: boolean }
  | { kind: 'moveNode'; nodeId: string; oldPosition: Point; newPosition: Point };

export interface HistoryEntry {
  timestamp: number;
  description: string;
  diffs: GraphDiff[];
}

// -- Type guards --

export function isSceneGroup(entry: SceneEntry): entry is SceneGroup {
  return 'children' in entry;
}

export function isSceneItem(entry: SceneEntry): entry is SceneItem {
  return 'path' in entry;
}

// -- Scene builder input --

export interface TerminalNodeOutput {
  id: string;
  name?: string;
  path: PathValue;
  style: StyleValue;
  transform: TransformMatrix;
  visible: boolean;
}
```

- [ ] **Step 2: Export from index.ts**

```typescript
export * from './types';
```

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit -p packages/vector-engine/tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add packages/vector-engine/src/
git commit -m "feat(vector-engine): add core type system (HYP-308)"
```

---

### Task 3: Path Command System

**Files:**

- Create: `packages/vector-engine/src/path/commands.ts`
- Create: `packages/vector-engine/src/path/commands.test.ts`

Path commands are encoded as Float64Array for WASM efficiency. Each command starts
with a type discriminant followed by coordinates.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { PathCmd, encodeCommands, decodeCommands, commandsToSvgD, svgDToCommands } from './commands';

describe('PathCmd encoding', () => {
  it('should encode move + line + close', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 50 },
      { type: PathCmd.Close },
    ]);
    expect(cmds).toBeInstanceOf(Float64Array);
    // Move(0,0) = [0, 0, 0], Line(100,0) = [1, 100, 0], Line(100,50) = [1, 100, 50], Close = [5]
    expect(cmds.length).toBe(10); // 3 + 3 + 3 + 1
  });

  it('should encode cubic bezier', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Cubic, cx1: 10, cy1: 20, cx2: 30, cy2: 40, x: 50, y: 60 },
    ]);
    // Move = 3, Cubic = 7 (type + 6 coords)
    expect(cmds.length).toBe(10);
  });

  it('should roundtrip encode → decode', () => {
    const original = [
      { type: PathCmd.Move, x: 10, y: 20 },
      { type: PathCmd.Line, x: 30, y: 40 },
      { type: PathCmd.Quad, cx: 50, cy: 60, x: 70, y: 80 },
      { type: PathCmd.Close },
    ];
    const encoded = encodeCommands(original);
    const decoded = decodeCommands(encoded);
    expect(decoded).toEqual(original);
  });
});

describe('SVG d attribute conversion', () => {
  it('should convert commands to SVG d string', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 50 },
      { type: PathCmd.Close },
    ]);
    expect(commandsToSvgD(cmds)).toBe('M 0 0 L 100 0 L 100 50 Z');
  });

  it('should parse SVG d string to commands', () => {
    const cmds = svgDToCommands('M 10 20 L 30 40 C 1 2 3 4 5 6 Z');
    const decoded = decodeCommands(cmds);
    expect(decoded).toEqual([
      { type: PathCmd.Move, x: 10, y: 20 },
      { type: PathCmd.Line, x: 30, y: 40 },
      { type: PathCmd.Cubic, cx1: 1, cy1: 2, cx2: 3, cy2: 4, x: 5, y: 6 },
      { type: PathCmd.Close },
    ]);
  });

  it('should handle Q (quadratic) commands', () => {
    const cmds = svgDToCommands('M 0 0 Q 50 100 100 0 Z');
    const decoded = decodeCommands(cmds);
    expect(decoded[1]).toEqual({ type: PathCmd.Quad, cx: 50, cy: 100, x: 100, y: 0 });
  });

  // See "Test Reference Sources" section for additional edge cases from
  // svg-path-commander (arc flags, scientific notation, shorthand S/T, implicit L after M)
  // and Fabric.js (NaN handling, arc flags without spaces)
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
bun test packages/vector-engine/src/path/commands.test.ts
```

Expected: FAIL — `commands` module not found.

- [ ] **Step 3: Implement commands.ts**

```typescript
/**
 * @file Path command encoding/decoding for Float64Array WASM interop
 *
 * Accessed via: import { PathCmd, encodeCommands, ... } from 'vector-engine'
 *
 * Encoding: each command = [type discriminant, ...coordinates]
 * - Move:  [0, x, y]           (3 values)
 * - Line:  [1, x, y]           (3 values)
 * - Cubic: [2, cx1, cy1, cx2, cy2, x, y] (7 values)
 * - Quad:  [3, cx, cy, x, y]   (5 values)
 * - Arc:   [4, rx, ry, rot, largeArc, sweep, x, y] (8 values)
 * - Close: [5]                  (1 value)
 */

export enum PathCmd {
  Move = 0,
  Line = 1,
  Cubic = 2,
  Quad = 3,
  Arc = 4,
  Close = 5,
}

/** Command sizes (including the type discriminant) */
const CMD_SIZE: Record<PathCmd, number> = {
  [PathCmd.Move]: 3,
  [PathCmd.Line]: 3,
  [PathCmd.Cubic]: 7,
  [PathCmd.Quad]: 5,
  [PathCmd.Arc]: 8,
  [PathCmd.Close]: 1,
};

// Decoded command types (discriminated union)
export type PathCommand =
  | { type: PathCmd.Move; x: number; y: number }
  | { type: PathCmd.Line; x: number; y: number }
  | { type: PathCmd.Cubic; cx1: number; cy1: number; cx2: number; cy2: number; x: number; y: number }
  | { type: PathCmd.Quad; cx: number; cy: number; x: number; y: number }
  | {
      type: PathCmd.Arc;
      rx: number;
      ry: number;
      rotation: number;
      largeArc: number;
      sweep: number;
      x: number;
      y: number;
    }
  | { type: PathCmd.Close };

export function encodeCommands(commands: PathCommand[]): Float64Array {
  // Calculate total size
  let totalSize = 0;
  for (const cmd of commands) {
    totalSize += CMD_SIZE[cmd.type];
  }

  const buffer = new Float64Array(totalSize);
  let offset = 0;

  for (const cmd of commands) {
    buffer[offset++] = cmd.type;
    switch (cmd.type) {
      case PathCmd.Move:
      case PathCmd.Line:
        buffer[offset++] = cmd.x;
        buffer[offset++] = cmd.y;
        break;
      case PathCmd.Cubic:
        buffer[offset++] = cmd.cx1;
        buffer[offset++] = cmd.cy1;
        buffer[offset++] = cmd.cx2;
        buffer[offset++] = cmd.cy2;
        buffer[offset++] = cmd.x;
        buffer[offset++] = cmd.y;
        break;
      case PathCmd.Quad:
        buffer[offset++] = cmd.cx;
        buffer[offset++] = cmd.cy;
        buffer[offset++] = cmd.x;
        buffer[offset++] = cmd.y;
        break;
      case PathCmd.Arc:
        buffer[offset++] = cmd.rx;
        buffer[offset++] = cmd.ry;
        buffer[offset++] = cmd.rotation;
        buffer[offset++] = cmd.largeArc;
        buffer[offset++] = cmd.sweep;
        buffer[offset++] = cmd.x;
        buffer[offset++] = cmd.y;
        break;
      case PathCmd.Close:
        break;
    }
  }

  return buffer;
}

export function decodeCommands(buffer: Float64Array): PathCommand[] {
  const commands: PathCommand[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const type = buffer[offset++] as PathCmd;
    switch (type) {
      case PathCmd.Move:
        commands.push({ type, x: buffer[offset++], y: buffer[offset++] });
        break;
      case PathCmd.Line:
        commands.push({ type, x: buffer[offset++], y: buffer[offset++] });
        break;
      case PathCmd.Cubic:
        commands.push({
          type,
          cx1: buffer[offset++],
          cy1: buffer[offset++],
          cx2: buffer[offset++],
          cy2: buffer[offset++],
          x: buffer[offset++],
          y: buffer[offset++],
        });
        break;
      case PathCmd.Quad:
        commands.push({
          type,
          cx: buffer[offset++],
          cy: buffer[offset++],
          x: buffer[offset++],
          y: buffer[offset++],
        });
        break;
      case PathCmd.Arc:
        commands.push({
          type,
          rx: buffer[offset++],
          ry: buffer[offset++],
          rotation: buffer[offset++],
          largeArc: buffer[offset++],
          sweep: buffer[offset++],
          x: buffer[offset++],
          y: buffer[offset++],
        });
        break;
      case PathCmd.Close:
        commands.push({ type });
        break;
    }
  }

  return commands;
}

const SVG_CMD_MAP: Record<string, PathCmd> = {
  M: PathCmd.Move,
  L: PathCmd.Line,
  C: PathCmd.Cubic,
  Q: PathCmd.Quad,
  A: PathCmd.Arc,
  Z: PathCmd.Close,
};

const REVERSE_CMD_MAP: Record<PathCmd, string> = {
  [PathCmd.Move]: 'M',
  [PathCmd.Line]: 'L',
  [PathCmd.Cubic]: 'C',
  [PathCmd.Quad]: 'Q',
  [PathCmd.Arc]: 'A',
  [PathCmd.Close]: 'Z',
};

export function commandsToSvgD(buffer: Float64Array): string {
  const commands = decodeCommands(buffer);
  const parts: string[] = [];

  for (const cmd of commands) {
    const letter = REVERSE_CMD_MAP[cmd.type];
    switch (cmd.type) {
      case PathCmd.Move:
      case PathCmd.Line:
        parts.push(`${letter} ${cmd.x} ${cmd.y}`);
        break;
      case PathCmd.Cubic:
        parts.push(`${letter} ${cmd.cx1} ${cmd.cy1} ${cmd.cx2} ${cmd.cy2} ${cmd.x} ${cmd.y}`);
        break;
      case PathCmd.Quad:
        parts.push(`${letter} ${cmd.cx} ${cmd.cy} ${cmd.x} ${cmd.y}`);
        break;
      case PathCmd.Arc:
        parts.push(`${letter} ${cmd.rx} ${cmd.ry} ${cmd.rotation} ${cmd.largeArc} ${cmd.sweep} ${cmd.x} ${cmd.y}`);
        break;
      case PathCmd.Close:
        parts.push(letter);
        break;
    }
  }

  return parts.join(' ');
}

export function svgDToCommands(d: string): Float64Array {
  const tokens = d.trim().split(/[\s,]+/);
  const commands: PathCommand[] = [];
  let i = 0;

  while (i < tokens.length) {
    const letter = tokens[i++];
    const type = SVG_CMD_MAP[letter.toUpperCase()];
    if (type === undefined) continue;

    switch (type) {
      case PathCmd.Move:
      case PathCmd.Line:
        commands.push({ type, x: Number(tokens[i++]), y: Number(tokens[i++]) });
        break;
      case PathCmd.Cubic:
        commands.push({
          type,
          cx1: Number(tokens[i++]),
          cy1: Number(tokens[i++]),
          cx2: Number(tokens[i++]),
          cy2: Number(tokens[i++]),
          x: Number(tokens[i++]),
          y: Number(tokens[i++]),
        });
        break;
      case PathCmd.Quad:
        commands.push({
          type,
          cx: Number(tokens[i++]),
          cy: Number(tokens[i++]),
          x: Number(tokens[i++]),
          y: Number(tokens[i++]),
        });
        break;
      case PathCmd.Arc:
        commands.push({
          type,
          rx: Number(tokens[i++]),
          ry: Number(tokens[i++]),
          rotation: Number(tokens[i++]),
          largeArc: Number(tokens[i++]),
          sweep: Number(tokens[i++]),
          x: Number(tokens[i++]),
          y: Number(tokens[i++]),
        });
        break;
      case PathCmd.Close:
        commands.push({ type });
        break;
    }
  }

  return encodeCommands(commands);
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
bun test packages/vector-engine/src/path/commands.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/path/
git commit -m "feat(vector-engine): path command encoding/decoding + SVG d conversion (HYP-308)"
```

---

### Task 4: Path Builder

**Files:**

- Create: `packages/vector-engine/src/path/builder.ts`
- Create: `packages/vector-engine/src/path/builder.test.ts`

Fluent API for building paths. Used by all generator nodes.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { PathBuilder } from './builder';
import { decodeCommands, PathCmd } from './commands';

describe('PathBuilder', () => {
  it('should build a rectangle path', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 50).lineTo(0, 50).close().build();

    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    expect(cmds).toHaveLength(5);
    expect(cmds[0]).toEqual({ type: PathCmd.Move, x: 0, y: 0 });
    expect(cmds[4]).toEqual({ type: PathCmd.Close });
  });

  it('should build an open path', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 100).build();

    expect(path.closed).toBe(false);
  });

  it('should support cubic bezier curves', () => {
    const path = new PathBuilder().moveTo(0, 0).cubicTo(10, 20, 30, 40, 50, 60).close().build();

    const cmds = decodeCommands(path.commands);
    expect(cmds[1]).toEqual({
      type: PathCmd.Cubic,
      cx1: 10,
      cy1: 20,
      cx2: 30,
      cy2: 40,
      x: 50,
      y: 60,
    });
  });

  it('should support quadratic bezier curves', () => {
    const path = new PathBuilder().moveTo(0, 0).quadTo(50, 100, 100, 0).close().build();

    const cmds = decodeCommands(path.commands);
    expect(cmds[1]).toEqual({
      type: PathCmd.Quad,
      cx: 50,
      cy: 100,
      x: 100,
      y: 0,
    });
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
bun test packages/vector-engine/src/path/builder.test.ts
```

- [ ] **Step 3: Implement builder.ts**

`PathBuilder` accumulates `PathCommand[]`, calls `encodeCommands()` in `build()`.
Sets `closed = true` if the last command is `PathCmd.Close`.

```typescript
/**
 * @file Fluent path builder — used by all generator nodes to construct paths
 *
 * Accessed via: import { PathBuilder } from 'vector-engine'
 */

import type { PathValue } from '../types';
import { type PathCommand, PathCmd, encodeCommands } from './commands';

export class PathBuilder {
  private commands: PathCommand[] = [];

  moveTo(x: number, y: number): this {
    this.commands.push({ type: PathCmd.Move, x, y });
    return this;
  }

  lineTo(x: number, y: number): this {
    this.commands.push({ type: PathCmd.Line, x, y });
    return this;
  }

  cubicTo(cx1: number, cy1: number, cx2: number, cy2: number, x: number, y: number): this {
    this.commands.push({ type: PathCmd.Cubic, cx1, cy1, cx2, cy2, x, y });
    return this;
  }

  quadTo(cx: number, cy: number, x: number, y: number): this {
    this.commands.push({ type: PathCmd.Quad, cx, cy, x, y });
    return this;
  }

  arcTo(rx: number, ry: number, rotation: number, largeArc: number, sweep: number, x: number, y: number): this {
    this.commands.push({ type: PathCmd.Arc, rx, ry, rotation, largeArc, sweep, x, y });
    return this;
  }

  close(): this {
    this.commands.push({ type: PathCmd.Close });
    return this;
  }

  build(): PathValue {
    const lastCmd = this.commands[this.commands.length - 1];
    return {
      commands: encodeCommands(this.commands),
      closed: lastCmd?.type === PathCmd.Close,
    };
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
bun test packages/vector-engine/src/path/builder.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/path/
git commit -m "feat(vector-engine): fluent PathBuilder API (HYP-308)"
```

---

### Task 5: Bounding Box Computation

**Files:**

- Create: `packages/vector-engine/src/path/bounds.ts`
- Create: `packages/vector-engine/src/path/bounds.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { computeBounds } from './bounds';
import { PathBuilder } from './builder';

describe('computeBounds', () => {
  it('should compute bounds for a rectangle', () => {
    const path = new PathBuilder().moveTo(10, 20).lineTo(110, 20).lineTo(110, 70).lineTo(10, 70).close().build();

    const bounds = computeBounds(path.commands);
    expect(bounds).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('should compute bounds for a line', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(50, 100).build();

    const bounds = computeBounds(path.commands);
    expect(bounds).toEqual({ x: 0, y: 0, width: 50, height: 100 });
  });

  it('should return zero bounds for empty path', () => {
    const bounds = computeBounds(new Float64Array(0));
    expect(bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('should include control points in bounds for cubic curves', () => {
    const path = new PathBuilder().moveTo(0, 0).cubicTo(50, -100, 150, 200, 100, 0).build();
    const bounds = computeBounds(path.commands);
    // Control points extend to y=-100 and y=200
    expect(bounds.y).toBeLessThanOrEqual(-100);
    expect(bounds.height).toBeGreaterThanOrEqual(300);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement bounds.ts**

Iterate through commands, track min/max x/y across all endpoint coordinates.
For cubic/quad curves, use control point bounding box as approximation (tight
bounds require derivative analysis — defer to v1.x).

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/path/
git commit -m "feat(vector-engine): bounding box computation for path commands (HYP-308)"
```

---

### Task 6: Node Type Registry

**Files:**

- Create: `packages/vector-engine/src/nodes/registry.ts`
- Create: `packages/vector-engine/src/nodes/registry.test.ts`

Central registry where node types are registered and looked up by `type` string.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, beforeEach } from 'bun:test';
import { NodeRegistry } from './registry';
import type { NodeTypeDefinition, NodeValue } from '../types';

const dummyNode: NodeTypeDefinition = {
  type: 'test-rect',
  label: 'Test Rectangle',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'width', type: 'number', default: 100 },
    { name: 'height', type: 'number', default: 100 },
  ],
  execute: (_inputs, params) => ({
    path: {
      type: 'path',
      value: { commands: new Float64Array(0), closed: true },
    },
  }),
};

describe('NodeRegistry', () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
  });

  it('should register and retrieve a node type', () => {
    registry.register(dummyNode);
    const def = registry.get('test-rect');
    expect(def).toBeDefined();
    expect(def!.label).toBe('Test Rectangle');
  });

  it('should return undefined for unknown types', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should throw on duplicate registration', () => {
    registry.register(dummyNode);
    expect(() => registry.register(dummyNode)).toThrow(/already registered/);
  });

  it('should list types by category', () => {
    registry.register(dummyNode);
    const generators = registry.listByCategory('generator');
    expect(generators).toHaveLength(1);
    expect(generators[0].type).toBe('test-rect');
  });

  it('should list all registered types', () => {
    registry.register(dummyNode);
    expect(registry.listAll()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement registry.ts**

Simple `Map<string, NodeTypeDefinition>` with `register()`, `get()`,
`listByCategory()`, `listAll()`.

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/nodes/
git commit -m "feat(vector-engine): node type registry (HYP-308)"
```

---

### Task 7: VectorGraph (graphology wrapper)

**Files:**

- Create: `packages/vector-engine/src/graph/vector-graph.ts`
- Create: `packages/vector-engine/src/graph/vector-graph.test.ts`

Wraps `graphology` DirectedGraph with VectorGraph-specific operations.
Enforces DAG (no cycles), port type compatibility, and provides
serialization to/from `VectorGraph` JSON.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, beforeEach } from 'bun:test';
import { VectorGraphModel } from './vector-graph';
import type { GraphNode } from '../types';

describe('VectorGraphModel', () => {
  let graph: VectorGraphModel;

  beforeEach(() => {
    graph = VectorGraphModel.create('test', 'Test Graph', 800, 600);
  });

  it('should create an empty graph', () => {
    expect(graph.nodeCount).toBe(0);
    expect(graph.edgeCount).toBe(0);
    expect(graph.toJSON().name).toBe('Test Graph');
  });

  it('should add and retrieve nodes', () => {
    const id = graph.addNode({ type: 'rectangle', params: { width: 100, height: 50 } });
    expect(graph.getNode(id)).toBeDefined();
    expect(graph.getNode(id)!.type).toBe('rectangle');
    expect(graph.nodeCount).toBe(1);
  });

  it('should remove nodes and their edges', () => {
    const n1 = graph.addNode({ type: 'rectangle', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    expect(graph.edgeCount).toBe(1);
    graph.removeNode(n1);
    expect(graph.nodeCount).toBe(1);
    expect(graph.edgeCount).toBe(0);
  });

  it('should add edges between nodes', () => {
    const n1 = graph.addNode({ type: 'rectangle', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    const edgeId = graph.addEdge(n1, 'path', n2, 'path');
    expect(edgeId).toBeDefined();
    expect(graph.edgeCount).toBe(1);
  });

  it('should reject cycles', () => {
    const n1 = graph.addNode({ type: 'a', params: {} });
    const n2 = graph.addNode({ type: 'b', params: {} });
    graph.addEdge(n1, 'out', n2, 'in');
    expect(() => graph.addEdge(n2, 'out', n1, 'in')).toThrow(/cycle/i);
  });

  it('should return topological order', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    const n2 = graph.addNode({ type: 'offset', params: {} });
    const n3 = graph.addNode({ type: 'fill', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    graph.addEdge(n2, 'path', n3, 'path');
    const order = graph.topologicalOrder();
    expect(order.indexOf(n1)).toBeLessThan(order.indexOf(n2));
    expect(order.indexOf(n2)).toBeLessThan(order.indexOf(n3));
  });

  it('should get input node ids for a node', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    const inputs = graph.getInputEdges(n2);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].source).toBe(n1);
  });

  it('should serialize and deserialize', () => {
    const n1 = graph.addNode({ type: 'rect', params: { width: 100 } });
    const n2 = graph.addNode({ type: 'fill', params: { color: '#f00' } });
    graph.addEdge(n1, 'path', n2, 'path');

    const json = graph.toJSON();
    const restored = VectorGraphModel.fromJSON(json);
    expect(restored.nodeCount).toBe(2);
    expect(restored.edgeCount).toBe(1);
    expect(restored.getNode(n1)!.params.width).toBe(100);
  });

  it('should set and get muted state', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    expect(graph.isMuted(n1)).toBe(false);
    graph.setMuted(n1, true);
    expect(graph.isMuted(n1)).toBe(true);
  });

  it('should set param value', () => {
    const n1 = graph.addNode({ type: 'rect', params: { width: 100 } });
    graph.setParam(n1, 'width', 200);
    expect(graph.getNode(n1)!.params.width).toBe(200);
  });

  it('should set node position', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    graph.setPosition(n1, { x: 100, y: 200 });
    expect(graph.getNode(n1)!.position).toEqual({ x: 100, y: 200 });
  });

  it('should remove edge by id', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    const edgeId = graph.addEdge(n1, 'path', n2, 'path');
    expect(graph.edgeCount).toBe(1);
    graph.removeEdge(edgeId);
    expect(graph.edgeCount).toBe(0);
  });

  it('should get all edges for a node', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    const n3 = graph.addNode({ type: 'stroke', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    graph.addEdge(n1, 'path', n3, 'path');
    const edges = graph.getNodeEdges(n1);
    expect(edges).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement vector-graph.ts**

Key design decisions:

- Uses `graphology` `DirectedGraph` internally
- Node attributes store `GraphNode` data (type, params, position)
- Edge attributes store port info (sourcePort, targetPort)
- `topologicalOrder()` uses `graphology-dag`'s `topologicalSort`
- Cycle detection via `graphology-dag`'s `hasCycle` before adding edges
- `toJSON()` / `fromJSON()` convert to/from `VectorGraph` interface
- Generates UUIDs via `crypto.randomUUID()` for node/edge ids

```typescript
/**
 * @file VectorGraph — graphology wrapper with DAG enforcement
 *
 * Accessed via: import { VectorGraphModel } from 'vector-engine'
 * Assumptions: graphology and graphology-dag are installed
 */

import { DirectedGraph } from 'graphology';
import { topologicalSort, hasCycle } from 'graphology-dag';
import type { GraphNode, GraphEdge, VectorGraph } from '../types';

export class VectorGraphModel {
  private g: DirectedGraph;
  private meta: { version: number; id: string; name: string; canvas: { width: number; height: number } };
  private mutedSet: Set<string>;
  private viewport: { zoom: number; panX: number; panY: number };

  // ... constructor, static create(), static fromJSON()

  setParam(nodeId: string, param: string, value: unknown): void {
    const attrs = this.g.getNodeAttributes(nodeId);
    attrs.params = { ...attrs.params, [param]: value };
  }

  getNodeEdges(nodeId: string): GraphEdge[] {
    return this.g.edges(nodeId).map((edgeKey) => {
      const attrs = this.g.getEdgeAttributes(edgeKey);
      const [source, target] = this.g.extremities(edgeKey);
      return { id: attrs.id, source, target, sourcePort: attrs.sourcePort, targetPort: attrs.targetPort };
    });
  }

  addNode(opts: { type: string; params: Record<string, unknown>; position?: { x: number; y: number } }): string {
    const id = crypto.randomUUID();
    this.g.addNode(id, { type: opts.type, params: opts.params, position: opts.position });
    return id;
  }

  removeNode(id: string): GraphEdge[] {
    // Collect edges before removal (for undo)
    const removedEdges = this.getNodeEdges(id);
    this.g.dropNode(id);
    this.mutedSet.delete(id);
    return removedEdges;
  }

  addEdge(source: string, sourcePort: string, target: string, targetPort: string): string {
    // Temporarily add edge, check for cycles, rollback if found
    const id = crypto.randomUUID();
    const edgeKey = this.g.addDirectedEdge(source, target, { id, sourcePort, targetPort });
    if (hasCycle(this.g)) {
      this.g.dropEdge(edgeKey);
      throw new Error(`Adding edge ${source} → ${target} would create a cycle`);
    }
    return id;
  }

  removeEdge(edgeId: string): void {
    // Find edge key first, then drop outside iteration to avoid mutation during forEachEdge
    let foundKey: string | undefined;
    this.g.forEachEdge((edgeKey, attrs) => {
      if (attrs.id === edgeId) foundKey = edgeKey;
    });
    if (foundKey) this.g.dropEdge(foundKey);
  }

  setPosition(nodeId: string, position: { x: number; y: number }): void {
    const attrs = this.g.getNodeAttributes(nodeId);
    attrs.position = position;
  }

  topologicalOrder(): string[] {
    return topologicalSort(this.g);
  }

  // ... getNode, getInputEdges, isMuted, setMuted, toJSON, fromJSON
}
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/graph/
git commit -m "feat(vector-engine): VectorGraph model with DAG enforcement (HYP-308)"
```

---

### Task 8: Execution Engine (depends on Task 9: Scene Builder)

**Files:**

- Create: `packages/vector-engine/src/graph/executor.ts`
- Create: `packages/vector-engine/src/graph/executor.test.ts`

Executes the graph in topological order with dirty-set + hash-based caching.
This is the heart of the engine.

> **⚠️ EXECUTION ORDER:** Implement **Task 9 (Scene Builder) before Task 8**.
> The executor imports and calls `buildScene()` from scene-builder.ts.
> Despite the numbering, the correct order is: Task 9 → Task 8.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, beforeEach } from 'bun:test';
import { GraphExecutor } from './executor';
import { VectorGraphModel } from './vector-graph';
import { NodeRegistry } from '../nodes/registry';
import type { NodeTypeDefinition, NodeValue } from '../types';
import { PathBuilder } from '../path/builder';

// Minimal generator node for testing
const rectNode: NodeTypeDefinition = {
  type: 'test-rect',
  label: 'Rectangle',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'width', type: 'number', default: 100 },
    { name: 'height', type: 'number', default: 50 },
  ],
  execute: (_inputs, params) => {
    const w = params.width as number;
    const h = params.height as number;
    const path = new PathBuilder().moveTo(0, 0).lineTo(w, 0).lineTo(w, h).lineTo(0, h).close().build();
    return { path: { type: 'path', value: path } };
  },
};

// Pass-through node (simulates a muted operation)
const passThroughNode: NodeTypeDefinition = {
  type: 'test-passthrough',
  label: 'Pass Through',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [],
  execute: (inputs) => ({ path: inputs.path as NodeValue }),
};

describe('GraphExecutor', () => {
  let registry: NodeRegistry;
  let graph: VectorGraphModel;
  let executor: GraphExecutor;

  beforeEach(() => {
    registry = new NodeRegistry();
    registry.register(rectNode);
    registry.register(passThroughNode);
    graph = VectorGraphModel.create('test', 'Test', 800, 600);
    executor = new GraphExecutor(registry);
  });

  it('should execute a single generator node', () => {
    const n1 = graph.addNode({ type: 'test-rect', params: { width: 200, height: 100 } });
    const result = executor.execute(graph);
    expect(result.scene.items).toHaveLength(1);
    expect(result.nodeStatus[n1].state).toBe('ok');
  });

  it('should execute a chain of connected nodes', () => {
    const n1 = graph.addNode({ type: 'test-rect', params: { width: 100, height: 50 } });
    const n2 = graph.addNode({ type: 'test-passthrough', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    const result = executor.execute(graph);
    // Only terminal nodes (no outgoing edges) produce scene items
    expect(result.scene.items).toHaveLength(1);
  });

  it('should use cache on unchanged re-execution', () => {
    const n1 = graph.addNode({ type: 'test-rect', params: { width: 100, height: 50 } });
    executor.execute(graph);
    const result2 = executor.execute(graph);
    expect(result2.nodeStatus[n1].state).toBe('cached');
  });

  it('should invalidate cache when param changes', () => {
    const n1 = graph.addNode({ type: 'test-rect', params: { width: 100, height: 50 } });
    executor.execute(graph);
    graph.setParam(n1, 'width', 200);
    executor.invalidate(n1);
    const result2 = executor.execute(graph);
    expect(result2.nodeStatus[n1].state).toBe('ok');
  });

  it('should skip muted nodes (passthrough)', () => {
    const n1 = graph.addNode({ type: 'test-rect', params: { width: 100, height: 50 } });
    const n2 = graph.addNode({ type: 'test-passthrough', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    graph.setMuted(n2, true);
    const result = executor.execute(graph);
    expect(result.nodeStatus[n2].state).toBe('skipped');
    // Scene still has 1 item (from n1 passed through)
    expect(result.scene.items).toHaveLength(1);
  });

  it('should handle node execution errors gracefully', () => {
    const errorNode: NodeTypeDefinition = {
      type: 'test-error',
      label: 'Error',
      category: 'generator',
      inputs: [],
      outputs: [{ name: 'path', type: 'path' }],
      params: [],
      execute: () => {
        throw new Error('intentional failure');
      },
    };
    registry.register(errorNode);
    const n1 = graph.addNode({ type: 'test-error', params: {} });
    const result = executor.execute(graph);
    expect(result.nodeStatus[n1].state).toBe('error');
    expect(result.nodeStatus[n1].error).toContain('intentional failure');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement executor.ts**

```typescript
/**
 * @file Graph execution engine — topological walk with hash-based caching
 *
 * Accessed via: import { GraphExecutor } from 'vector-engine'
 *
 * Tradeoffs: cache keys use JSON.stringify of params + input cache keys.
 * For large graphs this could be slow — optimize with incremental hashing later.
 */

import type {
  ExecutionResult,
  NodeValue,
  NodeExecutionStatus,
  SceneGraph,
  StyleValue,
  TransformMatrix,
  TerminalNodeOutput,
} from '../types';
import { IDENTITY_TRANSFORM } from '../types';
import type { VectorGraphModel } from './vector-graph';
import type { NodeRegistry } from '../nodes/registry';

interface CacheEntry {
  hash: string;
  result: Record<string, NodeValue | NodeValue[]>;
}

export class GraphExecutor {
  private cache = new Map<string, CacheEntry>();
  private dirty = new Set<string>();

  constructor(private registry: NodeRegistry) {}

  execute(graph: VectorGraphModel): ExecutionResult {
    /* ... */
  }
  invalidate(nodeId: string): void {
    /* ... */
  }
  getCachedResult(nodeId: string): Record<string, NodeValue> | undefined {
    /* ... */
  }
  clearCache(): void {
    /* ... */
  }
}
```

Key implementation notes:

1. `execute()` calls `graph.topologicalOrder()` to get execution order
2. For each node: if node is in dirty set → force re-execute; otherwise compute
   `cacheKey = hash(nodeType, params, ...inputCacheKeys)`, check against cache
3. If cache hit and not dirty → set status `"cached"`, skip
4. If cache miss or dirty → call `nodeDef.execute(inputs, params)`, store result, clear dirty flag
5. `invalidate(nodeId)` marks node + all descendants as dirty (clears their cache entries)
6. Muted nodes: pass first input through to output (see spec §Mute Semantics)
7. Error nodes: catch, set status `"error"`, skip dependents (`"skipped"`)
8. Terminal nodes (no outgoing edges) → collect as `TerminalNodeOutput[]`, pass to `buildScene()`
9. Scene items get default style/transform if not connected to style/transform nodes

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/graph/executor.ts packages/vector-engine/src/graph/executor.test.ts
git commit -m "feat(vector-engine): graph execution engine with caching (HYP-308)"
```

---

### Task 9: Scene Graph Builder

**Files:**

- Create: `packages/vector-engine/src/graph/scene-builder.ts`
- Create: `packages/vector-engine/src/graph/scene-builder.test.ts`

Converts executor output (per-node results) into a flat `SceneGraph` ordered
back-to-front for rendering. Terminal nodes produce `SceneItem`s.

This is extracted from the executor for testability — the executor calls
`buildScene()` after all nodes are executed.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { buildScene } from './scene-builder';
import { PathBuilder } from '../path/builder';
import type { TerminalNodeOutput, TransformMatrix } from '../types';
import { IDENTITY_TRANSFORM } from '../types';

describe('buildScene', () => {
  it('should create scene items from terminal node results', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 50).lineTo(0, 50).close().build();

    const terminal: TerminalNodeOutput = {
      id: 'n1',
      name: 'Rectangle',
      path,
      style: { fill: { type: 'solid', color: '#ff0000' } },
      transform: IDENTITY_TRANSFORM,
      visible: true,
    };

    const scene = buildScene({
      terminalNodes: [terminal],
      canvas: { width: 800, height: 600 },
    });

    expect(scene.items).toHaveLength(1);
    expect(scene.items[0]).toMatchObject({ id: 'n1', visible: true });
    expect(scene.canvas).toEqual({ width: 800, height: 600 });
  });

  it('should preserve order (back-to-front)', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const base: TerminalNodeOutput = {
      id: '',
      path,
      style: {},
      transform: IDENTITY_TRANSFORM,
      visible: true,
    };
    const scene = buildScene({
      terminalNodes: [
        { ...base, id: 'back', name: 'Back' },
        { ...base, id: 'front', name: 'Front' },
      ],
      canvas: { width: 100, height: 100 },
    });

    expect(scene.items[0].id).toBe('back');
    expect(scene.items[1].id).toBe('front');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement scene-builder.ts**

Maps terminal node results to `SceneItem[]`. Each terminal node that has a `path`
output becomes a `SceneItem` with its style and transform.

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/graph/
git commit -m "feat(vector-engine): scene graph builder (HYP-308)"
```

---

## Chunk 2: Nodes

### Task 10: Rectangle and Ellipse Generators

**Files:**

- Create: `packages/vector-engine/src/nodes/generators/rectangle.ts`
- Create: `packages/vector-engine/src/nodes/generators/ellipse.ts`
- Create: `packages/vector-engine/src/nodes/generators/generators.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { rectangleNode } from './rectangle';
import { ellipseNode } from './ellipse';
import { decodeCommands, PathCmd } from '../../path/commands';
import type { PathValue } from '../../types';

describe('Rectangle generator', () => {
  it('should generate a rectangle path', () => {
    const result = rectangleNode.execute({}, { width: 100, height: 50, x: 0, y: 0 });
    const path = result.path.value as PathValue;
    expect(path.closed).toBe(true);

    const cmds = decodeCommands(path.commands);
    expect(cmds).toHaveLength(5); // M, L, L, L, Z
    expect(cmds[0]).toEqual({ type: PathCmd.Move, x: 0, y: 0 });
    expect(cmds[1]).toEqual({ type: PathCmd.Line, x: 100, y: 0 });
    expect(cmds[2]).toEqual({ type: PathCmd.Line, x: 100, y: 50 });
    expect(cmds[3]).toEqual({ type: PathCmd.Line, x: 0, y: 50 });
  });

  it('should respect x, y offset', () => {
    const result = rectangleNode.execute({}, { width: 50, height: 30, x: 10, y: 20 });
    const path = result.path.value as PathValue;
    const cmds = decodeCommands(path.commands);
    expect(cmds[0]).toEqual({ type: PathCmd.Move, x: 10, y: 20 });
  });

  // See "Test Reference Sources" for edge cases from Graphite (zero-size shapes,
  // degenerate angles) and Paper.js (oversized corner radius, shape constructors)

  it('should have correct params definition', () => {
    expect(rectangleNode.params.map((p) => p.name)).toEqual(['width', 'height', 'x', 'y']);
  });
});

describe('Ellipse generator', () => {
  it('should generate a closed ellipse path', () => {
    const result = ellipseNode.execute({}, { rx: 50, ry: 30, cx: 0, cy: 0 });
    const path = result.path.value as PathValue;
    expect(path.closed).toBe(true);
    // Ellipse is approximated with 4 cubic bezier curves
    const cmds = decodeCommands(path.commands);
    expect(cmds[0].type).toBe(PathCmd.Move);
    // 4 cubics + close = 6 commands
    expect(cmds.filter((c) => c.type === PathCmd.Cubic)).toHaveLength(4);
  });

  it('should center at cx, cy', () => {
    const result = ellipseNode.execute({}, { rx: 50, ry: 30, cx: 100, cy: 200 });
    const path = result.path.value as PathValue;
    const cmds = decodeCommands(path.commands);
    // First point should be at (cx + rx, cy) = (150, 200)
    expect(cmds[0]).toMatchObject({ x: 150, y: 200 });
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement rectangle.ts**

```typescript
/**
 * @file Rectangle generator node
 */

import type { NodeTypeDefinition } from '../../types';
import { PathBuilder } from '../../path/builder';

export const rectangleNode: NodeTypeDefinition = {
  type: 'rectangle',
  label: 'Rectangle',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'width', type: 'number', default: 100, min: 0 },
    { name: 'height', type: 'number', default: 100, min: 0 },
    { name: 'x', type: 'number', default: 0 },
    { name: 'y', type: 'number', default: 0 },
  ],
  execute(_inputs, params) {
    const { width, height, x, y } = params as { width: number; height: number; x: number; y: number };
    const path = new PathBuilder()
      .moveTo(x, y)
      .lineTo(x + width, y)
      .lineTo(x + width, y + height)
      .lineTo(x, y + height)
      .close()
      .build();
    return { path: { type: 'path', value: path } };
  },
};
```

- [ ] **Step 4: Implement ellipse.ts**

Ellipse approximated by 4 cubic bezier arcs (standard kappa = 0.5522847498).
Starting point at (cx + rx, cy), arcs go clockwise.

- [ ] **Step 5: Run tests — verify they pass**

- [ ] **Step 6: Commit**

```bash
git add packages/vector-engine/src/nodes/generators/
git commit -m "feat(vector-engine): rectangle and ellipse generator nodes (HYP-308)"
```

---

### Task 11: Polygon, Star, Line, Arc, Spiral, Arrow Generators

**Files:**

- Create: `packages/vector-engine/src/nodes/generators/polygon.ts`
- Create: `packages/vector-engine/src/nodes/generators/star.ts`
- Create: `packages/vector-engine/src/nodes/generators/line.ts`
- Create: `packages/vector-engine/src/nodes/generators/arc.ts`
- Create: `packages/vector-engine/src/nodes/generators/spiral.ts`
- Create: `packages/vector-engine/src/nodes/generators/arrow.ts`
- Modify: `packages/vector-engine/src/nodes/generators/generators.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('Polygon generator', () => {
  it('should generate a square (sides=4)', () => {
    const result = polygonNode.execute({}, { sides: 4, radius: 50, cx: 0, cy: 0 });
    const path = result.path.value as PathValue;
    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    expect(cmds).toHaveLength(5); // M + 3L + Z
  });

  it('should generate a hexagon (sides=6)', () => {
    const result = polygonNode.execute({}, { sides: 6, radius: 50, cx: 0, cy: 0 });
    const cmds = decodeCommands((result.path.value as PathValue).commands);
    expect(cmds).toHaveLength(7); // M + 5L + Z
  });
});

describe('Star generator', () => {
  it('should generate a 5-pointed star', () => {
    const result = starNode.execute({}, { points: 5, outerRadius: 50, innerRadius: 20, cx: 0, cy: 0 });
    const path = result.path.value as PathValue;
    expect(path.closed).toBe(true);
    const cmds = decodeCommands(path.commands);
    expect(cmds).toHaveLength(11); // M + 9L + Z (alternating outer/inner)
  });
});

describe('Line generator', () => {
  it('should generate an open line path', () => {
    const result = lineNode.execute({}, { x1: 0, y1: 0, x2: 100, y2: 50 });
    const path = result.path.value as PathValue;
    expect(path.closed).toBe(false);
    const cmds = decodeCommands(path.commands);
    expect(cmds).toHaveLength(2); // M + L
    expect(cmds[0]).toMatchObject({ x: 0, y: 0 });
    expect(cmds[1]).toMatchObject({ x: 100, y: 50 });
  });
});

describe('Arc generator', () => {
  it('should generate an arc approximated with cubics', () => {
    const result = arcNode.execute({}, { radius: 50, startAngle: 0, endAngle: 180 });
    const path = result.path.value as PathValue;
    const cmds = decodeCommands(path.commands);
    expect(cmds[0].type).toBe(PathCmd.Move);
    expect(cmds.filter((c) => c.type === PathCmd.Cubic).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Spiral generator', () => {
  it('should generate an open spiral path', () => {
    const result = spiralNode.execute({}, { turns: 3, startRadius: 10, endRadius: 50 });
    const path = result.path.value as PathValue;
    expect(path.closed).toBe(false);
    const cmds = decodeCommands(path.commands);
    expect(cmds.length).toBeGreaterThan(10); // many segments
  });
});

describe('Arrow generator', () => {
  it('should generate a closed arrow shape', () => {
    const result = arrowNode.execute({}, { length: 100, headWidth: 20, headLength: 15 });
    const path = result.path.value as PathValue;
    expect(path.closed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement all six generators**

Polygon and star: trigonometric vertex computation, params include `cx`, `cy` center.
Arc: standard arc-to-cubic conversion algorithm.
Spiral: parametric curve, approximate with line segments or cubics.
Arrow: construct from shaft rectangle + triangular head, params: `length`, `headWidth`, `headLength`.

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/nodes/generators/
git commit -m "feat(vector-engine): polygon, star, line, arc, spiral, arrow generators (HYP-308)"
```

---

### Task 12: PathOpsBackend Interface + Mock

**Files:**

- Create: `packages/vector-wasm/src/types.ts`
- Create: `packages/vector-wasm/src/mock-pathops.ts`

The `PathOpsBackend` interface abstracts WASM operations. A mock backend
enables unit testing without loading CanvasKit WASM.

- [ ] **Step 1: Define PathOpsBackend interface**

```typescript
/**
 * @file PathOpsBackend — abstraction over WASM path operations
 *
 * Accessed via: import { PathOpsBackend } from 'vector-wasm'
 */

import type { PathValue } from 'vector-engine';

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'xor';

export interface PathOpsBackend {
  boolean(op: BooleanOp, a: PathValue, b: PathValue): PathValue;
  simplify(path: PathValue, tolerance: number): PathValue;
  flatten(path: PathValue, maxError: number): PathValue;
  strokeToPath(path: PathValue, width: number, cap: string, join: string): PathValue;
  dash(path: PathValue, dashArray: number[], dashOffset: number): PathValue;
}
```

- [ ] **Step 2: Implement MockPathOps**

Mock returns concatenated commands for `boolean`, pass-through for `simplify`
and `flatten`. Sufficient for testing node wiring.

```typescript
/**
 * @file Mock PathOps backend for unit tests
 *
 * Accessed via: import { MockPathOps } from 'vector-wasm'
 * Assumptions: not geometrically correct, only tests node wiring
 */

import type { PathOpsBackend, BooleanOp } from './types';
import type { PathValue } from 'vector-engine';

export class MockPathOps implements PathOpsBackend {
  boolean(_op: BooleanOp, a: PathValue, b: PathValue): PathValue {
    // Concatenate commands (not geometrically correct)
    const combined = new Float64Array(a.commands.length + b.commands.length);
    combined.set(a.commands);
    combined.set(b.commands, a.commands.length);
    return { commands: combined, closed: a.closed || b.closed };
  }

  simplify(path: PathValue, _tolerance: number): PathValue {
    return path; // pass-through
  }

  flatten(path: PathValue, _maxError: number): PathValue {
    return path; // pass-through
  }

  strokeToPath(path: PathValue, _width: number, _cap: string, _join: string): PathValue {
    return { ...path, closed: true };
  }

  dash(path: PathValue, _dashArray: number[], _dashOffset: number): PathValue {
    return path;
  }
}
```

- [ ] **Step 3: Export from index.ts**

- [ ] **Step 4: Commit**

```bash
git add packages/vector-wasm/src/
git commit -m "feat(vector-wasm): PathOpsBackend interface + mock implementation (HYP-308)"
```

---

### Task 13: Boolean Operation Nodes

**Files:**

- Create: `packages/vector-engine/src/nodes/path-ops/boolean.ts`
- Create: `packages/vector-engine/src/nodes/path-ops/path-ops.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { createBooleanNodes } from './boolean';
import { MockPathOps } from 'vector-wasm';
import { PathBuilder } from '../../path/builder';

describe('Boolean operation nodes', () => {
  const mockOps = new MockPathOps();
  const nodes = createBooleanNodes(mockOps);

  const rectPath = () => new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();

  it('should have union, subtract, intersect, xor nodes', () => {
    expect(nodes.map((n) => n.type)).toEqual(['boolean-union', 'boolean-subtract', 'boolean-intersect', 'boolean-xor']);
  });

  it('should accept 2 path inputs and produce 1 path output', () => {
    for (const node of nodes) {
      expect(node.inputs).toHaveLength(2);
      expect(node.outputs).toHaveLength(1);
      expect(node.outputs[0].type).toBe('path');
    }
  });

  it('should execute union via backend', () => {
    const union = nodes[0];
    const result = union.execute(
      {
        a: { type: 'path', value: rectPath() },
        b: { type: 'path', value: rectPath() },
      },
      {},
    );
    expect(result.path.type).toBe('path');
  });

  // See "Test Reference Sources" for edge cases from Paper.js (~40 boolean tests:
  // identical paths, non-intersecting, compound with holes, floating-point precision)
  // and Graphite (commutative: same result regardless of operand order)
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement boolean.ts**

Factory function `createBooleanNodes(backend: PathOpsBackend)` returns 4
`NodeTypeDefinition`s. Each calls `backend.boolean(op, a, b)`.

The backend is injected — nodes don't know about CanvasKit vs mock.

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/nodes/path-ops/
git commit -m "feat(vector-engine): boolean operation nodes (union/subtract/intersect/xor) (HYP-308)"
```

---

### Task 14: Basic Path Operations (Pure TS)

**Files:**

- Create: `packages/vector-engine/src/nodes/path-ops/basic-ops.ts`
- Modify: `packages/vector-engine/src/nodes/path-ops/path-ops.test.ts`

Pure TypeScript operations that don't need WASM:
Reverse Path, Close/Open Path, Join Paths, Break Apart.

> **Why pure TS, not a library?** Investigated svg-path-commander (closest match:
> reverse + split, MIT, 12KB). All libraries work with SVG d-strings or nested JS arrays,
> not our Float64Array encoding. Using them means: Float64Array → parse to their format →
> operation → serialize back → Float64Array. Two allocations + two traversals for ~160 lines
> of trivial array math. CanvasKit doesn't expose reverse/breakApart in WASM bindings either.
> Reference algorithms from svg-path-commander's `reversePath.ts` / `splitPath.ts` (MIT).

- [ ] **Step 1: Write failing tests**

```typescript
import { reversePathNode, closeOpenNode, joinPathsNode, breakApartPaths } from './basic-ops';
import { decodeCommands, PathCmd } from '../../path/commands';
import type { PathValue } from '../../types';

describe('Reverse Path', () => {
  it('should reverse command order (endpoints become startpoints)', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).close().build();
    const result = reversePathNode.execute({ path: { type: 'path', value: path } }, {});
    const reversed = result.path.value as PathValue;
    const cmds = decodeCommands(reversed.commands);
    // Reversed: M(100,100) → L(100,0) → L(0,0) → Z
    expect(cmds[0]).toMatchObject({ type: PathCmd.Move, x: 100, y: 100 });
  });
});

describe('Close/Open Path', () => {
  it('should close an open path', () => {
    const open = new PathBuilder().moveTo(0, 0).lineTo(100, 100).build();
    expect(open.closed).toBe(false);
    const result = closeOpenNode.execute({ path: { type: 'path', value: open } }, { action: 'close' });
    expect((result.path.value as PathValue).closed).toBe(true);
  });
});

describe('Join Paths', () => {
  it('should join two open paths at nearest endpoints', () => {
    const p1 = new PathBuilder().moveTo(0, 0).lineTo(50, 0).build();
    const p2 = new PathBuilder().moveTo(50, 0).lineTo(100, 0).build();
    const result = joinPathsNode.execute(
      {
        a: { type: 'path', value: p1 },
        b: { type: 'path', value: p2 },
      },
      {},
    );
    const joined = result.path.value as PathValue;
    const cmds = decodeCommands(joined.commands);
    // Should be M(0,0) L(50,0) L(100,0)
    expect(cmds).toHaveLength(3);
  });
});

describe('breakApartPaths (utility function, not a node)', () => {
  it('should split compound path into sub-paths at Move commands', () => {
    // Compound path: two separate rectangles concatenated
    const cmds1 = new PathBuilder().moveTo(0, 0).lineTo(10, 0).lineTo(10, 10).close().build().commands;
    const cmds2 = new PathBuilder().moveTo(20, 20).lineTo(30, 20).lineTo(30, 30).close().build().commands;
    const compound = new Float64Array(cmds1.length + cmds2.length);
    compound.set(cmds1);
    compound.set(cmds2, cmds1.length);

    const subPaths = breakApartPaths({ commands: compound, closed: true });
    expect(subPaths).toHaveLength(2);
    expect(subPaths[0].closed).toBe(true);
    expect(subPaths[1].closed).toBe(true);
    // First sub-path starts at (0,0)
    const cmds = decodeCommands(subPaths[0].commands);
    expect(cmds[0]).toMatchObject({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement basic-ops.ts**

`reversePathNode`: Reverse path direction while preserving geometry. Not a simple
array reversal — each command type requires specific handling:

```
Algorithm for reversePath(path: PathValue) → PathValue:
1. Decode Float64Array → PathCommand[]
2. Walk commands, collect segments as (startPoint, command) pairs
3. Reverse the segment list
4. For each reversed segment, transform the command:
   - Move: becomes the new starting Move at the segment's endpoint
   - Line(x,y): endpoint becomes the previous segment's endpoint (trivial)
   - Cubic(cp1, cp2, end): SWAP cp1 ↔ cp2, set new endpoint
     Before: C(cx1,cy1, cx2,cy2, x,y) from point P
     After:  C(cx2,cy2, cx1,cy1, P.x,P.y) — control points swap order
   - Quad(cp, end): control point stays, endpoint swaps
     Before: Q(cx,cy, x,y) from point P
     After:  Q(cx,cy, P.x,P.y)
   - Arc(rx,ry,rot,large,sweep,x,y): FLIP sweep flag (0↔1)
     Before: A(rx,ry,rot,large,sweep,x,y)
     After:  A(rx,ry,rot,large,1-sweep,P.x,P.y)
5. If original was closed, keep Close at end
6. Encode back to Float64Array
```

Reference: svg-path-commander's `reversePath.ts` (MIT) handles all edge cases.
The key insight: cubic bezier C(P0→CP1→CP2→P1) reversed is C(P1→CP2→CP1→P0),
and arc sweep flag must be flipped to maintain the same geometric arc.

`closeOpenNode`: If `action === "close"`, append Close command (or remove it for "open").

`joinPathsNode`: Find nearest endpoints between two open paths, concatenate
commands (possibly reversing one path).

`breakApartPaths(path: PathValue): PathValue[]`: Utility function (not a node).
Splits commands at Move commands → multiple PathValue[]. Used by graph-level
"Break Apart" command which replaces one compound-path node with N generator nodes.
Exported from `basic-ops.ts` as a pure function.

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/nodes/path-ops/
git commit -m "feat(vector-engine): reverse, close/open, join, break apart path ops (HYP-308)"
```

---

### Task 15: Fill and Stroke Style Nodes

**Files:**

- Create: `packages/vector-engine/src/nodes/style/fill.ts`
- Create: `packages/vector-engine/src/nodes/style/stroke.ts`
- Create: `packages/vector-engine/src/nodes/style/style.test.ts`

Style nodes don't modify paths — they attach style metadata that the scene
builder uses to create `SceneItem.style`.

**Style composition**: Each style node takes an optional `style` input. If present,
the node MERGES its style with the incoming style (shallow merge on StyleValue fields).
This enables chaining: `rectangle → fill → stroke → opacity` produces a single merged
StyleValue with all three properties. Without an incoming style, the node creates fresh.

```
Rectangle ──path──→ Fill ──path+style──→ Stroke ──path+style──→ (terminal)
                          style: {fill}         style: {fill, stroke}
```

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { fillNode } from './fill';
import { strokeNode } from './stroke';
import { PathBuilder } from '../../path/builder';
import type { StyleValue } from '../../types';

describe('Fill node', () => {
  it('should output a style with solid fill', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const result = fillNode.execute({ path: { type: 'path', value: path } }, { fillType: 'solid', color: '#ff0000' });
    expect(result.path.type).toBe('path');
    expect(result.style.type).toBe('style');
    const style = result.style.value as StyleValue;
    expect(style.fill).toEqual({ type: 'solid', color: '#ff0000' });
  });

  it('should support linear gradient fill', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const result = fillNode.execute(
      { path: { type: 'path', value: path } },
      {
        fillType: 'linearGradient',
        stops: [
          { offset: 0, color: '#000' },
          { offset: 1, color: '#fff' },
        ],
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
      },
    );
    const style = result.style.value as StyleValue;
    expect(style.fill!.type).toBe('linearGradient');
    expect(style.fill!.stops).toHaveLength(2);
  });

  it('should merge with incoming style (composition chaining)', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const incomingStyle: StyleValue = { stroke: { color: '#000', width: 1, cap: 'butt', join: 'miter' } };
    const result = fillNode.execute(
      {
        path: { type: 'path', value: path },
        style: { type: 'style', value: incomingStyle },
      },
      { fillType: 'solid', color: '#ff0000' },
    );
    const style = result.style.value as StyleValue;
    expect(style.fill).toEqual({ type: 'solid', color: '#ff0000' });
    expect(style.stroke).toBeDefined(); // preserved from incoming
  });
});

describe('Stroke node', () => {
  it('should output a style with stroke', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const result = strokeNode.execute(
      { path: { type: 'path', value: path } },
      { color: '#000000', width: 2, cap: 'round', join: 'round' },
    );
    const style = result.style.value as StyleValue;
    expect(style.stroke).toMatchObject({ color: '#000000', width: 2 });
  });

  it('should merge with incoming style (fill → stroke chain)', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const incomingStyle: StyleValue = { fill: { type: 'solid', color: '#ff0000' } };
    const result = strokeNode.execute(
      {
        path: { type: 'path', value: path },
        style: { type: 'style', value: incomingStyle },
      },
      { color: '#000000', width: 2, cap: 'round', join: 'round' },
    );
    const style = result.style.value as StyleValue;
    // Both fill (from upstream) and stroke (from this node) present
    expect(style.fill).toEqual({ type: 'solid', color: '#ff0000' });
    expect(style.stroke).toMatchObject({ color: '#000000', width: 2 });
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement fill.ts and stroke.ts**

Both take a `path` input, pass it through, and add a `style` output.
The `execute()` function reads params and constructs the appropriate
`FillStyle` or `StrokeStyle` value.

Both nodes have 2 outputs: `path` (passthrough) and `style` (constructed).

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/nodes/style/
git commit -m "feat(vector-engine): fill and stroke style nodes (HYP-308)"
```

---

### Task 16: Opacity and Blend Mode Nodes

**Files:**

- Create: `packages/vector-engine/src/nodes/style/opacity.ts`
- Create: `packages/vector-engine/src/nodes/style/blend-mode.ts`
- Modify: `packages/vector-engine/src/nodes/style/style.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `style.test.ts`:

```typescript
import { opacityNode } from './opacity';
import { blendModeNode } from './blend-mode';

describe('Opacity node', () => {
  it('should output style with opacity value', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const result = opacityNode.execute({ path: { type: 'path', value: path } }, { value: 0.5 });
    expect(result.path.type).toBe('path');
    const style = result.style.value as StyleValue;
    expect(style.opacity).toBe(0.5);
  });

  it('should merge with incoming style', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const incomingStyle: StyleValue = { fill: { type: 'solid', color: '#f00' } };
    const result = opacityNode.execute(
      {
        path: { type: 'path', value: path },
        style: { type: 'style', value: incomingStyle },
      },
      { value: 0.7 },
    );
    const style = result.style.value as StyleValue;
    expect(style.opacity).toBe(0.7);
    expect(style.fill).toBeDefined();
  });
});

describe('Blend mode node', () => {
  it('should output style with blend mode', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const result = blendModeNode.execute({ path: { type: 'path', value: path } }, { mode: 'multiply' });
    const style = result.style.value as StyleValue;
    expect(style.blendMode).toBe('multiply');
  });

  it('should merge with incoming style', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const incomingStyle: StyleValue = { stroke: { color: '#000', width: 2, cap: 'round', join: 'round' } };
    const result = blendModeNode.execute(
      {
        path: { type: 'path', value: path },
        style: { type: 'style', value: incomingStyle },
      },
      { mode: 'screen' },
    );
    const style = result.style.value as StyleValue;
    expect(style.blendMode).toBe('screen');
    expect(style.stroke).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement opacity.ts and blend-mode.ts**

Same pattern as fill/stroke: passthrough path, construct style value, merge with incoming style.

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/nodes/style/
git commit -m "feat(vector-engine): opacity and blend mode style nodes (HYP-308)"
```

---

### Task 17: Transform Nodes

**Files:**

- Create: `packages/vector-engine/src/nodes/transform/translate.ts`
- Create: `packages/vector-engine/src/nodes/transform/rotate.ts`
- Create: `packages/vector-engine/src/nodes/transform/scale.ts`
- Create: `packages/vector-engine/src/nodes/transform/skew.ts`
- Create: `packages/vector-engine/src/nodes/transform/transform.test.ts`

Transform nodes output `TransformMatrix` values.
They compose with parent transforms in the scene builder.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { translateNode } from './translate';
import { rotateNode } from './rotate';
import { scaleNode } from './scale';
import { skewNode } from './skew';
import type { TransformMatrix } from '../../types';

describe('Translate node', () => {
  it('should output a translation matrix', () => {
    const result = translateNode.execute({}, { dx: 10, dy: 20 });
    const m = result.transform.value as TransformMatrix;
    // Translation matrix: [1, 0, 0, 1, dx, dy]
    expect(m).toEqual([1, 0, 0, 1, 10, 20]);
  });
});

describe('Rotate node', () => {
  it('should output a rotation matrix (90 degrees)', () => {
    const result = rotateNode.execute({}, { angle: 90, originX: 0, originY: 0 });
    const m = result.transform.value as TransformMatrix;
    // cos(90°)≈0, sin(90°)≈1 → [0, 1, -1, 0, 0, 0]
    expect(m[0]).toBeCloseTo(0, 5);
    expect(m[1]).toBeCloseTo(1, 5);
    expect(m[2]).toBeCloseTo(-1, 5);
    expect(m[3]).toBeCloseTo(0, 5);
  });
});

describe('Scale node', () => {
  it('should output a scale matrix', () => {
    const result = scaleNode.execute({}, { sx: 2, sy: 3, originX: 0, originY: 0 });
    const m = result.transform.value as TransformMatrix;
    expect(m).toEqual([2, 0, 0, 3, 0, 0]);
  });
});

describe('Skew node', () => {
  it('should output a skew matrix', () => {
    const result = skewNode.execute({}, { ax: 45, ay: 0 });
    const m = result.transform.value as TransformMatrix;
    // skewX(45°): [1, 0, tan(45°), 1, 0, 0] = [1, 0, 1, 1, 0, 0]
    expect(m[0]).toBeCloseTo(1);
    expect(m[2]).toBeCloseTo(1); // tan(45°) = 1
    expect(m[3]).toBeCloseTo(1);
  });

  // See "Test Reference Sources" for edge cases from SVG.js (matrix decompose/recompose,
  // flip with center, non-invertible inverse), Graphite (identity detection, negative scale),
  // and Paper.js (rotation decompose at 0/45/90/135/180/270°)
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement translate, rotate, scale, skew**

Each builds its `TransformMatrix` from params. Rotation and scale
support `originX`, `originY` (translate → op → translate back).

```typescript
// Rotation with origin:
// T(ox,oy) × R(θ) × T(-ox,-oy)
const cos = Math.cos(rad);
const sin = Math.sin(rad);
const tx = ox - ox * cos + oy * sin;
const ty = oy - ox * sin - oy * cos;
return [cos, sin, -sin, cos, tx, ty];
```

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/nodes/transform/
git commit -m "feat(vector-engine): translate, rotate, scale, skew transform nodes (HYP-308)"
```

---

### Task 18: Node Auto-Registration

**Files:**

- Create: `packages/vector-engine/src/nodes/register-all.ts`
- Create: `packages/vector-engine/src/nodes/register-all.test.ts`

Central function that registers all built-in nodes with a registry.

- [ ] **Step 1: Write test**

```typescript
import { describe, expect, it } from 'bun:test';
import { createDefaultRegistry } from './register-all';

describe('createDefaultRegistry', () => {
  it('should register all built-in node types', () => {
    const registry = createDefaultRegistry();
    const all = registry.listAll();
    // Generators: rectangle, ellipse, polygon, star, line, arc, spiral, arrow (8)
    // Path ops: 4 boolean + reverse, close-open, join (7) — breakApart is a utility fn, not a node
    // Style: fill, stroke, opacity, blend-mode (4)
    // Transform: translate, rotate, scale, skew (4)
    expect(all.length).toBeGreaterThanOrEqual(23);
  });

  it('should have generators category', () => {
    const registry = createDefaultRegistry();
    expect(registry.listByCategory('generator').length).toBeGreaterThanOrEqual(8);
  });
});
```

- [ ] **Step 2: Implement register-all.ts**

Imports all node definitions, creates a `NodeRegistry`, registers each.
Boolean nodes need a `PathOpsBackend` — accept it as parameter with
`MockPathOps` as default for testing.

```typescript
import { NodeRegistry } from './registry';
import { rectangleNode } from './generators/rectangle';
// ... all other imports

export function createDefaultRegistry(pathOps?: PathOpsBackend): NodeRegistry {
  const registry = new NodeRegistry();
  registry.register(rectangleNode);
  registry.register(ellipseNode);
  // ... all generators, path-ops, style, transform
  for (const boolNode of createBooleanNodes(pathOps ?? new MockPathOps())) {
    registry.register(boolNode);
  }
  return registry;
}
```

- [ ] **Step 3: Run test — verify it passes**

- [ ] **Step 4: Commit**

```bash
git add packages/vector-engine/src/nodes/
git commit -m "feat(vector-engine): auto-register all built-in nodes (HYP-308)"
```

---

## Chunk 3: History + Export + Integration

### Task 19: Graph Diff System

**Files:**

- Create: `packages/vector-engine/src/graph/history.ts`
- Create: `packages/vector-engine/src/graph/history.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, beforeEach } from 'bun:test';
import { HistoryManager } from './history';
import { VectorGraphModel } from './vector-graph';

describe('HistoryManager', () => {
  let graph: VectorGraphModel;
  let history: HistoryManager;

  beforeEach(() => {
    graph = VectorGraphModel.create('test', 'Test', 800, 600);
    history = new HistoryManager(graph);
  });

  it('should record param changes', () => {
    const n1 = graph.addNode({ type: 'rect', params: { width: 100 } });
    history.begin('Add rectangle');
    // addNode is tracked
    history.commit();

    history.begin('Change width');
    history.recordParamChange(n1, 'width', 100, 200);
    graph.setParam(n1, 'width', 200);
    history.commit();

    expect(history.entryCount).toBe(2);
    expect(history.canUndo).toBe(true);
  });

  it('should undo param change', () => {
    const n1 = graph.addNode({ type: 'rect', params: { width: 100 } });
    history.begin('Add rectangle');
    history.recordAddNode(graph.getNode(n1)!);
    history.commit();

    history.begin('Change width');
    history.recordParamChange(n1, 'width', 100, 200);
    graph.setParam(n1, 'width', 200);
    history.commit();

    expect(graph.getNode(n1)!.params.width).toBe(200);
    history.undo(graph);
    expect(graph.getNode(n1)!.params.width).toBe(100);
  });

  it('should redo undone change', () => {
    const n1 = graph.addNode({ type: 'rect', params: { width: 100 } });
    history.begin('Add rect');
    history.recordAddNode(graph.getNode(n1)!);
    history.commit();

    history.begin('Change width');
    history.recordParamChange(n1, 'width', 100, 200);
    graph.setParam(n1, 'width', 200);
    history.commit();

    history.undo(graph);
    expect(graph.getNode(n1)!.params.width).toBe(100);
    history.redo(graph);
    expect(graph.getNode(n1)!.params.width).toBe(200);
  });

  it('should undo node addition (removes node)', () => {
    history.begin('Add rectangle');
    const n1 = graph.addNode({ type: 'rect', params: {} });
    history.recordAddNode(graph.getNode(n1)!);
    history.commit();

    expect(graph.nodeCount).toBe(1);
    history.undo(graph);
    expect(graph.nodeCount).toBe(0);
  });

  it('should undo node removal (restores node + edges)', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    history.begin('setup');
    history.recordAddNode(graph.getNode(n1)!);
    history.recordAddNode(graph.getNode(n2)!);
    history.commit();

    history.begin('Remove n1');
    const removedEdges = graph.removeNode(n1);
    history.recordRemoveNode({ id: n1, type: 'rect', params: {} }, removedEdges);
    history.commit();

    expect(graph.nodeCount).toBe(1);
    history.undo(graph);
    expect(graph.nodeCount).toBe(2);
    expect(graph.edgeCount).toBe(1);
  });

  it('should undo/redo edge addition', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    history.begin('Setup nodes');
    history.recordAddNode(graph.getNode(n1)!);
    history.recordAddNode(graph.getNode(n2)!);
    history.commit();

    history.begin('Connect');
    const edgeId = graph.addEdge(n1, 'path', n2, 'path');
    history.recordAddEdge({ id: edgeId, source: n1, target: n2, sourcePort: 'path', targetPort: 'path' });
    history.commit();

    expect(graph.edgeCount).toBe(1);
    history.undo(graph);
    expect(graph.edgeCount).toBe(0);
    history.redo(graph);
    expect(graph.edgeCount).toBe(1);
  });

  it('should undo/redo edge removal', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    const edgeId = graph.addEdge(n1, 'path', n2, 'path');
    history.begin('Setup');
    history.commit();

    history.begin('Disconnect');
    graph.removeEdge(edgeId);
    history.recordRemoveEdge({ id: edgeId, source: n1, target: n2, sourcePort: 'path', targetPort: 'path' });
    history.commit();

    expect(graph.edgeCount).toBe(0);
    history.undo(graph);
    expect(graph.edgeCount).toBe(1);
  });

  it('should undo/redo mute toggle', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    history.begin('Add');
    history.recordAddNode(graph.getNode(n1)!);
    history.commit();

    history.begin('Mute');
    graph.setMuted(n1, true);
    history.recordMuteNode(n1, true);
    history.commit();

    expect(graph.isMuted(n1)).toBe(true);
    history.undo(graph);
    expect(graph.isMuted(n1)).toBe(false);
    history.redo(graph);
    expect(graph.isMuted(n1)).toBe(true);
  });

  it('should undo/redo node position move', () => {
    const n1 = graph.addNode({ type: 'rect', params: {}, position: { x: 0, y: 0 } });
    history.begin('Move');
    graph.setPosition(n1, { x: 100, y: 200 });
    history.recordMoveNode(n1, { x: 0, y: 0 }, { x: 100, y: 200 });
    history.commit();

    history.undo(graph);
    expect(graph.getNode(n1)!.position).toEqual({ x: 0, y: 0 });
  });

  it('should return affected node IDs from undo', () => {
    const n1 = graph.addNode({ type: 'rect', params: { width: 100 } });
    history.begin('Add');
    history.recordAddNode(graph.getNode(n1)!);
    history.commit();

    history.begin('Change');
    history.recordParamChange(n1, 'width', 100, 200);
    graph.setParam(n1, 'width', 200);
    history.commit();

    const affected = history.undo(graph);
    expect(affected).toContain(n1);
  });

  it('should clear redo stack on new action after undo', () => {
    const n1 = graph.addNode({ type: 'rect', params: { width: 100 } });
    history.begin('Add');
    history.recordAddNode(graph.getNode(n1)!);
    history.commit();

    history.begin('Change to 200');
    history.recordParamChange(n1, 'width', 100, 200);
    graph.setParam(n1, 'width', 200);
    history.commit();

    history.undo(graph);

    history.begin('Change to 300');
    history.recordParamChange(n1, 'width', 100, 300);
    graph.setParam(n1, 'width', 300);
    history.commit();

    expect(history.canRedo).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement history.ts**

```typescript
/**
 * @file History manager — undo/redo via graph diff snapshots
 *
 * Accessed via: import { HistoryManager } from 'vector-engine'
 *
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Undo/Redo
 *
 * Tradeoffs: stores full diff for each operation. For param changes this is
 * cheap (old + new value). For structural changes (add/remove node) we store
 * the full GraphNode + removed edges to enable precise restoration.
 */

import type { GraphDiff, HistoryEntry, GraphNode, GraphEdge, Point } from '../types';
import type { VectorGraphModel } from './vector-graph';

export class HistoryManager {
  private entries: HistoryEntry[] = [];
  private pointer = 0; // points to next undo position
  private pendingDiffs: GraphDiff[] = [];
  private pendingDescription = '';

  constructor(private graph: VectorGraphModel) {}

  begin(description: string): void {
    /* ... */
  }
  recordParamChange(nodeId: string, param: string, oldValue: unknown, newValue: unknown): void {
    /* ... */
  }
  recordAddNode(node: GraphNode): void {
    /* ... */
  }
  recordRemoveNode(node: GraphNode, removedEdges: GraphEdge[]): void {
    /* ... */
  }
  recordAddEdge(edge: GraphEdge): void {
    /* ... */
  }
  recordRemoveEdge(edge: GraphEdge): void {
    /* ... */
  }
  recordMuteNode(nodeId: string, muted: boolean): void {
    /* ... */
  }
  recordMoveNode(nodeId: string, oldPosition: Point, newPosition: Point): void {
    /* ... */
  }
  commit(): void {
    /* ... */
  }

  /** Returns affected node IDs (for executor invalidation) */
  undo(graph: VectorGraphModel): string[] {
    /* ... */
  }
  /** Returns affected node IDs */
  redo(graph: VectorGraphModel): string[] {
    /* ... */
  }

  get canUndo(): boolean {
    return this.pointer > 0;
  }
  get canRedo(): boolean {
    return this.pointer < this.entries.length;
  }
  get entryCount(): number {
    return this.entries.length;
  }
}
```

Undo applies diffs in reverse order (removeNode → addNode, paramChange → set old value).
Redo applies diffs forward.

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/graph/
git commit -m "feat(vector-engine): undo/redo history manager with graph diffs (HYP-308)"
```

---

### Task 20: SVG String Exporter

**Files:**

- Create: `packages/vector-engine/src/export/svg.ts`
- Create: `packages/vector-engine/src/export/svg.test.ts`

Serializes a `SceneGraph` to an SVG string. No DOM — pure string concatenation.
Used for server-side export, CLI, AI agent output.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { sceneToSvg } from './svg';
import { PathBuilder } from '../path/builder';
import type { SceneGraph, SceneItem, TransformMatrix } from '../types';

function makeItem(overrides: Partial<SceneItem> = {}): SceneItem {
  return {
    id: 'test',
    path: new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 50).lineTo(0, 50).close().build(),
    style: { fill: { type: 'solid', color: '#ff0000' } },
    transform: [1, 0, 0, 1, 0, 0] as TransformMatrix,
    visible: true,
    ...overrides,
  };
}

describe('sceneToSvg', () => {
  it('should produce valid SVG with viewBox', () => {
    const scene: SceneGraph = {
      items: [makeItem()],
      canvas: { width: 800, height: 600 },
    };
    const svg = sceneToSvg(scene);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 800 600"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('</svg>');
  });

  it('should include path element with d attribute', () => {
    const scene: SceneGraph = {
      items: [makeItem()],
      canvas: { width: 100, height: 100 },
    };
    const svg = sceneToSvg(scene);
    expect(svg).toContain('<path');
    expect(svg).toContain('d="M 0 0 L 100 0 L 100 50 L 0 50 Z"');
  });

  it('should apply fill color', () => {
    const svg = sceneToSvg({
      items: [makeItem({ style: { fill: { type: 'solid', color: '#3b82f6' } } })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('fill="#3b82f6"');
  });

  it('should apply stroke', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({
          style: {
            stroke: { color: '#000', width: 2, cap: 'round', join: 'round' },
          },
        }),
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('stroke="#000"');
    expect(svg).toContain('stroke-width="2"');
  });

  it('should apply transform matrix', () => {
    const svg = sceneToSvg({
      items: [makeItem({ transform: [1, 0, 0, 1, 10, 20] as TransformMatrix })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('transform="matrix(1 0 0 1 10 20)"');
  });

  it('should skip invisible items', () => {
    const svg = sceneToSvg({
      items: [makeItem({ visible: false })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).not.toContain('<path');
  });

  it('should render background color', () => {
    const svg = sceneToSvg({
      items: [],
      canvas: { width: 100, height: 100 },
      background: '#ffffff',
    });
    expect(svg).toContain('<rect');
    expect(svg).toContain('fill="#ffffff"');
  });

  it('should handle linear gradient fills', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({
          style: {
            fill: {
              type: 'linearGradient',
              stops: [
                { offset: 0, color: '#000' },
                { offset: 1, color: '#fff' },
              ],
              from: { x: 0, y: 0 },
              to: { x: 100, y: 0 },
            },
          },
        }),
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('<stop');
    expect(svg).toContain('</defs>');
  });

  it('should handle opacity', () => {
    const svg = sceneToSvg({
      items: [makeItem({ style: { opacity: 0.5 } })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('opacity="0.5"');
  });

  it('should apply blend mode via mix-blend-mode style', () => {
    const svg = sceneToSvg({
      items: [makeItem({ style: { blendMode: 'multiply' } })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('mix-blend-mode:multiply');
  });

  it('should render shadow as SVG filter', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({
          style: { shadow: { color: '#000', offsetX: 2, offsetY: 2, blur: 4 } },
        }),
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('<filter');
    expect(svg).toContain('feDropShadow');
  });

  it('should render blur as SVG filter', () => {
    const svg = sceneToSvg({
      items: [makeItem({ style: { blur: 5 } })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('<filter');
    expect(svg).toContain('feGaussianBlur');
  });

  it('should handle radial gradient fill', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({
          style: {
            fill: {
              type: 'radialGradient',
              stops: [
                { offset: 0, color: '#f00' },
                { offset: 1, color: '#00f' },
              ],
              center: { x: 50, y: 50 },
              radius: 50,
            },
          },
        }),
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('<radialGradient');
    expect(svg).toContain('<stop');
  });

  it('should handle conic gradient fill (approximated)', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({
          style: {
            fill: {
              type: 'conicGradient',
              stops: [
                { offset: 0, color: '#f00' },
                { offset: 1, color: '#0f0' },
              ],
              center: { x: 50, y: 50 },
            },
          },
        }),
      ],
      canvas: { width: 100, height: 100 },
    });
    // Conic gradient has no direct SVG equivalent — falls back or uses pattern
    expect(svg).toContain('<path');
  });

  it('should apply clipPath', () => {
    const clipPath = new PathBuilder().moveTo(10, 10).lineTo(90, 10).lineTo(90, 90).lineTo(10, 90).close().build();
    const svg = sceneToSvg({
      items: [makeItem({ clipPath })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('<clipPath');
    expect(svg).toContain('clip-path="url(');
  });

  it('should render SceneGroup as <g> with children', () => {
    const svg = sceneToSvg({
      items: [
        {
          id: 'group1',
          children: [makeItem({ id: 'child1' }), makeItem({ id: 'child2' })],
          transform: [1, 0, 0, 1, 10, 20] as TransformMatrix,
          visible: true,
        },
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('<g');
    expect(svg).toContain('</g>');
    // Group should contain two path elements
    const pathCount = (svg.match(/<path/g) || []).length;
    expect(pathCount).toBe(2);
  });

  it('should apply dashArray and dashOffset on stroke', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({
          style: {
            stroke: { color: '#000', width: 2, cap: 'butt', join: 'miter', dashArray: [5, 3], dashOffset: 2 },
          },
        }),
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('stroke-dasharray="5 3"');
    expect(svg).toContain('stroke-dashoffset="2"');
  });

  it('should omit transform attribute for identity matrix', () => {
    const svg = sceneToSvg({
      items: [makeItem({ transform: [1, 0, 0, 1, 0, 0] as TransformMatrix })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).not.toContain('transform=');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement svg.ts**

```typescript
/**
 * @file SVG string exporter — SceneGraph to SVG serialization
 *
 * Accessed via: import { sceneToSvg } from 'vector-engine'
 *
 * Tradeoffs: string concatenation (no DOM, no template engine).
 * Gradient defs are collected and emitted in a single <defs> block.
 */

import type { SceneGraph, SceneEntry, SceneItem, SceneGroup, FillStyle, TransformMatrix } from '../types';
import { commandsToSvgD } from '../path/commands';
import { isSceneItem, isSceneGroup, IDENTITY_TRANSFORM } from '../types';

export function sceneToSvg(scene: SceneGraph): string {
  const defs: string[] = [];
  const body: string[] = [];

  for (const entry of scene.items) {
    renderEntry(entry, body, defs);
  }

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.canvas.width} ${scene.canvas.height}">`);

  if (defs.length > 0) {
    parts.push('<defs>', ...defs, '</defs>');
  }

  if (scene.background) {
    parts.push(`<rect width="100%" height="100%" fill="${scene.background}"/>`);
  }

  parts.push(...body);
  parts.push('</svg>');

  return parts.join('\n');
}

function renderEntry(entry: SceneEntry, body: string[], defs: string[]): void {
  if (isSceneItem(entry)) {
    renderItem(entry, body, defs);
  } else if (isSceneGroup(entry)) {
    // Render group with <g> wrapper
    if (!entry.visible) return;
    body.push(`<g${transformAttr(entry.transform)}${opacityAttr(entry.opacity)}>`);
    for (const child of entry.children) {
      renderEntry(child, body, defs);
    }
    body.push('</g>');
  }
}

// ... renderItem, transformAttr, fillAttr, strokeAttr, gradientDef helpers
// Key implementation notes:
// - transformAttr: return empty string for identity matrix [1,0,0,1,0,0]
// - clipPath: generate <clipPath id="clip-{id}"> in defs, reference via clip-path="url(#clip-{id})"
// - blendMode: render as style="mix-blend-mode:{mode}" attribute
// - shadow: generate <filter> with <feDropShadow> in defs
// - blur: generate <filter> with <feGaussianBlur> in defs
// - dashArray/dashOffset: stroke-dasharray and stroke-dashoffset attributes
// - radialGradient: <radialGradient> with cx, cy, r attributes
// - conicGradient: no SVG native support — fallback to solid color or pattern approximation
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/vector-engine/src/export/
git commit -m "feat(vector-engine): SVG string exporter (HYP-308)"
```

---

### Task 21: End-to-End Integration Test

**Files:**

- Create: `packages/vector-engine/src/integration.test.ts`

Full pipeline: create graph → add nodes → connect → execute → export SVG.
This validates that all components work together.

- [ ] **Step 1: Write integration test**

```typescript
import { describe, expect, it } from 'bun:test';
import { VectorGraphModel } from './graph/vector-graph';
import { GraphExecutor } from './graph/executor';
import { HistoryManager } from './graph/history';
import { createDefaultRegistry } from './nodes/register-all';
import { sceneToSvg } from './export/svg';

describe('Vector Engine — end-to-end', () => {
  it('should create a rectangle, fill it, and export SVG', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'Icon', 24, 24);
    const executor = new GraphExecutor(registry);

    // Add rectangle
    const rect = graph.addNode({
      type: 'rectangle',
      params: { width: 20, height: 20, x: 2, y: 2 },
    });

    // Add fill
    const fill = graph.addNode({
      type: 'fill',
      params: { fillType: 'solid', color: '#3b82f6' },
    });

    // Connect rectangle → fill
    graph.addEdge(rect, 'path', fill, 'path');

    // Execute
    const result = executor.execute(graph);
    expect(result.scene.items).toHaveLength(1);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);

    // Export SVG
    const svg = sceneToSvg(result.scene);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('fill="#3b82f6"');
    expect(svg).toContain('d="M 2 2 L 22 2 L 22 22 L 2 22 Z"');
  });

  it('should undo/redo a param change', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'Icon', 24, 24);
    const executor = new GraphExecutor(registry);
    const history = new HistoryManager(graph);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 10, height: 10, x: 0, y: 0 } });
    history.begin('Add rectangle');
    history.recordAddNode(graph.getNode(rect)!);
    history.commit();

    // Change width
    history.begin('Resize');
    history.recordParamChange(rect, 'width', 10, 20);
    graph.setParam(rect, 'width', 20);
    history.commit();

    // Execute — should use width=20
    let result = executor.execute(graph);
    let svg = sceneToSvg(result.scene);
    expect(svg).toContain('L 20 0');

    // Undo — should revert to width=10
    const affected = history.undo(graph);
    for (const id of affected) executor.invalidate(id);
    result = executor.execute(graph);
    svg = sceneToSvg(result.scene);
    expect(svg).toContain('L 10 0');

    // Redo — back to width=20
    const reaffected = history.redo(graph);
    for (const id of reaffected) executor.invalidate(id);
    result = executor.execute(graph);
    svg = sceneToSvg(result.scene);
    expect(svg).toContain('L 20 0');
  });

  it('should build a compound shape with boolean union', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'Union Icon', 24, 24);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({
      type: 'rectangle',
      params: { width: 16, height: 16, x: 0, y: 0 },
    });
    const ellipse = graph.addNode({
      type: 'ellipse',
      params: { rx: 8, ry: 8, cx: 16, cy: 8 },
    });
    const union = graph.addNode({ type: 'boolean-union', params: {} });
    const fill = graph.addNode({
      type: 'fill',
      params: { fillType: 'solid', color: '#ef4444' },
    });

    graph.addEdge(rect, 'path', union, 'a');
    graph.addEdge(ellipse, 'path', union, 'b');
    graph.addEdge(union, 'path', fill, 'path');

    const result = executor.execute(graph);
    expect(result.scene.items).toHaveLength(1);
    // All 4 nodes should have executed successfully
    expect(Object.values(result.nodeStatus).every((s) => s.state === 'ok')).toBe(true);

    const svg = sceneToSvg(result.scene);
    expect(svg).toContain('fill="#ef4444"');
  });

  it('should undo edge removal and restore connection', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'EdgeUndo', 100, 100);
    const executor = new GraphExecutor(registry);
    const history = new HistoryManager(graph);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 50, height: 50, x: 0, y: 0 } });
    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#f00' } });
    const edgeId = graph.addEdge(rect, 'path', fill, 'path');

    history.begin('Setup');
    history.recordAddNode(graph.getNode(rect)!);
    history.recordAddNode(graph.getNode(fill)!);
    history.recordAddEdge({ id: edgeId, source: rect, target: fill, sourcePort: 'path', targetPort: 'path' });
    history.commit();

    // Disconnect
    history.begin('Disconnect');
    graph.removeEdge(edgeId);
    history.recordRemoveEdge({ id: edgeId, source: rect, target: fill, sourcePort: 'path', targetPort: 'path' });
    history.commit();

    // After disconnection, both nodes are terminal → 2 scene items (no fill on rect)
    let result = executor.execute(graph);
    expect(result.scene.items).toHaveLength(2);

    // Undo → reconnect
    const affected = history.undo(graph);
    for (const id of affected) executor.invalidate(id);
    result = executor.execute(graph);
    expect(result.scene.items).toHaveLength(1); // fill is terminal, rect feeds into it
    expect(graph.edgeCount).toBe(1);
  });

  it('should undo node removal and restore full subgraph', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'NodeUndo', 100, 100);
    const executor = new GraphExecutor(registry);
    const history = new HistoryManager(graph);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 40, height: 40, x: 0, y: 0 } });
    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#0f0' } });
    const edgeId = graph.addEdge(rect, 'path', fill, 'path');

    history.begin('Setup');
    history.recordAddNode(graph.getNode(rect)!);
    history.recordAddNode(graph.getNode(fill)!);
    history.recordAddEdge({ id: edgeId, source: rect, target: fill, sourcePort: 'path', targetPort: 'path' });
    history.commit();

    // Remove the rectangle (also removes the edge)
    history.begin('Delete rect');
    const removedEdges = graph.removeNode(rect);
    history.recordRemoveNode(
      { id: rect, type: 'rectangle', params: { width: 40, height: 40, x: 0, y: 0 } },
      removedEdges,
    );
    history.commit();

    expect(graph.nodeCount).toBe(1);
    expect(graph.edgeCount).toBe(0);

    // Undo → rect and edge restored
    history.undo(graph);
    expect(graph.nodeCount).toBe(2);
    expect(graph.edgeCount).toBe(1);

    // Execute and verify SVG still works
    executor.clearCache();
    const result = executor.execute(graph);
    expect(result.scene.items).toHaveLength(1);
    const svg = sceneToSvg(result.scene);
    expect(svg).toContain('fill="#0f0"');
  });

  it('should serialize graph, restore, and produce identical SVG', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'Roundtrip', 100, 100);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({
      type: 'rectangle',
      params: { width: 50, height: 50, x: 25, y: 25 },
    });
    const fill = graph.addNode({
      type: 'fill',
      params: { fillType: 'solid', color: '#10b981' },
    });
    graph.addEdge(rect, 'path', fill, 'path');

    const svg1 = sceneToSvg(executor.execute(graph).scene);

    // Serialize → deserialize
    const json = graph.toJSON();
    const restored = VectorGraphModel.fromJSON(json);
    const executor2 = new GraphExecutor(registry);
    const svg2 = sceneToSvg(executor2.execute(restored).scene);

    expect(svg2).toBe(svg1);
  });
});
```

- [ ] **Step 2: Run test — verify it passes (all components already implemented)**

```bash
bun test packages/vector-engine/src/integration.test.ts
```

If any test fails, debug and fix the specific component.

- [ ] **Step 3: Commit**

```bash
git add packages/vector-engine/src/integration.test.ts
git commit -m "test(vector-engine): end-to-end integration tests (HYP-308)"
```

---

### Task 22: Public API + Package Exports

**Files:**

- Modify: `packages/vector-engine/src/index.ts`
- Modify: `packages/vector-wasm/src/index.ts`

- [ ] **Step 1: Define public API**

`packages/vector-engine/src/index.ts`:

```typescript
/**
 * @file Vector Engine — public API
 *
 * Accessed via: import { VectorGraphModel, GraphExecutor, ... } from 'vector-engine'
 */

// Types
export type {
  PathValue,
  StyleValue,
  FillStyle,
  StrokeStyle,
  ShadowStyle,
  BlendMode,
  GradientStop,
  Point,
  BoundingBox,
  TransformMatrix,
  NodeValue,
  NodeValueType,
  ParamType,
  ParamDefinition,
  PortDefinition,
  NodeCategory,
  NodeTypeDefinition,
  GraphNode,
  GraphEdge,
  VectorGraph,
  SceneItem,
  SceneGroup,
  SceneEntry,
  SceneGraph,
  NodeExecutionState,
  NodeExecutionStatus,
  ExecutionResult,
  GraphDiff,
  HistoryEntry,
} from './types';

export { IDENTITY_TRANSFORM, isSceneGroup, isSceneItem } from './types';

// Path
export {
  PathCmd,
  type PathCommand,
  encodeCommands,
  decodeCommands,
  commandsToSvgD,
  svgDToCommands,
} from './path/commands';
export { PathBuilder } from './path/builder';
export { computeBounds } from './path/bounds';

// Graph
export { VectorGraphModel } from './graph/vector-graph';
export { GraphExecutor } from './graph/executor';
export { buildScene } from './graph/scene-builder';
export { HistoryManager } from './graph/history';

// Nodes
export { NodeRegistry } from './nodes/registry';
export { createDefaultRegistry } from './nodes/register-all';

// Export
export { sceneToSvg } from './export/svg';
```

`packages/vector-wasm/src/index.ts`:

```typescript
export type { PathOpsBackend, BooleanOp } from './types';
export { MockPathOps } from './mock-pathops';
// export { CanvasKitPathOps } from "./canvaskit-pathops"; // uncomment when implemented
```

- [ ] **Step 2: Verify full test suite passes**

```bash
bun run test   # ALL tests including packages/
```

- [ ] **Step 3: Verify lint passes**

```bash
bun run lint
```

- [ ] **Step 4: Commit**

```bash
git add packages/
git commit -m "feat(vector-engine): finalize public API and package exports (HYP-308)"
```

---

## Summary

After completing all 22 tasks, the vector engine SDK provides:

| Capability                                                 | Status            |
| ---------------------------------------------------------- | ----------------- |
| Create vector documents (graph model)                      | ✅                |
| Shape generators (rect, ellipse, polygon, star, line, arc) | ✅                |
| Boolean operations (union, subtract, intersect, xor)       | ✅ (mock backend) |
| Path operations (reverse, close/open, join, break apart)   | ✅                |
| Style nodes (fill, stroke, opacity, blend mode)            | ✅                |
| Transform nodes (translate, rotate, scale, skew)           | ✅                |
| Graph execution with caching                               | ✅                |
| Undo/redo via graph diffs                                  | ✅                |
| SVG string export                                          | ✅                |
| Graph serialization (JSON roundtrip)                       | ✅                |

**Not in this plan (deferred to Plan 2+):**

- Real CanvasKit WASM integration (Plan 2)
- Clipper2 path offset (Plan 2)
- Deformation nodes, variable stroke, gradient mesh (Plan 2)
- Text to path (Plan 2)
- FIG import, SVG import (Plan 2)
- CanvasKit renderer (Plan 3)
- Editor UI, tools, panels (Plan 4)
- HyperIDE integration, MCP tools (Plan 4)
