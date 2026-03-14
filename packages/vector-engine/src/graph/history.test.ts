import { beforeEach, describe, expect, it } from 'bun:test';
import type { GraphNode } from '../types';
import { HistoryManager } from './history';
import { VectorGraphModel } from './vector-graph';

/** Retrieve a node that must exist — throws if not found (test setup error). */
function mustGetNode(graph: VectorGraphModel, id: string): GraphNode {
  const node = graph.getNode(id);
  if (!node) throw new Error(`Node ${id} not found`);
  return node;
}

describe('HistoryManager', () => {
  let graph: VectorGraphModel;
  let history: HistoryManager;

  beforeEach(() => {
    graph = VectorGraphModel.create('test', 'Test', 800, 600);
    history = new HistoryManager();
  });

  it('should record param changes', () => {
    const n1 = graph.addNode({ type: 'rect', params: { width: 100 } });
    history.begin('Change width');
    history.recordParamChange(n1, 'width', 100, 200);
    graph.setParam(n1, 'width', 200);
    history.commit();

    expect(history.entryCount).toBe(1);
    expect(history.canUndo).toBe(true);
  });

  it('should undo param change', () => {
    const n1 = graph.addNode({ type: 'rect', params: { width: 100 } });
    history.begin('Add rectangle');
    history.recordAddNode(mustGetNode(graph, n1));
    history.commit();

    history.begin('Change width');
    history.recordParamChange(n1, 'width', 100, 200);
    graph.setParam(n1, 'width', 200);
    history.commit();

    expect(mustGetNode(graph, n1).params.width).toBe(200);
    history.undo(graph);
    expect(mustGetNode(graph, n1).params.width).toBe(100);
  });

  it('should redo undone change', () => {
    const n1 = graph.addNode({ type: 'rect', params: { width: 100 } });
    history.begin('Add rect');
    history.recordAddNode(mustGetNode(graph, n1));
    history.commit();

    history.begin('Change width');
    history.recordParamChange(n1, 'width', 100, 200);
    graph.setParam(n1, 'width', 200);
    history.commit();

    history.undo(graph);
    expect(mustGetNode(graph, n1).params.width).toBe(100);
    history.redo(graph);
    expect(mustGetNode(graph, n1).params.width).toBe(200);
  });

  it('should undo node addition (removes node)', () => {
    history.begin('Add rectangle');
    const n1 = graph.addNode({ type: 'rect', params: {} });
    history.recordAddNode(mustGetNode(graph, n1));
    history.commit();

    expect(graph.nodeCount).toBe(1);
    history.undo(graph);
    expect(graph.nodeCount).toBe(0);
  });

  it('should undo node removal (restores node + edges)', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    history.begin('setup');
    history.recordAddNode(mustGetNode(graph, n1));
    history.recordAddNode(mustGetNode(graph, n2));
    history.commit();

    history.begin('Remove n1');
    const removedEdges = graph.removeNode(n1);
    history.recordRemoveNode({ id: n1, type: 'rect', params: {} }, removedEdges);
    history.commit();

    expect(graph.nodeCount).toBe(1);
    history.undo(graph);
    expect(graph.nodeCount).toBe(2);
    expect(graph.edgeCount).toBe(1);
  });

  it('should undo/redo edge addition', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    history.begin('Setup nodes');
    history.recordAddNode(mustGetNode(graph, n1));
    history.recordAddNode(mustGetNode(graph, n2));
    history.commit();

    history.begin('Connect');
    const edgeId = graph.addEdge(n1, 'path', n2, 'path');
    history.recordAddEdge({ id: edgeId, source: n1, target: n2, sourcePort: 'path', targetPort: 'path' });
    history.commit();

    expect(graph.edgeCount).toBe(1);
    history.undo(graph);
    expect(graph.edgeCount).toBe(0);
    history.redo(graph);
    expect(graph.edgeCount).toBe(1);
  });

  it('should undo/redo edge removal', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    const edgeId = graph.addEdge(n1, 'path', n2, 'path');
    history.begin('Setup');
    history.commit();

    history.begin('Disconnect');
    graph.removeEdge(edgeId);
    history.recordRemoveEdge({ id: edgeId, source: n1, target: n2, sourcePort: 'path', targetPort: 'path' });
    history.commit();

    expect(graph.edgeCount).toBe(0);
    history.undo(graph);
    expect(graph.edgeCount).toBe(1);
  });

  it('should undo/redo mute toggle', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    history.begin('Add');
    history.recordAddNode(mustGetNode(graph, n1));
    history.commit();

    history.begin('Mute');
    graph.setMuted(n1, true);
    history.recordMuteNode(n1, true);
    history.commit();

    expect(graph.isMuted(n1)).toBe(true);
    history.undo(graph);
    expect(graph.isMuted(n1)).toBe(false);
    history.redo(graph);
    expect(graph.isMuted(n1)).toBe(true);
  });

  it('should undo/redo node position move', () => {
    const n1 = graph.addNode({ type: 'rect', params: {}, position: { x: 0, y: 0 } });
    history.begin('Move');
    graph.setPosition(n1, { x: 100, y: 200 });
    history.recordMoveNode(n1, { x: 0, y: 0 }, { x: 100, y: 200 });
    history.commit();

    history.undo(graph);
    expect(mustGetNode(graph, n1).position).toEqual({ x: 0, y: 0 });
  });

  it('should return affected node IDs from undo', () => {
    const n1 = graph.addNode({ type: 'rect', params: { width: 100 } });
    history.begin('Add');
    history.recordAddNode(mustGetNode(graph, n1));
    history.commit();

    history.begin('Change');
    history.recordParamChange(n1, 'width', 100, 200);
    graph.setParam(n1, 'width', 200);
    history.commit();

    const affected = history.undo(graph);
    expect(affected).toContain(n1);
  });

  it('should restore muted state when undoing node removal', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    graph.setMuted(n1, true);
    history.begin('Setup');
    history.recordAddNode(mustGetNode(graph, n1));
    history.commit();

    history.begin('Remove muted node');
    const removedEdges = graph.removeNode(n1);
    history.recordRemoveNode({ id: n1, type: 'rect', params: {} }, removedEdges, true);
    history.commit();

    expect(graph.nodeCount).toBe(0);
    history.undo(graph);
    expect(graph.nodeCount).toBe(1);
    expect(graph.isMuted(n1)).toBe(true);
  });

  it('should skip empty commits and not increment entryCount', () => {
    history.begin('Empty commit — no diffs recorded');
    history.commit();
    expect(history.entryCount).toBe(0);
    expect(history.canUndo).toBe(false);
  });

  it('should enforce maxEntries by dropping oldest entries', () => {
    const smallHistory = new HistoryManager(3);
    const n1 = graph.addNode({ type: 'rect', params: { width: 1 } });

    for (let i = 0; i < 5; i++) {
      smallHistory.begin(`Change ${i}`);
      smallHistory.recordParamChange(n1, 'width', i, i + 1);
      graph.setParam(n1, 'width', i + 1);
      smallHistory.commit();
    }

    expect(smallHistory.entryCount).toBe(3);
    expect(smallHistory.canUndo).toBe(true);
  });

  it('should clear redo stack on new action after undo', () => {
    const n1 = graph.addNode({ type: 'rect', params: { width: 100 } });
    history.begin('Add');
    history.recordAddNode(mustGetNode(graph, n1));
    history.commit();

    history.begin('Change to 200');
    history.recordParamChange(n1, 'width', 100, 200);
    graph.setParam(n1, 'width', 200);
    history.commit();

    history.undo(graph);

    history.begin('Change to 300');
    history.recordParamChange(n1, 'width', 100, 300);
    graph.setParam(n1, 'width', 300);
    history.commit();

    expect(history.canRedo).toBe(false);
  });
});
