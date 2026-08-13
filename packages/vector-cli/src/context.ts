/**
 * @file EvalContext — shared session state for CLI
 *
 * Accessed via: All CLI commands — holds graph, executor, history, registry
 */

import {
  computeBounds,
  createDefaultRegistry,
  GraphExecutor,
  HistoryManager,
  isSceneItem,
  type NodeRegistry,
  type SceneGraph,
  sceneToSvg,
  VectorGraphModel,
} from 'vector-engine';
import type { PathOpsBackend } from 'vector-wasm';

export interface TextAnnotation {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  fill: string;
  anchor: string;
}

export interface EvalContext {
  graph: VectorGraphModel;
  registry: NodeRegistry;
  executor: GraphExecutor;
  history: HistoryManager;
  currentFile?: string;
  previewPath?: string;
  canvasWidth: number;
  canvasHeight: number;
  /** When true, canvas was explicitly set by user — don't auto-fit */
  canvasExplicit: boolean;
  /** Data piped via stdin (available as `input` in sandbox) */
  stdinData?: string;
  /** Raw SVG text elements to append to output */
  textAnnotations: TextAnnotation[];
}

/**
 * Build a fresh CLI session.
 *
 * @param pathOps - PathOps backend for boolean/offset/dash/strokeToPath/simplify
 *   nodes. Omit (the default) to get the MockPathOps no-op stub used by unit
 *   tests. The CLI entrypoint passes a real CanvasKit+Clipper backend it has
 *   already awaited (initCanvasKit is async; createContext stays synchronous so
 *   the chainable DSL and ~100 sync test callsites are unaffected).
 */
export function createContext(width?: number, height?: number, pathOps?: PathOpsBackend): EvalContext {
  const explicit = width !== undefined && height !== undefined;
  const w = width ?? 100;
  const h = height ?? 100;
  const registry = createDefaultRegistry(pathOps);
  const graph = VectorGraphModel.create(crypto.randomUUID(), 'untitled', w, h);
  return {
    graph,
    registry,
    executor: new GraphExecutor(registry),
    history: new HistoryManager(),
    canvasWidth: w,
    canvasHeight: h,
    canvasExplicit: explicit,
    textAnnotations: [],
  };
}

/** Auto-fit scene canvas to content bounding box with proportional padding */
function autoFitCanvas(scene: SceneGraph, annotations: TextAnnotation[]): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of scene.items) {
    if (isSceneItem(item) && item.visible) {
      const b = computeBounds(item.path.commands);
      if (b.width === 0 && b.height === 0) continue;
      const t = item.transform;
      const corners = [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x, y: b.y + b.height },
        { x: b.x + b.width, y: b.y + b.height },
      ];
      for (const p of corners) {
        const tx = t[0] * p.x + t[2] * p.y + t[4];
        const ty = t[1] * p.x + t[3] * p.y + t[5];
        if (tx < minX) minX = tx;
        if (ty < minY) minY = ty;
        if (tx > maxX) maxX = tx;
        if (ty > maxY) maxY = ty;
      }
    }
  }

  // Include text annotations in bounds
  for (const t of annotations) {
    const estimatedWidth = t.text.length * t.fontSize * 0.6;
    const x = t.anchor === 'middle' ? t.x - estimatedWidth / 2 : t.x;
    const y = t.y - t.fontSize;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + estimatedWidth > maxX) maxX = x + estimatedWidth;
    if (t.y > maxY) maxY = t.y;
  }

  if (minX === Infinity) return; // no visible items

  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const pad = Math.max(2, Math.round(Math.max(contentW, contentH) * 0.03));
  scene.canvas = {
    x: Math.floor(minX - pad),
    y: Math.floor(minY - pad),
    width: Math.ceil(contentW + pad * 2),
    height: Math.ceil(contentH + pad * 2),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function executeAndRender(ctx: EvalContext): string {
  const result = ctx.executor.execute(ctx.graph);
  if (!ctx.canvasExplicit) {
    autoFitCanvas(result.scene, ctx.textAnnotations);
  }
  let svg = sceneToSvg(result.scene);
  if (ctx.textAnnotations.length > 0) {
    const textElements = ctx.textAnnotations
      .map(
        (t) =>
          `<text x="${t.x}" y="${t.y}" font-size="${t.fontSize}" font-family="${escapeHtml(t.fontFamily)}" fill="${escapeHtml(t.fill)}" text-anchor="${t.anchor}" xml:space="preserve">${escapeHtml(t.text)}</text>`,
      )
      .join('');
    svg = svg.replace('</svg>', `${textElements}</svg>`);
  }
  return svg;
}
