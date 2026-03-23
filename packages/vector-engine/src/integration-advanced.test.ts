/**
 * @file Advanced end-to-end integration tests for the Vector Engine
 *
 * Accessed via: CI pipeline — validates advanced pipeline features
 *   (SVG roundtrip, geometry ops, path flattening, node registry completeness)
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md
 */

import { describe, expect, it } from 'bun:test';
import { mapFigToGraph } from './import/fig-mapper';
import { svgToGraph } from './import/svg-import';
import {
  computeBounds,
  computeReconciliationDiff,
  deserializeGraph,
  GraphExecutor,
  IDENTITY_TRANSFORM,
  nearestPointOnPath,
  PathBuilder,
  SVGStringRenderer,
  sceneToSvg,
  serializeGraph,
  VectorGraphModel,
} from './index';
import { splitIntersections } from './network/split';
import type { VectorNetwork } from './network/types';
import { createDefaultRegistry } from './nodes/register-all';
import { flattenPath } from './path/flatten';
import { pathLength } from './path/geometry';
import type { SceneGraph } from './types';

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

describe('Plan 2b integration', () => {
  it('should create gradient mesh via node', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'Mesh', 200, 200);
    const meshNode = graph.addNode({
      type: 'gradientMesh',
      params: { rows: 2, cols: 2, width: 100, height: 100, x: 0, y: 0, color: '#ff0000' },
    });
    const executor = new GraphExecutor(registry);
    const result = executor.execute(graph);
    expect(result.nodeStatus[meshNode].state).toBe('ok');
  });

  it('should split intersections then find regions', () => {
    const network: VectorNetwork = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [],
    };
    const split = splitIntersections(network);
    expect(split.vertices.length).toBe(5);
  });

  it('should register all Plan 2b nodes', () => {
    const registry = createDefaultRegistry();
    expect(registry.get('gradientMesh')).toBeDefined();
    expect(registry.get('meshFromPath')).toBeDefined();
    expect(registry.get('envelopeDistort')).toBeDefined();
  });

  it('should map FIG nodes to graph', () => {
    const result = mapFigToGraph(
      [
        {
          type: 'RECTANGLE',
          name: 'R',
          id: '1',
          children: [],
          properties: { width: 100, height: 50 },
        },
      ],
      { width: 400, height: 300 },
    );
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Plan 3 integration', () => {
  it('should compute tight bounds for curve-heavy path', () => {
    const curve = new PathBuilder().moveTo(0, 0).cubicTo(50, 200, 50, -200, 100, 0).build();
    const bounds = computeBounds(curve.commands);
    // Tight bounds should be much less than control-point hull
    expect(bounds.height).toBeLessThan(200);
  });

  it('should hit test shapes in a scene', () => {
    const renderer = new SVGStringRenderer();
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const scene: SceneGraph = {
      items: [
        {
          id: 'r1',
          path: rect,
          style: { fill: { type: 'solid', color: '#f00' } },
          transform: IDENTITY_TRANSFORM,
          visible: true,
        },
      ],
      canvas: { width: 200, height: 200 },
    };
    expect(renderer.hitTest({ x: 50, y: 50 }, scene)?.itemId).toBe('r1');
    expect(renderer.hitTest({ x: 150, y: 150 }, scene)).toBeNull();
  });

  it('should serialize and deserialize graph with history', () => {
    const model = VectorGraphModel.create('test', 'RT', 100, 100);
    model.addNode({ type: 'rectangle', params: { width: 50, height: 50 } });
    const file = serializeGraph(model, { componentPath: 'test.tsx' });
    const json = JSON.stringify(file);
    const { model: loaded } = deserializeGraph(JSON.parse(json));
    expect(loaded.nodeCount).toBe(1);
  });

  it('should compute reconciliation diff and apply', () => {
    const state1 = {
      canvas: { width: 100, height: 100 },
      nodes: { n1: { id: 'n1', type: 'rectangle', params: { width: 50 }, position: { x: 0, y: 0 } } },
      edges: [],
      muted: [],
    };
    const state2 = {
      ...state1,
      nodes: { n1: { id: 'n1', type: 'rectangle', params: { width: 100 }, position: { x: 0, y: 0 } } },
    };
    const diff = computeReconciliationDiff(state1, state2);
    expect(diff.modified.params.length).toBe(1);
  });

  it('should find nearest point on path', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = nearestPointOnPath({ x: 50, y: 30 }, line);
    expect(result.distance).toBeCloseTo(30, 1);
  });

  it('should register all Plan 3 nodes', () => {
    const registry = createDefaultRegistry();
    expect(registry.get('addPoint')).toBeDefined();
    expect(registry.get('removePoint')).toBeDefined();
    expect(registry.get('convertPoint')).toBeDefined();
    expect(registry.get('splitPath')).toBeDefined();
    const all = registry.listAll();
    expect(all.length).toBe(52);
  });
});
