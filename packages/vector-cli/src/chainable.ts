/**
 * @file ChainableNode — fluent API wrapper for graph node operations
 *
 * Accessed via: Every CLI command — rect(100,50).fill("#f00").export("svg")
 * Assumptions: each method adds exactly one node and one edge (source→target on 'path' port),
 *   forming a linear chain. Terminal methods execute the graph and extract results.
 */

import {
  type BlendMode,
  type BoundingBox,
  computeBounds,
  isSceneItem,
  pathArea,
  pathLength,
  sceneToSvg,
} from 'vector-engine';
import type { EvalContext } from './context';

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

  trim(start = 0, end = 1): ChainableNode {
    return this.chain('trimPath', { start, end });
  }

  reverse(): ChainableNode {
    return this.chain('reversePath', {});
  }

  close(): ChainableNode {
    return this.chain('closeOpen', {});
  }

  dash(dashArray: number[], dashOffset = 0): ChainableNode {
    return this.chain('dashPath', { dashArray: JSON.stringify(dashArray), dashOffset });
  }

  strokeToPath(width = 1): ChainableNode {
    return this.chain('strokeToPath', { width, cap: 'butt', join: 'miter' });
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

  /** Execute graph and return SVG string. */
  svg(): string {
    const result = this.ctx.executor.execute(this.ctx.graph);
    return sceneToSvg(result.scene);
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
