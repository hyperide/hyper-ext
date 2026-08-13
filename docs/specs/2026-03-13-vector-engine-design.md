# Vector Engine — Design Specification

## Overview

A GPU-accelerated, WASM-powered vector editing engine for HyperIDE with a parametric
node-based history system (DAG). Embedded as a new "Vector" mode in the editor toolbar,
targeting icon creation, SVG editing, and advanced path operations that surpass Figma's
capabilities.

### Goals

- Vector editing mode integrated into HyperIDE (SaaS + VS Code extension)
- Node-based DAG for non-destructive parametric editing (CAD-like history)
- GPU-accelerated rendering via CanvasKit (WASM)
- WASM compute for path operations (boolean, offset, stroke)
- SDK architecture: reusable packages independent of HyperIDE UI
- SVG roundtrip: parse existing SVG from JSX, edit, inject back via AST
- Bidirectional sync: external TSX edits update the graph via semantic diff

### Non-Goals (v1)

- Lottie/Rive animation export
- Real-time collaborative vector editing
- Whiteboard/moodboard mode in board view
- Raster image editing
- Dedicated AI generation UI (no "Generate icon" button, no text-to-vector prompt field;
  the AI chat + MCP tools provide full programmatic access to every vector operation)

## Architecture

### Approach: Hybrid TS + WASM

TypeScript manages the graph, execution, UI, and document model. WASM modules handle
compute-intensive geometry: boolean operations, path offset, text shaping. Clean boundary:
TS orchestrates, WASM calculates.

### Monorepo Setup

The project currently has no `packages/` directory. A Bun workspace configuration is added
to the root `package.json`:

```jsonc
{
  "workspaces": ["packages/*"],
}
```

Each package has its own `package.json`, `tsconfig.json`, and test configuration.
Packages reference each other via workspace protocol (`"vector-wasm": "workspace:*"`).

Build integration:

- `scripts/build-client.ts` updated to resolve workspace packages
- `bun run test` discovers tests in `packages/*/src/**/*.test.ts`
- `tsconfig.json` path aliases: `@vector-engine/*`, `@vector-renderer/*`, etc.
- VS Code extension bundles packages via esbuild (same pattern as existing stubs)

### Package Structure

```
packages/
├── vector-engine/          # Core: node graph, document model, operations
│   ├── graph/              # DAG engine (graphology + custom executor)
│   ├── nodes/              # Node type implementations
│   ├── document/           # VectorDocument, scene graph
│   ├── path/               # Path/curve primitives (wraps WASM)
│   └── export/             # SVG/JSON serialization
│
├── vector-renderer/        # CanvasKit rendering adapter
│   ├── canvaskit/          # CanvasKit WASM integration
│   ├── svg/                # SVG string renderer (server-side, export)
│   └── types.ts            # Renderer interface
│
├── vector-editor/          # UI: tools, panels, interactions (React)
│   ├── tools/              # Pen, Select, Shape, etc. (state machines)
│   ├── panels/             # Properties, Layers, History, Node Graph
│   ├── hooks/              # React hooks
│   └── store/              # Zustand stores
│
└── vector-wasm/            # WASM compute modules (thin TS wrappers)
    ├── pathops.ts           # CanvasKit PathOps boolean/stroke/dash
    ├── clipper.ts           # Clipper2 offset/inflate/deflate
    └── shaping.ts           # rustybuzz text shaping
```

### Dependency Graph

```
vector-engine ──→ vector-wasm
     ↑                ↑
vector-renderer ──────┘
     ↑
vector-editor ──→ vector-engine + vector-renderer + React/Zustand
     ↑
HyperIDE client/ ──→ vector-editor (integration layer)
HyperIDE server/ ──→ vector-engine (SVG export, server-side ops)
HyperIDE vscode-extension/ ──→ vector-editor (embedded panel)
```

Key constraint: `vector-engine` has zero framework dependencies (no React, no DOM).
It can run in Node.js, Web Workers, server, and tests.

## Core Type System

All types live in `vector-engine`. Other packages import from here.

### Value Types (node I/O)

```typescript
/** SVG path data + metadata, the primary data flowing between nodes */
interface PathValue {
  /** SVG path commands (M, L, C, Q, A, Z) as typed array for WASM interop */
  commands: Float64Array;
  /** Bounding box (computed lazily, cached) */
  bounds?: BoundingBox;
  /** Whether the path is closed */
  closed: boolean;
}

/** Visual style applied to a path */
interface StyleValue {
  fill?: FillStyle;
  stroke?: StrokeStyle;
  opacity?: number;
  blendMode?: BlendMode;
  shadow?: ShadowStyle;
  blur?: number;
}

interface FillStyle {
  type: 'solid' | 'linearGradient' | 'radialGradient' | 'conicGradient';
  color?: string; // hex, for solid
  stops?: GradientStop[]; // for gradients
  from?: Point;
  to?: Point; // for linear
  center?: Point;
  radius?: number; // for radial
}

interface StrokeStyle {
  color: string;
  width: number;
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  dashArray?: number[];
  dashOffset?: number;
}

interface ShadowStyle {
  color: string;
  offsetX: number;
  offsetY: number;
  blur: number;
}

type BlendMode =
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

interface GradientStop {
  offset: number;
  color: string;
}
interface Point {
  x: number;
  y: number;
}
interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 2D affine transform matrix [a, b, c, d, e, f] */
type TransformMatrix = [number, number, number, number, number, number];

/** Vector network — graph-based path model (Figma-style, Plan 2) */
interface VectorNetwork {
  vertices: VectorVertex[];
  segments: VectorSegment[];
  regions: VectorRegion[];
}

interface VectorVertex {
  x: number;
  y: number;
  cornerRadius?: number;
  handleMirroring?: 'none' | 'angle' | 'angleAndLength';
}

interface VectorSegment {
  start: number;
  end: number; // vertex indices
  tangentStart: Point;
  tangentEnd: Point; // bezier handles (0,0 = straight)
}

interface VectorRegion {
  windingRule: 'evenOdd' | 'nonZero';
  loops: number[][]; // segment index chains
  fills: FillStyle[];
}

/** Discriminated union for all values flowing through the graph */
type NodeValue =
  | { type: 'path'; value: PathValue }
  | { type: 'network'; value: VectorNetwork }
  | { type: 'style'; value: StyleValue }
  | { type: 'number'; value: number }
  | { type: 'color'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'transform'; value: TransformMatrix };
```

### Scene Graph (renderer input)

The scene graph is the evaluated output of the node DAG — a flat, ordered list of
renderable items. The renderer consumes this; it does not traverse the node graph.

```typescript
/** A single renderable element */
interface SceneItem {
  id: string; // originating node id
  path: PathValue;
  style: StyleValue;
  transform: TransformMatrix;
  clipPath?: PathValue;
  visible: boolean;
  name?: string; // for layers panel
}

/** Complete scene ready for rendering */
interface SceneGraph {
  items: SceneItem[]; // ordered back-to-front (painter's algorithm)
  canvas: { width: number; height: number };
  background?: string; // canvas background color
}

/** Hit test result */
interface HitResult {
  itemId: string;
  hitType: 'fill' | 'stroke' | 'control-point';
  point: Point; // exact hit coordinates
  distance: number; // distance from point to nearest edge
}
```

### Viewport

```typescript
interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
  /** Convert screen coordinates to canvas coordinates */
  screenToCanvas(point: Point): Point;
  /** Convert canvas coordinates to screen coordinates */
  canvasToScreen(point: Point): Point;
}
```

### Parameter Definitions

```typescript
type ParamType = 'number' | 'string' | 'color' | 'boolean' | 'enum' | 'point';

interface ParamDefinition {
  name: string;
  type: ParamType;
  default: unknown;
  label?: string; // human-readable, for properties panel
  /** Number constraints */
  min?: number;
  max?: number;
  step?: number;
  /** Enum options */
  options?: Array<{ value: string; label: string }>;
}
```

## Node-based DAG — Parametric History

### Concept

Every user action creates or modifies a node in a directed acyclic graph.
The document IS the graph. Changing a parameter on any node triggers re-execution
of that node and all downstream dependents. Unchanged subtrees return cached results.

```
[Rectangle]──→[Round Corners r=8]──→[Path Offset d=4]──→[Fill #3b82f6]──→ rendered
[Circle]──────────────────────────→[Boolean Union]──────→[Stroke 2px]──→ rendered
                                        ↑
                              [Path Offset d=4]
```

### Graph Data Model

Built on `graphology` (graph data structure) + `graphology-dag` (topological sort,
cycle detection).

```typescript
/** A node in the parametric graph */
interface GraphNode {
  id: string;
  type: string; // registered node type name
  params: Record<string, unknown>; // user-editable parameters
  position?: Point; // for node graph UI layout
}

/** A connection between nodes */
interface GraphEdge {
  id: string;
  source: string; // source node id
  target: string; // target node id
  sourcePort: string; // output port name
  targetPort: string; // input port name
}

/** Port definition for a node type */
interface PortDefinition {
  name: string;
  type: NodeValue['type']; // must match NodeValue discriminant
  multiple?: boolean; // accepts multiple connections (e.g. boolean union)
}

/** Node type registration */
interface NodeTypeDefinition {
  type: string;
  label: string;
  category: 'generator' | 'pathOp' | 'style' | 'transform' | 'utility';
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  params: ParamDefinition[];
  execute(inputs: Record<string, NodeValue>, params: Record<string, unknown>): Record<string, NodeValue>;
}
```

Port type compatibility is enforced at edge creation time: an edge can only connect
ports with matching `NodeValue['type']`. The UI prevents invalid connections;
deserialization validates and rejects mismatches with a diagnostic.

### VectorGraph (primary document type)

```typescript
interface VectorGraph {
  /** File format version for migration */
  version: number;
  /** Unique document identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Canvas dimensions */
  canvas: { width: number; height: number };
  /** All nodes, keyed by id */
  nodes: Record<string, GraphNode>;
  /** All edges */
  edges: GraphEdge[];
  /** Muted node ids (skipped during execution) */
  muted: string[];
  /** Viewport state (not part of the document semantics, but persisted for UX) */
  viewport: { zoom: number; panX: number; panY: number };
}
```

### Execution Engine

1. User changes a node parameter (or adds/removes node/edge)
2. Executor marks the node as **dirty**
3. Topological sort (graphology-dag) determines execution order
4. Walk dirty nodes in order; for each:
   - Compute cache key: `hash(nodeType, params, ...inputCacheKeys)`
   - If cache hit → skip, return cached result
   - If cache miss → call `node.execute(inputs, params)`, store result
5. Terminal nodes produce the `SceneGraph`

```typescript
interface ExecutionEngine {
  /** Execute the graph, returns scene graph for rendering */
  execute(graph: VectorGraph): ExecutionResult;

  /** Mark a node and all descendants as dirty */
  invalidate(nodeId: string): void;

  /** Get cached result for a node */
  getCachedResult(nodeId: string): Record<string, NodeValue> | undefined;

  /** Clear all caches */
  clearCache(): void;
}

interface ExecutionResult {
  scene: SceneGraph;
  /** Per-node execution status (for error display in UI) */
  nodeStatus: Record<string, NodeExecutionStatus>;
  /** Total execution time in ms */
  executionTimeMs: number;
}

interface NodeExecutionStatus {
  state: 'ok' | 'error' | 'skipped' | 'cached';
  error?: string;
  executionTimeMs?: number;
}
```

### Error Handling

When a node's `execute()` throws:

1. The node's status is set to `'error'` with the error message
2. All downstream nodes are set to `'skipped'`
3. The scene graph is rendered without the failed subtree
4. The UI shows an error indicator on the failed node (red border in layers panel,
   error icon in node graph)
5. The user can fix the parameter or disconnect the node — execution resumes
6. Errors do NOT propagate beyond the failed subtree; independent branches render normally

### Undo/Redo

Not command-pattern. Instead: **graph diff snapshots**.

```typescript
interface HistoryEntry {
  timestamp: number;
  description: string; // "Changed radius to 12" | "Added rectangle" | "Deleted node"
  diffs: GraphDiff[];
}

/** Covers both parameter changes and structural changes */
type GraphDiff =
  | { kind: 'paramChange'; nodeId: string; param: string; oldValue: unknown; newValue: unknown }
  | { kind: 'addNode'; node: GraphNode }
  | { kind: 'removeNode'; node: GraphNode; removedEdges: GraphEdge[] }
  | { kind: 'addEdge'; edge: GraphEdge }
  | { kind: 'removeEdge'; edge: GraphEdge }
  | { kind: 'muteNode'; nodeId: string; muted: boolean }
  | { kind: 'moveNode'; nodeId: string; oldPosition: Point; newPosition: Point };
```

- **Undo**: reverse each diff in the entry (remove added nodes, re-add removed nodes,
  restore old param values), then re-execute dirty subtree
- **Redo**: re-apply each diff, re-execute
- A single user action (e.g. "draw rectangle") may produce multiple diffs grouped
  in one `HistoryEntry` (addNode + addEdge + paramChange)
- History is persisted in the `.graph` file as an operation log (see Undo/Redo Persistence).

### Snapshot Cache

On save, an optional per-node result cache is written alongside the graph:

```
.hypercanvas/vectors/<Component>/
├── arrow.graph.json                  # source of truth, git-tracked
└── .cache/
    └── arrow-<graphHash>.snap.json   # intermediate results, gitignored
```

- File named `<asset>-<sha256(graph.json content)>.snap.json`
- Contains `Record<nodeId, { hash: string; result: serialized NodeValue }>`
- On file open: if a `.snap.json` exists matching current graph hash → warm start
  (only re-execute nodes whose input hashes changed since snapshot)
- If no matching snapshot → full re-execution (always correct)
- Old snapshots auto-cleaned: keep only the 3 most recent per asset

**Nearest snapshot search**: when no exact hash match exists, the engine scans
available snapshots and picks the one with the most cache hits (most node hashes
still valid). This gives a partial warm start even after small graph edits.

```typescript
interface SnapshotManager {
  /** Save current execution cache to disk */
  save(graphHash: string, cache: ExecutionCache): Promise<void>;

  /** Load best-matching snapshot for the given graph */
  loadBest(graphHash: string, nodeHashes: Record<string, string>): Promise<ExecutionCache | null>;

  /** Remove old snapshots beyond retention limit */
  cleanup(assetDir: string, keepCount: number): Promise<void>;
}
```

### Mute Semantics

When a node is muted:

- **Single input, single output** (same type): input passes through to dependents
- **Multiple inputs** (e.g. boolean union): the first connected input passes through
- **Type mismatch** (output type differs from input): dependents receive nothing,
  treated as disconnected (show warning in UI)
- Mute state is persisted in `graph.json` `muted` array and is part of undo/redo

### CAD-like Operations

| Operation              | Implementation                                                       |
| ---------------------- | -------------------------------------------------------------------- |
| **Mute node**          | Skip node during execution, pass input through (see semantics above) |
| **Reorder**            | Re-wire edges, re-execute affected subtree                           |
| **Branch**             | One output connected to multiple inputs (e.g. icon in 3 sizes)       |
| **Edit any parameter** | Change param on any node → replay from that point forward            |
| **Rollback flatten**   | Flatten = node. Mute it → original paths restored                    |

## Integration with HyperIDE

### Toolbar

New mode added to `client/components/Toolbar.tsx`:

```typescript
export type Tool = 'board' | 'interact' | 'design' | 'vector' | 'code';
```

Position: between Design and Code. Hotkey: `5` / `Alt+5` / `Ctrl+Shift+5`.

Vector tool hotkeys (V, P, R, O, L, T, H, Z) are scoped — only active when
`mode === 'vector'`. They do not conflict with existing HyperIDE hotkeys in
other modes.

### PlatformMessage Types

New messages added to `client/lib/platform/types.ts`:

```typescript
type VectorPlatformMessage =
  | { type: 'vector:modeEntered'; assetId: string }
  | { type: 'vector:modeExited'; exportedSvg: string }
  | { type: 'vector:graphChanged'; graphId: string }
  | { type: 'vector:nodeSelected'; nodeIds: string[] }
  | { type: 'vector:svgExported'; svg: string; componentPath: string };
```

These are added to the `PlatformMessage` union to avoid the silent-failure pitfall
documented in CLAUDE.md.

### Entry Points

| Action                                           | Behaviour                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| Double-click SVG element in Design mode          | Identify via `data-uniq-id`, extract SVG via `lib/ast/`, parse → graph |
| Toolbar → Vector (SVG selected)                  | Same as double-click                                                   |
| Toolbar → Vector (nothing selected)              | New empty vector document                                              |
| **Open `.graph` file** (file explorer / sidebar) | Open vector editor in Vector mode directly. Load graph, show canvas.   |
| AI agent programmatic call                       | `vector-engine` API, no UI needed                                      |
| AI chat command `> export svg`                   | Context-aware command execution (see Command Mode below)               |

SVG elements are identified by their `data-uniq-id` attribute (existing CanvasEngine
infrastructure). This ID maps the DOM element back to the AST node for export.

### File Associations

| File                                 | Opens as                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `*.graph` (Kiwi binary)              | Vector mode editor. Knows its linked TSX component via metadata inside the graph         |
| `icons/Icon.tsx` containing `<svg>`  | Design mode. Double-click SVG → Vector mode, loads/creates linked `.graph`               |
| `*.graph.json` (JSON representation) | Editable in Code mode. Changes reconciled back into the graph (see Graph Reconciliation) |

When a `.graph` file is opened, the editor:

1. Loads and decodes the Kiwi binary into `VectorGraph`
2. Resolves the linked TSX component (stored as `componentPath` in graph metadata)
3. Enters Vector mode with the graph loaded
4. Shows the rendered scene immediately (from snapshot cache if available)
5. The Properties panel shows both graph params AND the target component path

### SVG ↔ Node Graph Roundtrip

**Import (SVG → Graph)**:

1. Extract `<svg>` content from JSX via `lib/ast/` using `data-uniq-id`
2. Parse SVG DOM tree (svgson/svg-parser)
3. Convert each SVG element to corresponding graph nodes
4. Connect nodes to reconstruct the visual hierarchy

SVG import feature support (v1):

| SVG Feature                                                            | Support     | Strategy                                                              |
| ---------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| `<path d="...">`                                                       | ✅ full     | Direct PathValue conversion                                           |
| `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polygon>`, `<polyline>` | ✅ full     | Convert to generator nodes                                            |
| `<g>` (groups + nested transforms)                                     | ✅ full     | Group node with accumulated transform                                 |
| `viewBox` / `preserveAspectRatio`                                      | ✅ full     | Canvas dimensions + viewport mapping                                  |
| `transform` attribute (matrix, translate, rotate, scale, skew)         | ✅ full     | Transform node per element                                            |
| Inline `style="..."` CSS                                               | ✅ full     | Parse to fill/stroke/opacity style nodes                              |
| `fill` / `stroke` / `opacity` attributes                               | ✅ full     | Style nodes                                                           |
| `<linearGradient>` / `<radialGradient>` in `<defs>`                    | ✅ full     | FillStyle gradient params                                             |
| `<use>` / `<defs>` / `<symbol>`                                        | ✅ expand   | Inline expansion at import time (no symbol node in v1)                |
| `<clipPath>`                                                           | ✅ full     | Clip Mask node                                                        |
| CSS `<style>` blocks and `class` attributes                            | ⚠️ basic    | Resolve classes to inline styles at import; complex selectors ignored |
| `<text>` (not outlined)                                                | ⚠️ basic    | Convert to Text to Path node (font must be available)                 |
| `marker-start` / `marker-end` (arrows)                                 | ⚠️ basic    | Expand to explicit Arrow nodes where detectable                       |
| `<mask>` (alpha masks)                                                 | ⚠️ basic    | Alpha Mask node for simple cases                                      |
| SVG filters (`<filter>`, `feGaussianBlur`, etc.)                       | ❌ v2       | Too complex for v1; imported as opaque metadata                       |
| Pattern fills (`<pattern>`)                                            | ❌ v2       | Requires tiling support                                               |
| Embedded `<image>`                                                     | ❌ non-goal | Raster editing is out of scope                                        |
| SVG animations (`<animate>`, SMIL)                                     | ❌ non-goal | Animation is Phase 3                                                  |

**Export (Graph → JSX)**:

1. Execute graph → produce SVG path data + styles
2. Generate `<svg>` JSX string
3. Inject into component via `lib/ast/` mutator, matching by `data-uniq-id`
4. Existing non-SVG JSX remains untouched

**Export (Graph → SVG string)** (SDK-level, no JSX/DOM dependency):

1. Execute graph → produce scene graph
2. `vector-engine/export/svg.ts` serializes scene graph to SVG string directly
3. Available on server, in workers, in CLI — no renderer needed

**Import (FIG → Graph)**:

Figma `.fig` files are parsed via `@open-pencil/core/kiwi` (MIT, TypeScript, ~5K lines).
The pipeline:

1. Unzip `.fig` container, extract `canvas.fig`
2. Decompress Kiwi header (schema) + payload (zstd/deflate)
3. Decode `NodeChange[]` via reverse-engineered Figma Kiwi schema (~194 definitions)
4. Convert Figma nodes to vector-engine graph nodes:
   - RECTANGLE, ELLIPSE, POLYGON, STAR → generator nodes
   - VECTOR → PathValue (decode fillGeometry blob → SVG path data)
   - BOOLEAN_OPERATION → Boolean node (union/subtract/intersect/xor)
   - FRAME / GROUP → Group node
   - TEXT → Text to Path node
   - Fills, strokes, effects → Style nodes
   - Transforms → Transform nodes
5. Wire edges to reconstruct the visual hierarchy

Supported Figma features (v1):

| Feature                                                | Support | Notes                                    |
| ------------------------------------------------------ | ------- | ---------------------------------------- |
| Basic shapes (rectangle, ellipse, polygon, star, line) | ✅      | Direct mapping to generator nodes        |
| Vector paths (pen tool output)                         | ✅      | fillGeometry blob → PathValue            |
| Boolean operations                                     | ✅      | BOOLEAN_OPERATION node type              |
| Fills (solid, gradient)                                | ✅      | FillStyle mapping                        |
| Strokes                                                | ✅      | StrokeStyle mapping                      |
| Effects (shadows, blur)                                | ✅      | Style nodes                              |
| Groups and frames                                      | ✅      | Group nodes                              |
| Transforms                                             | ✅      | Transform nodes                          |
| Text (as paths)                                        | ⚠️      | Font must be available locally           |
| Component instances                                    | ⚠️      | Flattened at import (overrides resolved) |
| Auto-layout                                            | ❌      | No layout engine in v1                   |
| Variables / design tokens                              | ❌      | No variable system in v1                 |
| Prototyping / interactions                             | ❌      | Out of scope                             |

**Risk**: Figma's Kiwi schema is reverse-engineered and undocumented. Format can change
without notice. OpenPencil actively tracks changes, but there's inherent fragility.
Mitigation: graceful degradation — unknown node types become opaque placeholders with
a warning, not hard failures.

**Alternative**: Figma REST API (`GET /v1/files/:key/nodes`) exports SVG directly.
No .fig parsing needed, but requires API token and network access. Supported as a
fallback via `> import from figma` command.

**Reverse sync (TSX → Graph) — Semantic Diff**:
When the TSX file changes externally (developer edits code, git pull, AI agent):

1. File watcher detects `<svg>` content changed in the component
2. Parse new SVG into a temporary "incoming" graph
3. Run **semantic diff** between current graph output and incoming graph:
   - Match shapes by geometry similarity (path data hash, position, size)
   - Classify changes: added shapes, removed shapes, modified attributes
4. Convert diff into graph operations:
   - Added shape → `addNode` + `addEdge` (append to graph as new generator)
   - Removed shape → `removeNode` (disconnect from graph, warn if has dependents)
   - Modified attribute → `paramChange` on the matching node
5. Apply operations to the existing graph, preserving parametric history
6. If structural ambiguity (e.g. can't determine which node maps to which SVG element):
   show merge UI with visual diff, let user resolve manually

This avoids the "re-import and lose history" problem. Most external edits
(color change, position tweak, new path added) map cleanly to graph operations.

### Storage

| Data              | Storage                                                       | Notes                                         |
| ----------------- | ------------------------------------------------------------- | --------------------------------------------- |
| Node graph        | `.hypercanvas/vectors/<Component>/<asset>.graph`              | **Kiwi binary**, source of truth, git-tracked |
| Snapshot cache    | `.hypercanvas/vectors/<Component>/.cache/<asset>-<hash>.snap` | Kiwi binary, gitignored, per-revision         |
| Derived output    | Inline `<svg>` in `icons/Icon.tsx` via `lib/ast/`             | No separate .svg files                        |
| Undo/redo history | Part of the graph — operation log persisted in `.graph` file  | Survives session restarts                     |
| Asset metadata    | Database (like canvas compositions)                           | Thumbnails, tags, search                      |

### File Format: Kiwi Binary

Primary format is **Kiwi codec** (schema-based binary, created by Evan Wallace for Figma).

Why Kiwi over JSON/MessagePack:

- **Schema evolution**: backward + forward compatible. Add node types without breaking old files
- **Compact**: no field names in payload, varint encoding. ~30-50% smaller than JSON
- **Trees/graphs**: designed specifically for tree-structured data
- **Single-pass**: linear serialization, cache-friendly parsing
- **Proven**: Figma .fig files use Kiwi at scale

The Kiwi schema (`.kiwi` file) defines all graph types (`GraphNode`, `GraphEdge`,
`VectorGraph`, etc.) and is versioned alongside the engine code. Schema changes
trigger automatic migration on file open.

**JSON representation**: exported via `> export graph.json` or auto-generated alongside
`.graph`. Human-readable, editable in Code mode. Edits are reconciled back into the
graph via semantic diff (see Graph Reconciliation). Useful for: debugging, git diff
inspection, manual scripting, AI agent edits, bulk parameter changes.

### Graph File Structure

```
.hypercanvas/vectors/
└── IconButton/
    ├── arrow.graph                    # Kiwi binary (source of truth)
    ├── checkmark.graph                # another asset
    └── .cache/
        ├── arrow-a3f8c2.snap          # snapshot for revision a3f8c2
        ├── arrow-b7d1e4.snap          # snapshot for revision b7d1e4
        └── checkmark-c9e0f1.snap      # snapshot for checkmark
```

### Graph Metadata (inside .graph file)

```typescript
interface VectorGraphMeta {
  /** Link to the TSX component that contains the derived SVG */
  componentPath: string; // e.g. "src/icons/IconButton.tsx"
  /** data-uniq-id of the <svg> element in the component */
  svgElementId?: string;
  /** When this graph was last exported to the component */
  lastExportTimestamp?: number;
}
```

This bidirectional link means:

- Opening `arrow.graph` → editor knows to export to `IconButton.tsx`
- Opening `IconButton.tsx` and double-clicking SVG → finds `arrow.graph`

### Undo/Redo Persistence

Undo history IS part of the graph file — the `.graph` file stores the full operation
log, not just current state. This means:

- Close and reopen the file → undo history is still there
- The "current state" is derived by replaying the log (but snapshots make this instant)
- The operation log is append-only; undo = mark entry as undone, redo = unmark
- Log compaction: on explicit save, entries older than N (configurable, default 100)
  are collapsed into a single "base state" checkpoint. Recent entries remain granular.

```typescript
interface VectorGraphFile {
  /** Schema version */
  version: number;
  /** Graph metadata (component link, etc.) */
  meta: VectorGraphMeta;
  /** Base state — collapsed history checkpoint */
  base: VectorGraphState;
  /** Recent operations on top of base (undo-able) */
  operations: GraphOperation[];
  /** Index into operations: everything before this is "done", after is "undone" */
  undoPointer: number;
  /** Viewport (UX state, not semantic) */
  viewport: { zoom: number; panX: number; panY: number };
}

interface VectorGraphState {
  canvas: { width: number; height: number };
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
  muted: string[];
}

/** Matches GraphDiff but with timestamp and description */
interface GraphOperation {
  timestamp: number;
  description: string;
  diffs: GraphDiff[];
}
```

To get current state: apply `operations[0..undoPointer]` to `base`.
With a snapshot cache, this is O(1) — not O(n) replay.

### Graph Reconciliation

When a `.graph.json` file is edited (in Code mode, by AI agent, or externally) and
saved, the engine reconciles changes back into the live graph. This is analogous to
React's DOM reconciliation — minimal graph mutations derived from a structural diff.

**Trigger**: file watcher detects `.graph.json` changed → reconciliation pipeline runs.

**Pipeline**:

1. **Parse**: load modified JSON, validate against schema. If invalid JSON → reject,
   show parse error in editor, no changes applied.

2. **Diff**: compare modified graph state against current in-memory graph. Produces a
   classified changeset:

```typescript
interface ReconciliationDiff {
  added: {
    nodes: GraphNode[]; // new nodes not in current graph
    edges: GraphEdge[]; // new edges
  };
  removed: {
    nodeIds: string[]; // nodes missing from modified JSON
    edgeIds: string[]; // edges missing from modified JSON
  };
  modified: {
    params: Array<{
      // param values changed
      nodeId: string;
      changes: Record<string, { old: unknown; new: unknown }>;
    }>;
    reordered: Array<{
      // edges rewired (node moved in pipeline)
      edgeId: string;
      old: { source: string; target: string };
      new: { source: string; target: string };
    }>;
    muted: {
      // mute state toggled
      added: string[]; // newly muted node ids
      removed: string[]; // unmuted node ids
    };
  };
  meta: {
    canvasChanged: boolean; // canvas dimensions changed
    viewportChanged: boolean; // viewport state changed
  };
}
```

3. **Validate**: check that the resulting graph is a valid DAG (no cycles, no dangling
   edges, port types compatible). If invalid → reject with specific diagnostic,
   revert `.graph.json` to last known-good state.

4. **Apply**: convert diff into `GraphOperation[]` and apply to the live graph.
   This preserves undo history — the reconciliation itself is an undoable operation
   ("Reconciled from JSON edit").

5. **Re-execute**: invalidate affected nodes, execute dirty subtree, update rendering.

**Matching strategy** (how to pair old nodes with new nodes):

- **By id** (primary): nodes have stable ids. If `n1` exists in both old and new → matched.
- **By position in array** (fallback for edges): edges don't always have stable ids.
  Match by `(source, sourcePort, target, targetPort)` tuple.
- **Unmatched new nodes**: treated as additions.
- **Unmatched old nodes**: treated as deletions. If deleted node has downstream dependents,
  show a warning but proceed (dependents become disconnected).

**Full reload fallback**: if the diff is too large (>50% of nodes changed) or if
structural integrity can't be verified, fall back to full graph replacement:

- Save current undo history as a "pre-reconciliation checkpoint"
- Replace entire graph state with the JSON content
- Undo history resets to a single base state (the new JSON)
- Show notification: "Graph was fully reloaded from JSON (history compacted)"

**Sync direction**: `.graph` (Kiwi binary) is always the canonical format.
`.graph.json` is a projection. After reconciliation, the Kiwi `.graph` file is
updated to match. The JSON file is then refreshed to stay in sync.

### Version Migration

When `version` in `graph.json` is older than the current engine version:

- Engine runs a migration pipeline: `v1→v2→v3→...→current`
- Each migration is a pure function `(oldGraph) => newGraph`
- Migration bumps the version field and re-saves
- Unknown future versions (downgrade) → refuse to open, show error with version info

### Persistence Triggers

- **Auto-save**: debounced (500ms after last change), writes `graph.json`
- **Explicit save** (Cmd+S): immediate write + snapshot cache generation
- **On Vector mode exit**: save + export SVG to JSX
- **On window unload**: best-effort save (sendBeacon or sync write)

### Command Mode (`>` prefix in AI Chat)

Typing `>` in the AI chat input activates **command mode**: a context-aware command
palette replaces the chat history area with a filtered list of available commands.

**Activation**: `>` as the first character in the AI chat input field.
**Deactivation**: backspace to remove `>`, or Escape, or selecting a command.
**Filtering**: typing after `>` narrows the list (fuzzy match).

Commands are context-sensitive — the list changes based on:

- Current mode (vector / design / board / code)
- What file is open (`.graph`, `.tsx`, `.svg`)
- What is selected (SVG element, graph node, nothing)

#### Vector Context Commands

| Command                   | Context                          | Action                                                       |
| ------------------------- | -------------------------------- | ------------------------------------------------------------ |
| `> export svg`            | Vector mode, graph open          | Export current graph as SVG string to clipboard              |
| `> export svg to file`    | Vector mode, graph open          | Export SVG to a standalone `.svg` file                       |
| `> export graph.json`     | Vector mode, graph open          | Export human-readable JSON (debug format)                    |
| `> export snapshot`       | Vector mode, graph open          | Force-write snapshot cache for current state                 |
| `> export to component`   | Vector mode, graph linked to TSX | Inject SVG into linked TSX component                         |
| `> import svg`            | Vector mode                      | Paste/select SVG → parse into current graph                  |
| `> import fig`            | Vector mode                      | Select .fig file → parse into current graph                  |
| `> import from figma`     | Vector mode                      | Figma REST API → SVG → parse into graph (requires API token) |
| `> import from component` | Vector mode, graph linked to TSX | Re-import SVG from linked component                          |
| `> link to component`     | Vector mode                      | Set/change the linked TSX component path                     |
| `> flatten history`       | Vector mode                      | Compact operation log to single base state                   |
| `> show graph json`       | Vector mode                      | Preview the graph as formatted JSON (read-only)              |
| `> open node graph`       | Vector mode                      | Toggle the @xyflow/react DAG visualization panel             |

#### Design Context Commands

| Command            | Context                   | Action                                           |
| ------------------ | ------------------------- | ------------------------------------------------ |
| `> edit as vector` | Design mode, SVG selected | Open selected SVG in Vector mode                 |
| `> create icon`    | Design mode               | Create new empty vector graph, enter Vector mode |

#### General Commands

| Command             | Context                 | Action                                               |
| ------------------- | ----------------------- | ---------------------------------------------------- |
| `> export png`      | Any visual mode         | Render current view to PNG (via CanvasKit)           |
| `> export pdf`      | Vector mode, graph open | Export as PDF (via CanvasKit Skia PDF backend, v1.x) |
| `> export data-uri` | Vector mode, graph open | Export SVG as CSS `data:image/svg+xml` URI           |
| `> list vectors`    | Any mode                | Show all `.graph` files in the project               |

**Implementation**: CommandRegistry in `vector-editor/commands/`. Each command is a
function with `{ id, label, context: ContextFilter, execute: (ctx) => void }`.
The AI chat component checks for `>` prefix and delegates to CommandRegistry.
Commands can return output that appears as a system message in the chat.

### Coexistence with CanvasEngine

When Vector mode is active:

- CanvasEngine instances become a read-only backdrop (dimmed)
- Vector editor renders in a separate CanvasKit surface overlaid on the viewport
- Selection, zoom, pan are handled by vector-editor (not canvas-engine)
- On exit from Vector mode: generated SVG is injected into the component AST
- CanvasEngine resumes control of the viewport

### WASM Loading in VS Code Extension

VS Code webviews have CSP restrictions on WASM loading. The WASM binaries
(CanvasKit, Clipper2, rustybuzz) are:

- Bundled as static assets in the extension's `media/` directory
- Served to the webview via `webview.asWebviewUri()` (converts to `vscode-resource://`)
- CanvasKit's `locateFile` callback is overridden to point to the bundled path
- Loading shows a progress indicator (skeleton canvas with spinner)

## Vector Operations (v1)

### Shape Generator Nodes

| Node      | Params                           | Output |
| --------- | -------------------------------- | ------ |
| Rectangle | width, height, x, y              | path   |
| Ellipse   | rx, ry, cx, cy                   | path   |
| Polygon   | sides, radius                    | path   |
| Star      | points, outerRadius, innerRadius | path   |
| Line      | x1, y1, x2, y2                   | path   |
| Arc       | radius, startAngle, endAngle     | path   |
| Spiral    | turns, startRadius, endRadius    | path   |
| Arrow     | length, headWidth, headLength    | path   |

### Path Operation Nodes

| Node                          | Backend            | Inputs → Output                                                           |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------- |
| Boolean Union                 | CanvasKit PathOps  | 2+ paths → path                                                           |
| Boolean Subtract              | CanvasKit PathOps  | 2 paths → path                                                            |
| Boolean Intersect             | CanvasKit PathOps  | 2 paths → path                                                            |
| Boolean Difference (XOR)      | CanvasKit PathOps  | 2 paths → path                                                            |
| Divide                        | CanvasKit PathOps  | 2+ paths → N region paths (split at all intersections)                    |
| Trim                          | CanvasKit PathOps  | 2 paths → front path with overlapping area removed                        |
| Crop                          | CanvasKit PathOps  | 2 paths → intersection area only (like intersect but keeps styles of top) |
| Path Offset (inflate/deflate) | Clipper2 WASM      | path + distance → path                                                    |
| Stroke to Path                | CanvasKit PathOps  | path + stroke params → filled path                                        |
| Dash                          | CanvasKit PathOps  | path + dash array → dashed path                                           |
| Simplify                      | CanvasKit PathOps  | path + tolerance → simplified path                                        |
| Flatten                       | CanvasKit PathOps  | path + maxError → polyline path                                           |
| Round Corners                 | Custom TS          | path + radius → path                                                      |
| Chamfer                       | Custom TS          | path + distance → chamfered path                                          |
| Smooth                        | Custom TS (bezier) | path → smoothed path                                                      |
| Reverse Path                  | Custom TS          | path → reversed path                                                      |
| Split Path                    | Custom TS          | path + offset → 2 paths                                                   |
| Join Paths                    | Custom TS          | 2 open paths → 1 path (connect endpoints)                                 |
| Break Apart                   | Custom TS          | compound path → N sub-paths                                               |
| Close/Open Path               | Custom TS          | path → toggled closed/open path                                           |
| Add Point                     | Custom TS          | path + position → path with new anchor                                    |
| Remove Point                  | Custom TS          | path + pointIndex → path without anchor                                   |
| Convert Point Type            | Custom TS          | path + pointIndex + type (smooth/corner/symmetric) → path                 |
| Subdivide                     | Custom TS          | path + segmentIndex → path with segment split (shape preserved)           |
| Curve Fit                     | fit-curve          | point[] → smooth bezier path                                              |
| Remove Self-Intersections     | CanvasKit PathOps  | path → clean path                                                         |
| Enforce Winding               | Custom TS          | path + direction (CW/CCW) → reoriented path                               |
| Trim Path                     | Custom TS          | path + start% + end% → sub-path (like AE trim paths)                      |

### Deformation Nodes (Live Effects)

| Node             | Backend   | Inputs → Output                                                     |
| ---------------- | --------- | ------------------------------------------------------------------- |
| Roughen          | Custom TS | path + size + detail + type (smooth/corner) → distorted path        |
| Zigzag           | Custom TS | path + size + ridgesPerSegment + type (smooth/corner) → zigzag path |
| Pucker & Bloat   | Custom TS | path + amount (-100..100) → pulled/pushed path                      |
| Twist            | Custom TS | path + angle → spirally rotated path                                |
| Warp             | Custom TS | path + warpType (arc/flag/wave/...) + bend% → warped path           |
| Envelope Distort | Custom TS | path + mesh (4-point/grid) → deformed path                          |

All deformation nodes are non-destructive (stacked in the DAG). They operate on
the flattened polyline approximation of the input path, then optionally re-fit curves
via `fit-curve` for smooth output. Parameters are animatable (future Phase 3).

### Variable Width Stroke

| Node            | Backend               | Inputs → Output                          |
| --------------- | --------------------- | ---------------------------------------- |
| Variable Stroke | Custom TS + CanvasKit | path + widthProfile → outlined fill path |

Width profile is an array of `{ offset: number; width: number }` points along the path
(0..1 normalized). The node interpolates between width points, generates an outline path
(offset left + offset right + caps), and outputs a filled path.

```typescript
interface WidthPoint {
  offset: number; // 0..1 along path length
  width: number; // stroke width at this point
  taper?: 'sharp' | 'round'; // endpoint taper style
}

// Node params
interface VariableStrokeParams {
  profile: WidthPoint[];
  cap: 'butt' | 'round' | 'square';
}
```

This enables calligraphic effects, tapered strokes, and pressure-sensitive pen input.
The Width Tool (UI, v1.x) lets users add/drag width points directly on the path.

### Style Nodes

| Node       | Params                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| Fill       | color \| gradient (linear/radial/conic) \| pattern                         |
| Stroke     | color, width, cap (butt/round/square), join (miter/round/bevel), dashArray |
| Opacity    | value 0..1                                                                 |
| Blend Mode | normal, multiply, screen, overlay, ... (CSS blend modes)                   |
| Shadow     | color, offsetX, offsetY, blur                                              |
| Blur       | radius (Gaussian)                                                          |

### Transform Nodes

| Node      | Params                       |
| --------- | ---------------------------- |
| Translate | dx, dy                       |
| Rotate    | angle, originX, originY      |
| Scale     | sx, sy, originX, originY     |
| Skew      | ax, ay                       |
| Matrix    | a, b, c, d, e, f (2D affine) |

### Text Nodes

| Node         | Backend        | Description                                                                                  |
| ------------ | -------------- | -------------------------------------------------------------------------------------------- |
| Text to Path | opentype.js    | font + string + size → path outlines (Latin, simple scripts)                                 |
| Text Shaping | rustybuzz-wasm | complex script shaping (Arabic, Devanagari) → glyph positions, then opentype.js for outlines |

rustybuzz is needed only for complex scripts. For Latin text, opentype.js handles
both shaping and outline extraction. The two compose: rustybuzz shapes → opentype.js
converts positioned glyphs to paths.

### Gradient Mesh (SDK-level, no dedicated UI in v1)

A gradient mesh is a grid of bezier patches where each vertex carries a color.
Bilinear interpolation across patches produces photorealistic color blending —
the Illustrator feature everyone wants but nobody can use because of bad UX.

```typescript
interface MeshValue {
  /** Grid dimensions */
  rows: number;
  cols: number;
  /** Vertices: (rows+1) × (cols+1) control points with colors */
  vertices: MeshVertex[];
  /** Bezier handles for each edge (horizontal and vertical) */
  handles: MeshHandle[];
}

interface MeshVertex {
  position: Point;
  color: string; // hex color at this vertex
  opacity?: number; // per-vertex opacity (default 1)
}

interface MeshHandle {
  /** Control point for the bezier curve between two vertices */
  cp1: Point;
  cp2: Point;
}
```

| Node           | Backend               | Inputs → Output                                          |
| -------------- | --------------------- | -------------------------------------------------------- |
| Gradient Mesh  | Custom TS + CanvasKit | mesh params → rendered mesh (as CanvasKit vertices draw) |
| Mesh from Path | Custom TS             | path + rows + cols → mesh fitted to path bounds          |

**Rendering**: CanvasKit `drawVertices()` with `SkVertexMode.kTriangles` and per-vertex
colors. The mesh is tessellated into triangles at render time. For SVG export, the mesh
is rasterized to a `<image>` (no SVG equivalent of gradient mesh exists).

**SDK API** (no UI in v1, but fully accessible via MCP tools and graph JSON):

- `vector_create_mesh` — create mesh node with grid dimensions
- `vector_set_mesh_vertex` — set position/color of a vertex
- `vector_set_mesh_handle` — adjust bezier handles between vertices
- AI agents can generate photorealistic gradients by programmatically placing vertex colors

**UI** (v1.x): Mesh tool — click to add rows/columns, drag vertices, click vertex to set
color. This is intentionally deferred because getting mesh UX right is hard (Illustrator
proves this).

### Structural Nodes

| Node       | Inputs → Output                             | Description                                                                                 |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Group      | N paths → grouped scene item                | Groups children under a shared transform/opacity. Scene graph becomes a tree, not flat list |
| Clip Mask  | path (content) + path (mask) → clipped path | Clips content to mask shape. Exposed as `clipPath` in SceneItem                             |
| Alpha Mask | path (content) + path (mask) → masked path  | Mask by opacity (gradient masks, feathered edges)                                           |

Group nodes enable nested transforms, grouped opacity, and proper SVG `<g>` export.
The SceneGraph `items` field becomes recursive:

```typescript
type SceneEntry = SceneItem | SceneGroup;

interface SceneGroup {
  id: string;
  children: SceneEntry[];
  transform: TransformMatrix;
  opacity?: number;
  clipPath?: PathValue;
  visible: boolean;
  name?: string;
}

interface SceneGraph {
  items: SceneEntry[]; // ordered back-to-front (painter's algorithm)
  canvas: { width: number; height: number };
  background?: string;
}
```

### Alignment / Distribution (utility commands, not nodes)

These operate on the current selection (multiple nodes) and produce `paramChange` diffs:

- Align left / center / right / top / middle / bottom
- Distribute horizontally / vertically (equal spacing)
- Align to canvas center / edges
- Match width / height / size

Implemented as commands in `vector-editor/commands/alignment.ts`, accessible via
toolbar buttons, hotkeys, and MCP tools (`vector_align`, `vector_distribute`).

### Geometry Queries (utility functions, not nodes)

- Area, perimeter/length of path
- Bounding box (tight, stroke-aware)
- Point at offset along path
- Tangent, normal, curvature at offset
- Nearest point on path to a given point
- Hit testing (point-in-path, point-on-stroke)
- Path intersection points

## Rendering

### Architecture

```
vector-engine (produces SceneGraph)
       │
       ▼
VectorRenderer (interface)
       │
       ├── CanvasKitRenderer (v1)
       │     canvaskit-wasm (~6.5MB uncompressed, ~1.4MB gzipped)
       │     WebGL2 backend
       │     Full: blur, shadows, gradients, text, image filters, emoji
       │
       ├── SVGStringRenderer (server-side, export — no canvas/DOM needed)
       │
       └── VelloRenderer (future, when blur/filters/emoji mature)
             vello → WASM, WebGPU backend
             GPU compute, faster on complex scenes
```

### Renderer Interface

```typescript
interface VectorRenderer {
  initialize(canvas: HTMLCanvasElement): Promise<void>;
  render(scene: SceneGraph): void;
  resize(width: number, height: number): void;
  hitTest(point: Point, scene: SceneGraph): HitResult | null;
  dispose(): void;
}

/** SVG export lives in vector-engine, not the renderer */
interface SVGExporter {
  toSVG(scene: SceneGraph): string;
}
```

The interface accepts a `SceneGraph` (the evaluated output of the node graph),
not individual draw calls. The renderer decides how to paint.

### Loading Strategy

CanvasKit WASM is lazy-loaded only when the user enters Vector mode.
Until then, zero overhead on normal HyperIDE usage. During load (~1-3s):

- Canvas area shows a skeleton placeholder with a spinner
- Toolbar tools are disabled until initialization completes
- A progress callback reports WASM download and initialization stages

## Tech Stack

| Layer                  | Technology                                 | Bundle size          | Licence |
| ---------------------- | ------------------------------------------ | -------------------- | ------- |
| Graph data structure   | graphology + graphology-dag                | ~30KB                | MIT     |
| Graph execution        | Custom TS executor                         | —                    | —       |
| Path boolean ops       | canvaskit-wasm (PathOps)                   | included in renderer | BSD-3   |
| Path offset            | clipper2-wasm ¹                            | ~150KB               | BSL-1.0 |
| Curve fitting          | fit-curve                                  | ~3KB                 | MIT     |
| FIG import             | @open-pencil/core (kiwi subpath)           | ~50KB                | MIT     |
| Curve math             | Custom TS (ported from kurbo where needed) | —                    | —       |
| Text shaping           | rustybuzz-wasm                             | ~300KB               | MIT     |
| Text outlines          | opentype.js                                | ~120KB               | MIT     |
| 2D rendering           | canvaskit-wasm                             | ~1.4MB gzipped       | BSD-3   |
| Binary serialization   | kiwi-schema (Kiwi codec)                   | ~15KB                | MIT     |
| SVG parsing            | svgson or svg-parser                       | ~10KB                | MIT     |
| Node graph UI (future) | @xyflow/react                              | ~200KB               | MIT     |
| Editor UI              | React + Zustand + Tailwind + shadcn        | existing             | —       |

Total additional WASM payload: ~2MB gzipped (lazy-loaded on Vector mode entry).

¹ **Clipper2 precision**: Clipper2 operates on integer coordinates internally. All floating-point
path data must be scaled by a factor (e.g. ×1000) before offset operations and scaled back after.
The `vector-wasm/clipper.ts` wrapper handles this transparently. Insufficient scale factor causes
visible stairstep artifacts on curves; excessive factor causes integer overflow on large canvases.
Default: `scaleFactor = 1000`, configurable per-operation.

## Tools (UI, vector-editor package)

Each tool is implemented as a **state machine** (inspired by Graphite's tool architecture).

### v1 Tools

| Tool            | Hotkey          | Description                                                                                                                          |
| --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Select (V)      | V               | Select, move, resize, rotate shapes. Multi-select with Shift                                                                         |
| Pen (P)         | P               | Create/edit bezier paths. Click for corners, drag for curves                                                                         |
| Rectangle (R)   | R               | Draw rectangles. Hold Shift for square                                                                                               |
| Ellipse (O)     | O               | Draw ellipses. Hold Shift for circle                                                                                                 |
| Polygon         | —               | Draw regular polygons (configurable sides)                                                                                           |
| Star            | —               | Draw stars (configurable points, inner/outer radius)                                                                                 |
| Line (L)        | L               | Draw straight lines                                                                                                                  |
| Text (T)        | T               | Place text, configure font/size, convert to path                                                                                     |
| Pencil (N)      | N               | Freehand drawing. Stroke → curve fit (fit-curve) → smooth bezier path                                                                |
| Curvature (C)   | C               | Draw curves by clicking points — engine auto-computes optimal handles. No manual bezier handles needed. Shift+click for corner point |
| Width (Shift+W) | Shift+W         | Add/drag width points on a path to create variable width stroke profile                                                              |
| Hand (H)        | H / Space+drag  | Pan viewport                                                                                                                         |
| Zoom (Z)        | Z / Ctrl+scroll | Zoom viewport                                                                                                                        |

### Tool State Machine Pattern

```typescript
interface VectorTool {
  name: string;
  cursor: string;
  onActivate(): void;
  onDeactivate(): void;
  onPointerDown(event: PointerEvent, context: ToolContext): void;
  onPointerMove(event: PointerEvent, context: ToolContext): void;
  onPointerUp(event: PointerEvent, context: ToolContext): void;
  onKeyDown(event: KeyboardEvent, context: ToolContext): void;
  onKeyUp(event: KeyboardEvent, context: ToolContext): void;
  render(context: ToolContext): void; // tool-specific overlays (guides, handles)
}

interface ToolContext {
  engine: VectorEngine;
  renderer: VectorRenderer;
  viewport: Viewport;
  selection: SelectionManager;
  snapping: SnappingEngine;
}

interface SelectionManager {
  selected: string[]; // node ids
  select(ids: string[], append?: boolean): void;
  deselect(ids?: string[]): void;
  clear(): void;
  getBounds(): BoundingBox | null;
}

interface SnappingEngine {
  /** Given a proposed point, return the snapped point + active guides */
  snap(point: Point, exclude?: string[]): { point: Point; guides: SnapGuide[] };
  setEnabled(enabled: boolean): void;
}

interface SnapGuide {
  type: 'edge' | 'center' | 'grid' | 'custom';
  from: Point;
  to: Point;
}
```

### Panels

| Panel                     | Content                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| **Properties**            | Selected node params, fill/stroke, transform. Arithmetic inputs (see below) |
| **Layers**                | Tree of shapes/groups (ordered by render order). Visibility, lock, rename   |
| **History**               | Node graph timeline. Click any entry to preview that state                  |
| **Node Graph** (advanced) | @xyflow/react visualization of the DAG. For power users                     |

### Arithmetic Input Fields

All numeric inputs in the Properties panel support inline arithmetic expressions.
The user can type `24+6`, `100/3`, `width*2`, `48-12` — the expression is evaluated
on Enter/blur and the result replaces the expression.

Supported:

- Basic operators: `+`, `-`, `*`, `/`
- Parentheses: `(24+6)*2`
- Percentage of current value: `+10%` (adds 10% of current), `-25%`
- Named references to own properties: `width`, `height`, `radius` (from the same node)
- Constants: `pi`, `sqrt2`
- Functions: `round()`, `ceil()`, `floor()`, `min()`, `max()`, `abs()`

Implementation: lightweight expression parser in `vector-editor/utils/expr-eval.ts`
(~200 lines, no eval/Function). The parser is shared across all numeric inputs via a
`NumericInput` component that wraps `<input>` with expression evaluation on commit.

```typescript
interface NumericInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Available named variables for expressions (e.g. { width: 100 }) */
  variables?: Record<string, number>;
  /** Label shown above/beside the input */
  label?: string;
}
```

Scrub (drag to change value) remains — arithmetic activates only when the user
types a non-numeric character.

## Use Cases (v1 and future)

### v1: Icon Creation & SVG Editing

Primary workflow. User creates/edits icons as parametric node graphs. Output is
inline SVG in React components. Non-destructive: change any parameter at any time.

### Future: Image Trace (Phase 2)

Raster image → vector paths. WASM module (potrace or vtracer compiled to WASM)
auto-traces bitmap input into optimized bezier paths. Useful for logo vectorization,
hand-drawn sketch import. Output goes through simplify + curve fit pipeline.

### Future: Pattern Along Path (Phase 2)

Repeat a shape/symbol along a path at configurable intervals. Enables chain links,
rope, decorative borders, railway tracks. The pattern node takes a path + a sub-graph
(the pattern unit) and distributes instances with optional spacing, rotation, and scale.

### Future: Animation (Phase 3)

Node graph extended with keyframe nodes. Export to Lottie JSON or Rive format.
CanvasKit already supports Skottie (Lottie player).

### AI Agent Integration (v1)

AI agents interact with the vector engine through two channels:

**1. MCP Tools** (structured, type-safe — primary interface):

Exposed via the existing HyperIDE MCP server (`server/modules/mcp/`).

| Tool                           | Params                                              | Description                                                |
| ------------------------------ | --------------------------------------------------- | ---------------------------------------------------------- |
| `vector_create_graph`          | name, canvasWidth, canvasHeight, componentPath?     | Create new empty graph, return graph id                    |
| `vector_open_graph`            | graphPath                                           | Load existing .graph file, return current state summary    |
| `vector_add_node`              | graphId, type, params                               | Add a generator/operation node, return node id             |
| `vector_remove_node`           | graphId, nodeId                                     | Remove node and its edges                                  |
| `vector_connect`               | graphId, sourceId, sourcePort, targetId, targetPort | Create edge between nodes                                  |
| `vector_disconnect`            | graphId, edgeId                                     | Remove edge                                                |
| `vector_set_param`             | graphId, nodeId, param, value                       | Change a node parameter                                    |
| `vector_get_state`             | graphId                                             | Return full graph state as JSON (nodes, edges, muted)      |
| `vector_get_node`              | graphId, nodeId, includeResult?                     | Return node definition + optionally its computed output    |
| `vector_list_nodes`            | graphId                                             | List all nodes with types and connections summary          |
| `vector_list_node_types`       | category?                                           | List available node type definitions with params           |
| `vector_boolean_op`            | graphId, operation, pathNodeIds[]                   | Create boolean operation node wired to inputs              |
| `vector_offset_path`           | graphId, pathNodeId, distance                       | Create offset node                                         |
| `vector_set_style`             | graphId, nodeId, fill?, stroke?, opacity?           | Apply style to a path                                      |
| `vector_transform`             | graphId, nodeId, translate?, rotate?, scale?        | Apply transform                                            |
| `vector_text_to_path`          | graphId, text, font, size                           | Create text → path node                                    |
| `vector_graph_mute_node`       | graphId, nodeId, muted                              | Toggle mute on a node                                      |
| `vector_graph_undo`            | graphId, steps?                                     | Undo N operations (default 1)                              |
| `vector_graph_redo`            | graphId, steps?                                     | Redo N operations (default 1)                              |
| `vector_graph_get_history`     | graphId, limit?                                     | Return recent operation log                                |
| `vector_export_svg`            | graphId                                             | Execute graph, return SVG string                           |
| `vector_export_to_component`   | graphId                                             | Execute graph, inject SVG into linked TSX                  |
| `vector_query_geometry`        | graphId, nodeId, query                              | Query: area, length, bounds, pointAtOffset, nearestPoint   |
| `vector_import_svg`            | graphId, svgString                                  | Parse SVG into graph nodes (append to existing graph)      |
| `vector_import_fig`            | graphId, figFilePath                                | Parse .fig file, convert to graph nodes                    |
| `vector_join_paths`            | graphId, pathNodeId1, pathNodeId2                   | Join two open paths at nearest endpoints                   |
| `vector_break_apart`           | graphId, pathNodeId                                 | Break compound path into sub-paths                         |
| `vector_align`                 | graphId, nodeIds[], alignment                       | Align selected nodes (left/center/right/top/middle/bottom) |
| `vector_distribute`            | graphId, nodeIds[], axis                            | Distribute selected nodes evenly (horizontal/vertical)     |
| `vector_group`                 | graphId, nodeIds[]                                  | Group selected nodes, return group node id                 |
| `vector_ungroup`               | graphId, groupNodeId                                | Dissolve group, preserve children                          |
| `vector_create_mesh`           | graphId, rows, cols, bounds                         | Create gradient mesh node with grid dimensions             |
| `vector_set_mesh_vertex`       | graphId, meshNodeId, row, col, position?, color?    | Set position/color of a mesh vertex                        |
| `vector_set_mesh_handle`       | graphId, meshNodeId, edge, cp1?, cp2?               | Adjust bezier handles between mesh vertices                |
| `vector_deform`                | graphId, pathNodeId, effect, params                 | Apply deformation (roughen/zigzag/pucker/twist/warp)       |
| `vector_variable_stroke`       | graphId, pathNodeId, profile[]                      | Set variable width stroke profile                          |
| `vector_divide`                | graphId, pathNodeIds[]                              | Divide overlapping paths into region fragments             |
| `vector_trim_path`             | graphId, pathNodeId, start%, end%                   | Trim path to sub-range                                     |
| `vector_graph_snapshot`        | graphId                                             | Force snapshot cache write                                 |
| `vector_graph_flatten_history` | graphId                                             | Compact operations into base state                         |

**2. JSON file editing** (unstructured, via filesystem):

AI agents can also edit `.graph.json` directly and rely on reconciliation (see
Graph Reconciliation). This is useful for bulk edits, templates, or when the agent
prefers to work with the full document at once rather than incremental tool calls.

**Design principle**: MCP tools operate on the same `vector-engine` API that the
UI uses. There is no separate "AI path" — the engine is the single source of truth.
Every MCP tool call is recorded as a `GraphOperation` in the undo log, so the user
can review and undo AI changes the same way they undo their own edits.

**Typical AI workflows**:

- "Create a settings gear icon, 24x24": `vector_create_graph` → series of
  `vector_add_node` (circles, rectangles) → `vector_boolean_op` (subtract) →
  `vector_set_style` → `vector_export_to_component`

- "Make all strokes 2px thicker": `vector_list_nodes` → filter stroke nodes →
  `vector_get_node` each → `vector_set_param` with updated width

- "Show me the history of this icon": `vector_graph_get_history` → formatted summary

- "Undo the last 3 changes": `vector_graph_undo(steps=3)`

- "Duplicate this icon but with rounded corners": `vector_get_state` → parse →
  modify → `vector_create_graph` new → add round corners node → export

### Future: Whiteboard / Moodboard (Phase 4)

Vector primitives (arrows, shapes, text, connectors) in Board mode.
Architecture diagrams, wireframes, user flows — Miro/FigJam-like functionality.

## Design Decisions & Trade-offs

### Why CanvasKit over Vello (for v1)

Vello (Rust + WebGPU) is architecturally superior but lacks blur, image filters,
drop shadow, and reliable emoji rendering. CanvasKit (Skia WASM) provides all of these
today. The renderer interface abstraction allows migration to Vello when it matures.

### Why custom graph executor over Graphite's graph-craft

Graphite's graph-craft is Rust (edition 2024, rustc 1.88+), tightly coupled to its
type system, and would require WASM bridge for every JS↔Rust call. A TypeScript executor
is debuggable in DevTools, integrates directly with React/Zustand, and our needs are
simpler (no GPU shader nodes, no JIT compilation).

### Why graphology over custom graph

graphology is battle-tested (3.5k stars), provides DAG enforcement, topological sort,
traversal algorithms, and serialization. No reason to reimplement graph primitives.

### Why not Paper.js

Performance ceiling at ~100 objects. CPU-only Canvas2D. No WASM. Project in maintenance
mode (last commit July 2024). PathKit does everything Paper.js does, faster, in 63KB WASM.

### Why separate packages (not lib/vector-engine/)

The existing `lib/` is for AST/styling utilities specific to HyperIDE's component editing.
Vector engine is a fundamentally different domain. Separate packages enforce clean boundaries,
enable independent versioning, and allow potential npm publishing.

### Why semantic diff for reverse sync (not re-import)

Re-importing SVG from scratch destroys parametric history. Semantic diff preserves the
node graph structure and only applies the minimal set of changes. Most external edits
(color, position, adding a path) map cleanly to graph operations.

## Vector Networks (Plan 2)

Figma-style vector networks replace the sequential SVG path model with a graph-based
model where vertices can have any number of connected segments. This enables
branching (T-junctions), automatic region detection, and non-linear editing.

### Why Vector Networks

SVG paths are sequential: each point has at most 2 neighbors (prev/next). This means:

- No branching — can't create a T-junction or fork
- No automatic regions — can't fill areas between intersecting segments
- Destructive edge deletion — removing a segment breaks the entire path
- Pen tool limited to drawing one continuous curve

Vector networks solve all of these. Every major vector editor (Figma, Graphite,
OpenPencil) uses this model internally; SVG is only the export format.

### Architecture

**Reference implementation:** OpenPencil `@open-pencil/core` (MIT, ~5-7K LOC)

Key components:

1. **VectorNetwork type** — vertices + segments + regions (see Core Type System above)
2. **Topology solver** — Minimal Cycle Basis algorithm to find fillable regions
3. **Conversions** — VectorNetwork ↔ PathValue[], VectorNetwork ↔ FIG blob
4. **NodeValue extension** — `{ type: 'network'; value: VectorNetwork }` in the graph

### Topology Solver (region detection)

Algorithm (Minimal Cycle Basis):

1. Find leftmost vertex
2. Travel clockwise from first vertex (relative to imaginary edge below)
3. At each vertex, select the counter-clockwise edge (vector determinant)
4. Continue until returning to start → one closed region found
5. Remove first edge and filaments (dead-end vertices with 1 connection)
6. Repeat until graph exhausted

Requires edge expansion: all segment intersections must be split into vertices first.

### Conversions

| From                  | To            | Strategy                                                                         |
| --------------------- | ------------- | -------------------------------------------------------------------------------- |
| VectorNetwork         | PathValue[]   | Traverse each region's loops, emit M/L/C/Z per segment. One PathValue per region |
| PathValue             | VectorNetwork | Each command endpoint → vertex, each segment → VectorSegment. Single region      |
| FIG vectorNetworkBlob | VectorNetwork | Binary decode via OpenPencil's `vector.ts` encoder/decoder                       |
| VectorNetwork         | SVG           | Convert to PathValue[] first, then use existing sceneToSvg                       |

### Integration with Node Graph

- Generator nodes output PathValue (v1) or VectorNetwork (v2)
- Boolean ops: convert VectorNetwork → PathValue[] for CanvasKit, optionally convert result back
- Pen tool (Plan 4) edits VectorNetwork directly — the primary interactive editing model
- SceneBuilder converts VectorNetwork → PathValue[] for rendering/export

## References & Inspiration

### Architecture

- [Graphite Editor](https://github.com/GraphiteEditor/Graphite) — node-based DAG,
  tool state machines, message system (Apache 2.0, study architecture, implement own)
- [OpenPencil OpenSpec](https://openpencil.dev/development/openspec) — 19 capability specs,
  CanvasKit rendering, vector network model, Yoga WASM auto-layout

### Libraries

- [graphology](https://graphology.github.io/) — graph data structure (MIT)
- [canvaskit-wasm](https://www.npmjs.com/package/canvaskit-wasm) — Skia WASM (BSD-3)
- [clipper2-wasm](https://github.com/ErikSom/Clipper2-WASM) — polygon offset (BSL-1.0)
- [rustybuzz-wasm](https://www.npmjs.com/package/rustybuzz-wasm) — text shaping (MIT)
- [opentype.js](https://github.com/opentypejs/opentype.js) — font outlines (MIT)
- [kiwi](https://github.com/evanw/kiwi) — schema-based binary codec (MIT)
- [kurbo](https://github.com/linebender/kurbo) — curve math reference (MIT/Apache-2.0)
- [@xyflow/react](https://reactflow.dev/) — node graph UI (MIT)
- [@open-pencil/core](https://github.com/open-pencil/open-pencil) — FIG file import/export (MIT)
- [fit-curve](https://www.npmjs.com/package/fit-curve) — point array → bezier curve fitting (MIT)

### Research

- [Vello](https://github.com/linebender/vello) — future renderer candidate (GPU compute)
- [PathKit](https://docs.skia.org/docs/user/modules/pathkit/) — Skia path ops WASM
- [Graphite Graphene docs](https://graphite.rs/volunteer/guide/graphene/) — node execution model
