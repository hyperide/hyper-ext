/**
 * @file Advanced end-to-end integration tests for the Vector Engine
 *
 * Accessed via: CI pipeline — validates advanced pipeline features
 *   (SVG roundtrip, geometry ops, path flattening, node registry completeness)
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md
 */

import { describe, expect, it } from 'bun:test';
import { svgToGraph } from './import/svg-import';
import { GraphExecutor, PathBuilder, sceneToSvg, VectorGraphModel } from './index';
import { createDefaultRegistry } from './nodes/register-all';
import { flattenPath } from './path/flatten';
import { pathLength } from './path/geometry';

describe('advanced integration', () => {
  it('should export SVG then import back', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'RT', 200, 200);
    const rect = graph.addNode({ type: 'rectangle', params: { width: 100, height: 50, x: 10, y: 10 } });
    const fill = graph.addNode({ type: 'fill', params: { type: 'solid', color: '#ff0000' } });
    graph.addEdge(rect, 'path', fill, 'path');

    const executor = new GraphExecutor(registry);
    const result = executor.execute(graph);
    const svg = sceneToSvg(result.scene);

    const imported = svgToGraph(svg);
    expect(imported.nodes.length).toBeGreaterThanOrEqual(1);
    expect(imported.canvas).toEqual({ width: 200, height: 200 });
  });

  it('should compute geometry on generated shapes', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'Geo', 100, 100);
    graph.addNode({ type: 'rectangle', params: { width: 100, height: 100, x: 0, y: 0 } });
    const executor = new GraphExecutor(registry);
    const result = executor.execute(graph);
    const item = result.scene.items[0];
    if ('path' in item) {
      const len = pathLength(item.path.commands);
      expect(len).toBeCloseTo(400, 0);
    }
  });

  it('should flatten and approximate a curve', () => {
    const curve = new PathBuilder().moveTo(0, 0).cubicTo(33, 100, 66, 100, 100, 0).build();
    const points = flattenPath(curve.commands, 1.0);
    expect(points.length).toBeGreaterThan(2);
    const midIdx = Math.floor(points.length / 2);
    expect(points[midIdx].y).toBeGreaterThan(50);
  });

  it('should register all new nodes without conflicts', () => {
    const registry = createDefaultRegistry();
    const all = registry.listAll();
    expect(all.length).toBeGreaterThanOrEqual(44);
    const types = all.map((n) => n.type);
    expect(new Set(types).size).toBe(types.length);
  });
});
