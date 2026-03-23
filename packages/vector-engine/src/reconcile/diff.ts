/**
 * @file Graph reconciliation diff — structural comparison between graph states
 *
 * Accessed via: JSON edit reconciliation, AI agent graph edits
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Graph Reconciliation
 */

import type { VectorGraphState } from '../persistence/types';
import type { GraphEdge, GraphNode } from '../types';

export interface ReconciliationDiff {
  added: { nodes: GraphNode[]; edges: GraphEdge[] };
  removed: { nodeIds: string[]; edgeIds: string[] };
  modified: {
    params: Array<{ nodeId: string; changes: Record<string, { old: unknown; new: unknown }> }>;
    reordered: Array<{
      edgeId: string;
      old: { source: string; target: string };
      new: { source: string; target: string };
    }>;
    muted: { added: string[]; removed: string[] };
  };
  meta: { canvasChanged: boolean; viewportChanged: boolean };
}

export function computeReconciliationDiff(current: VectorGraphState, modified: VectorGraphState): ReconciliationDiff {
  const diff: ReconciliationDiff = {
    added: { nodes: [], edges: [] },
    removed: { nodeIds: [], edgeIds: [] },
    modified: { params: [], reordered: [], muted: { added: [], removed: [] } },
    meta: {
      canvasChanged: current.canvas.width !== modified.canvas.width || current.canvas.height !== modified.canvas.height,
      // VectorGraphState has no viewport field — always false
      viewportChanged: false,
    },
  };

  // Nodes: compare by ID
  const currentNodeIds = new Set(Object.keys(current.nodes));
  const modifiedNodeIds = new Set(Object.keys(modified.nodes));

  for (const id of modifiedNodeIds) {
    if (!currentNodeIds.has(id)) {
      diff.added.nodes.push(modified.nodes[id]);
    }
  }
  for (const id of currentNodeIds) {
    if (!modifiedNodeIds.has(id)) {
      diff.removed.nodeIds.push(id);
    }
  }

  // Param changes for nodes present in both states
  for (const id of currentNodeIds) {
    if (!modifiedNodeIds.has(id)) continue;
    const oldNode = current.nodes[id];
    const newNode = modified.nodes[id];
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    const allKeys = new Set([...Object.keys(oldNode.params), ...Object.keys(newNode.params)]);
    for (const key of allKeys) {
      if (JSON.stringify(oldNode.params[key]) !== JSON.stringify(newNode.params[key])) {
        changes[key] = { old: oldNode.params[key], new: newNode.params[key] };
      }
    }
    if (Object.keys(changes).length > 0) {
      diff.modified.params.push({ nodeId: id, changes });
    }
  }

  // Edges: match by ID — detect added, removed, and reconnected
  const currentEdgeMap = new Map(current.edges.map((e) => [e.id, e]));
  const modifiedEdgeMap = new Map(modified.edges.map((e) => [e.id, e]));

  for (const [id, edge] of modifiedEdgeMap) {
    if (!currentEdgeMap.has(id)) {
      diff.added.edges.push(edge);
    } else {
      const old = currentEdgeMap.get(id);
      if (old && (old.source !== edge.source || old.target !== edge.target)) {
        diff.modified.reordered.push({
          edgeId: id,
          old: { source: old.source, target: old.target },
          new: { source: edge.source, target: edge.target },
        });
      }
    }
  }
  for (const id of currentEdgeMap.keys()) {
    if (!modifiedEdgeMap.has(id)) {
      diff.removed.edgeIds.push(id);
    }
  }

  // Mute changes
  const currentMuted = new Set(current.muted);
  const modifiedMuted = new Set(modified.muted);
  for (const id of modifiedMuted) {
    if (!currentMuted.has(id)) diff.modified.muted.added.push(id);
  }
  for (const id of currentMuted) {
    if (!modifiedMuted.has(id)) diff.modified.muted.removed.push(id);
  }

  return diff;
}
