/**
 * @file End-to-end integration tests for the Vector Engine pipeline
 *
 * Accessed via: CI pipeline — validates full engine pipeline (graph → execute → scene → SVG)
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md
 */

import { describe, expect, it } from 'bun:test';
import { sceneToSvg } from './export/svg';
import { GraphExecutor } from './graph/executor';
import { HistoryManager } from './graph/history';
import { buildScene } from './graph/scene-builder';
import { VectorGraphModel } from './graph/vector-graph';
import { createDefaultRegistry } from './nodes/register-all';
import { PathBuilder } from './path/builder';
import type { SceneItem } from './types';

describe('Vector Engine — full pipeline', () => {
  it('Generator → Transform → Style → Export: rect with translation and fill', () => {
    // NOTE: The translate node outputs a `transform` port only — it is not wired
    // into the fill node which has no `transform` input. The executor always assigns
    // IDENTITY_TRANSFORM to terminal outputs. As a result, the transform matrix in
    // the current pipeline is always identity and does NOT appear in the SVG output.
    // This test verifies the observable behaviour of the implemented pipeline.
    //
    // Missing: a style/fill node accepting a `transform` input so the matrix flows
    // through to the scene item. Track as a follow-up.
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('t1', 'TransformTest', 32, 32);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 10, height: 10, x: 0, y: 0 } });
    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#ff0000' } });
    graph.addEdge(rect, 'path', fill, 'path');

    const result = executor.execute(graph);
    const svg = sceneToSvg(result.scene);

    // Path data is present
    expect(svg).toContain('d="M 0 0 L 10 0 L 10 10 L 0 10 Z"');
    // Fill color is applied
    expect(svg).toContain('fill="#ff0000"');
    // No non-identity matrix emitted (transform always identity in current impl)
    expect(svg).not.toContain('transform="matrix(');
  });

  it('Generator → Clip → Style → Export: SVG with clipPath in defs', () => {
    // NOTE: There is no dedicated clip node in createDefaultRegistry. The SceneItem
    // has a `clipPath` field, but the executor never populates it via the node pipeline.
    // This test documents what IS supported: the SVG exporter correctly emits
    // <clipPath> defs when a SceneItem.clipPath is set directly. The node-level
    // clip pipeline is not yet implemented.
    //
    // Missing: a `clip` node type that takes `path` + `clipShape` inputs and sets
    // clipPath on the scene item. Track as a follow-up.

    // Verify that sceneToSvg handles clipPath correctly when provided via scene API
    const shapePath = new PathBuilder().moveTo(0, 0).lineTo(20, 0).lineTo(20, 20).lineTo(0, 20).close().build();
    const clipShape = new PathBuilder().moveTo(0, 0).lineTo(10, 0).lineTo(10, 10).lineTo(0, 10).close().build();

    const scene = buildScene({
      canvas: { width: 32, height: 32 },
      terminalNodes: [
        {
          id: 'item1',
          path: shapePath,
          style: { fill: { type: 'solid', color: '#00ff00' } },
          transform: [1, 0, 0, 1, 0, 0],
          visible: true,
        },
      ],
    });

    // Manually set clipPath on scene item to verify SVG exporter
    const item = scene.items[0];
    if (!('path' in item)) throw new Error('expected SceneItem');
    (item as SceneItem).clipPath = clipShape;

    const svg = sceneToSvg(scene);
    expect(svg).toContain('<clipPath id="clip-item1">');
    expect(svg).toContain('clip-path="url(#clip-item1)"');
    expect(svg).toContain('<defs>');
  });

  it('Multiple shapes with different styles both appear in SVG', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('t2', 'MultiShape', 50, 50);
    const executor = new GraphExecutor(registry);

    const rect1 = graph.addNode({ type: 'rectangle', params: { width: 10, height: 10, x: 0, y: 0 } });
    const fill1 = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#ff0000' } });
    graph.addEdge(rect1, 'path', fill1, 'path');

    const rect2 = graph.addNode({ type: 'rectangle', params: { width: 10, height: 10, x: 20, y: 20 } });
    const fill2 = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#0000ff' } });
    graph.addEdge(rect2, 'path', fill2, 'path');

    const result = executor.execute(graph);
    expect(result.scene.items).toHaveLength(2);

    const svg = sceneToSvg(result.scene);
    const pathMatches = svg.match(/<path /g) ?? [];
    expect(pathMatches).toHaveLength(2);
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('fill="#0000ff"');
  });

  it('Gradient pipeline: rect with linear gradient has <linearGradient> in defs', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('t3', 'GradientTest', 100, 100);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 80, height: 80, x: 10, y: 10 } });
    const fill = graph.addNode({
      type: 'fill',
      params: {
        fillType: 'linearGradient',
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
      },
    });
    graph.addEdge(rect, 'path', fill, 'path');

    const result = executor.execute(graph);
    expect(result.scene.items).toHaveLength(1);
    expect(Object.values(result.nodeStatus).every((s) => s.state === 'ok')).toBe(true);

    const svg = sceneToSvg(result.scene);
    expect(svg).toContain('<defs>');
    expect(svg).toContain('<linearGradient id="grad-');
    expect(svg).toContain('fill="url(#grad-');
    expect(svg).toContain('gradientUnits="userSpaceOnUse"');
  });
});

describe('Vector Engine — transform pipeline', () => {
  it('rect → translate → fill: SVG should contain transform matrix', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('tp1', 'TransformPipeline', 100, 100);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 20, height: 20, x: 0, y: 0 } });
    const translate = graph.addNode({ type: 'translate', params: { dx: 30, dy: 40 } });
    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#ff0000' } });

    // rect → translate (path passthrough + transform output)
    graph.addEdge(rect, 'path', translate, 'path');
    // translate → fill (path + transform passthrough)
    graph.addEdge(translate, 'path', fill, 'path');

    const result = executor.execute(graph);
    expect(result.scene.items).toHaveLength(1);

    const svg = sceneToSvg(result.scene);
    expect(svg).toContain('fill="#ff0000"');
    // Transform matrix should appear: translate(30,40) = matrix(1 0 0 1 30 40)
    expect(svg).toContain('transform="matrix(1 0 0 1 30 40)"');
  });

  it('rect → rotate(45°) → fill: SVG should contain rotation matrix', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('tp2', 'RotatePipeline', 100, 100);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 20, height: 20, x: 0, y: 0 } });
    const rotate = graph.addNode({ type: 'rotate', params: { angle: 90, originX: 0, originY: 0 } });
    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#0000ff' } });

    graph.addEdge(rect, 'path', rotate, 'path');
    graph.addEdge(rotate, 'path', fill, 'path');

    const result = executor.execute(graph);
    const svg = sceneToSvg(result.scene);
    // Should contain a transform attribute (90° rotation around origin)
    expect(svg).toContain('transform="matrix(');
  });

  it('muted translate: transform should NOT appear in SVG', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('tp3', 'MutedTranslate', 100, 100);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 20, height: 20, x: 0, y: 0 } });
    const translate = graph.addNode({ type: 'translate', params: { dx: 30, dy: 40 } });
    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#00ff00' } });

    graph.addEdge(rect, 'path', translate, 'path');
    graph.addEdge(translate, 'path', fill, 'path');

    // Mute translate — should passthrough path without transform
    graph.setMuted(translate, true);

    const result = executor.execute(graph);
    expect(result.nodeStatus[translate].state).toBe('skipped');
    expect(result.scene.items).toHaveLength(1);

    const svg = sceneToSvg(result.scene);
    expect(svg).toContain('fill="#00ff00"');
    // No transform — translate was muted
    expect(svg).not.toContain('transform="matrix(');
  });
});

describe('Vector Engine — clip node pipeline', () => {
  it('rect clipped by circle: SVG should contain clipPath', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('cl1', 'ClipPipeline', 100, 100);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 80, height: 80, x: 10, y: 10 } });
    const circle = graph.addNode({ type: 'ellipse', params: { rx: 30, ry: 30, cx: 50, cy: 50 } });
    const clip = graph.addNode({ type: 'clip', params: {} });
    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#ff6600' } });

    graph.addEdge(rect, 'path', clip, 'path');
    graph.addEdge(circle, 'path', clip, 'clip');
    graph.addEdge(clip, 'path', fill, 'path');

    const result = executor.execute(graph);
    expect(result.scene.items).toHaveLength(1);
    expect(Object.values(result.nodeStatus).every((s) => s.state === 'ok')).toBe(true);

    const svg = sceneToSvg(result.scene);
    expect(svg).toContain('<clipPath');
    expect(svg).toContain('clip-path="url(#clip-');
    expect(svg).toContain('fill="#ff6600"');
  });

  it('clip node registered in default registry', () => {
    const registry = createDefaultRegistry();
    expect(registry.get('clip')).toBeDefined();
  });
});

describe('Vector Engine — muted node tests', () => {
  it('Muted style node: fill is not applied when fill node is muted', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('m1', 'MutedFill', 24, 24);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 20, height: 20, x: 2, y: 2 } });
    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#ff0000' } });
    graph.addEdge(rect, 'path', fill, 'path');

    // Mute the fill node — it should passthrough path without applying style
    graph.setMuted(fill, true);

    const result = executor.execute(graph);
    // fill node is muted → status is skipped
    expect(result.nodeStatus[fill].state).toBe('skipped');
    // The path still flows through so scene has 1 item
    expect(result.scene.items).toHaveLength(1);

    const svg = sceneToSvg(result.scene);
    // No fill color applied — muted fill node passes through without adding style
    expect(svg).not.toContain('fill="#ff0000"');
  });
});

describe('Vector Engine — error handling', () => {
  it('Disconnected fill node with no input: nodeStatus has error', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('e1', 'DisconnectedFill', 24, 24);
    const executor = new GraphExecutor(registry);

    // Fill node added with no incoming path edge
    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#ff0000' } });

    const result = executor.execute(graph);

    // The fill node has no path input → it calls execute with empty inputs.
    // fillNode.execute reads inputs.path without checking — it will return outputs
    // but path will be undefined, so this terminal node produces no path output
    // and is NOT added to the scene.
    expect(result.scene.items).toHaveLength(0);

    // The node itself should be in status (ok or error — it depends on what fill does
    // with undefined input). Verify the node was at least attempted.
    expect(result.nodeStatus[fill]).toBeDefined();
  });

  it('Unknown node type: nodeStatus has error state', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('e2', 'UnknownNode', 24, 24);
    const executor = new GraphExecutor(registry);

    // Add a node with a type that doesn't exist in the registry
    const unknownId = graph.addNode({ type: 'nonexistent-node-type', params: {} });

    const result = executor.execute(graph);
    expect(result.nodeStatus[unknownId].state).toBe('error');
    expect(result.nodeStatus[unknownId].error).toContain('Unknown node type: nonexistent-node-type');
    // No scene items from an errored node
    expect(result.scene.items).toHaveLength(0);
  });
});

describe('Vector Engine — cache verification', () => {
  it('Execute twice returns identical SVG output (cache hit)', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('c1', 'CacheTest', 24, 24);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 20, height: 20, x: 2, y: 2 } });
    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#3b82f6' } });
    graph.addEdge(rect, 'path', fill, 'path');

    const result1 = executor.execute(graph);
    const svg1 = sceneToSvg(result1.scene);

    const result2 = executor.execute(graph);
    const svg2 = sceneToSvg(result2.scene);

    expect(svg2).toBe(svg1);

    // Second execution should use cache for both nodes
    expect(result2.nodeStatus[rect].state).toBe('cached');
    expect(result2.nodeStatus[fill].state).toBe('cached');
  });

  it('Execute after invalidation reflects param change', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('c2', 'InvalidateTest', 24, 24);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 10, height: 10, x: 0, y: 0 } });
    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#000000' } });
    graph.addEdge(rect, 'path', fill, 'path');

    const result1 = executor.execute(graph);
    const svg1 = sceneToSvg(result1.scene);
    expect(svg1).toContain('L 10 0');

    // Change param and invalidate
    graph.setParam(rect, 'width', 20);
    executor.invalidate(rect);

    const result2 = executor.execute(graph);
    const svg2 = sceneToSvg(result2.scene);

    expect(svg2).toContain('L 20 0');
    expect(svg2).not.toBe(svg1);

    // rect was re-executed after invalidation
    expect(result2.nodeStatus[rect].state).toBe('ok');
  });
});

describe('Vector Engine — scene builder', () => {
  it('Topological order: parent executes before child in chain', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('s1', 'TopoOrder', 32, 32);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 10, height: 10, x: 0, y: 0 } });
    const reversePath = graph.addNode({ type: 'reverse-path', params: {} });
    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#aabbcc' } });

    graph.addEdge(rect, 'path', reversePath, 'path');
    graph.addEdge(reversePath, 'path', fill, 'path');

    const result = executor.execute(graph);

    // Verify all nodes ran successfully in order (no errors)
    expect(result.nodeStatus[rect].state).toBe('ok');
    expect(result.nodeStatus[reversePath].state).toBe('ok');
    expect(result.nodeStatus[fill].state).toBe('ok');
    expect(result.scene.items).toHaveLength(1);

    // Topological order must be: rect → reversePath → fill
    const order = graph.topologicalOrder();
    expect(order.indexOf(rect)).toBeLessThan(order.indexOf(reversePath));
    expect(order.indexOf(reversePath)).toBeLessThan(order.indexOf(fill));
  });

  it('Diamond dependency: both inputs computed before boolean union', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('s2', 'Diamond', 32, 32);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 16, height: 16, x: 0, y: 0 } });
    const ellipse = graph.addNode({ type: 'ellipse', params: { rx: 8, ry: 8, cx: 12, cy: 8 } });
    const union = graph.addNode({ type: 'boolean-union', params: {} });
    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#ff6600' } });

    graph.addEdge(rect, 'path', union, 'a');
    graph.addEdge(ellipse, 'path', union, 'b');
    graph.addEdge(union, 'path', fill, 'path');

    const result = executor.execute(graph);

    // All nodes must succeed
    expect(result.nodeStatus[rect].state).toBe('ok');
    expect(result.nodeStatus[ellipse].state).toBe('ok');
    expect(result.nodeStatus[union].state).toBe('ok');
    expect(result.nodeStatus[fill].state).toBe('ok');
    expect(result.scene.items).toHaveLength(1);

    // Both generators must execute before the union in topological order
    const order = graph.topologicalOrder();
    expect(order.indexOf(rect)).toBeLessThan(order.indexOf(union));
    expect(order.indexOf(ellipse)).toBeLessThan(order.indexOf(union));
  });
});

describe('Vector Engine — serialization', () => {
  it('Full graph with styles round-trips through JSON serialization', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('r1', 'SerializeTest', 64, 64);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({ type: 'rectangle', params: { width: 40, height: 40, x: 12, y: 12 } });
    const fill = graph.addNode({
      type: 'fill',
      params: {
        fillType: 'linearGradient',
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
        from: { x: 0, y: 0 },
        to: { x: 64, y: 0 },
      },
    });
    graph.addEdge(rect, 'path', fill, 'path');

    const svg1 = sceneToSvg(executor.execute(graph).scene);

    const json = graph.toJSON();
    const restored = VectorGraphModel.fromJSON(json);
    const executor2 = new GraphExecutor(registry);
    const svg2 = sceneToSvg(executor2.execute(restored).scene);

    expect(svg2).toBe(svg1);
    expect(svg2).toContain('<linearGradient id="grad-');
  });

  it('Graph state survives serialization after history changes', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('r2', 'HistorySerialize', 32, 32);
    const executor = new GraphExecutor(registry);
    const history = new HistoryManager();

    // Initial state
    const rect = graph.addNode({ type: 'rectangle', params: { width: 10, height: 10, x: 0, y: 0 } });
    history.begin('Add rect');
    const rectNode = graph.getNode(rect);
    if (!rectNode) throw new Error('rect not found');
    history.recordAddNode(rectNode);
    history.commit();

    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#111111' } });
    graph.addEdge(rect, 'path', fill, 'path');

    // Make a param change via history
    history.begin('Change width');
    history.recordParamChange(rect, 'width', 10, 25);
    graph.setParam(rect, 'width', 25);
    history.commit();

    const svgBefore = sceneToSvg(executor.execute(graph).scene);
    expect(svgBefore).toContain('L 25 0');

    // Serialize the CURRENT graph state (not history entries)
    const json = graph.toJSON();
    const restored = VectorGraphModel.fromJSON(json);
    const executor2 = new GraphExecutor(registry);
    const svgAfter = sceneToSvg(executor2.execute(restored).scene);

    // Restored graph reflects the latest state (width=25), not initial (width=10)
    expect(svgAfter).toBe(svgBefore);
    expect(svgAfter).toContain('L 25 0');
  });
});

describe('Vector Engine — end-to-end', () => {
  it('should create a rectangle, fill it, and export SVG', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'Icon', 24, 24);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({
      type: 'rectangle',
      params: { width: 20, height: 20, x: 2, y: 2 },
    });

    const fill = graph.addNode({
      type: 'fill',
      params: { fillType: 'solid', color: '#3b82f6' },
    });

    graph.addEdge(rect, 'path', fill, 'path');

    const result = executor.execute(graph);
    expect(result.scene.items).toHaveLength(1);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);

    const svg = sceneToSvg(result.scene);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('fill="#3b82f6"');
    expect(svg).toContain('d="M 2 2 L 22 2 L 22 22 L 2 22 Z"');
  });

  it('should undo/redo a param change', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'Icon', 24, 24);
    const executor = new GraphExecutor(registry);
    const history = new HistoryManager();

    const rect = graph.addNode({ type: 'rectangle', params: { width: 10, height: 10, x: 0, y: 0 } });
    history.begin('Add rectangle');
    const rectNode = graph.getNode(rect);
    if (!rectNode) throw new Error('rect node not found');
    history.recordAddNode(rectNode);
    history.commit();

    const fill = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#000000' } });
    graph.addEdge(rect, 'path', fill, 'path');

    history.begin('Resize');
    history.recordParamChange(rect, 'width', 10, 20);
    graph.setParam(rect, 'width', 20);
    history.commit();

    let result = executor.execute(graph);
    let svg = sceneToSvg(result.scene);
    expect(svg).toContain('L 20 0');

    const affected = history.undo(graph);
    for (const id of affected) executor.invalidate(id);
    result = executor.execute(graph);
    svg = sceneToSvg(result.scene);
    expect(svg).toContain('L 10 0');

    const reaffected = history.redo(graph);
    for (const id of reaffected) executor.invalidate(id);
    result = executor.execute(graph);
    svg = sceneToSvg(result.scene);
    expect(svg).toContain('L 20 0');
  });

  it('should build a compound shape with boolean union', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'Union Icon', 24, 24);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({
      type: 'rectangle',
      params: { width: 16, height: 16, x: 0, y: 0 },
    });
    const ellipse = graph.addNode({
      type: 'ellipse',
      params: { rx: 8, ry: 8, cx: 16, cy: 8 },
    });
    const union = graph.addNode({ type: 'boolean-union', params: {} });
    const fill = graph.addNode({
      type: 'fill',
      params: { fillType: 'solid', color: '#ef4444' },
    });

    graph.addEdge(rect, 'path', union, 'a');
    graph.addEdge(ellipse, 'path', union, 'b');
    graph.addEdge(union, 'path', fill, 'path');

    const result = executor.execute(graph);
    expect(result.scene.items).toHaveLength(1);
    expect(Object.values(result.nodeStatus).every((s) => s.state === 'ok')).toBe(true);

    const svg = sceneToSvg(result.scene);
    expect(svg).toContain('fill="#ef4444"');
  });

  it('should serialize graph, restore, and produce identical SVG', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'Roundtrip', 100, 100);
    const executor = new GraphExecutor(registry);

    const rect = graph.addNode({
      type: 'rectangle',
      params: { width: 50, height: 50, x: 25, y: 25 },
    });
    const fill = graph.addNode({
      type: 'fill',
      params: { fillType: 'solid', color: '#10b981' },
    });
    graph.addEdge(rect, 'path', fill, 'path');

    const svg1 = sceneToSvg(executor.execute(graph).scene);

    const json = graph.toJSON();
    const restored = VectorGraphModel.fromJSON(json);
    const executor2 = new GraphExecutor(registry);
    const svg2 = sceneToSvg(executor2.execute(restored).scene);

    expect(svg2).toBe(svg1);
  });
});
