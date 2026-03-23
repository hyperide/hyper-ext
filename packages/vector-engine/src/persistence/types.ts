/**
 * @file Persistence types — VectorGraphFile and related interfaces
 *
 * Accessed via: File save/load operations
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Undo/Redo Persistence
 */

import type { GraphDiff, GraphEdge, GraphNode } from '../types';

export interface VectorGraphMeta {
  componentPath: string;
  svgElementId?: string;
  lastExportTimestamp?: number;
}

export interface VectorGraphState {
  canvas: { width: number; height: number };
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
  muted: string[];
}

export interface GraphOperation {
  timestamp: number;
  description: string;
  diffs: GraphDiff[];
}

export interface VectorGraphFile {
  version: number;
  meta: VectorGraphMeta;
  base: VectorGraphState;
  operations: GraphOperation[];
  undoPointer: number;
  viewport: { zoom: number; panX: number; panY: number };
}
