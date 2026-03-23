/**
 * @file File commands — open/save/export for .graph, .graph.json, .svg, .fig
 *
 * Accessed via: open("file.graph"), save("file.graph"), etc.
 * Assumptions: graph is acyclic — cycle-creating edges from imports are silently skipped
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §CLI File I/O
 */

import { readFileSync, writeFileSync } from 'node:fs';
import {
  deserializeGraph,
  deserializeGraphBinary,
  HistoryManager,
  type ImportResult,
  mapFigToGraph,
  parseFigFile,
  serializeGraph,
  serializeGraphBinary,
  svgToGraph,
  VectorGraphModel,
} from 'vector-engine';
import type { EvalContext } from '../context';

function buildGraphFromImport(imported: ImportResult): VectorGraphModel {
  const graph = VectorGraphModel.create(crypto.randomUUID(), 'imported', imported.canvas.width, imported.canvas.height);
  for (const node of imported.nodes) {
    graph.addNodeWithId(node.id, { type: node.type, params: node.params });
  }
  for (const edge of imported.edges) {
    try {
      graph.addEdge(edge.source, edge.sourcePort, edge.target, edge.targetPort);
    } catch {
      // skip cycle-creating edges
    }
  }
  return graph;
}

export function openFile(ctx: EvalContext, filepath: string): void {
  if (filepath.endsWith('.graph.json') || (filepath.endsWith('.json') && !filepath.endsWith('.graph'))) {
    const raw = readFileSync(filepath, 'utf-8');
    const json = JSON.parse(raw);
    const { model, history } = deserializeGraph(json);
    ctx.graph = model;
    ctx.history = history;
  } else if (filepath.endsWith('.graph')) {
    const data = readFileSync(filepath);
    const { model, history } = deserializeGraphBinary(new Uint8Array(data));
    ctx.graph = model;
    ctx.history = history;
  } else if (filepath.endsWith('.svg')) {
    const svg = readFileSync(filepath, 'utf-8');
    const imported = svgToGraph(svg);
    ctx.graph = buildGraphFromImport(imported);
    ctx.history = new HistoryManager();
  } else if (filepath.endsWith('.fig')) {
    const data = readFileSync(filepath);
    const parsed = parseFigFile(data.buffer as ArrayBuffer);
    const imported = mapFigToGraph(parsed.nodes, parsed.canvas);
    ctx.graph = buildGraphFromImport(imported);
    ctx.history = new HistoryManager();
  } else {
    throw new Error(`Unsupported file format: ${filepath}`);
  }

  ctx.currentFile = filepath;
}

export function saveFile(ctx: EvalContext, filepath?: string): void {
  const target = filepath ?? ctx.currentFile;
  if (!target) {
    throw new Error('No file path provided and no current file set');
  }

  const meta = { componentPath: target };

  if (target.endsWith('.graph.json') || (target.endsWith('.json') && !target.endsWith('.graph'))) {
    const file = serializeGraph(ctx.graph, meta, ctx.history);
    writeFileSync(target, JSON.stringify(file, null, 2));
  } else if (target.endsWith('.graph')) {
    const bytes = serializeGraphBinary(ctx.graph, meta, ctx.history);
    writeFileSync(target, bytes);
  } else {
    throw new Error(`Unsupported file format for save: ${target}`);
  }

  ctx.currentFile = target;
}
