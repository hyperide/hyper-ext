/**
 * @file Vector-engine MCP server — wraps the engine graph API as MCP tools
 *
 * Accessed via: MCP tools (vector_create_shape, vector_set_style, vector_path_op,
 *   vector_boolean, vector_export, vector_list_shapes). The engine node doc-comments
 *   already name this contract (mesh-from-path.ts etc.: "Accessed via: MCP tool ...").
 * Assumptions: stateful-handle model — each server owns ONE EvalContext session held in
 *   the persistent closure below; tools return nodeId handles that later tools consume,
 *   exactly like ChainableNode.fromExisting(ctx, nodeId). State must live in the session
 *   object (not the per-connection McpServer) so handles survive across tool calls.
 *
 * Transport: v1 ships in-process only (InMemoryTransport in tests / a host that owns the
 *   server instance). An HTTP transport (mirroring HyperMcpServer's stateless
 *   StreamableHTTP) is a deliberate v2 deferral — see PR.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ChainableNode } from '../chainable';
import { createContext, type EvalContext } from '../context';

/** Standard MCP tool result shape used across all tools. */
type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(payload: unknown): ToolResult {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return { content: [{ type: 'text', text }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Resolve a handle to a live node, or throw a clean (non-crash) error. */
function resolve(ctx: EvalContext, handle: string): ChainableNode {
  if (!ctx.graph.getNode(handle)) {
    throw new Error(`Unknown handle "${handle}". Create a shape first or call vector_list_shapes.`);
  }
  return ChainableNode.fromExisting(ctx, handle);
}

/**
 * Register a tool from a raw Zod shape with a fully-typed handler.
 *
 * This is the ONE contained boundary for a known type-level false-positive: under
 * `moduleResolution: bundler`, tsgo flags zod 4.3.x schemas as not assignable to the
 * MCP SDK 1.27's `$ZodType` brand (the two see different `zod/v4/core` declaration
 * identities). The runtime is correct and fully covered by mcp.test.ts (HYP-508);
 * the SDK validates args against the shape at call time. Handlers stay strictly typed
 * via `z.infer` — only this single registration line is suppressed.
 */
function registerVectorTool<T extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  shape: T,
  handler: (args: z.infer<z.ZodObject<T>>) => ToolResult,
): void {
  // @ts-expect-error -- zod4 <-> MCP-SDK 1.27 $ZodType brand mismatch under bundler resolution; see jsdoc above.
  server.registerTool(name, { description, inputSchema: shape }, handler);
}

/**
 * Build an MCP server bound to a single fresh engine session.
 *
 * The EvalContext is captured here, in the persistent factory closure — NOT inside a
 * per-request McpServer — so node handles stay valid across separate tool calls.
 */
export function createVectorMcpServer(): McpServer {
  const ctx = createContext();
  const server = new McpServer({ name: 'vector-engine', version: '0.1.0' });

  // -- vector_create_shape: generators -------------------------------------
  registerVectorTool(
    server,
    'vector_create_shape',
    'Create a vector shape (generator node). Returns a handle (nodeId) to pass to other tools. ' +
      'Supported kinds: rect, ellipse, circle, polygon, star, line, arc, path.',
    {
      kind: z.enum(['rect', 'ellipse', 'circle', 'polygon', 'star', 'line', 'arc', 'path']),
      width: z.number().optional().describe('rect: width'),
      height: z.number().optional().describe('rect: height'),
      x: z.number().optional().describe('rect: top-left x (default 0)'),
      y: z.number().optional().describe('rect: top-left y (default 0)'),
      rx: z.number().optional().describe('ellipse: x radius'),
      ry: z.number().optional().describe('ellipse: y radius'),
      radius: z.number().optional().describe('circle/polygon/star/arc: radius'),
      cx: z.number().optional().describe('center x (default 0)'),
      cy: z.number().optional().describe('center y (default 0)'),
      sides: z.number().optional().describe('polygon: number of sides'),
      points: z.number().optional().describe('star: number of points'),
      innerRadius: z.number().optional().describe('star: inner radius'),
      x1: z.number().optional(),
      y1: z.number().optional(),
      x2: z.number().optional(),
      y2: z.number().optional(),
      startAngle: z.number().optional().describe('arc: start angle (deg)'),
      endAngle: z.number().optional().describe('arc: end angle (deg)'),
      d: z.string().optional().describe('path: SVG path data string'),
    },
    (args): ToolResult => {
      const a = args;
      const cx = a.cx ?? 0;
      const cy = a.cy ?? 0;
      let node: ChainableNode;
      switch (a.kind) {
        case 'rect':
          if (a.width === undefined || a.height === undefined) return fail('rect requires width and height.');
          node = ChainableNode.generator(ctx, 'rectangle', {
            width: a.width,
            height: a.height,
            x: a.x ?? 0,
            y: a.y ?? 0,
          });
          break;
        case 'ellipse':
          if (a.rx === undefined || a.ry === undefined) return fail('ellipse requires rx and ry.');
          node = ChainableNode.generator(ctx, 'ellipse', { rx: a.rx, ry: a.ry, cx, cy });
          break;
        case 'circle':
          if (a.radius === undefined) return fail('circle requires radius.');
          node = ChainableNode.generator(ctx, 'ellipse', { rx: a.radius, ry: a.radius, cx, cy });
          break;
        case 'polygon':
          if (a.sides === undefined || a.radius === undefined) return fail('polygon requires sides and radius.');
          node = ChainableNode.generator(ctx, 'polygon', { sides: a.sides, radius: a.radius, cx, cy });
          break;
        case 'star':
          if (a.points === undefined || a.radius === undefined || a.innerRadius === undefined)
            return fail('star requires points, radius (outer), and innerRadius.');
          node = ChainableNode.generator(ctx, 'star', {
            points: a.points,
            outerRadius: a.radius,
            innerRadius: a.innerRadius,
            cx,
            cy,
          });
          break;
        case 'line':
          if (a.x1 === undefined || a.y1 === undefined || a.x2 === undefined || a.y2 === undefined)
            return fail('line requires x1, y1, x2, y2.');
          node = ChainableNode.generator(ctx, 'line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 });
          break;
        case 'arc':
          if (a.radius === undefined || a.startAngle === undefined || a.endAngle === undefined)
            return fail('arc requires radius, startAngle, endAngle.');
          node = ChainableNode.generator(ctx, 'arc', {
            radius: a.radius,
            startAngle: a.startAngle,
            endAngle: a.endAngle,
            cx,
            cy,
          });
          break;
        case 'path':
          if (a.d === undefined) return fail('path requires d (SVG path data).');
          node = ChainableNode.generator(ctx, 'svgPath', { d: a.d });
          break;
        default:
          return fail(`Unsupported kind "${String(a.kind)}".`);
      }
      return ok({ handle: node.nodeId, kind: a.kind });
    },
  );

  // -- vector_set_style: fill / stroke / opacity ---------------------------
  registerVectorTool(
    server,
    'vector_set_style',
    'Apply a style to a shape. Returns a new handle for the styled result. ' +
      'At least one of fill / stroke / opacity must be provided.',
    {
      handle: z.string().describe('Handle from vector_create_shape or another tool'),
      fill: z.string().optional().describe('Solid fill color, e.g. #ff0000'),
      stroke: z.string().optional().describe('Stroke color, e.g. #000000'),
      strokeWidth: z.number().optional().describe('Stroke width (default 1)'),
      opacity: z.number().optional().describe('Opacity 0..1'),
    },
    (args): ToolResult => {
      try {
        if (args.fill === undefined && args.stroke === undefined && args.opacity === undefined) {
          return fail('vector_set_style requires at least one of fill, stroke, opacity.');
        }
        let node = resolve(ctx, args.handle);
        if (args.fill !== undefined) node = node.fill(args.fill);
        if (args.stroke !== undefined) node = node.stroke(args.stroke, args.strokeWidth ?? 1);
        if (args.opacity !== undefined) node = node.opacity(args.opacity);
        return ok({ handle: node.nodeId });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // -- vector_path_op: core single-input path operations -------------------
  registerVectorTool(
    server,
    'vector_path_op',
    'Apply a core single-input path operation to a shape. Returns a new handle. ' +
      'Ops: roundCorners (radius), offset (distance), smooth (smoothness).',
    {
      handle: z.string().describe('Handle to operate on'),
      op: z.enum(['roundCorners', 'offset', 'smooth']),
      radius: z.number().optional().describe('roundCorners: corner radius'),
      distance: z.number().optional().describe('offset: offset distance (negative insets)'),
      smoothness: z.number().optional().describe('smooth: smoothness (default 1)'),
    },
    (args): ToolResult => {
      try {
        const node = resolve(ctx, args.handle);
        let out: ChainableNode;
        switch (args.op) {
          case 'roundCorners':
            if (args.radius === undefined) return fail('roundCorners requires radius.');
            out = node.roundCorners(args.radius);
            break;
          case 'offset':
            if (args.distance === undefined) return fail('offset requires distance.');
            out = node.offset(args.distance);
            break;
          case 'smooth':
            out = node.smooth(args.smoothness ?? 1);
            break;
          default:
            return fail(`Unsupported op "${String(args.op)}".`);
        }
        return ok({ handle: out.nodeId });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // -- vector_boolean: two-input boolean ops -------------------------------
  registerVectorTool(
    server,
    'vector_boolean',
    'Combine two shapes with a boolean operation. Returns a new handle. ' +
      'Ops: union, subtract (a minus b), intersect, xor.',
    {
      op: z.enum(['union', 'subtract', 'intersect', 'xor']),
      a: z.string().describe('First operand handle'),
      b: z.string().describe('Second operand handle'),
    },
    (args): ToolResult => {
      try {
        const a = resolve(ctx, args.a);
        const b = resolve(ctx, args.b);
        const nodeId = ctx.graph.addNode({ type: `boolean-${args.op}`, params: {} });
        ctx.graph.addEdge(a.nodeId, 'path', nodeId, 'a');
        ctx.graph.addEdge(b.nodeId, 'path', nodeId, 'b');
        return ok({ handle: nodeId });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // -- vector_export: render terminal output -------------------------------
  registerVectorTool(
    server,
    'vector_export',
    'Execute the graph and export. format=svg returns an SVG document string; ' +
      'format=json returns the serialized graph. Pass a handle to anchor the chain (recommended); ' +
      'export always renders the full scene.',
    {
      handle: z.string().optional().describe('Handle to validate before export (optional)'),
      format: z.enum(['svg', 'json']).optional().describe('Output format (default svg)'),
    },
    (args): ToolResult => {
      try {
        if (args.handle !== undefined) resolve(ctx, args.handle);
        const format = args.format ?? 'svg';
        if (format === 'json') return ok(ctx.graph.toJSON());
        return ok(ChainableNode.fromExisting(ctx, args.handle ?? firstNodeId(ctx)).svg());
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // -- vector_list_shapes: introspect the session --------------------------
  registerVectorTool(
    server,
    'vector_list_shapes',
    'List all nodes (shapes/ops) currently in the session graph, with their handles and types.',
    {},
    (): ToolResult => {
      const shapes = ctx.graph
        .topologicalOrder()
        .map((id) => {
          const node = ctx.graph.getNode(id);
          return node ? { handle: id, type: node.type } : undefined;
        })
        .filter((s): s is { handle: string; type: string } => s !== undefined);
      return ok({ shapes });
    },
  );

  return server;
}

/** First node in topological order — fallback anchor for export without a handle. */
function firstNodeId(ctx: EvalContext): string {
  const order = ctx.graph.topologicalOrder();
  if (order.length === 0) throw new Error('No shapes in session. Create a shape before exporting.');
  return order[0];
}
