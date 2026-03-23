/**
 * @file Apply reconciliation — convert diff to undoable graph operations
 *
 * Accessed via: After JSON edit reconciliation — applies diff to live graph
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Graph Reconciliation
 */

import type { HistoryManager } from '../graph/history';
import type { VectorGraphModel } from '../graph/vector-graph';
import type { ReconciliationDiff } from './diff';

export function applyReconciliation(graph: VectorGraphModel, history: HistoryManager, diff: ReconciliationDiff): void {
  let hasChanges = false;

  // Count total changes to decide whether to record history
  const totalChanges =
    diff.added.nodes.length +
    diff.removed.nodeIds.length +
    diff.added.edges.length +
    diff.removed.edgeIds.length +
    diff.modified.params.length +
    diff.modified.muted.added.length +
    diff.modified.muted.removed.length;

  if (totalChanges === 0) return;

  history.begin('Reconciled from JSON edit');

  // Add nodes
  for (const node of diff.added.nodes) {
    graph.addNodeWithId(node.id, { type: node.type, params: node.params, position: node.position });
    history.recordAddNode(node);
    hasChanges = true;
  }

  // Remove nodes
  for (const nodeId of diff.removed.nodeIds) {
    const node = graph.getNode(nodeId);
    if (node) {
      const isMuted = graph.isMuted(nodeId);
      const removedEdges = graph.removeNode(nodeId);
      history.recordRemoveNode(node, removedEdges, isMuted);
      hasChanges = true;
    }
  }

  // Add edges
  for (const edge of diff.added.edges) {
    try {
      graph.addEdgeWithId(edge.id, edge.source, edge.sourcePort, edge.target, edge.targetPort);
      history.recordAddEdge(edge);
      hasChanges = true;
    } catch {
      // Edge would create a cycle — skip silently
    }
  }

  // Remove edges
  for (const edgeId of diff.removed.edgeIds) {
    // Collect the full edge object before removal for history recording
    const allEdges = graph.getEdges();
    const edge = allEdges.find((e) => e.id === edgeId);
    graph.removeEdge(edgeId);
    if (edge) {
      history.recordRemoveEdge(edge);
      hasChanges = true;
    }
  }

  // Param changes
  for (const { nodeId, changes } of diff.modified.params) {
    for (const [param, { old: oldValue, new: newValue }] of Object.entries(changes)) {
      graph.setParam(nodeId, param, newValue);
      history.recordParamChange(nodeId, param, oldValue, newValue);
      hasChanges = true;
    }
  }

  // Mute additions
  for (const nodeId of diff.modified.muted.added) {
    graph.setMuted(nodeId, true);
    history.recordMuteNode(nodeId, true);
    hasChanges = true;
  }

  // Mute removals
  for (const nodeId of diff.modified.muted.removed) {
    graph.setMuted(nodeId, false);
    history.recordMuteNode(nodeId, false);
    hasChanges = true;
  }

  if (hasChanges) {
    history.commit();
  }
}
