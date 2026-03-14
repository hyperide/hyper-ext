/**
 * @file VectorGraph — graphology wrapper with DAG enforcement
 *
 * Accessed via: Node graph panel in vector editing mode — every add/remove/connect action
 * Assumptions: all graph mutations go through VectorGraphModel methods — direct graphology access breaks DAG invariant and history tracking
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Graph Model
 */

import { DirectedGraph } from 'graphology';
import { hasCycle, topologicalSort } from 'graphology-dag';
import type { GraphEdge, GraphNode, Point, VectorGraph } from '../types';

interface GraphMeta {
  version: number;
  id: string;
  name: string;
  canvas: { width: number; height: number };
}

interface NodeAttrs {
  type: string;
  params: Record<string, unknown>;
  position?: Point;
}

interface EdgeAttrs {
  id: string;
  sourcePort: string;
  targetPort: string;
}

export class VectorGraphModel {
  private g: DirectedGraph<NodeAttrs, EdgeAttrs>;
  private meta: GraphMeta;
  private mutedSet = new Set<string>();
  private viewport = { zoom: 1, panX: 0, panY: 0 };
  /** Maps logical edge id → graphology edge key for O(1) removeEdge lookup */
  private edgeIdToKey = new Map<string, string>();

  private constructor(meta: GraphMeta) {
    this.g = new DirectedGraph<NodeAttrs, EdgeAttrs>();
    this.meta = meta;
  }

  static create(id: string, name: string, canvasWidth: number, canvasHeight: number): VectorGraphModel {
    return new VectorGraphModel({
      version: 1,
      id,
      name,
      canvas: { width: canvasWidth, height: canvasHeight },
    });
  }

  static fromJSON(json: VectorGraph): VectorGraphModel {
    const model = new VectorGraphModel({
      version: json.version,
      id: json.id,
      name: json.name,
      canvas: json.canvas,
    });
    for (const node of Object.values(json.nodes)) {
      model.g.addNode(node.id, { type: node.type, params: node.params, position: node.position });
    }
    for (const id of json.muted) {
      model.mutedSet.add(id);
    }
    for (const edge of json.edges) {
      const edgeKey = model.g.addDirectedEdge(edge.source, edge.target, {
        id: edge.id,
        sourcePort: edge.sourcePort,
        targetPort: edge.targetPort,
      });
      model.edgeIdToKey.set(edge.id, edgeKey);
    }
    if (hasCycle(model.g)) {
      throw new Error('Loaded graph contains a cycle');
    }
    if (json.viewport) model.viewport = json.viewport;
    return model;
  }

  get nodeCount(): number {
    return this.g.order;
  }

  get edgeCount(): number {
    return this.g.size;
  }

  addNode(opts: { type: string; params: Record<string, unknown>; position?: { x: number; y: number } }): string {
    const id = crypto.randomUUID();
    this.g.addNode(id, { type: opts.type, params: opts.params, position: opts.position });
    return id;
  }

  /** Restore a node with its original ID (used by undo/redo). */
  addNodeWithId(id: string, opts: { type: string; params: Record<string, unknown>; position?: Point }): void {
    this.g.addNode(id, { type: opts.type, params: opts.params, position: opts.position });
  }

  getNode(id: string): GraphNode | undefined {
    if (!this.g.hasNode(id)) return undefined;
    const attrs = this.g.getNodeAttributes(id);
    return {
      id,
      type: attrs.type,
      params: attrs.params,
      position: attrs.position,
    };
  }

  removeNode(id: string): GraphEdge[] {
    const removedEdges = this.getNodeEdges(id);
    // Clean up edgeIdToKey for all edges being removed
    for (const edge of removedEdges) {
      this.edgeIdToKey.delete(edge.id);
    }
    this.g.dropNode(id);
    this.mutedSet.delete(id);
    return removedEdges;
  }

  addEdge(source: string, sourcePort: string, target: string, targetPort: string): string {
    const id = crypto.randomUUID();
    const edgeKey = this.g.addDirectedEdge(source, target, { id, sourcePort, targetPort });
    if (hasCycle(this.g)) {
      this.g.dropEdge(edgeKey);
      throw new Error(`Adding edge ${source} → ${target} would create a cycle`);
    }
    this.edgeIdToKey.set(id, edgeKey);
    return id;
  }

  /** Restore an edge with its original ID (used by undo/redo). */
  addEdgeWithId(id: string, source: string, sourcePort: string, target: string, targetPort: string): void {
    const edgeKey = this.g.addDirectedEdge(source, target, { id, sourcePort, targetPort });
    if (hasCycle(this.g)) {
      this.g.dropEdge(edgeKey);
      throw new Error(`Restoring edge ${source} → ${target} would create a cycle`);
    }
    this.edgeIdToKey.set(id, edgeKey);
  }

  removeEdge(edgeId: string): void {
    const edgeKey = this.edgeIdToKey.get(edgeId);
    if (edgeKey) {
      this.g.dropEdge(edgeKey);
      this.edgeIdToKey.delete(edgeId);
    }
  }

  getInputEdges(nodeId: string): GraphEdge[] {
    return this.g.inEdges(nodeId).map((edgeKey) => {
      const attrs = this.g.getEdgeAttributes(edgeKey);
      const [source, target] = this.g.extremities(edgeKey);
      return {
        id: attrs.id,
        source,
        target,
        sourcePort: attrs.sourcePort,
        targetPort: attrs.targetPort,
      };
    });
  }

  getNodeEdges(nodeId: string): GraphEdge[] {
    return this.g.edges(nodeId).map((edgeKey) => {
      const attrs = this.g.getEdgeAttributes(edgeKey);
      const [source, target] = this.g.extremities(edgeKey);
      return {
        id: attrs.id,
        source,
        target,
        sourcePort: attrs.sourcePort,
        targetPort: attrs.targetPort,
      };
    });
  }

  setParam(nodeId: string, param: string, value: unknown): void {
    const attrs = this.g.getNodeAttributes(nodeId);
    this.g.setNodeAttribute(nodeId, 'params', { ...attrs.params, [param]: value });
  }

  setPosition(nodeId: string, position: { x: number; y: number }): void {
    this.g.setNodeAttribute(nodeId, 'position', position);
  }

  isMuted(nodeId: string): boolean {
    return this.mutedSet.has(nodeId);
  }

  setMuted(nodeId: string, muted: boolean): void {
    if (muted) this.mutedSet.add(nodeId);
    else this.mutedSet.delete(nodeId);
  }

  topologicalOrder(): string[] {
    return topologicalSort(this.g);
  }

  getCanvas(): { width: number; height: number } {
    return this.meta.canvas;
  }

  getEdges(): GraphEdge[] {
    const edges: GraphEdge[] = [];
    this.g.forEachEdge((_edgeKey, attrs, source, target) => {
      edges.push({
        id: attrs.id,
        source,
        target,
        sourcePort: attrs.sourcePort,
        targetPort: attrs.targetPort,
      });
    });
    return edges;
  }

  forEachEdge(callback: (edge: GraphEdge) => void): void {
    this.g.forEachEdge((_edgeKey, attrs, source, target) => {
      callback({
        id: attrs.id,
        source,
        target,
        sourcePort: attrs.sourcePort,
        targetPort: attrs.targetPort,
      });
    });
  }

  toJSON(): VectorGraph {
    const nodes: Record<string, GraphNode> = {};
    this.g.forEachNode((id, attrs) => {
      nodes[id] = {
        id,
        type: attrs.type,
        params: attrs.params,
        position: attrs.position,
      };
    });

    const edges = this.getEdges();

    return {
      version: this.meta.version,
      id: this.meta.id,
      name: this.meta.name,
      canvas: this.meta.canvas,
      viewport: this.viewport,
      nodes,
      edges,
      muted: [...this.mutedSet],
    };
  }
}
