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

  it('should skip muted node when input/output types mismatch', () => {
    // A node whose first input is 'path' but first output is 'style' — types don't match.
    // When muted, it must NOT forward the path value to the style output port.
    const typeChangerNode: NodeTypeDefinition = {
      type: 'test-type-changer',
      label: 'Type Changer',
      category: 'utility',
      inputs: [{ name: 'path', type: 'path' }],
      outputs: [{ name: 'style', type: 'style' }],
      params: [],
      execute() {
        return { style: { type: 'style', value: {} } };
      },
    };
    registry.register(typeChangerNode);

    // Terminal node whose ONLY path input comes via type-changer's 'style' output port.
    // This tests whether the muted type-changer leaks a path value into the style slot:
    // - Bug (no type check): type-changer puts path value in 'style' slot; this flows to
    //   path-sink's 'path' input via the explicit wrong-typed edge → 1 scene item produced.
    // - Fix (with type check): type-changer outputs nothing (type mismatch);
    //   path-sink gets no path input → 0 scene items.
    const pathSinkNode: NodeTypeDefinition = {
      type: 'test-path-sink',
      label: 'Path Sink',
      category: 'utility',
      inputs: [{ name: 'path', type: 'path' }],
      outputs: [{ name: 'path', type: 'path' }],
      params: [],
      execute(inputs) {
        return { path: inputs.path as NodeValue };
      },
    };
    registry.register(pathSinkNode);

    const n1 = graph.addNode({ type: 'test-rect', params: { width: 100, height: 50 } });
    const n2 = graph.addNode({ type: 'test-type-changer', params: {} });
    const n3 = graph.addNode({ type: 'test-path-sink', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    // Wrong-typed edge: 'style' → 'path' — only produces a scene item if n2 leaks path through style
    graph.addEdge(n2, 'style', n3, 'path');
    graph.setMuted(n2, true);

    const result = executor.execute(graph);

    // n2 is skipped
    expect(result.nodeStatus[n2].state).toBe('skipped');
    // n3 runs but has no valid path input (n2 produced nothing due to type mismatch)
    expect(result.nodeStatus[n3].state).toBe('ok');
    // No scene items: muted type-changer must not leak path value through style output port
    expect(result.scene.items).toHaveLength(0);
  });

  it('should forward implicit ports (transform) through muted nodes', () => {
    // A node with transform in both inputs and outputs (plus mismatched first ports
    // to ensure we're testing implicit port forwarding, not first-port passthrough).
    // When muted, transform must still be forwarded.
    const transformPassNode: NodeTypeDefinition = {
      type: 'test-transform-pass',
      label: 'Transform Pass',
      category: 'utility',
      // First input is 'path', first output is 'style' — intentional type mismatch
      // so we confirm the transform flows via IMPLICIT_PORTS, not first-port passthrough
      inputs: [
        { name: 'path', type: 'path' },
        { name: 'transform', type: 'transform' },
      ],
      outputs: [
        { name: 'style', type: 'style' },
        { name: 'transform', type: 'transform' },
      ],
      params: [],
      execute(inputs) {
        const result: Record<string, NodeValue> = {
          style: { type: 'style', value: {} },
        };
        if (inputs.transform) result.transform = inputs.transform as NodeValue;
        return result;
      },
    };
    registry.register(transformPassNode);

    // Downstream node that reads transform and passes it through to its outputs
    const transformConsumerNode: NodeTypeDefinition = {
      type: 'test-transform-consumer',
      label: 'Transform Consumer',
      category: 'utility',
      inputs: [
        { name: 'path', type: 'path' },
        { name: 'transform', type: 'transform' },
      ],
      outputs: [
        { name: 'path', type: 'path' },
        { name: 'transform', type: 'transform' },
      ],
      params: [],
      execute(inputs) {
        const result: Record<string, NodeValue> = { path: inputs.path as NodeValue };
        if (inputs.transform) result.transform = inputs.transform as NodeValue;
        return result;
      },
    };
    registry.register(transformConsumerNode);

    // transform-source produces a transform value
    const transformSourceNode: NodeTypeDefinition = {
      type: 'test-transform-source',
      label: 'Transform Source',
      category: 'transform',
      inputs: [],
      outputs: [{ name: 'transform', type: 'transform' }],
      params: [],
      execute() {
        return {
          transform: {
            type: 'transform',
            value: [2, 0, 0, 2, 0, 0] as [number, number, number, number, number, number],
          },
        };
      },
    };
    registry.register(transformSourceNode);

    // Graph: rect → transform-pass (muted); transform-source → transform-pass;
    //        transform-pass → transform-consumer (via explicit style edge + rect path)
    const nRect = graph.addNode({ type: 'test-rect', params: { width: 100, height: 50 } });
    const nTransSrc = graph.addNode({ type: 'test-transform-source', params: {} });
    const nPass = graph.addNode({ type: 'test-transform-pass', params: {} });
    const nConsumer = graph.addNode({ type: 'test-transform-consumer', params: {} });

    graph.addEdge(nRect, 'path', nPass, 'path');
    graph.addEdge(nTransSrc, 'transform', nPass, 'transform');
    graph.addEdge(nPass, 'transform', nConsumer, 'transform');
    graph.addEdge(nRect, 'path', nConsumer, 'path');
    graph.setMuted(nPass, true);

    const result = executor.execute(graph);

    // nPass is skipped
    expect(result.nodeStatus[nPass].state).toBe('skipped');
    // nConsumer must still execute
    expect(result.nodeStatus[nConsumer].state).toBe('ok');
    // The scene has 1 item from nConsumer — it received the path from nRect
    expect(result.scene.items).toHaveLength(1);
    // Verify transform was forwarded through the muted node by checking scene item transform
    // The transform [2,0,0,2,0,0] from transform-source should reach the scene item
    expect(result.scene.items[0]).toBeDefined();
    const item = result.scene.items[0];
    if (!('children' in item)) {
      expect(item.transform).toEqual([2, 0, 0, 2, 0, 0]);
    }
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

describe('style implicit port forwarding', () => {
  it('should forward style from fill through opacity node', () => {
    const registry = new NodeRegistry();
    // Register real nodes for this test
    const { fillNode } = require('../nodes/style/fill');
    const { opacityNode } = require('../nodes/style/opacity');
    registry.register({
      type: 'test-gen',
      label: 'Gen',
      category: 'generator',
      inputs: [],
      outputs: [{ name: 'path', type: 'path' }],
      params: [],
      execute() {
        const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).close().build();
        return { path: { type: 'path', value: path } };
      },
    });
    registry.register(fillNode);
    registry.register(opacityNode);

    const graph = VectorGraphModel.create('test', 'style-chain', 100, 100);
    const gen = graph.addNode({ type: 'test-gen', params: {} });
    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#ff0000' } });
    const opacity = graph.addNode({ type: 'opacity', params: { value: 0.5 } });
    graph.addEdge(gen, 'path', fill, 'path');
    graph.addEdge(fill, 'path', opacity, 'path');
    // Note: NO explicit edge for style port — it should be forwarded implicitly

    const executor = new GraphExecutor(registry);
    const result = executor.execute(graph);

    // Terminal output is opacity node — it should have BOTH fill and opacity
    const item = result.scene.items[0];
    expect('path' in item).toBe(true);
    if ('path' in item) {
      expect(item.style.fill).toBeDefined();
      expect(item.style.fill?.type).toBe('solid');
      expect(item.style.opacity).toBe(0.5);
    }
  });
});
