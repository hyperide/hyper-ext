import { beforeEach, describe, expect, it } from 'bun:test';
import { NodeRegistry } from '../nodes/registry';
import { PathBuilder } from '../path/builder';
import type { NodeTypeDefinition, NodeValue } from '../types';
import { GraphExecutor } from './executor';
import { VectorGraphModel } from './vector-graph';

// Minimal generator node for testing
const rectNode: NodeTypeDefinition = {
  type: 'test-rect',
  label: 'Rectangle',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'width', type: 'number', default: 100 },
    { name: 'height', type: 'number', default: 50 },
  ],
  execute: (_inputs, params) => {
    const w = params.width as number;
    const h = params.height as number;
    const path = new PathBuilder().moveTo(0, 0).lineTo(w, 0).lineTo(w, h).lineTo(0, h).close().build();
    return { path: { type: 'path', value: path } };
  },
};

// Pass-through node (simulates a modifier)
const passThroughNode: NodeTypeDefinition = {
  type: 'test-passthrough',
  label: 'Pass Through',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [],
  execute: (inputs) => ({ path: inputs.path as NodeValue }),
};

describe('GraphExecutor', () => {
  let registry: NodeRegistry;
  let graph: VectorGraphModel;
  let executor: GraphExecutor;

  beforeEach(() => {
    registry = new NodeRegistry();
    registry.register(rectNode);
    registry.register(passThroughNode);
    graph = VectorGraphModel.create('test', 'Test', 800, 600);
    executor = new GraphExecutor(registry);
  });

  it('should execute a single generator node', () => {
    const n1 = graph.addNode({ type: 'test-rect', params: { width: 200, height: 100 } });
    const result = executor.execute(graph);
    expect(result.scene.items).toHaveLength(1);
    expect(result.nodeStatus[n1].state).toBe('ok');
  });

  it('should execute a chain of connected nodes', () => {
    const n1 = graph.addNode({ type: 'test-rect', params: { width: 100, height: 50 } });
    const n2 = graph.addNode({ type: 'test-passthrough', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    const result = executor.execute(graph);
    // Only terminal nodes (no outgoing edges) produce scene items
    expect(result.scene.items).toHaveLength(1);
  });

  it('should use cache on unchanged re-execution', () => {
    graph.addNode({ type: 'test-rect', params: { width: 100, height: 50 } });
    executor.execute(graph);
    const result2 = executor.execute(graph);
    // On second execution, node should be cached
    const statuses = Object.values(result2.nodeStatus);
    expect(statuses.some((s) => s.state === 'cached')).toBe(true);
  });

  it('should invalidate cache when param changes', () => {
    const n1 = graph.addNode({ type: 'test-rect', params: { width: 100, height: 50 } });
    executor.execute(graph);
    graph.setParam(n1, 'width', 200);
    executor.invalidate(n1);
    const result2 = executor.execute(graph);
    expect(result2.nodeStatus[n1].state).toBe('ok');
  });

  it('should skip muted nodes (passthrough)', () => {
    const n1 = graph.addNode({ type: 'test-rect', params: { width: 100, height: 50 } });
    const n2 = graph.addNode({ type: 'test-passthrough', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    graph.setMuted(n2, true);
    const result = executor.execute(graph);
    expect(result.nodeStatus[n2].state).toBe('skipped');
    // Scene still has 1 item (from n1 passed through)
    expect(result.scene.items).toHaveLength(1);
  });

  it('should handle node execution errors gracefully', () => {
    const errorNode: NodeTypeDefinition = {
      type: 'test-error',
      label: 'Error',
      category: 'generator',
      inputs: [],
      outputs: [{ name: 'path', type: 'path' }],
      params: [],
      execute: () => {
        throw new Error('intentional failure');
      },
    };
    registry.register(errorNode);
    const n1 = graph.addNode({ type: 'test-error', params: {} });
    const result = executor.execute(graph);
    expect(result.nodeStatus[n1].state).toBe('error');
    expect(result.nodeStatus[n1].error).toContain('intentional failure');
  });
});
