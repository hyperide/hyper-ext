/**
 * @file Reverse sync — apply external SVG changes to existing graph
 *
 * Accessed via: File watcher detects TSX component changed
 * Assumptions: incoming SVG is well-formed and importable via svgToGraph.
 *   Style changes are applied to the nearest upstream fill/stroke node.
 *   Added shapes become new svgPath + fill node chains.
 *   Removed shapes are reported but not auto-deleted (user safety).
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Reverse Sync
 */

import { GraphExecutor } from '../graph/executor';
import type { HistoryManager } from '../graph/history';
import { VectorGraphModel } from '../graph/vector-graph';
import { svgToGraph } from '../import/svg-import';
import type { NodeRegistry } from '../nodes/registry';
import { commandsToSvgD } from '../path/commands';
import type { SceneItem } from '../types';
import { isSceneItem } from '../types';
import { computeSemanticDiff } from './semantic-diff';

export interface ReverseSyncResult {
  changesApplied: number;
  addedShapes: number;
  removedShapes: number;
  modifiedStyles: number;
  ambiguous: boolean;
}

/**
 * Build a temporary VectorGraphModel from an SVG import result
 * and execute it to extract scene items.
 */
function importToSceneItems(svgString: string, registry: NodeRegistry): SceneItem[] {
  const imported = svgToGraph(svgString);
  if (imported.nodes.length === 0) return [];

  const tempGraph = VectorGraphModel.create('temp-import', 'temp', imported.canvas.width, imported.canvas.height);

  for (const node of imported.nodes) {
    // svgToGraph sets fill params as { type: 'solid' } but the fill node expects { fillType: 'solid' }
    const params = { ...node.params };
    if (node.type === 'fill' && 'type' in params && !('fillType' in params)) {
      params.fillType = params.type;
      delete params.type;
    }
    tempGraph.addNodeWithId(node.id, { type: node.type, params });
  }
  for (const edge of imported.edges) {
    try {
      tempGraph.addEdgeWithId(
        `temp-${edge.source}-${edge.target}`,
        edge.source,
        edge.sourcePort,
        edge.target,
        edge.targetPort,
      );
    } catch {
      // Skip edges that would create cycles (shouldn't happen from SVG import)
    }
  }

  const executor = new GraphExecutor(registry);
  const result = executor.execute(tempGraph);
  return result.scene.items.filter(isSceneItem);
}

/**
 * Find the fill node connected upstream of a terminal node in the graph.
 * Walks backward through edges looking for a node of type 'fill'.
 */
function findUpstreamFillNode(graph: VectorGraphModel, terminalNodeId: string): string | undefined {
  const visited = new Set<string>();
  const queue = [terminalNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) break;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = graph.getNode(nodeId);
    if (node && node.type === 'fill') {
      return nodeId;
    }

    const inputEdges = graph.getInputEdges(nodeId);
    for (const edge of inputEdges) {
      queue.push(edge.source);
    }
  }

  return undefined;
}

/**
 * Apply external SVG changes to an existing graph, preserving parametric history.
 *
 * Pipeline:
 * 1. Execute current graph to get scene items
 * 2. Parse incoming SVG, build temp graph, execute to get scene items
 * 3. Compute semantic diff
 * 4. Apply style changes to upstream fill/stroke nodes
 * 5. Add new shapes as svgPath + fill chains
 * 6. Report removed shapes (don't auto-delete)
 */
export function reverseSync(
  graph: VectorGraphModel,
  executor: GraphExecutor,
  registry: NodeRegistry,
  history: HistoryManager,
  incomingSvg: string,
): ReverseSyncResult {
  // 1. Execute current graph to get scene items
  const currentResult = executor.execute(graph);
  const currentItems = currentResult.scene.items.filter(isSceneItem);

  // 2. Parse incoming SVG into scene items via temp graph
  const incomingItems = importToSceneItems(incomingSvg, registry);

  // 3. Compute semantic diff
  const diff = computeSemanticDiff(currentItems, incomingItems);

  let changesApplied = 0;
  let modifiedStyles = 0;

  // 4. Apply style changes for matched shapes
  if (diff.matched.some((m) => m.styleChanged)) {
    history.begin('Reverse sync: style update');

    for (const match of diff.matched) {
      if (!match.styleChanged) continue;

      const incomingStyle = match.incomingItem.style;
      if (!incomingStyle.fill) continue;

      // Find the fill node upstream of the terminal node
      const fillNodeId = findUpstreamFillNode(graph, match.currentId);
      if (!fillNodeId) continue;

      const fillNode = graph.getNode(fillNodeId);
      if (!fillNode) continue;

      // Update fill color if it's a solid fill
      if (incomingStyle.fill.type === 'solid') {
        const oldColor = fillNode.params.color;
        const newColor = incomingStyle.fill.color;
        if (oldColor !== newColor) {
          graph.setParam(fillNodeId, 'color', newColor);
          history.recordParamChange(fillNodeId, 'color', oldColor, newColor);
          changesApplied++;
          modifiedStyles++;
        }
      }
    }

    history.commit();
  }

  // 5. Add new shapes as svgPath + fill node chains
  let addedShapes = 0;
  if (diff.added.length > 0) {
    history.begin('Reverse sync: add shapes');

    for (const item of diff.added) {
      // Import the path data as an svgPath node
      const d = commandsToSvgD(item.path.commands);

      const pathNodeId = graph.addNode({ type: 'svgPath', params: { d } });
      const pathNode = graph.getNode(pathNodeId);
      if (pathNode) {
        history.recordAddNode(pathNode);
        changesApplied++;
      }

      // Add fill node if the item has a fill style
      if (item.style.fill && item.style.fill.type === 'solid') {
        const fillNodeId = graph.addNode({
          type: 'fill',
          params: { fillType: 'solid', color: item.style.fill.color },
        });
        const fillNode = graph.getNode(fillNodeId);
        if (fillNode) {
          history.recordAddNode(fillNode);
        }

        const edgeId = graph.addEdge(pathNodeId, 'path', fillNodeId, 'path');
        const edges = graph.getEdges();
        const edge = edges.find((e) => e.id === edgeId);
        if (edge) {
          history.recordAddEdge(edge);
        }
        changesApplied++;
      }

      addedShapes++;
    }

    history.commit();
  }

  return {
    changesApplied,
    addedShapes,
    removedShapes: diff.removed.length,
    modifiedStyles,
    ambiguous: diff.ambiguous,
  };
}
