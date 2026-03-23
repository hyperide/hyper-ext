/**
 * @file Tests for semantic diff and reverse sync pipeline
 *
 * Accessed via: Internal module — test suite for sync/ modules
 */

import { describe, expect, it } from 'bun:test';
import { sceneToSvg } from '../export/svg';
import { GraphExecutor } from '../graph/executor';
import { HistoryManager } from '../graph/history';
import { VectorGraphModel } from '../graph/vector-graph';
import { createDefaultRegistry } from '../nodes/register-all';
import { PathBuilder } from '../path/builder';
import type { SceneItem } from '../types';
import { IDENTITY_TRANSFORM } from '../types';
import { reverseSync } from './reverse-sync';
import { computeSemanticDiff } from './semantic-diff';

const makeItem = (id: string, path: ReturnType<PathBuilder['build']>, fill?: string): SceneItem => ({
  id,
  path,
  style: fill ? { fill: { type: 'solid', color: fill } } : {},
  transform: IDENTITY_TRANSFORM,
  visible: true,
});

describe('computeSemanticDiff', () => {
  it('should detect no changes when paths match', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const diff = computeSemanticDiff([makeItem('n1', rect, '#ff0000')], [makeItem('x', rect, '#ff0000')]);
    expect(diff.matched.length).toBe(1);
    expect(diff.matched[0].styleChanged).toBe(false);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
  });

  it('should detect added shape', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const circle = new PathBuilder().moveTo(50, 0).arcTo(50, 50, 0, 1, 1, 50, 100).close().build();
    const diff = computeSemanticDiff([makeItem('n1', rect)], [makeItem('x1', rect), makeItem('x2', circle)]);
    expect(diff.added.length).toBe(1);
  });

  it('should detect removed shape', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const tri = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(50, 86.6).close().build();
    const diff = computeSemanticDiff([makeItem('n1', rect), makeItem('n2', tri)], [makeItem('x1', rect)]);
    expect(diff.removed.length).toBe(1);
    expect(diff.removed[0].id).toBe('n2');
  });

  it('should detect style change on matched shape', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const diff = computeSemanticDiff([makeItem('n1', rect, '#ff0000')], [makeItem('x', rect, '#00ff00')]);
    expect(diff.matched.length).toBe(1);
    expect(diff.matched[0].styleChanged).toBe(true);
    expect(diff.matched[0].geometryChanged).toBe(false);
  });

  it('should handle empty scenes', () => {
    const diff = computeSemanticDiff([], []);
    expect(diff.matched.length).toBe(0);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
    expect(diff.ambiguous).toBe(false);
  });

  it('should set ambiguous when most shapes unmatched', () => {
    const r1 = new PathBuilder().moveTo(0, 0).lineTo(10, 0).close().build();
    const r2 = new PathBuilder().moveTo(0, 0).lineTo(20, 0).close().build();
    const r3 = new PathBuilder().moveTo(0, 0).lineTo(30, 0).close().build();
    const r4 = new PathBuilder().moveTo(0, 0).lineTo(40, 0).close().build();
    const diff = computeSemanticDiff(
      [makeItem('n1', r1), makeItem('n2', r2)],
      [makeItem('x1', r3), makeItem('x2', r4)],
    );
    // All shapes different, no bounding box overlap → ambiguous
    expect(diff.ambiguous).toBe(true);
  });

  it('should match multiple shapes correctly', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const tri = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(50, 86.6).close().build();
    const diff = computeSemanticDiff(
      [makeItem('n1', rect, '#ff0000'), makeItem('n2', tri, '#0000ff')],
      [makeItem('x1', tri, '#0000ff'), makeItem('x2', rect, '#00ff00')],
    );
    expect(diff.matched.length).toBe(2);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);

    // rect matched with style change
    const rectMatch = diff.matched.find((m) => m.currentId === 'n1');
    expect(rectMatch).toBeDefined();
    expect(rectMatch?.styleChanged).toBe(true);

    // tri matched without style change
    const triMatch = diff.matched.find((m) => m.currentId === 'n2');
    expect(triMatch).toBeDefined();
    expect(triMatch?.styleChanged).toBe(false);
  });

  it('should not flag ambiguous when all shapes match', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const diff = computeSemanticDiff([makeItem('n1', rect)], [makeItem('x1', rect)]);
    expect(diff.ambiguous).toBe(false);
  });

  it('should use bounding box fallback for slightly different paths', () => {
    // Two rectangles with very similar geometry but different path data
    const rect1 = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    // Same area but slightly shifted — still >70% overlap
    const rect2 = new PathBuilder().moveTo(5, 5).lineTo(105, 5).lineTo(105, 105).lineTo(5, 105).close().build();
    const diff = computeSemanticDiff([makeItem('n1', rect1)], [makeItem('x1', rect2)]);
    // Overlap: 95x95 = 9025, smaller area = 10000, ratio = 0.9025 > 0.7
    // Area ratio: 10000/10000 = 1 < 2
    expect(diff.matched.length).toBe(1);
    expect(diff.matched[0].geometryChanged).toBe(true);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
  });
});

describe('reverseSync', () => {
  it('should detect no changes for identical SVG', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'RS', 100, 100);
    graph.addNode({ type: 'rectangle', params: { width: 50, height: 50, x: 0, y: 0 } });
    const executor = new GraphExecutor(registry);
    const history = new HistoryManager();
    const svg = sceneToSvg(executor.execute(graph).scene);
    const result = reverseSync(graph, executor, registry, history, svg);
    expect(result.changesApplied).toBe(0);
  });

  it('should handle empty incoming SVG', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'RS', 100, 100);
    const executor = new GraphExecutor(registry);
    const history = new HistoryManager();
    const result = reverseSync(graph, executor, registry, history, '<svg viewBox="0 0 100 100"></svg>');
    expect(result.ambiguous).toBe(false);
  });

  it('should detect added shape in incoming SVG', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'RS', 100, 100);
    const executor = new GraphExecutor(registry);
    const history = new HistoryManager();
    // Incoming SVG has a shape but graph is empty
    const svg = '<svg viewBox="0 0 100 100"><rect width="50" height="50" fill="#ff0000"/></svg>';
    const result = reverseSync(graph, executor, registry, history, svg);
    expect(result.addedShapes).toBeGreaterThanOrEqual(1);
  });

  it('should apply style change when fill color differs', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'RS', 100, 100);
    // Create rectangle → fill chain
    const rectId = graph.addNode({ type: 'rectangle', params: { width: 50, height: 50, x: 0, y: 0 } });
    const fillId = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#ff0000' } });
    graph.addEdge(rectId, 'path', fillId, 'path');

    const executor = new GraphExecutor(registry);
    const history = new HistoryManager();

    // Generate SVG from current state, then modify the fill color
    const svg = sceneToSvg(executor.execute(graph).scene);
    const modifiedSvg = svg.replace('#ff0000', '#00ff00');

    const result = reverseSync(graph, executor, registry, history, modifiedSvg);
    expect(result.modifiedStyles).toBe(1);

    // Verify the fill node param was updated
    const fillNode = graph.getNode(fillId);
    expect(fillNode?.params.color).toBe('#00ff00');
  });

  it('should record changes in history for undo support', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'RS', 100, 100);
    const executor = new GraphExecutor(registry);
    const history = new HistoryManager();

    const svg = '<svg viewBox="0 0 100 100"><rect width="50" height="50" fill="#ff0000"/></svg>';
    reverseSync(graph, executor, registry, history, svg);

    // History should have entries from the sync
    expect(history.entryCount).toBeGreaterThanOrEqual(1);
  });

  it('should report removed shapes without deleting them', () => {
    const registry = createDefaultRegistry();
    const graph = VectorGraphModel.create('test', 'RS', 100, 100);
    const rectId = graph.addNode({ type: 'rectangle', params: { width: 50, height: 50, x: 0, y: 0 } });
    const fillId = graph.addNode({ type: 'fill', params: { fillType: 'solid', color: '#ff0000' } });
    graph.addEdge(rectId, 'path', fillId, 'path');

    const executor = new GraphExecutor(registry);
    const history = new HistoryManager();

    // Empty SVG = all current shapes are "removed"
    const result = reverseSync(graph, executor, registry, history, '<svg viewBox="0 0 100 100"></svg>');
    expect(result.removedShapes).toBeGreaterThanOrEqual(1);
    // But the graph nodes should still exist
    expect(graph.nodeCount).toBe(2);
  });
});
