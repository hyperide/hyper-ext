# Vector Engine Deferred SDK Features

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Kiwi binary serialization (.graph files), TSX semantic diff
(reverse sync from external code edits), and FIG vectorNetworkBlob binary decode.

**Architecture:** Kiwi codec uses `kiwi-schema` npm package (Evan Wallace's own
implementation) with a `.kiwi` schema file defining all graph types. TSX semantic
diff parses incoming SVG via existing `svgToGraph`, matches shapes by geometry hash,
and applies changes via existing `applyReconciliation`. FIG blob decode reverse-engineers
Figma's binary vertex/segment format using OpenPencil as reference.

**Tech Stack:** TypeScript, bun:test, kiwi-schema

**Spec:** `docs/specs/2026-03-13-vector-engine-design.md`

---

## File Structure

```
packages/vector-engine/src/
├── persistence/
│   ├── kiwi-schema.kiwi              # CREATE: Kiwi schema definition
│   ├── kiwi-codec.ts                 # CREATE: encode/decode VectorGraphFile to/from binary
│   ├── kiwi-codec.test.ts            # CREATE
│   └── serialize.ts                  # MODIFY: add binary serialization option
├── sync/
│   ├── semantic-diff.ts              # CREATE: match SVG shapes to graph nodes
│   ├── reverse-sync.ts              # CREATE: apply incoming SVG changes to graph
│   └── sync.test.ts                  # CREATE
└── import/
    ├── fig-blob-decode.ts            # CREATE: vectorNetworkBlob binary decoder
    ├── fig-blob-decode.test.ts       # CREATE
    └── fig-mapper.ts                 # MODIFY: use blob decoder for VECTOR nodes
```

---

## Chunk 1: Kiwi Binary Serialization

### Task 1: Kiwi Schema Definition

Define the `.kiwi` schema that mirrors our TypeScript types.

**Files:**

- Modify: `packages/vector-engine/package.json` (add kiwi-schema)
- Create: `packages/vector-engine/src/persistence/kiwi-schema.kiwi`

- [ ] **Step 1: Add dependency**

```bash
cd packages/vector-engine && bun add kiwi-schema
```

- [ ] **Step 2: Create schema file**

Kiwi schema syntax (from kiwi-schema docs):

```kiwi
// packages/vector-engine/src/persistence/kiwi-schema.kiwi

enum NodeValueType {
  PATH = 0;
  STYLE = 1;
  NUMBER = 2;
  COLOR = 3;
  BOOLEAN = 4;
  TRANSFORM = 5;
  MESH = 6;
  NETWORK = 7;
}

message Point {
  float x = 1;
  float y = 2;
}

message GraphNode {
  string id = 1;
  string type = 2;
  string paramsJson = 3;  // JSON-encoded params (schema-free)
  Point position = 4;
}

message GraphEdge {
  string id = 1;
  string source = 2;
  string target = 3;
  string sourcePort = 4;
  string targetPort = 5;
}

message Canvas {
  float width = 1;
  float height = 2;
}

message Viewport {
  float zoom = 1;
  float panX = 2;
  float panY = 3;
}

message GraphDiffEntry {
  int kind = 1;            // 0=paramChange, 1=addNode, 2=removeNode, etc.
  string nodeId = 2;
  string param = 3;
  string oldValueJson = 4;
  string newValueJson = 5;
  GraphNode node = 6;
  GraphEdge edge = 7;
  GraphEdge[] removedEdges = 8;
  bool muted = 9;
  Point oldPosition = 10;
  Point newPosition = 11;
}

message GraphOperation {
  float timestamp = 1;
  string description = 2;
  GraphDiffEntry[] diffs = 3;
}

message VectorGraphMeta {
  string componentPath = 1;
  string svgElementId = 2;
  float lastExportTimestamp = 3;
}

message VectorGraphState {
  Canvas canvas = 1;
  GraphNode[] nodes = 2;
  GraphEdge[] edges = 3;
  string[] muted = 4;
}

message VectorGraphFile {
  int version = 1;
  VectorGraphMeta meta = 2;
  VectorGraphState base = 3;
  GraphOperation[] operations = 4;
  int undoPointer = 5;
  Viewport viewport = 6;
}
```

Note: Kiwi uses message/enum syntax similar to protobuf. The `kiwi-schema` npm
package compiles `.kiwi` files to JS encode/decode functions.

- [ ] **Step 3: Commit**

```
feat(vector-engine): Kiwi schema definition for graph file format (HYP-308)
```

---

### Task 2: Kiwi Codec (Encode/Decode)

**Files:**

- Create: `packages/vector-engine/src/persistence/kiwi-codec.ts`
- Create: `packages/vector-engine/src/persistence/kiwi-codec.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { encodeGraphFile, decodeGraphFile } from "./kiwi-codec";
import type { VectorGraphFile } from "./types";

describe("Kiwi codec", () => {
  const sampleFile: VectorGraphFile = {
    version: 1,
    meta: { componentPath: "src/icons/Arrow.tsx", svgElementId: "svg-1" },
    base: {
      canvas: { width: 100, height: 100 },
      nodes: {
        n1: { id: "n1", type: "rectangle", params: { width: 50, height: 50 } },
      },
      edges: [],
      muted: [],
    },
    operations: [
      {
        timestamp: Date.now(),
        description: "Add rectangle",
        diffs: [{ kind: "addNode", node: { id: "n1", type: "rectangle", params: { width: 50, height: 50 } } }],
      },
    ],
    undoPointer: 1,
    viewport: { zoom: 1, panX: 0, panY: 0 },
  };

  it("should encode VectorGraphFile to binary", () => {
    const binary = encodeGraphFile(sampleFile);
    expect(binary).toBeInstanceOf(Uint8Array);
    expect(binary.length).toBeGreaterThan(0);
    // Binary should be smaller than JSON
    const jsonSize = JSON.stringify(sampleFile).length;
    expect(binary.length).toBeLessThan(jsonSize);
  });

  it("should decode binary back to VectorGraphFile", () => {
    const binary = encodeGraphFile(sampleFile);
    const decoded = decodeGraphFile(binary);
    expect(decoded.version).toBe(1);
    expect(decoded.meta.componentPath).toBe("src/icons/Arrow.tsx");
    expect(Object.keys(decoded.base.nodes).length).toBe(1);
    expect(decoded.base.nodes.n1.type).toBe("rectangle");
  });

  it("should roundtrip preserve all data", () => {
    const binary = encodeGraphFile(sampleFile);
    const decoded = decodeGraphFile(binary);
    expect(decoded.version).toBe(sampleFile.version);
    expect(decoded.meta).toEqual(sampleFile.meta);
    expect(decoded.base.canvas).toEqual(sampleFile.base.canvas);
    expect(decoded.undoPointer).toBe(sampleFile.undoPointer);
    expect(decoded.viewport).toEqual(sampleFile.viewport);
    expect(decoded.operations.length).toBe(1);
  });

  it("should handle empty graph", () => {
    const empty: VectorGraphFile = {
      version: 1,
      meta: { componentPath: "" },
      base: { canvas: { width: 0, height: 0 }, nodes: {}, edges: [], muted: [] },
      operations: [],
      undoPointer: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
    };
    const binary = encodeGraphFile(empty);
    const decoded = decodeGraphFile(binary);
    expect(decoded.version).toBe(1);
    expect(Object.keys(decoded.base.nodes).length).toBe(0);
  });

  it("should handle graph with edges and muted nodes", () => {
    const file: VectorGraphFile = {
      version: 1,
      meta: { componentPath: "test.tsx" },
      base: {
        canvas: { width: 200, height: 200 },
        nodes: {
          n1: { id: "n1", type: "rectangle", params: { width: 100 } },
          n2: { id: "n2", type: "fill", params: { type: "solid", color: "#ff0000" } },
        },
        edges: [{ id: "e1", source: "n1", target: "n2", sourcePort: "path", targetPort: "path" }],
        muted: ["n2"],
      },
      operations: [],
      undoPointer: 0,
      viewport: { zoom: 2, panX: 50, panY: -30 },
    };
    const binary = encodeGraphFile(file);
    const decoded = decodeGraphFile(binary);
    expect(decoded.base.edges.length).toBe(1);
    expect(decoded.base.edges[0].source).toBe("n1");
    expect(decoded.base.muted).toEqual(["n2"]);
    expect(decoded.viewport.zoom).toBe(2);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement kiwi-codec.ts**

```typescript
/**
 * @file Kiwi binary codec — encode/decode VectorGraphFile to compact binary
 *
 * Accessed via: File save/load — .graph files use Kiwi binary format
 * Tradeoffs: params stored as JSON strings inside Kiwi messages (schema-free).
 *   This avoids defining Kiwi schemas for every node's param shape.
 *   ~30-50% smaller than JSON. Single-pass encode/decode.
 */
```

Implementation approach:

If `kiwi-schema` package works with bun and provides a compiler:

- Compile `.kiwi` schema → JS encoder/decoder at build time (or runtime)
- Use generated `encode`/`decode` functions

If `kiwi-schema` doesn't work well, implement a **manual Kiwi-compatible binary codec**:

- Varint encoding for integers
- Length-prefixed strings (UTF-8)
- Nested messages as length-prefixed blobs
- Arrays as count + elements
- The format matches Kiwi wire format for forward compatibility

Either way, the public API is:

```typescript
export function encodeGraphFile(file: VectorGraphFile): Uint8Array;
export function decodeGraphFile(data: Uint8Array): VectorGraphFile;
```

Key serialization decisions:

- `nodes: Record<string, GraphNode>` → serialize as array of GraphNode (id is inside each node)
- `params: Record<string, unknown>` → serialize as JSON string (`paramsJson`)
- `GraphDiff` union → serialize as `GraphDiffEntry` message with `kind` field discriminating which fields are populated
- `GraphDiff.kind` mapping: paramChange=0, addNode=1, removeNode=2, addEdge=3, removeEdge=4, muteNode=5, moveNode=6

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Update serialize.ts — add binary option**

Add to `serialize.ts`:

```typescript
import { encodeGraphFile, decodeGraphFile } from "./kiwi-codec";

export function serializeGraphBinary(
  model: VectorGraphModel,
  meta: VectorGraphMeta,
  history?: HistoryManager,
): Uint8Array {
  const file = serializeGraph(model, meta, history);
  return encodeGraphFile(file);
}

export function deserializeGraphBinary(data: Uint8Array): {
  model: VectorGraphModel;
  meta: VectorGraphMeta;
  history: HistoryManager;
} {
  const file = decodeGraphFile(data);
  return deserializeGraph(file);
}
```

- [ ] **Step 6: Commit**

```
feat(vector-engine): Kiwi binary codec for .graph files (HYP-308)
```

---

## Chunk 2: TSX Semantic Diff (Reverse Sync)

### Task 3: Semantic Shape Matching

Match shapes from an incoming SVG against existing graph terminal outputs
by geometry hash (path data), bounding box, and style.

**Files:**

- Create: `packages/vector-engine/src/sync/semantic-diff.ts`
- Create: `packages/vector-engine/src/sync/sync.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { computeSemanticDiff, type SemanticChange } from "./semantic-diff";
import { PathBuilder } from "../path/builder";
import type { SceneItem } from "../types";
import { IDENTITY_TRANSFORM } from "../types";

const makeItem = (id: string, path: ReturnType<PathBuilder["build"]>, fill?: string): SceneItem => ({
  id,
  path,
  style: fill ? { fill: { type: "solid", color: fill } } : {},
  transform: IDENTITY_TRANSFORM,
  visible: true,
});

describe("computeSemanticDiff", () => {
  it("should detect no changes when scenes match", () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const current = [makeItem("n1", rect, "#ff0000")];
    const incoming = [makeItem("x", rect, "#ff0000")];
    const diff = computeSemanticDiff(current, incoming);
    expect(diff.matched.length).toBe(1);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
  });

  it("should detect added shape", () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const circle = new PathBuilder().moveTo(50, 0).arcTo(50, 50, 0, 1, 1, 50, 100).close().build();
    const current = [makeItem("n1", rect)];
    const incoming = [makeItem("x1", rect), makeItem("x2", circle)];
    const diff = computeSemanticDiff(current, incoming);
    expect(diff.added.length).toBe(1);
  });

  it("should detect removed shape", () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const circle = new PathBuilder().moveTo(50, 0).arcTo(50, 50, 0, 1, 1, 50, 100).close().build();
    const current = [makeItem("n1", rect), makeItem("n2", circle)];
    const incoming = [makeItem("x1", rect)];
    const diff = computeSemanticDiff(current, incoming);
    expect(diff.removed.length).toBe(1);
    expect(diff.removed[0].id).toBe("n2");
  });

  it("should detect modified style (color change)", () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const current = [makeItem("n1", rect, "#ff0000")];
    const incoming = [makeItem("x", rect, "#00ff00")]; // color changed
    const diff = computeSemanticDiff(current, incoming);
    expect(diff.matched.length).toBe(1);
    expect(diff.matched[0].styleChanged).toBe(true);
  });

  it("should handle empty scenes", () => {
    const diff = computeSemanticDiff([], []);
    expect(diff.matched.length).toBe(0);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement semantic-diff.ts**

```typescript
/**
 * @file Semantic diff — match SVG shapes to graph terminal outputs by geometry
 *
 * Accessed via: Reverse sync pipeline — when TSX file changes externally
 * Assumptions: shapes are matched by path data hash (FNV-1a of Float64Array).
 *   Position/size matching is fallback when path data differs.
 * Tradeoffs: O(n*m) matching for n current × m incoming shapes. Fine for
 *   typical SVG files (<100 shapes). Large files may need spatial indexing.
 */

import type { PathValue, SceneItem, StyleValue } from '../types';
import { computeBounds } from '../path/bounds';

export interface SemanticMatch {
  currentId: string;
  incomingItem: SceneItem;
  styleChanged: boolean;
  geometryChanged: boolean;
}

export interface SemanticDiff {
  matched: SemanticMatch[];
  added: SceneItem[];    // in incoming but not in current
  removed: SceneItem[];  // in current but not in incoming
  ambiguous: boolean;    // true if matching confidence is low
}

export function computeSemanticDiff(
  current: SceneItem[],
  incoming: SceneItem[],
): SemanticDiff { ... }
```

Matching algorithm:

1. Compute path hash for each shape (FNV-1a of commands Float64Array — reuse fingerprint from executor)
2. First pass: exact path hash match → paired
3. Second pass: for unmatched, try bounding box overlap + area similarity
4. Remaining unmatched current → removed
5. Remaining unmatched incoming → added
6. For matched pairs: compare style (fill color, stroke, opacity)

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): semantic shape matching for TSX reverse sync (HYP-308)
```

---

### Task 4: Reverse Sync Pipeline

Convert semantic diff into graph operations and apply.

**Files:**

- Create: `packages/vector-engine/src/sync/reverse-sync.ts`
- Modify: `packages/vector-engine/src/sync/sync.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { reverseSync } from "./reverse-sync";
import { VectorGraphModel } from "../graph/vector-graph";
import { GraphExecutor } from "../graph/executor";
import { createDefaultRegistry } from "../nodes/register-all";
import { HistoryManager } from "../graph/history";
import { PathBuilder } from "../path/builder";
import { sceneToSvg } from "../export/svg";
import { svgToGraph } from "../import/svg-import";

describe("reverseSync", () => {
  it("should detect color change and update graph param", () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create("test", "RS", 100, 100);
    const rect = graph.addNode({ type: "rectangle", params: { width: 100, height: 100, x: 0, y: 0 } });
    const fill = graph.addNode({ type: "fill", params: { type: "solid", color: "#ff0000" } });
    graph.addEdge(rect, "path", fill, "path");

    const executor = new GraphExecutor(registry);
    const history = new HistoryManager();

    // Execute to get current scene
    const currentResult = executor.execute(graph);

    // Simulate external edit: change color to blue
    const svg = sceneToSvg(currentResult.scene);
    const modifiedSvg = svg.replace("#ff0000", "#0000ff");

    const result = reverseSync(graph, executor, registry, history, modifiedSvg);
    expect(result.changesApplied).toBeGreaterThanOrEqual(0);
    // Note: exact assertion depends on whether SVG import + semantic diff
    // can match the re-imported shape back to the original node
  });

  it("should handle identical SVG (no changes)", () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create("test", "RS", 100, 100);
    graph.addNode({ type: "rectangle", params: { width: 50, height: 50, x: 0, y: 0 } });

    const executor = new GraphExecutor(registry);
    const history = new HistoryManager();
    const currentResult = executor.execute(graph);
    const svg = sceneToSvg(currentResult.scene);

    const result = reverseSync(graph, executor, registry, history, svg);
    expect(result.changesApplied).toBe(0);
  });
});
```

- [ ] **Step 2: Implement reverse-sync.ts**

```typescript
/**
 * @file Reverse sync — apply external SVG changes to existing graph
 *
 * Accessed via: File watcher detects TSX component changed → reverse sync pipeline
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Reverse Sync
 */

export interface ReverseSyncResult {
  changesApplied: number;
  ambiguous: boolean;
}

export function reverseSync(
  graph: VectorGraphModel,
  executor: GraphExecutor,
  registry: NodeRegistry,
  history: HistoryManager,
  incomingSvg: string,
): ReverseSyncResult {
  // 1. Execute current graph → get current scene items
  // 2. Parse incoming SVG → svgToGraph → execute → get incoming scene items
  // 3. Run computeSemanticDiff(current, incoming)
  // 4. For each matched pair with style changes:
  //    - Find the corresponding style node in the graph
  //    - Apply param changes
  // 5. For added shapes: import as new svgPath nodes
  // 6. For removed shapes: warn (don't auto-delete — user might have intended a different edit)
  // 7. Record all changes via history
  return { changesApplied: 0, ambiguous: false };
}
```

- [ ] **Step 3: Run test — verify it passes**

- [ ] **Step 4: Commit**

```
feat(vector-engine): reverse sync pipeline for TSX → graph updates (HYP-308)
```

---

## Chunk 3: FIG vectorNetworkBlob Decode

### Task 5: Binary Blob Decoder

Decode Figma's `vectorNetworkBlob` binary format into our `VectorNetwork` type.

**Files:**

- Create: `packages/vector-engine/src/import/fig-blob-decode.ts`
- Create: `packages/vector-engine/src/import/fig-blob-decode.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { decodeVectorNetworkBlob } from "./fig-blob-decode";
import type { VectorNetwork } from "../network/types";

describe("decodeVectorNetworkBlob", () => {
  it("should export decode function", () => {
    expect(typeof decodeVectorNetworkBlob).toBe("function");
  });

  it("should return empty network for empty data", () => {
    const result = decodeVectorNetworkBlob(new Uint8Array(0));
    expect(result.vertices.length).toBe(0);
    expect(result.segments.length).toBe(0);
    expect(result.regions.length).toBe(0);
  });

  it("should return empty network for invalid data", () => {
    const result = decodeVectorNetworkBlob(new Uint8Array([0, 1, 2, 3]));
    expect(result.vertices.length).toBe(0);
  });

  it("should decode a simple triangle blob", () => {
    // Construct a minimal binary blob matching Figma's format:
    // Header: vertexCount(3), segmentCount(3), regionCount(1)
    // Vertices: 3 × (x: f32, y: f32)
    // Segments: 3 × (startIdx: u32, endIdx: u32, tangentStartX: f32, ...)
    // Regions: 1 × (windingRule: u8, loopCount: u32, loop: segmentIndices[])
    const blob = buildTriangleBlob();
    const network = decodeVectorNetworkBlob(blob);
    expect(network.vertices.length).toBe(3);
    expect(network.segments.length).toBe(3);
    expect(network.regions.length).toBe(1);
  });
});

/** Build a minimal binary blob for a triangle network */
function buildTriangleBlob(): Uint8Array {
  const buf = new ArrayBuffer(256);
  const view = new DataView(buf);
  let offset = 0;

  // Magic/version (if any) — we'll define based on OpenPencil research
  // Vertex count
  view.setUint32(offset, 3, true);
  offset += 4;
  // Vertices: (x, y) as float32
  const verts = [
    [0, 0],
    [100, 0],
    [50, 86.6],
  ];
  for (const [x, y] of verts) {
    view.setFloat32(offset, x, true);
    offset += 4;
    view.setFloat32(offset, y, true);
    offset += 4;
  }
  // Segment count
  view.setUint32(offset, 3, true);
  offset += 4;
  // Segments: (startIdx, endIdx, tangentStartX, tangentStartY, tangentEndX, tangentEndY)
  const segs = [
    [0, 1],
    [1, 2],
    [2, 0],
  ];
  for (const [s, e] of segs) {
    view.setUint32(offset, s, true);
    offset += 4;
    view.setUint32(offset, e, true);
    offset += 4;
    view.setFloat32(offset, 0, true);
    offset += 4; // tangentStart.x
    view.setFloat32(offset, 0, true);
    offset += 4; // tangentStart.y
    view.setFloat32(offset, 0, true);
    offset += 4; // tangentEnd.x
    view.setFloat32(offset, 0, true);
    offset += 4; // tangentEnd.y
  }
  // Region count
  view.setUint32(offset, 1, true);
  offset += 4;
  // Region: windingRule(u8), loopCount(u32), loop0Length(u32), loop0 indices
  view.setUint8(offset, 1);
  offset += 1; // nonZero = 1
  view.setUint32(offset, 1, true);
  offset += 4; // 1 loop
  view.setUint32(offset, 3, true);
  offset += 4; // 3 segments in loop
  view.setUint32(offset, 0, true);
  offset += 4;
  view.setUint32(offset, 1, true);
  offset += 4;
  view.setUint32(offset, 2, true);
  offset += 4;

  return new Uint8Array(buf, 0, offset);
}
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement fig-blob-decode.ts**

```typescript
/**
 * @file FIG vectorNetworkBlob decoder — parse Figma binary path data
 *
 * Accessed via: FIG import pipeline for VECTOR node types
 * Assumptions: binary format reverse-engineered from OpenPencil's vector.ts.
 *   Format may change in future Figma versions. Graceful degradation on
 *   unrecognized data — returns empty network, never throws.
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §FIG Import
 */

import type { VectorNetwork, VectorVertex, VectorSegment, VectorRegion } from "../network/types";

export function decodeVectorNetworkBlob(data: Uint8Array): VectorNetwork {
  if (data.length < 4) {
    return { vertices: [], segments: [], regions: [] };
  }

  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    // Read vertex count
    const vertexCount = view.getUint32(offset, true);
    offset += 4;
    const vertices: VectorVertex[] = [];
    for (let i = 0; i < vertexCount && offset + 8 <= data.length; i++) {
      const x = view.getFloat32(offset, true);
      offset += 4;
      const y = view.getFloat32(offset, true);
      offset += 4;
      vertices.push({ x, y });
    }

    // Read segment count
    if (offset + 4 > data.length) return { vertices, segments: [], regions: [] };
    const segmentCount = view.getUint32(offset, true);
    offset += 4;
    const segments: VectorSegment[] = [];
    for (let i = 0; i < segmentCount && offset + 24 <= data.length; i++) {
      const start = view.getUint32(offset, true);
      offset += 4;
      const end = view.getUint32(offset, true);
      offset += 4;
      const tsx = view.getFloat32(offset, true);
      offset += 4;
      const tsy = view.getFloat32(offset, true);
      offset += 4;
      const tex = view.getFloat32(offset, true);
      offset += 4;
      const tey = view.getFloat32(offset, true);
      offset += 4;
      segments.push({
        start,
        end,
        tangentStart: { x: tsx, y: tsy },
        tangentEnd: { x: tex, y: tey },
      });
    }

    // Read region count
    if (offset + 4 > data.length) return { vertices, segments, regions: [] };
    const regionCount = view.getUint32(offset, true);
    offset += 4;
    const regions: VectorRegion[] = [];
    for (let i = 0; i < regionCount && offset < data.length; i++) {
      const windingByte = view.getUint8(offset);
      offset += 1;
      const windingRule = windingByte === 0 ? ("evenOdd" as const) : ("nonZero" as const);
      if (offset + 4 > data.length) break;
      const loopCount = view.getUint32(offset, true);
      offset += 4;
      const loops: number[][] = [];
      for (let j = 0; j < loopCount && offset + 4 <= data.length; j++) {
        const segCount = view.getUint32(offset, true);
        offset += 4;
        const loop: number[] = [];
        for (let k = 0; k < segCount && offset + 4 <= data.length; k++) {
          loop.push(view.getUint32(offset, true));
          offset += 4;
        }
        loops.push(loop);
      }
      regions.push({ windingRule, loops, fills: [] });
    }

    return { vertices, segments, regions };
  } catch {
    return { vertices: [], segments: [], regions: [] };
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): FIG vectorNetworkBlob binary decoder (HYP-308)
```

---

### Task 6: Integrate Blob Decoder into FIG Mapper

**Files:**

- Modify: `packages/vector-engine/src/import/fig-mapper.ts`
- Modify: `packages/vector-engine/src/import/fig-import.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("FIG mapper with vectorNetworkBlob", () => {
  it("should decode VECTOR node with binary blob", () => {
    const blob = buildTriangleBlob(); // reuse from blob test
    const figNodes: FigNode[] = [
      {
        type: "VECTOR",
        name: "Triangle",
        id: "v1",
        children: [],
        properties: {
          vectorNetworkBlob: Array.from(blob), // Uint8Array as number[]
        },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    const pathNode = result.nodes.find((n) => n.type === "svgPath");
    expect(pathNode).toBeDefined();
    // Should have a valid d attribute from the decoded network
    expect((pathNode!.params.d as string).length).toBeGreaterThan(0);
  });

  it("should fallback to fillGeometry when no blob", () => {
    const figNodes: FigNode[] = [
      {
        type: "VECTOR",
        name: "Path",
        id: "v2",
        children: [],
        properties: { fillGeometry: "M 0 0 L 100 0 Z" },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    expect(result.nodes.find((n) => n.type === "svgPath")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Modify fig-mapper.ts VECTOR case**

In the `VECTOR` case of `mapFigToGraph`, add blob decode:

```typescript
case 'VECTOR': {
  nodeId = nextId();
  let d = '';
  const blobData = figNode.properties.vectorNetworkBlob;
  if (Array.isArray(blobData)) {
    // Decode binary blob → VectorNetwork → paths → d attribute
    const blob = new Uint8Array(blobData as number[]);
    const network = decodeVectorNetworkBlob(blob);
    if (network.vertices.length > 0) {
      const paths = networkToPaths(network);
      if (paths.length > 0) {
        d = commandsToSvgD(paths[0].commands);
      }
    }
  }
  if (!d) {
    // Fallback to fillGeometry string
    d = (figNode.properties.fillGeometry as string) ?? '';
  }
  nodes.push({ id: nodeId, type: 'svgPath', params: { d } });
  break;
}
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-engine): integrate vectorNetworkBlob decoder in FIG import (HYP-308)
```

---

## Chunk 4: Register & Polish

### Task 7: Update Exports + Integration Tests

**Files:**

- Modify: `packages/vector-engine/src/index.ts`
- Modify: `packages/vector-engine/src/integration-advanced.test.ts`

- [ ] **Step 1: Add new exports to index.ts**

```typescript
// Kiwi codec
export { encodeGraphFile, decodeGraphFile } from "./persistence/kiwi-codec";
export { serializeGraphBinary, deserializeGraphBinary } from "./persistence/serialize";
// Reverse sync
export { computeSemanticDiff, type SemanticDiff, type SemanticMatch } from "./sync/semantic-diff";
export { reverseSync, type ReverseSyncResult } from "./sync/reverse-sync";
// FIG blob decode
export { decodeVectorNetworkBlob } from "./import/fig-blob-decode";
```

- [ ] **Step 2: Add integration tests**

```typescript
describe("deferred SDK features", () => {
  it("should roundtrip graph through Kiwi binary", () => {
    const model = VectorGraphModel.create("test", "Kiwi", 100, 100);
    model.addNode({ type: "rectangle", params: { width: 50, height: 50 } });
    const binary = serializeGraphBinary(model, { componentPath: "test.tsx" });
    expect(binary).toBeInstanceOf(Uint8Array);
    const { model: loaded } = deserializeGraphBinary(binary);
    expect(loaded.nodeCount).toBe(1);
  });

  it("should decode FIG vector blob to path", () => {
    const blob = new Uint8Array(0); // Empty blob → empty network
    const network = decodeVectorNetworkBlob(blob);
    expect(network.vertices.length).toBe(0);
  });
});
```

- [ ] **Step 3: Run full test suite + lint + coverage**

```bash
bun test packages/vector-engine/ packages/vector-wasm/ && biome check ./packages/
```

- [ ] **Step 4: Commit**

```
feat(vector-engine): export deferred SDK features and integration tests (HYP-308)
```

---

## Deferred to Plan 4 (Integration)

| Feature                        | Reason                                              |
| ------------------------------ | --------------------------------------------------- |
| .graph file watcher            | Needs environment-specific API (VS Code, SaaS, CLI) |
| Merge UI for ambiguous changes | UI component — Plan 4                               |
| Auto-delete removed shapes     | Safety concern — needs user confirmation UI         |
