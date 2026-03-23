/**
 * @file Graph serialization — save/load VectorGraphFile as JSON
 *
 * Accessed via: Auto-save, explicit save (Cmd+S), file open
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Undo/Redo Persistence
 */

import { HistoryManager } from '../graph/history';
import { VectorGraphModel } from '../graph/vector-graph';
import type { GraphOperation, VectorGraphFile, VectorGraphMeta, VectorGraphState } from './types';

export function serializeGraph(
  model: VectorGraphModel,
  meta: VectorGraphMeta,
  history?: HistoryManager,
): VectorGraphFile {
  const json = model.toJSON();
  const base: VectorGraphState = {
    canvas: json.canvas,
    nodes: json.nodes,
    edges: json.edges,
    muted: json.muted,
  };
  const operations: GraphOperation[] = history
    ? history.getEntries().map((e) => ({
        timestamp: e.timestamp,
        description: e.description,
        diffs: e.diffs,
      }))
    : [];
  const undoPointer = history ? history.getPointer() : operations.length;
  return {
    version: 1,
    meta,
    base,
    operations,
    undoPointer,
    viewport: json.viewport,
  };
}

export function deserializeGraph(file: VectorGraphFile): {
  model: VectorGraphModel;
  meta: VectorGraphMeta;
  history: HistoryManager;
} {
  const model = VectorGraphModel.fromJSON({
    version: file.version,
    id: crypto.randomUUID(),
    name: file.meta.componentPath,
    canvas: file.base.canvas,
    nodes: file.base.nodes,
    edges: file.base.edges,
    muted: file.base.muted,
    viewport: file.viewport,
  });
  const history = new HistoryManager();
  // Replay operations up to undoPointer
  for (let i = 0; i < file.undoPointer && i < file.operations.length; i++) {
    const op = file.operations[i];
    history.replayForward(model, op.diffs, op.description, op.timestamp);
  }
  return { model, meta: file.meta, history };
}
