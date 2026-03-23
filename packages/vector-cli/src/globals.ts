/**
 * @file Global function bindings — user-facing API injected into sandbox
 *
 * Accessed via: Every CLI expression — rect(100,50), union(a,b), undo(), etc.
 * Assumptions: each call mutates EvalContext.graph directly; no batching or transactions
 */

import { ChainableNode } from './chainable';
import { openFile, saveFile } from './commands/file';
import type { EvalContext } from './context';
import { formatEdgesTable, formatNodesTable } from './formatters/table';
import { formatDAGTree } from './formatters/tree';
import { PreviewManager } from './preview';

// -- Generators --

function makeGenerator(ctx: EvalContext, type: string, params: Record<string, unknown>): ChainableNode {
  return ChainableNode.generator(ctx, type, params);
}

function createGenerators(ctx: EvalContext) {
  return {
    rect(w: number, h: number, x = 0, y = 0) {
      return makeGenerator(ctx, 'rectangle', { width: w, height: h, x, y });
    },
    ellipse(rx: number, ry: number, cx = 0, cy = 0) {
      return makeGenerator(ctx, 'ellipse', { rx, ry, cx, cy });
    },
    circle(r: number, cx = 0, cy = 0) {
      return makeGenerator(ctx, 'ellipse', { rx: r, ry: r, cx, cy });
    },
    polygon(sides: number, radius: number, cx = 0, cy = 0) {
      return makeGenerator(ctx, 'polygon', { sides, radius, cx, cy });
    },
    star(points: number, outer: number, inner: number, cx = 0, cy = 0) {
      return makeGenerator(ctx, 'star', { points, outerRadius: outer, innerRadius: inner, cx, cy });
    },
    line(x1: number, y1: number, x2: number, y2: number) {
      return makeGenerator(ctx, 'line', { x1, y1, x2, y2 });
    },
    arc(radius: number, startAngle: number, endAngle: number, cx = 0, cy = 0) {
      return makeGenerator(ctx, 'arc', { radius, startAngle, endAngle, cx, cy });
    },
    spiral(spirals: number, radius: number, cx = 0, cy = 0) {
      return makeGenerator(ctx, 'spiral', { spirals, radius, cx, cy });
    },
    arrow(length: number, width: number) {
      return makeGenerator(ctx, 'arrow', { length, width });
    },
    path(d: string) {
      return makeGenerator(ctx, 'svgPath', { d });
    },
    text(text: string, fontSize = 16) {
      return makeGenerator(ctx, 'textToPath', { text, fontSize, fontUrl: '' });
    },
    mesh(rows: number, cols: number, w = 100, h = 100) {
      return makeGenerator(ctx, 'gradientMesh', { rows, cols, width: w, height: h });
    },
  };
}

// -- Multi-node operations --

function booleanOp(ctx: EvalContext, type: string, a: ChainableNode, b: ChainableNode): ChainableNode {
  const nodeId = ctx.graph.addNode({ type, params: {} });
  ctx.graph.addEdge(a.nodeId, 'path', nodeId, 'a');
  ctx.graph.addEdge(b.nodeId, 'path', nodeId, 'b');
  return ChainableNode.fromExisting(ctx, nodeId);
}

function createMultiNodeOps(ctx: EvalContext) {
  return {
    union(a: ChainableNode, b: ChainableNode) {
      return booleanOp(ctx, 'boolean-union', a, b);
    },
    subtract(a: ChainableNode, b: ChainableNode) {
      return booleanOp(ctx, 'boolean-subtract', a, b);
    },
    intersect(a: ChainableNode, b: ChainableNode) {
      return booleanOp(ctx, 'boolean-intersect', a, b);
    },
    xor(a: ChainableNode, b: ChainableNode) {
      return booleanOp(ctx, 'boolean-xor', a, b);
    },
    clip(content: ChainableNode, mask: ChainableNode) {
      const nodeId = ctx.graph.addNode({ type: 'clip', params: {} });
      ctx.graph.addEdge(content.nodeId, 'path', nodeId, 'path');
      ctx.graph.addEdge(mask.nodeId, 'path', nodeId, 'clip');
      return ChainableNode.fromExisting(ctx, nodeId);
    },
    group(...nodes: ChainableNode[]) {
      const nodeId = ctx.graph.addNode({ type: 'group', params: {} });
      for (const node of nodes) {
        ctx.graph.addEdge(node.nodeId, 'path', nodeId, 'children');
      }
      return ChainableNode.fromExisting(ctx, nodeId);
    },
    join(a: ChainableNode, b: ChainableNode) {
      const nodeId = ctx.graph.addNode({ type: 'join-paths', params: {} });
      ctx.graph.addEdge(a.nodeId, 'path', nodeId, 'a');
      ctx.graph.addEdge(b.nodeId, 'path', nodeId, 'b');
      return ChainableNode.fromExisting(ctx, nodeId);
    },
  };
}

// -- Canvas --

function createCanvasOps(ctx: EvalContext) {
  return {
    canvas(w?: number, h?: number) {
      if (w !== undefined && h !== undefined) {
        ctx.canvasWidth = w;
        ctx.canvasHeight = h;
      }
      return { width: ctx.canvasWidth, height: ctx.canvasHeight };
    },
  };
}

// -- History --

function createHistoryOps(ctx: EvalContext) {
  return {
    undo(n = 1) {
      const affected: string[] = [];
      for (let i = 0; i < n; i++) {
        affected.push(...ctx.history.undo(ctx.graph));
      }
      return affected;
    },
    redo(n = 1) {
      const affected: string[] = [];
      for (let i = 0; i < n; i++) {
        affected.push(...ctx.history.redo(ctx.graph));
      }
      return affected;
    },
    history(n?: number) {
      const entries = ctx.history.getEntries();
      if (n !== undefined) {
        return entries.slice(-n);
      }
      return [...entries];
    },
  };
}

// -- DAG manipulation --

function createDagOps(ctx: EvalContext) {
  return {
    mute(node: ChainableNode) {
      ctx.graph.setMuted(node.nodeId, true);
    },
    unmute(node: ChainableNode) {
      ctx.graph.setMuted(node.nodeId, false);
    },
    toggle(node: ChainableNode) {
      ctx.graph.setMuted(node.nodeId, !ctx.graph.isMuted(node.nodeId));
    },
    remove(node: ChainableNode) {
      ctx.graph.removeNode(node.nodeId);
    },
    set(node: ChainableNode, param: string, value: unknown) {
      ctx.graph.setParam(node.nodeId, param, value);
    },
  };
}

// -- File I/O and Preview --

function createFileOps(ctx: EvalContext) {
  let previewManager: PreviewManager | undefined;

  return {
    open(filePath: string) {
      openFile(ctx, filePath);
    },
    save(filePath?: string) {
      saveFile(ctx, filePath);
    },
    preview(pathOrFalse?: string | false) {
      if (pathOrFalse === false) {
        previewManager?.dispose();
        previewManager = undefined;
        ctx.previewPath = undefined;
        return undefined;
      }
      if (typeof pathOrFalse === 'string') {
        previewManager?.dispose();
        previewManager = new PreviewManager(pathOrFalse);
        ctx.previewPath = pathOrFalse;
      }
      return ctx.previewPath;
    },
  };
}

// -- Inspection --

function createInspectionOps(ctx: EvalContext) {
  return {
    nodes() {
      console.log(formatNodesTable(ctx));
      return ctx.graph
        .topologicalOrder()
        .map((id) => ctx.graph.getNode(id))
        .filter(Boolean);
    },
    edges() {
      console.log(formatEdgesTable(ctx));
      return ctx.graph.getEdges();
    },
    tree() {
      console.log(formatDAGTree(ctx));
    },
    info(node: ChainableNode) {
      return ctx.graph.getNode(node.nodeId);
    },
  };
}

// -- Public API --

export interface GlobalBindings {
  // Generators
  rect: ReturnType<typeof createGenerators>['rect'];
  ellipse: ReturnType<typeof createGenerators>['ellipse'];
  circle: ReturnType<typeof createGenerators>['circle'];
  polygon: ReturnType<typeof createGenerators>['polygon'];
  star: ReturnType<typeof createGenerators>['star'];
  line: ReturnType<typeof createGenerators>['line'];
  arc: ReturnType<typeof createGenerators>['arc'];
  spiral: ReturnType<typeof createGenerators>['spiral'];
  arrow: ReturnType<typeof createGenerators>['arrow'];
  path: ReturnType<typeof createGenerators>['path'];
  text: ReturnType<typeof createGenerators>['text'];
  mesh: ReturnType<typeof createGenerators>['mesh'];
  // Multi-node
  union: ReturnType<typeof createMultiNodeOps>['union'];
  subtract: ReturnType<typeof createMultiNodeOps>['subtract'];
  intersect: ReturnType<typeof createMultiNodeOps>['intersect'];
  xor: ReturnType<typeof createMultiNodeOps>['xor'];
  clip: ReturnType<typeof createMultiNodeOps>['clip'];
  group: ReturnType<typeof createMultiNodeOps>['group'];
  join: ReturnType<typeof createMultiNodeOps>['join'];
  // Canvas
  canvas: ReturnType<typeof createCanvasOps>['canvas'];
  // History
  undo: ReturnType<typeof createHistoryOps>['undo'];
  redo: ReturnType<typeof createHistoryOps>['redo'];
  history: ReturnType<typeof createHistoryOps>['history'];
  // DAG
  mute: ReturnType<typeof createDagOps>['mute'];
  unmute: ReturnType<typeof createDagOps>['unmute'];
  toggle: ReturnType<typeof createDagOps>['toggle'];
  remove: ReturnType<typeof createDagOps>['remove'];
  set: ReturnType<typeof createDagOps>['set'];
  // Inspection
  nodes: ReturnType<typeof createInspectionOps>['nodes'];
  edges: ReturnType<typeof createInspectionOps>['edges'];
  tree: ReturnType<typeof createInspectionOps>['tree'];
  info: ReturnType<typeof createInspectionOps>['info'];
  // File I/O and Preview
  open: ReturnType<typeof createFileOps>['open'];
  save: ReturnType<typeof createFileOps>['save'];
  preview: ReturnType<typeof createFileOps>['preview'];
  // Passthrough
  Math: typeof Math;
  console: typeof console;
}

export function createGlobals(ctx: EvalContext): GlobalBindings {
  return {
    ...createGenerators(ctx),
    ...createMultiNodeOps(ctx),
    ...createCanvasOps(ctx),
    ...createHistoryOps(ctx),
    ...createDagOps(ctx),
    ...createInspectionOps(ctx),
    ...createFileOps(ctx),
    Math,
    console,
  };
}
