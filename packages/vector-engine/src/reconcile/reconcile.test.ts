import { describe, expect, it } from 'bun:test';
import { HistoryManager } from '../graph/history';
import { VectorGraphModel } from '../graph/vector-graph';
import type { VectorGraphState } from '../persistence/types';
import { applyReconciliation } from './apply';
import type { ReconciliationDiff } from './diff';
import { computeReconciliationDiff } from './diff';

const makeState = (overrides?: Partial<VectorGraphState>): VectorGraphState => ({
  canvas: { width: 100, height: 100 },
  nodes: {},
  edges: [],
  muted: [],
  ...overrides,
});

describe('computeReconciliationDiff', () => {
  it('should detect added node', () => {
    const current = makeState({ nodes: { n1: { id: 'n1', type: 'rectangle', params: {} } } });
    const modified = makeState({
      nodes: {
        n1: { id: 'n1', type: 'rectangle', params: {} },
        n2: { id: 'n2', type: 'ellipse', params: {} },
      },
    });
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.added.nodes.length).toBe(1);
    expect(diff.added.nodes[0].id).toBe('n2');
  });

  it('should detect removed node', () => {
    const current = makeState({
      nodes: {
        n1: { id: 'n1', type: 'rectangle', params: {} },
        n2: { id: 'n2', type: 'ellipse', params: {} },
      },
    });
    const modified = makeState({ nodes: { n1: { id: 'n1', type: 'rectangle', params: {} } } });
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.removed.nodeIds).toEqual(['n2']);
  });

  it('should detect param change', () => {
    const current = makeState({ nodes: { n1: { id: 'n1', type: 'rectangle', params: { width: 50 } } } });
    const modified = makeState({ nodes: { n1: { id: 'n1', type: 'rectangle', params: { width: 100 } } } });
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.modified.params.length).toBe(1);
    expect(diff.modified.params[0].changes.width).toEqual({ old: 50, new: 100 });
  });

  it('should detect mute toggle', () => {
    const current = makeState({ muted: [] });
    const modified = makeState({ muted: ['n1'] });
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.modified.muted.added).toEqual(['n1']);
  });

  it('should detect canvas change', () => {
    const current = makeState({ canvas: { width: 100, height: 100 } });
    const modified = makeState({ canvas: { width: 200, height: 200 } });
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.meta.canvasChanged).toBe(true);
  });

  it('should detect added/removed edges', () => {
    const current = makeState({
      edges: [{ id: 'e1', source: 'a', target: 'b', sourcePort: 'path', targetPort: 'path' }],
    });
    const modified = makeState({
      edges: [{ id: 'e2', source: 'b', target: 'c', sourcePort: 'path', targetPort: 'path' }],
    });
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.removed.edgeIds).toEqual(['e1']);
    expect(diff.added.edges.length).toBe(1);
    expect(diff.added.edges[0].id).toBe('e2');
  });

  it('should detect edge reorder', () => {
    const current = makeState({
      edges: [{ id: 'e1', source: 'a', target: 'b', sourcePort: 'path', targetPort: 'path' }],
    });
    const modified = makeState({
      edges: [{ id: 'e1', source: 'a', target: 'c', sourcePort: 'path', targetPort: 'path' }],
    });
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.modified.reordered.length).toBe(1);
    expect(diff.modified.reordered[0].old.target).toBe('b');
    expect(diff.modified.reordered[0].new.target).toBe('c');
  });

  it('should return empty diff for identical states', () => {
    const state = makeState({ nodes: { n1: { id: 'n1', type: 'rectangle', params: {} } } });
    const diff = computeReconciliationDiff(state, state);
    expect(diff.added.nodes.length).toBe(0);
    expect(diff.removed.nodeIds.length).toBe(0);
    expect(diff.modified.params.length).toBe(0);
    expect(diff.meta.canvasChanged).toBe(false);
  });
});

describe('applyReconciliation', () => {
  it('should add nodes from diff', () => {
    const graph = VectorGraphModel.create('test', 'Test', 100, 100);
    const history = new HistoryManager();
    const diff: ReconciliationDiff = {
      added: { nodes: [{ id: 'new-1', type: 'ellipse', params: { rx: 25, ry: 25 } }], edges: [] },
      removed: { nodeIds: [], edgeIds: [] },
      modified: { params: [], reordered: [], muted: { added: [], removed: [] } },
      meta: { canvasChanged: false, viewportChanged: false },
    };
    applyReconciliation(graph, history, diff);
    expect(graph.nodeCount).toBe(1);
    expect(graph.getNode('new-1')).toBeDefined();
  });

  it('should remove nodes from diff', () => {
    const graph = VectorGraphModel.create('test', 'Test', 100, 100);
    const history = new HistoryManager();
    const nodeId = graph.addNode({ type: 'rectangle', params: {} });
    const diff: ReconciliationDiff = {
      added: { nodes: [], edges: [] },
      removed: { nodeIds: [nodeId], edgeIds: [] },
      modified: { params: [], reordered: [], muted: { added: [], removed: [] } },
      meta: { canvasChanged: false, viewportChanged: false },
    };
    applyReconciliation(graph, history, diff);
    expect(graph.nodeCount).toBe(0);
  });

  it('should apply param changes', () => {
    const graph = VectorGraphModel.create('test', 'Test', 100, 100);
    const history = new HistoryManager();
    const nodeId = graph.addNode({ type: 'rectangle', params: { width: 50 } });
    const diff: ReconciliationDiff = {
      added: { nodes: [], edges: [] },
      removed: { nodeIds: [], edgeIds: [] },
      modified: {
        params: [{ nodeId, changes: { width: { old: 50, new: 100 } } }],
        reordered: [],
        muted: { added: [], removed: [] },
      },
      meta: { canvasChanged: false, viewportChanged: false },
    };
    applyReconciliation(graph, history, diff);
    expect(graph.getNode(nodeId)?.params.width).toBe(100);
  });

  it('should record reconciliation as undoable', () => {
    const graph = VectorGraphModel.create('test', 'Test', 100, 100);
    const history = new HistoryManager();
    const diff: ReconciliationDiff = {
      added: { nodes: [{ id: 'n1', type: 'rectangle', params: {} }], edges: [] },
      removed: { nodeIds: [], edgeIds: [] },
      modified: { params: [], reordered: [], muted: { added: [], removed: [] } },
      meta: { canvasChanged: false, viewportChanged: false },
    };
    applyReconciliation(graph, history, diff);
    expect(graph.nodeCount).toBe(1);
    history.undo(graph);
    expect(graph.nodeCount).toBe(0);
  });

  it('should handle empty diff without recording history', () => {
    const graph = VectorGraphModel.create('test', 'Test', 100, 100);
    const history = new HistoryManager();
    const diff: ReconciliationDiff = {
      added: { nodes: [], edges: [] },
      removed: { nodeIds: [], edgeIds: [] },
      modified: { params: [], reordered: [], muted: { added: [], removed: [] } },
      meta: { canvasChanged: false, viewportChanged: false },
    };
    applyReconciliation(graph, history, diff);
    expect(graph.nodeCount).toBe(0);
    expect(history.entryCount).toBe(0);
  });
});
