/**
 * @file ChainableNode — fluent API wrapper for graph node operations
 *
 * Accessed via: Every CLI command — rect(100,50).fill("#f00").export("svg")
 * Assumptions: each method adds exactly one node and one edge (source→target on 'path' port),
 *   forming a linear chain. Terminal methods execute the graph and extract results.
 */

import { writeFileSync } from 'node:fs';
import { type BlendMode, type BoundingBox, computeBounds, isSceneItem, pathArea, pathLength } from 'vector-engine';
import { type EvalContext, executeAndRender } from './context';
import { svgToPng } from './png';

export class ChainableNode {
  private constructor(
    private readonly ctx: EvalContext,
    readonly nodeId: string,
  ) {}

  /** Create a generator node (entry point for a chain). */
  static generator(ctx: EvalContext, type: string, params: Record<string, unknown>): ChainableNode {
    const nodeId = ctx.graph.addNode({ type, params });
    return new ChainableNode(ctx, nodeId);
  }

  /** Wrap an already-existing node id (for multi-node ops like boolean, group). */
  static fromExisting(ctx: EvalContext, nodeId: string): ChainableNode {
    return new ChainableNode(ctx, nodeId);
  }

  /** Add a new node, connect it to the current node, return a new ChainableNode. */
  private chain(type: string, params: Record<string, unknown>): ChainableNode {
    const newId = this.ctx.graph.addNode({ type, params });
    this.ctx.graph.addEdge(this.nodeId, 'path', newId, 'path');
    return new ChainableNode(this.ctx, newId);
  }

  // -- Style --

  fill(color: string): ChainableNode {
    return this.chain('fill', { fillType: 'solid', color });
  }

  stroke(color: string, width = 1): ChainableNode {
    return this.chain('stroke', { color, width, cap: 'butt', join: 'miter' });
  }

  opacity(value: number): ChainableNode {
    return this.chain('opacity', { value });
  }

  blend(mode: BlendMode): ChainableNode {
    return this.chain('blendMode', { mode });
  }

  shadow(color = '#00000066', offsetX = 2, offsetY = 4, blur = 6): ChainableNode {
    return this.chain('shadow', { color, offsetX, offsetY, blur });
  }

  blur(radius: number): ChainableNode {
    return this.chain('blur', { radius });
  }

  // -- Transform --

  translate(dx: number, dy: number): ChainableNode {
    return this.chain('translate', { dx, dy });
  }

  rotate(angle: number, originX = 0, originY = 0): ChainableNode {
    return this.chain('rotate', { angle, originX, originY });
  }

  scale(sx: number, sy?: number): ChainableNode {
    return this.chain('scale', { sx, sy: sy ?? sx, originX: 0, originY: 0 });
  }

  skew(ax: number, ay = 0): ChainableNode {
    return this.chain('skew', { ax, ay });
  }

  // -- Path ops --

  roundCorners(radius: number): ChainableNode {
    return this.chain('roundCorners', { radius });
  }

  chamfer(radius: number): ChainableNode {
    return this.chain('chamfer', { radius });
  }

  smooth(smoothness = 1): ChainableNode {
    return this.chain('smooth', { smoothness });
  }

  offset(distance: number): ChainableNode {
    return this.chain('offset', { distance });
  }

  /**
   * Reduce redundant points, then run the WASM geometric simplify (self-intersection
   * removal). Higher tolerance drops more points; tolerance 0 is a near-identity.
   *
   * `method` picks the decimation algorithm (default 'rdp'):
   *   - 'rdp' (Ramer-Douglas-Peucker): `tolerance` is the max perpendicular distance any
   *     dropped point may deviate from the simplified polyline (a hard deviation bound).
   *   - 'vw' (Visvalingam-Whyatt): `tolerance` is the minimum effective triangle AREA a
   *     vertex must have to survive. VW keeps visually salient vertices but gives no
   *     per-point deviation bound — the threshold is an area, not a distance.
   */
  simplify(tolerance = 1, opts?: { method?: 'rdp' | 'vw' }): ChainableNode {
    return this.chain('simplify', { tolerance, method: opts?.method ?? 'rdp' });
  }

  trim(start = 0, end = 1): ChainableNode {
    return this.chain('trimPath', { start, end });
  }

  reverse(): ChainableNode {
    // Node type must match the registry name (basic-ops.ts: 'reverse-path'); the old
    // 'reversePath' hit "Unknown node type" in GraphExecutor — .reverse() was a no-op.
    return this.chain('reverse-path', {});
  }

  close(): ChainableNode {
    // Registry name is 'close-open-path' (basic-ops.ts); the old 'closeOpen' was unknown.
    return this.chain('close-open-path', { action: 'close' });
  }

  dash(dashArray: number[], dashOffset = 0): ChainableNode {
    return this.chain('dashPath', { dashArray: JSON.stringify(dashArray), dashOffset });
  }

  strokeToPath(width = 1): ChainableNode {
    return this.chain('strokeToPath', { width, cap: 'butt', join: 'miter' });
  }

  /**
   * Lay real glyph outlines of `text` along this path, following its tangent.
   *
   * Consumes the current node as the baseline curve and produces a compound path
   * of per-glyph outlines (true text-on-path, not positioned <text> annotations).
   * Requires a font registered in the engine; with no font the result is empty.
   */
  textOnPath(
    text: string,
    opts: { fontSize?: number; fontUrl?: string; letterSpacing?: number; startOffset?: number } = {},
  ): ChainableNode {
    return this.chain('textOnPath', {
      text,
      fontSize: opts.fontSize ?? 48,
      fontUrl: opts.fontUrl ?? '',
      letterSpacing: opts.letterSpacing ?? 0,
      startOffset: opts.startOffset ?? 0,
    });
  }

  // -- Deformations --

  roughen(size: number, detail = 5): ChainableNode {
    return this.chain('roughen', { size, detail, type: 'corner', seed: 42 });
  }

  zigzag(size: number, ridgesPerSegment = 5): ChainableNode {
    return this.chain('zigzag', { size, ridgesPerSegment, type: 'corner' });
  }

  puckerBloat(amount: number): ChainableNode {
    return this.chain('puckerBloat', { amount });
  }

  twist(angle: number): ChainableNode {
    return this.chain('twist', { angle });
  }

  warp(bend: number, warpType: 'arc' | 'wave' | 'flag' | 'bulge' = 'arc'): ChainableNode {
    return this.chain('warp', { bend, warpType });
  }

  variableStroke(widthPoints: Array<{ offset: number; width: number }>): ChainableNode {
    return this.chain('variableStroke', { widthPoints });
  }

  envelopeDistort(mesh: unknown): ChainableNode {
    return this.chain('envelopeDistort', { mesh });
  }

  subdivide(segmentIndex = 0, t = 0.5): ChainableNode {
    return this.chain('subdivide', { segmentIndex, t });
  }

  addPoint(segmentIndex = 0, t = 0.5): ChainableNode {
    return this.chain('addPoint', { segmentIndex, t });
  }

  removePoint(pointIndex: number): ChainableNode {
    return this.chain('removePoint', { pointIndex });
  }

  convertPoint(pointIndex: number, targetType: 'corner' | 'smooth' | 'symmetric' = 'smooth'): ChainableNode {
    return this.chain('convertPoint', { pointIndex, targetType });
  }

  enforceWinding(direction: 'cw' | 'ccw' = 'cw'): ChainableNode {
    return this.chain('enforceWinding', { direction });
  }

  // -- Terminal operations --

  /** Execute graph and export to format. Returns the output string. */
  export(format: 'svg' | 'json'): string {
    if (format === 'json') {
      return JSON.stringify(this.ctx.graph.toJSON(), null, 2);
    }
    return this.svg();
  }

  /** Execute graph and return SVG string (with auto-fit canvas). */
  svg(): string {
    return executeAndRender(this.ctx);
  }

  /** Execute graph and return bounding box of this node's output path. */
  bounds(): BoundingBox {
    const path = this.executePath();
    if (!path) return { x: 0, y: 0, width: 0, height: 0 };
    return computeBounds(path.commands);
  }

  /** Execute graph and return total path length. */
  length(): number {
    const path = this.executePath();
    if (!path) return 0;
    return pathLength(path.commands);
  }

  /** Execute graph and return absolute path area. */
  area(): number {
    const path = this.executePath();
    if (!path) return 0;
    return Math.abs(pathArea(path.commands));
  }

  /** Execute graph and write PNG via @resvg/resvg-js. Writes to file or stdout. */
  png(filename?: string, width = 400): void {
    const svg = this.svg();
    const buf = svgToPng(svg, width);
    if (filename) {
      writeFileSync(filename, buf);
    } else {
      process.stdout.write(buf);
    }
  }

  /**
   * Execute the graph and extract the path from the terminal scene item
   * that corresponds to this node's chain.
   */
  private executePath() {
    const result = this.ctx.executor.execute(this.ctx.graph);
    for (const item of result.scene.items) {
      if (isSceneItem(item) && item.id === this.nodeId) {
        return item.path;
      }
    }
    // Fallback: return first scene item's path
    for (const item of result.scene.items) {
      if (isSceneItem(item)) {
        return item.path;
      }
    }
    return undefined;
  }
}
