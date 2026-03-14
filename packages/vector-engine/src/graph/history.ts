/**
 * @file History manager — undo/redo via graph diff snapshots
 *
 * Accessed via: Cmd+Z / Cmd+Shift+Z in vector editing mode
 *
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Undo/Redo
 *
 * Tradeoffs: each operation stored as an atomic diff (GraphDiff union type).
 * paramChange: just nodeId + param name + old/new value.
 * removeNode: stores GraphNode (4 fields: id, type, params, position) + severed
 * edges — required because the node and its connections no longer exist in the
 * graph, so undo must recreate them from the diff. No xpath-like addressing is
 * possible: a DAG has no stable path hierarchy, only node ids.
 */

import type { GraphDiff, GraphEdge, GraphNode, HistoryEntry, Point } from '../types';
import type { VectorGraphModel } from './vector-graph';

export class HistoryManager {
  private entries: HistoryEntry[] = [];
  private pointer = 0;
  private pendingDiffs: GraphDiff[] = [];
  private pendingDescription = '';

  constructor(private readonly maxEntries = 100) {}

  begin(description: string): void {
    this.pendingDiffs = [];
    this.pendingDescription = description;
  }

  recordParamChange(nodeId: string, param: string, oldValue: unknown, newValue: unknown): void {
    this.pendingDiffs.push({ kind: 'paramChange', nodeId, param, oldValue, newValue });
  }

  recordAddNode(node: GraphNode): void {
    this.pendingDiffs.push({ kind: 'addNode', node: { ...node } });
  }

  recordRemoveNode(node: GraphNode, removedEdges: GraphEdge[], muted?: boolean): void {
    this.pendingDiffs.push({ kind: 'removeNode', node: { ...node }, removedEdges: [...removedEdges], muted });
  }

  recordAddEdge(edge: GraphEdge): void {
    this.pendingDiffs.push({ kind: 'addEdge', edge: { ...edge } });
  }

  recordRemoveEdge(edge: GraphEdge): void {
    this.pendingDiffs.push({ kind: 'removeEdge', edge: { ...edge } });
  }

  recordMuteNode(nodeId: string, muted: boolean): void {
    this.pendingDiffs.push({ kind: 'muteNode', nodeId, muted });
  }

  recordMoveNode(nodeId: string, oldPosition: Point, newPosition: Point): void {
    this.pendingDiffs.push({ kind: 'moveNode', nodeId, oldPosition, newPosition });
  }

  commit(): void {
    if (this.pendingDiffs.length === 0) {
      this.pendingDescription = '';
      return;
    }
    // Truncate redo stack when a new action is committed
    this.entries.length = this.pointer;
    this.entries.push({
      timestamp: Date.now(),
      description: this.pendingDescription,
      diffs: this.pendingDiffs,
    });
    this.pointer = this.entries.length;
    this.pendingDiffs = [];
    this.pendingDescription = '';
    if (this.entries.length > this.maxEntries) {
      const excess = this.entries.length - this.maxEntries;
      this.entries.splice(0, excess);
      this.pointer -= excess;
    }
  }

  undo(graph: VectorGraphModel): string[] {
    if (!this.canUndo) return [];
    this.pointer--;
    const entry = this.entries[this.pointer];
    const affected = new Set<string>();

    // Apply diffs in REVERSE order
    for (let i = entry.diffs.length - 1; i >= 0; i--) {
      this.applyReverse(graph, entry.diffs[i], affected);
    }

    return [...affected];
  }

  redo(graph: VectorGraphModel): string[] {
    if (!this.canRedo) return [];
    const entry = this.entries[this.pointer];
    this.pointer++;
    const affected = new Set<string>();

    // Apply diffs in FORWARD order
    for (const diff of entry.diffs) {
      this.applyForward(graph, diff, affected);
    }

    return [...affected];
  }

  private applyReverse(graph: VectorGraphModel, diff: GraphDiff, affected: Set<string>): void {
    switch (diff.kind) {
      case 'paramChange':
        graph.setParam(diff.nodeId, diff.param, diff.oldValue);
        affected.add(diff.nodeId);
        break;
      case 'addNode':
        graph.removeNode(diff.node.id);
        affected.add(diff.node.id);
        break;
      case 'removeNode':
        graph.addNodeWithId(diff.node.id, {
          type: diff.node.type,
          params: diff.node.params,
          position: diff.node.position,
        });
        if (diff.muted) {
          graph.setMuted(diff.node.id, true);
        }
        for (const edge of diff.removedEdges) {
          graph.addEdgeWithId(edge.id, edge.source, edge.sourcePort, edge.target, edge.targetPort);
          affected.add(edge.source);
          affected.add(edge.target);
        }
        affected.add(diff.node.id);
        break;
      case 'addEdge':
        graph.removeEdge(diff.edge.id);
        affected.add(diff.edge.source);
        affected.add(diff.edge.target);
        break;
      case 'removeEdge':
        graph.addEdgeWithId(
          diff.edge.id,
          diff.edge.source,
          diff.edge.sourcePort,
          diff.edge.target,
          diff.edge.targetPort,
        );
        affected.add(diff.edge.source);
        affected.add(diff.edge.target);
        break;
      case 'muteNode':
        graph.setMuted(diff.nodeId, !diff.muted);
        affected.add(diff.nodeId);
        break;
      case 'moveNode':
        graph.setPosition(diff.nodeId, diff.oldPosition);
        affected.add(diff.nodeId);
        break;
    }
  }

  private applyForward(graph: VectorGraphModel, diff: GraphDiff, affected: Set<string>): void {
    switch (diff.kind) {
      case 'paramChange':
        graph.setParam(diff.nodeId, diff.param, diff.newValue);
        affected.add(diff.nodeId);
        break;
      case 'addNode':
        graph.addNodeWithId(diff.node.id, {
          type: diff.node.type,
          params: diff.node.params,
          position: diff.node.position,
        });
        affected.add(diff.node.id);
        break;
      case 'removeNode':
        graph.removeNode(diff.node.id);
        affected.add(diff.node.id);
        break;
      case 'addEdge':
        graph.addEdgeWithId(
          diff.edge.id,
          diff.edge.source,
          diff.edge.sourcePort,
          diff.edge.target,
          diff.edge.targetPort,
        );
        affected.add(diff.edge.source);
        affected.add(diff.edge.target);
        break;
      case 'removeEdge':
        graph.removeEdge(diff.edge.id);
        affected.add(diff.edge.source);
        affected.add(diff.edge.target);
        break;
      case 'muteNode':
        graph.setMuted(diff.nodeId, diff.muted);
        affected.add(diff.nodeId);
        break;
      case 'moveNode':
        graph.setPosition(diff.nodeId, diff.newPosition);
        affected.add(diff.nodeId);
        break;
    }
  }

  get canUndo(): boolean {
    return this.pointer > 0;
  }

  get canRedo(): boolean {
    return this.pointer < this.entries.length;
  }

  get entryCount(): number {
    return this.entries.length;
  }
}
