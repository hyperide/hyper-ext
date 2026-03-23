/**
 * @file Operation log — append-only history with compaction
 *
 * Accessed via: Persistence — stores undoable operations in VectorGraphFile
 * Tradeoffs: compaction reduces log size but loses granular undo for old operations
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Undo/Redo Persistence
 */

import type { GraphDiff } from '../types';
import type { GraphOperation, VectorGraphState } from './types';

export class OperationLog {
  private ops: GraphOperation[] = [];

  get length(): number {
    return this.ops.length;
  }

  get operations(): readonly GraphOperation[] {
    return this.ops;
  }

  append(op: GraphOperation): void {
    this.ops.push(op);
  }

  /** Compact old operations into base state, keeping last `keepCount` entries */
  compact(
    baseState: VectorGraphState,
    keepCount: number,
  ): {
    newBase: VectorGraphState;
    operations: GraphOperation[];
  } {
    if (this.ops.length <= keepCount) {
      return { newBase: baseState, operations: [...this.ops] };
    }
    const toCompact = this.ops.slice(0, this.ops.length - keepCount);
    const remaining = this.ops.slice(this.ops.length - keepCount);
    const newBase = applyOperationsToState(baseState, toCompact);
    this.ops = remaining;
    return { newBase, operations: remaining };
  }
}

/** Apply operations forward onto a plain state object */
function applyOperationsToState(state: VectorGraphState, operations: GraphOperation[]): VectorGraphState {
  const result: VectorGraphState = JSON.parse(JSON.stringify(state));
  for (const op of operations) {
    for (const diff of op.diffs) {
      applyDiffToState(result, diff);
    }
  }
  return result;
}

function applyDiffToState(state: VectorGraphState, diff: GraphDiff): void {
  switch (diff.kind) {
    case 'addNode':
      state.nodes[diff.node.id] = diff.node;
      break;
    case 'removeNode':
      delete state.nodes[diff.node.id];
      for (const edge of diff.removedEdges) {
        state.edges = state.edges.filter((e) => e.id !== edge.id);
      }
      break;
    case 'paramChange':
      if (state.nodes[diff.nodeId]) {
        state.nodes[diff.nodeId].params[diff.param] = diff.newValue;
      }
      break;
    case 'addEdge':
      state.edges.push(diff.edge);
      break;
    case 'removeEdge':
      state.edges = state.edges.filter((e) => e.id !== diff.edge.id);
      break;
    case 'muteNode':
      if (diff.muted) {
        if (!state.muted.includes(diff.nodeId)) state.muted.push(diff.nodeId);
      } else {
        state.muted = state.muted.filter((id) => id !== diff.nodeId);
      }
      break;
    case 'moveNode':
      if (state.nodes[diff.nodeId]) {
        state.nodes[diff.nodeId].position = diff.newPosition;
      }
      break;
  }
}
