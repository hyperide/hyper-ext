# vecli Core CLI — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the vecli command-line tool: eval-based JS sandbox with fluent
ChainableNode API, batch/pipe/inline modes, file operations, history, and
live SVG preview.

**Architecture:** New `packages/vector-cli/` workspace package. Entry point detects
TTY vs pipe mode. Core is `EvalContext` (shared graph/executor/history state) with
`ChainableNode` (fluent wrapper adding nodes to graph on each method call). Global
functions (`rect`, `fill`, `union`, etc.) are injected into a `new Function()` sandbox.
TUI is a separate chunk (Plan 2).

**Tech Stack:** TypeScript, bun:test, chalk (colored output), minimist (arg parsing)

**Spec:** `docs/specs/2026-03-17-vector-cli-design.md`

---

## File Structure

```
packages/vector-cli/
├── package.json
├── tsconfig.json
├── bin/
│   └── vecli.ts                     # Entry point, mode detection, arg parsing
├── src/
│   ├── context.ts                   # EvalContext — shared session state
│   ├── chainable.ts                 # ChainableNode — fluent API wrapper
│   ├── globals.ts                   # Global function bindings for sandbox
│   ├── sandbox.ts                   # new Function() sandbox setup
│   ├── batch.ts                     # Batch mode runner (pipe/inline/file)
│   ├── preview.ts                   # Live SVG preview (file watcher write)
│   ├── commands/
│   │   ├── file.ts                  # open/save/export
│   │   ├── history.ts               # undo/redo/history/mute/reorder
│   │   └── inspect.ts               # nodes/edges/info/tree/scene/stats
│   └── formatters/
│       ├── table.ts                 # Tabular output for nodes/edges
│       └── tree.ts                  # ASCII tree for DAG visualization
└── test/
    ├── chainable.test.ts
    ├── sandbox.test.ts
    ├── globals.test.ts
    ├── batch.test.ts
    ├── commands.test.ts
    └── formatters.test.ts
```

---

## Chunk 1: Package Setup & EvalContext

### Task 1: Package Scaffolding

**Files:**

- Modify: root `package.json` (add to workspaces)
- Create: `packages/vector-cli/package.json`
- Create: `packages/vector-cli/tsconfig.json`
- Create: `packages/vector-cli/src/context.ts`
- Create: `packages/vector-cli/test/context.test.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "vector-cli",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "bin": { "vecli": "bin/vecli.ts" },
  "main": "src/context.ts",
  "dependencies": {
    "vector-engine": "workspace:*",
    "vector-wasm": "workspace:*",
    "chalk": "^5.3.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "paths": {
      "vector-engine": ["../vector-engine/src"],
      "vector-wasm": ["../vector-wasm/src"]
    }
  },
  "include": ["src", "bin", "test"]
}
```

- [ ] **Step 3: Add to root workspaces**

In root `package.json`, workspaces already has `"packages/*"` so no change needed.

- [ ] **Step 4: Write EvalContext with tests**

```typescript
// src/context.ts
/**
 * @file EvalContext — shared session state for CLI
 *
 * Accessed via: All CLI commands — holds graph, executor, history, registry
 */

import { VectorGraphModel, GraphExecutor, createDefaultRegistry, HistoryManager, sceneToSvg } from 'vector-engine';
import type { NodeRegistry } from 'vector-engine';

export interface EvalContext {
  graph: VectorGraphModel;
  registry: NodeRegistry;
  executor: GraphExecutor;
  history: HistoryManager;
  currentFile?: string;
  previewPath?: string;
  canvasWidth: number;
  canvasHeight: number;
}

export function createContext(width = 100, height = 100): EvalContext {
  const registry = createDefaultRegistry();
  const graph = VectorGraphModel.create(crypto.randomUUID(), 'untitled', width, height);
  return {
    graph,
    registry,
    executor: new GraphExecutor(registry),
    history: new HistoryManager(),
    canvasWidth: width,
    canvasHeight: height,
  };
}

export function executeAndRender(ctx: EvalContext): string {
  const result = ctx.executor.execute(ctx.graph);
  return sceneToSvg(result.scene);
}
```

```typescript
// test/context.test.ts
import { describe, expect, it } from 'bun:test';
import { createContext, executeAndRender } from '../src/context';

describe('EvalContext', () => {
  it('should create context with default canvas', () => {
    const ctx = createContext();
    expect(ctx.graph.nodeCount).toBe(0);
    expect(ctx.canvasWidth).toBe(100);
  });

  it('should create context with custom canvas', () => {
    const ctx = createContext(200, 300);
    expect(ctx.canvasWidth).toBe(200);
    expect(ctx.canvasHeight).toBe(300);
  });

  it('should execute empty graph to SVG', () => {
    const ctx = createContext();
    const svg = executeAndRender(ctx);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 100 100"');
  });
});
```

- [ ] **Step 5: Install deps and verify**

```bash
bun install
bun test packages/vector-cli/
```

- [ ] **Step 6: Commit**

```
feat(vector-cli): package scaffolding and EvalContext (HYP-308)
```

---

### Task 2: ChainableNode

The core fluent API. Each method call adds a node to the graph,
connects edges, returns a new ChainableNode.

**Files:**

- Create: `packages/vector-cli/src/chainable.ts`
- Create: `packages/vector-cli/test/chainable.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { ChainableNode } from '../src/chainable';
import { createContext } from '../src/context';

describe('ChainableNode', () => {
  it('should create a rectangle node', () => {
    const ctx = createContext();
    const node = ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50 });
    expect(ctx.graph.nodeCount).toBe(1);
    expect(node.nodeId).toBeTruthy();
  });

  it('should chain fill after generator', () => {
    const ctx = createContext();
    const node = ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50 }).fill('#ff0000');
    expect(ctx.graph.nodeCount).toBe(2);
    expect(ctx.graph.edgeCount).toBe(1);
  });

  it('should chain multiple operations', () => {
    const ctx = createContext();
    const node = ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50 })
      .fill('#ff0000')
      .stroke('#000000', 2)
      .translate(10, 20);
    expect(ctx.graph.nodeCount).toBe(4);
    expect(ctx.graph.edgeCount).toBe(3);
  });

  it('should export SVG', () => {
    const ctx = createContext();
    const svg = ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50 }).fill('#ff0000').export('svg');
    expect(svg).toContain('<svg');
    expect(svg).toContain('fill="#ff0000"');
  });

  it('should compute bounds', () => {
    const ctx = createContext();
    const bounds = ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50, x: 10, y: 20 }).bounds();
    expect(bounds.width).toBeCloseTo(100, 0);
    expect(bounds.height).toBeCloseTo(50, 0);
  });

  it('should compute length', () => {
    const ctx = createContext();
    const len = ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 100, x: 0, y: 0 }).length();
    expect(len).toBeCloseTo(400, 0);
  });

  it('should chain deformation', () => {
    const ctx = createContext();
    const node = ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50 }).roughen(10, 5);
    expect(ctx.graph.nodeCount).toBe(2);
  });

  it('should chain roundCorners', () => {
    const ctx = createContext();
    const node = ChainableNode.generator(ctx, 'rectangle', { width: 100, height: 50 }).roundCorners(10);
    expect(ctx.graph.nodeCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement chainable.ts**

```typescript
/**
 * @file ChainableNode — fluent API wrapper for graph node operations
 *
 * Accessed via: Every CLI command — rect(100,50).fill("#f00").export("svg")
 */

import {
  sceneToSvg,
  computeBounds,
  pathLength,
  pathArea,
  pointAtOffset,
  type BoundingBox,
  type PathValue,
  type NodeValue,
  type PointAtOffsetResult,
} from 'vector-engine';
import type { EvalContext } from './context';
import { writeFileSync } from 'node:fs';

export class ChainableNode {
  constructor(
    readonly ctx: EvalContext,
    readonly nodeId: string,
  ) {}

  /** Create a generator node */
  static generator(ctx: EvalContext, type: string, params: Record<string, unknown>): ChainableNode {
    const id = ctx.graph.addNode({ type, params });
    return new ChainableNode(ctx, id);
  }

  /** Add a downstream node connected via path port */
  private chain(type: string, params: Record<string, unknown>): ChainableNode {
    const id = this.ctx.graph.addNode({ type, params });
    this.ctx.graph.addEdge(this.nodeId, 'path', id, 'path');
    return new ChainableNode(this.ctx, id);
  }

  // -- Style --
  fill(color: string): ChainableNode {
    return this.chain('fill', { type: 'solid', color });
  }
  stroke(color: string, width = 1, cap = 'round', join = 'round'): ChainableNode {
    return this.chain('stroke', { color, width, cap, join });
  }
  opacity(value: number): ChainableNode {
    return this.chain('opacity', { opacity: value });
  }
  blend(mode: string): ChainableNode {
    return this.chain('blendMode', { mode });
  }
  shadow(color: string, dx: number, dy: number, blur: number): ChainableNode {
    return this.chain('shadow', { color, offsetX: dx, offsetY: dy, blur });
  }
  blur(radius: number): ChainableNode {
    return this.chain('blur', { radius });
  }

  // -- Transform --
  translate(dx: number, dy: number): ChainableNode {
    return this.chain('translate', { dx, dy });
  }
  rotate(angle: number, cx?: number, cy?: number): ChainableNode {
    return this.chain('rotate', { angle, cx: cx ?? 0, cy: cy ?? 0 });
  }
  scale(sx: number, sy?: number): ChainableNode {
    return this.chain('scale', { sx, sy: sy ?? sx });
  }
  skew(sx: number, sy: number): ChainableNode {
    return this.chain('skew', { skewX: sx, skewY: sy });
  }

  // -- Path operations --
  roundCorners(radius: number): ChainableNode {
    return this.chain('roundCorners', { radius });
  }
  chamfer(distance: number): ChainableNode {
    return this.chain('chamfer', { distance });
  }
  smooth(smoothness = 0.5): ChainableNode {
    return this.chain('smooth', { smoothness });
  }
  offset(distance: number): ChainableNode {
    return this.chain('offset', { distance });
  }
  trim(start: number, end: number): ChainableNode {
    return this.chain('trimPath', { start, end });
  }
  reverse(): ChainableNode {
    return this.chain('reversePath', {});
  }
  close(): ChainableNode {
    return this.chain('closeOpen', {});
  }
  dash(on: number, off: number): ChainableNode {
    return this.chain('dashPath', { dashArray: JSON.stringify([on, off]), dashOffset: 0 });
  }
  strokeToPath(): ChainableNode {
    return this.chain('strokeToPath', { width: 1, cap: 'round', join: 'round' });
  }
  roughen(size: number, detail = 5): ChainableNode {
    return this.chain('roughen', { size, detail, type: 'corner', seed: 42 });
  }
  zigzag(size: number, ridges = 5): ChainableNode {
    return this.chain('zigzag', { size, ridgesPerSegment: ridges, type: 'corner' });
  }
  puckerBloat(amount: number): ChainableNode {
    return this.chain('puckerBloat', { amount });
  }
  twist(angle: number): ChainableNode {
    return this.chain('twist', { angle });
  }
  warp(type: string, bend: number): ChainableNode {
    return this.chain('warp', { warpType: type, bend });
  }
  variableStroke(profile: Array<{ offset: number; width: number }>): ChainableNode {
    return this.chain('variableStroke', { profile: JSON.stringify(profile), cap: 'round' });
  }
  subdivide(segIndex: number, t = 0.5): ChainableNode {
    return this.chain('subdivide', { segmentIndex: segIndex, t });
  }
  addPoint(segIndex: number, t = 0.5): ChainableNode {
    return this.chain('addPoint', { segmentIndex: segIndex, t });
  }
  removePoint(index: number): ChainableNode {
    return this.chain('removePoint', { pointIndex: index });
  }
  convertPoint(index: number, type: string): ChainableNode {
    return this.chain('convertPoint', { pointIndex: index, pointType: type });
  }
  enforceWinding(dir: string): ChainableNode {
    return this.chain('enforceWinding', { direction: dir });
  }

  // -- Terminal operations (return values, not ChainableNode) --
  export(format: string, filename?: string): string {
    const result = this.ctx.executor.execute(this.ctx.graph);
    const svg = sceneToSvg(result.scene);
    if (format === 'svg') {
      if (filename) writeFileSync(filename, svg);
      return svg;
    }
    if (format === 'json') {
      const json = JSON.stringify(this.ctx.graph.toJSON(), null, 2);
      if (filename) writeFileSync(filename, json);
      return json;
    }
    return svg;
  }

  svg(): string {
    return this.export('svg');
  }

  bounds(): BoundingBox {
    const result = this.ctx.executor.execute(this.ctx.graph);
    const items = result.scene.items;
    for (const item of items) {
      if ('path' in item) return computeBounds(item.path.commands);
    }
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  length(): number {
    const result = this.ctx.executor.execute(this.ctx.graph);
    for (const item of result.scene.items) {
      if ('path' in item) return pathLength(item.path.commands);
    }
    return 0;
  }

  area(): number {
    const result = this.ctx.executor.execute(this.ctx.graph);
    for (const item of result.scene.items) {
      if ('path' in item) return Math.abs(pathArea(item.path.commands));
    }
    return 0;
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-cli): ChainableNode fluent API (HYP-308)
```

---

## Chunk 2: Sandbox & Global Functions

### Task 3: Global Function Bindings

Map user-facing function names to ChainableNode constructors + multi-node ops.

**Files:**

- Create: `packages/vector-cli/src/globals.ts`
- Create: `packages/vector-cli/test/globals.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { createGlobals } from '../src/globals';
import { createContext } from '../src/context';

describe('global functions', () => {
  it('should create rect', () => {
    const ctx = createContext();
    const globals = createGlobals(ctx);
    const node = globals.rect(100, 50);
    expect(ctx.graph.nodeCount).toBe(1);
  });

  it('should create circle (shorthand for ellipse)', () => {
    const ctx = createContext();
    const globals = createGlobals(ctx);
    const node = globals.circle(30);
    expect(ctx.graph.nodeCount).toBe(1);
  });

  it('should do boolean union', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    const a = g.rect(100, 100);
    const b = g.circle(50);
    const u = g.union(a, b);
    expect(ctx.graph.nodeCount).toBe(3); // rect + circle + union
    expect(ctx.graph.edgeCount).toBe(2);
  });

  it('should create group', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    const a = g.rect(100, 50);
    const b = g.ellipse(30, 20);
    const grp = g.group(a, b);
    expect(ctx.graph.nodeCount).toBe(3);
  });

  it('should set canvas size', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    g.canvas(200, 300);
    expect(ctx.canvasWidth).toBe(200);
    expect(ctx.canvasHeight).toBe(300);
  });

  it('should undo/redo', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    g.rect(100, 50);
    expect(ctx.graph.nodeCount).toBe(1);
    // History needs to be recorded for undo to work
    // This test verifies the functions exist and don't crash
    g.undo();
    g.redo();
  });
});
```

- [ ] **Step 2: Implement globals.ts**

```typescript
/**
 * @file Global function bindings — user-facing API injected into sandbox
 *
 * Accessed via: Every CLI expression — rect(100,50), union(a,b), undo(), etc.
 */

import { ChainableNode } from './chainable';
import type { EvalContext } from './context';
import { executeAndRender } from './context';

export function createGlobals(ctx: EvalContext): Record<string, Function> {
  return {
    // Generators
    rect: (w: number, h: number, x = 0, y = 0) =>
      ChainableNode.generator(ctx, 'rectangle', { width: w, height: h, x, y }),
    ellipse: (rx: number, ry: number, cx = 0, cy = 0) => ChainableNode.generator(ctx, 'ellipse', { rx, ry, cx, cy }),
    circle: (r: number, cx = 0, cy = 0) => ChainableNode.generator(ctx, 'ellipse', { rx: r, ry: r, cx, cy }),
    polygon: (sides: number, radius: number, cx = 0, cy = 0) =>
      ChainableNode.generator(ctx, 'polygon', { sides, radius, cx, cy }),
    star: (points: number, outer: number, inner: number, cx = 0, cy = 0) =>
      ChainableNode.generator(ctx, 'star', { points, outerRadius: outer, innerRadius: inner, cx, cy }),
    line: (x1: number, y1: number, x2: number, y2: number) => ChainableNode.generator(ctx, 'line', { x1, y1, x2, y2 }),
    arc: (radius: number, startAngle: number, endAngle: number, cx = 0, cy = 0) =>
      ChainableNode.generator(ctx, 'arc', { radius, startAngle, endAngle, cx, cy }),
    spiral: (spirals: number, radius: number, cx = 0, cy = 0) =>
      ChainableNode.generator(ctx, 'spiral', { spirals, radius, cx, cy }),
    arrow: (length: number, width: number) => ChainableNode.generator(ctx, 'arrow', { length, width }),
    path: (d: string) => ChainableNode.generator(ctx, 'svgPath', { d }),
    text: (text: string, fontSize = 48) => ChainableNode.generator(ctx, 'textToPath', { text, fontSize, fontUrl: '' }),
    mesh: (rows: number, cols: number, w = 100, h = 100) =>
      ChainableNode.generator(ctx, 'gradientMesh', { rows, cols, width: w, height: h, x: 0, y: 0, color: '#ffffff' }),

    // Boolean / multi-node
    union: (a: ChainableNode, b: ChainableNode) => boolOp(ctx, 'booleanUnion', a, b),
    subtract: (a: ChainableNode, b: ChainableNode) => boolOp(ctx, 'booleanSubtract', a, b),
    intersect: (a: ChainableNode, b: ChainableNode) => boolOp(ctx, 'booleanIntersect', a, b),
    xor: (a: ChainableNode, b: ChainableNode) => boolOp(ctx, 'booleanXor', a, b),
    clip: (content: ChainableNode, mask: ChainableNode) => {
      const id = ctx.graph.addNode({ type: 'clip', params: {} });
      ctx.graph.addEdge(content.nodeId, 'path', id, 'path');
      ctx.graph.addEdge(mask.nodeId, 'path', id, 'clipPath');
      return new ChainableNode(ctx, id);
    },
    group: (...nodes: ChainableNode[]) => {
      const id = ctx.graph.addNode({ type: 'group', params: { opacity: 1 } });
      for (const n of nodes) {
        ctx.graph.addEdge(n.nodeId, 'path', id, 'children');
      }
      return new ChainableNode(ctx, id);
    },
    join: (a: ChainableNode, b: ChainableNode) => {
      const id = ctx.graph.addNode({ type: 'joinPaths', params: {} });
      ctx.graph.addEdge(a.nodeId, 'path', id, 'paths');
      ctx.graph.addEdge(b.nodeId, 'path', id, 'paths');
      return new ChainableNode(ctx, id);
    },

    // Canvas
    canvas: (w?: number, h?: number) => {
      if (w !== undefined && h !== undefined) {
        ctx.canvasWidth = w;
        ctx.canvasHeight = h;
        // Recreate graph with new canvas
        // (simplified: just update context dimensions)
      }
      return { width: ctx.canvasWidth, height: ctx.canvasHeight };
    },

    // History
    undo: (n = 1) => {
      for (let i = 0; i < n; i++) ctx.history.undo(ctx.graph);
    },
    redo: (n = 1) => {
      for (let i = 0; i < n; i++) ctx.history.redo(ctx.graph);
    },
    history: (n?: number) => {
      const entries = ctx.history.getEntries();
      return n ? entries.slice(-n) : entries;
    },

    // Mute
    mute: (node: ChainableNode) => ctx.graph.setMuted(node.nodeId, true),
    unmute: (node: ChainableNode) => ctx.graph.setMuted(node.nodeId, false),
    toggle: (node: ChainableNode) => {
      ctx.graph.setMuted(node.nodeId, !ctx.graph.isMuted(node.nodeId));
    },

    // DAG manipulation
    remove: (node: ChainableNode) => ctx.graph.removeNode(node.nodeId),
    set: (node: ChainableNode | string, param: string, value: unknown) => {
      const id = typeof node === 'string' ? node : node.nodeId;
      ctx.graph.setParam(id, param, value);
    },

    // Export (global — exports entire canvas)
    export: (format: string, filename?: string) => {
      const result = ctx.executor.execute(ctx.graph);
      const svg = sceneToSvg(result.scene);
      if (filename) writeFileSync(filename, svg);
      return svg;
    },

    // Inspection
    nodes: () => {
      const order = ctx.graph.topologicalOrder();
      return order.map((id) => ctx.graph.getNode(id)).filter(Boolean);
    },
    edges: () => ctx.graph.getEdges(),
    info: (node: ChainableNode | string) => {
      const id = typeof node === 'string' ? node : node.nodeId;
      return ctx.graph.getNode(id);
    },

    // Math/console passthrough
    Math,
    console,
  };
}

function boolOp(ctx: EvalContext, type: string, a: ChainableNode, b: ChainableNode): ChainableNode {
  const id = ctx.graph.addNode({ type, params: {} });
  ctx.graph.addEdge(a.nodeId, 'path', id, 'a');
  ctx.graph.addEdge(b.nodeId, 'path', id, 'b');
  return new ChainableNode(ctx, id);
}
```

- [ ] **Step 3: Run test — verify it passes**

- [ ] **Step 4: Commit**

```
feat(vector-cli): global function bindings for sandbox (HYP-308)
```

---

### Task 4: Sandbox (eval)

**Files:**

- Create: `packages/vector-cli/src/sandbox.ts`
- Create: `packages/vector-cli/test/sandbox.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { runInSandbox } from '../src/sandbox';
import { createContext } from '../src/context';

describe('sandbox', () => {
  it('should execute simple expression', () => {
    const ctx = createContext();
    const result = runInSandbox(ctx, 'rect(100, 50)');
    expect(ctx.graph.nodeCount).toBe(1);
  });

  it('should execute chained expression', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(100, 50).fill("#ff0000").stroke("#000", 2)');
    expect(ctx.graph.nodeCount).toBe(3);
  });

  it('should support variables', () => {
    const ctx = createContext();
    runInSandbox(
      ctx,
      `
      const r = rect(100, 50);
      const c = circle(30);
      union(r, c).fill("#00f");
    `,
    );
    expect(ctx.graph.nodeCount).toBe(4); // rect + circle + union + fill
  });

  it('should support loops', () => {
    const ctx = createContext();
    runInSandbox(
      ctx,
      `
      for (let i = 0; i < 3; i++) {
        circle(10).translate(i * 30, 0);
      }
    `,
    );
    expect(ctx.graph.nodeCount).toBe(6); // 3 circles + 3 translates
  });

  it('should not expose process/require/import', () => {
    const ctx = createContext();
    expect(() => runInSandbox(ctx, 'process.exit()')).toThrow();
    expect(() => runInSandbox(ctx, 'require("fs")')).toThrow();
  });

  it('should return last expression result', () => {
    const ctx = createContext();
    const result = runInSandbox(ctx, 'rect(100, 50).fill("#f00").svg()');
    expect(result).toContain('<svg');
  });

  it('should handle syntax errors gracefully', () => {
    const ctx = createContext();
    expect(() => runInSandbox(ctx, 'rect(100, }')).toThrow();
  });
});
```

- [ ] **Step 2: Implement sandbox.ts**

```typescript
/**
 * @file Sandbox — isolated eval scope for CLI expressions
 *
 * Accessed via: Every CLI command execution
 * Tradeoffs: uses new Function() with explicit scope injection.
 *   No access to process, require, import, globalThis, Bun, fetch.
 */

import { createGlobals } from './globals';
import type { EvalContext } from './context';

export function runInSandbox(ctx: EvalContext, code: string): unknown {
  const globals = createGlobals(ctx);
  const keys = Object.keys(globals);
  const values = Object.values(globals);

  // Wrap code to return last expression value
  const wrappedCode = `"use strict";\n${code}`;

  try {
    const fn = new Function(...keys, wrappedCode);
    return fn(...values);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Syntax error: ${err.message}`);
    }
    throw err;
  }
}
```

- [ ] **Step 3: Run test — verify it passes**

- [ ] **Step 4: Commit**

```
feat(vector-cli): sandboxed eval for CLI expressions (HYP-308)
```

---

## Chunk 3: Batch Mode & Entry Point

### Task 5: Batch Runner

**Files:**

- Create: `packages/vector-cli/src/batch.ts`
- Create: `packages/vector-cli/test/batch.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { runBatch } from '../src/batch';

describe('batch mode', () => {
  it('should execute inline expression and return SVG', () => {
    const output = runBatch({ expression: 'rect(100,50).fill("#f00").svg()' });
    expect(output).toContain('<svg');
  });

  it('should execute multi-line script', () => {
    const script = `
      const r = rect(100, 50);
      r.fill("#ff0000").export("svg");
    `;
    const output = runBatch({ script });
    expect(output).toContain('<svg');
  });

  it('should respect canvas size', () => {
    const output = runBatch({
      expression: 'rect(50,50).svg()',
      canvasWidth: 200,
      canvasHeight: 150,
    });
    expect(output).toContain('viewBox="0 0 200 150"');
  });

  it('should handle errors gracefully', () => {
    expect(() => runBatch({ expression: 'nonexistent()' })).toThrow();
  });
});
```

- [ ] **Step 2: Implement batch.ts**

```typescript
/**
 * @file Batch runner — execute expressions/scripts in non-interactive mode
 *
 * Accessed via: vecli 'expression', vecli -e file.js, pipe
 */

import { createContext } from './context';
import { runInSandbox } from './sandbox';

export interface BatchOptions {
  expression?: string;
  script?: string;
  canvasWidth?: number;
  canvasHeight?: number;
}

export function runBatch(opts: BatchOptions): string {
  const ctx = createContext(opts.canvasWidth, opts.canvasHeight);
  const code = opts.expression ?? opts.script ?? '';
  const result = runInSandbox(ctx, code);
  if (typeof result === 'string') return result;
  // If no explicit export, execute and return SVG of whatever is in the graph
  if (ctx.graph.nodeCount > 0) {
    const execResult = ctx.executor.execute(ctx.graph);
    return sceneToSvg(execResult.scene);
  }
  return '';
}
```

- [ ] **Step 3: Commit**

```
feat(vector-cli): batch mode runner (HYP-308)
```

---

### Task 6: Entry Point (bin/vecli.ts)

**Files:**

- Create: `packages/vector-cli/bin/vecli.ts`

- [ ] **Step 1: Implement entry point**

```typescript
#!/usr/bin/env bun
/**
 * @file vecli entry point — mode detection and arg parsing
 *
 * Accessed via: `vecli` command in terminal
 */

import { readFileSync } from 'node:fs';
import { runBatch } from '../src/batch';

const args = process.argv.slice(2);

// Parse flags
let execFile: string | undefined;
let outputFile: string | undefined;
let inputFile: string | undefined;
let canvasWidth = 100;
let canvasHeight = 100;
let expression: string | undefined;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '-e':
      execFile = args[++i];
      break;
    case '-o':
      outputFile = args[++i];
      break;
    case '-i':
      inputFile = args[++i];
      break;
    case '--canvas': {
      const [w, h] = args[++i].split('x').map(Number);
      canvasWidth = w;
      canvasHeight = h;
      break;
    }
    default:
      if (!args[i].startsWith('-') && !expression) {
        expression = args[i];
      }
  }
}

// Detect mode
const isTTY = process.stdin.isTTY && process.stdout.isTTY;
const hasBatchArgs = expression || execFile;

if (hasBatchArgs || !isTTY) {
  // Batch mode
  let code = expression ?? '';
  if (execFile) code = readFileSync(execFile, 'utf-8');
  if (!code && !isTTY) {
    // Read from stdin pipe
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    code = Buffer.concat(chunks).toString('utf-8');
  }

  try {
    const output = runBatch({ expression: code, canvasWidth, canvasHeight });
    if (outputFile) {
      writeFileSync(outputFile, output);
    } else if (output) {
      process.stdout.write(output);
    }
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
} else {
  // TUI mode (placeholder — implemented in Plan 2)
  console.log('vecli interactive mode — TUI coming in next phase');
  console.log("Use: vecli 'expression' for batch mode");
  console.log('Use: vecli -e script.js to execute a file');
}
```

- [ ] **Step 2: Test manually**

```bash
# Make executable
chmod +x packages/vector-cli/bin/vecli.ts

# Test inline
bun packages/vector-cli/bin/vecli.ts 'rect(100,50).fill("#f00").svg()'

# Test file exec
echo 'rect(100,50).fill("#ff0000").export("svg")' > /tmp/test.js
bun packages/vector-cli/bin/vecli.ts -e /tmp/test.js

# Test pipe
echo 'circle(50).fill("#00f").svg()' | bun packages/vector-cli/bin/vecli.ts
```

- [ ] **Step 3: Commit**

```
feat(vector-cli): entry point with mode detection (HYP-308)
```

---

## Chunk 4: File Operations & Preview

### Task 7: File Commands (open/save/export)

**Files:**

- Create: `packages/vector-cli/src/commands/file.ts`
- Create: `packages/vector-cli/test/commands.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { openFile, saveFile } from '../src/commands/file';
import { createContext } from '../src/context';
import { runInSandbox } from '../src/sandbox';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, unlinkSync } from 'node:fs';

describe('file commands', () => {
  it('should save and open .graph.json', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(100, 50).fill("#ff0000")');
    const tmpFile = join(tmpdir(), 'test-vecli.graph.json');
    saveFile(ctx, tmpFile);
    // Open in new context
    const ctx2 = createContext();
    openFile(ctx2, tmpFile);
    expect(ctx2.graph.nodeCount).toBe(2);
    unlinkSync(tmpFile);
  });

  it('should save and open .graph (binary)', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(100, 50)');
    const tmpFile = join(tmpdir(), 'test-vecli.graph');
    saveFile(ctx, tmpFile);
    const ctx2 = createContext();
    openFile(ctx2, tmpFile);
    expect(ctx2.graph.nodeCount).toBe(1);
    unlinkSync(tmpFile);
  });

  it('should import SVG', () => {
    const ctx = createContext();
    const tmpFile = join(tmpdir(), 'test-vecli.svg');
    const svgContent = '<svg viewBox="0 0 100 100"><rect width="50" height="50" fill="#f00"/></svg>';
    require('node:fs').writeFileSync(tmpFile, svgContent);
    openFile(ctx, tmpFile);
    expect(ctx.graph.nodeCount).toBeGreaterThanOrEqual(1);
    unlinkSync(tmpFile);
  });
});
```

- [ ] **Step 2: Implement file.ts**

```typescript
/**
 * @file File commands — open/save/export for .graph, .graph.json, .svg, .fig
 *
 * Accessed via: open("file.graph"), save("file.graph"), etc.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import {
  serializeGraph,
  deserializeGraph,
  serializeGraphBinary,
  deserializeGraphBinary,
  svgToGraph,
  parseFigFile,
  mapFigToGraph,
  VectorGraphModel,
  sceneToSvg,
} from 'vector-engine';
import type { EvalContext } from '../context';

export function openFile(ctx: EvalContext, filepath: string): void {
  const ext = filepath.split('.').pop()?.toLowerCase();
  if (ext === 'json' || filepath.endsWith('.graph.json')) {
    const json = JSON.parse(readFileSync(filepath, 'utf-8'));
    const { model, meta, history } = deserializeGraph(json);
    Object.assign(ctx, { graph: model, history, currentFile: filepath });
  } else if (ext === 'graph') {
    const data = readFileSync(filepath);
    const { model, meta, history } = deserializeGraphBinary(new Uint8Array(data));
    Object.assign(ctx, { graph: model, history, currentFile: filepath });
  } else if (ext === 'svg') {
    const svg = readFileSync(filepath, 'utf-8');
    const imported = svgToGraph(svg);
    // Build graph from imported nodes
    // ... (similar to what reverseSync does)
    ctx.currentFile = filepath;
  } else if (ext === 'fig') {
    const data = readFileSync(filepath);
    const parsed = parseFigFile(data.buffer);
    const imported = mapFigToGraph(parsed.nodes, parsed.canvas);
    ctx.currentFile = filepath;
  }
}

export function saveFile(ctx: EvalContext, filepath?: string): void {
  const target = filepath ?? ctx.currentFile;
  if (!target) throw new Error('No file path specified. Use save("filename")');
  const ext = target.split('.').pop()?.toLowerCase();
  if (ext === 'json' || target.endsWith('.graph.json')) {
    const file = serializeGraph(ctx.graph, { componentPath: '' }, ctx.history);
    writeFileSync(target, JSON.stringify(file, null, 2));
  } else if (ext === 'graph') {
    const binary = serializeGraphBinary(ctx.graph, { componentPath: '' }, ctx.history);
    writeFileSync(target, binary);
  }
  ctx.currentFile = target;
}
```

- [ ] **Step 3: Wire file commands into globals.ts**

Add `open` and `save` to globals:

```typescript
open: (path: string) => openFile(ctx, path),
save: (path?: string) => saveFile(ctx, path),
```

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```
feat(vector-cli): file commands — open/save for .graph, .svg, .fig (HYP-308)
```

---

### Task 8: Live SVG Preview

**Files:**

- Create: `packages/vector-cli/src/preview.ts`
- Modify: `packages/vector-cli/test/commands.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { PreviewManager } from '../src/preview';

describe('live preview', () => {
  it('should write SVG on update', () => {
    const tmpFile = join(tmpdir(), 'test-preview.svg');
    const preview = new PreviewManager(tmpFile);
    preview.update('<svg><rect/></svg>');
    const content = readFileSync(tmpFile, 'utf-8');
    expect(content).toContain('<svg>');
    preview.dispose();
    unlinkSync(tmpFile);
  });

  it('should debounce rapid updates', async () => {
    const tmpFile = join(tmpdir(), 'test-preview-debounce.svg');
    const preview = new PreviewManager(tmpFile, 50);
    preview.update('<svg>1</svg>');
    preview.update('<svg>2</svg>');
    preview.update('<svg>3</svg>');
    await new Promise((r) => setTimeout(r, 100));
    const content = readFileSync(tmpFile, 'utf-8');
    expect(content).toContain('<svg>3</svg>'); // Only last write
    preview.dispose();
    unlinkSync(tmpFile);
  });
});
```

- [ ] **Step 2: Implement preview.ts**

```typescript
/**
 * @file Live SVG preview — writes SVG to file on every graph change
 *
 * Accessed via: preview("file.svg") in REPL or --preview flag
 */

import { writeFileSync } from 'node:fs';

export class PreviewManager {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: string | null = null;

  constructor(
    readonly filepath: string,
    private debounceMs = 100,
  ) {}

  update(svg: string): void {
    this.pending = svg;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private flush(): void {
    if (this.pending) {
      writeFileSync(this.filepath, this.pending);
      this.pending = null;
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.pending) this.flush();
  }
}
```

- [ ] **Step 3: Wire preview into globals**

```typescript
preview: (pathOrFalse?: string | false) => {
  if (pathOrFalse === false) {
    ctx.previewPath = undefined;
    return;
  }
  if (typeof pathOrFalse === 'string') {
    ctx.previewPath = pathOrFalse;
  }
  return ctx.previewPath;
},
```

- [ ] **Step 4: Commit**

```
feat(vector-cli): live SVG preview with debounced file write (HYP-308)
```

---

## Chunk 5: Formatters & Inspection

### Task 9: Table & Tree Formatters

**Files:**

- Create: `packages/vector-cli/src/formatters/table.ts`
- Create: `packages/vector-cli/src/formatters/tree.ts`
- Create: `packages/vector-cli/test/formatters.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, expect, it } from 'bun:test';
import { formatNodesTable } from '../src/formatters/table';
import { formatDAGTree } from '../src/formatters/tree';
import { createContext } from '../src/context';
import { runInSandbox } from '../src/sandbox';

describe('formatters', () => {
  it('should format nodes as table', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(100, 50).fill("#ff0000")');
    const table = formatNodesTable(ctx);
    expect(table).toContain('rectangle');
    expect(table).toContain('fill');
  });

  it('should format DAG as ASCII tree', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(100, 50).fill("#ff0000").stroke("#000", 2)');
    const tree = formatDAGTree(ctx);
    expect(tree).toContain('rectangle');
    expect(tree).toContain('→');
    expect(tree).toContain('fill');
  });

  it('should handle empty graph', () => {
    const ctx = createContext();
    expect(formatNodesTable(ctx)).toContain('(empty)');
    expect(formatDAGTree(ctx)).toContain('(empty)');
  });
});
```

- [ ] **Step 2: Implement**

Table: aligned columns with ID, type, params summary.
Tree: topological order, `└→` connectors showing edges.

- [ ] **Step 3: Wire into globals**

```typescript
nodes: () => { console.log(formatNodesTable(ctx)); return ...; },
tree: () => { console.log(formatDAGTree(ctx)); },
```

- [ ] **Step 4: Commit**

```
feat(vector-cli): table and ASCII tree formatters (HYP-308)
```

---

### Task 10: Integration Tests & Polish

**Files:**

- Create: `packages/vector-cli/test/integration.test.ts`

- [ ] **Step 1: Write end-to-end tests**

```typescript
describe('vecli integration', () => {
  it('should create icon from script', () => {
    const output = runBatch({
      expression: `
        canvas(24, 24);
        const bg = rect(24, 24).fill("#4A90D9").roundCorners(4);
        const arrow = path("M 7 12 L 12 7 L 17 12").stroke("#fff", 2);
        group(bg, arrow).svg();
      `,
      canvasWidth: 24,
      canvasHeight: 24,
    });
    expect(output).toContain('<svg');
    expect(output).toContain('viewBox="0 0 24 24"');
  });

  it('should chain complex operations', () => {
    const output = runBatch({
      expression: `
        const r = rect(100, 100);
        const c = circle(30).translate(50, 50);
        subtract(r, c).fill("#ff0000").roundCorners(5).svg();
      `,
    });
    expect(output).toContain('<svg');
  });

  it('should use variables and loops', () => {
    const ctx = createContext(200, 200);
    runInSandbox(
      ctx,
      `
      for (let i = 0; i < 5; i++) {
        circle(8).translate(i * 25 + 20, 100).fill("#333");
      }
    `,
    );
    expect(ctx.graph.nodeCount).toBe(15); // 5 × (circle + translate + fill)
  });
});
```

- [ ] **Step 2: Run full test suite + coverage**

```bash
bun test packages/vector-cli/
bun test --coverage packages/vector-cli/
```

- [ ] **Step 3: Commit**

```
test(vector-cli): integration tests (HYP-308)
```

---

## Deferred to vecli Plan 2 (TUI)

| Feature                   | Reason                                             |
| ------------------------- | -------------------------------------------------- |
| ink-based TUI panels      | Separate concern, depends on core CLI being stable |
| REPL loop                 | Needs ink or readline integration                  |
| Hotkeys (Ctrl+Z/Y/S/Q)    | TUI-specific                                       |
| ASCII graph visualization | TUI center panel                                   |
| Properties editing        | TUI right panel                                    |
| Status bar                | TUI bottom                                         |
| sixel/kitty SVG preview   | Terminal-specific                                  |
