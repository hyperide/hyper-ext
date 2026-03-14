import { beforeEach, describe, expect, it } from 'bun:test';
import { VectorGraphModel } from './vector-graph';

describe('VectorGraphModel', () => {
  let graph: VectorGraphModel;

  beforeEach(() => {
    graph = VectorGraphModel.create('test', 'Test Graph', 800, 600);
  });

  it('should create an empty graph', () => {
    expect(graph.nodeCount).toBe(0);
    expect(graph.edgeCount).toBe(0);
    expect(graph.toJSON().name).toBe('Test Graph');
  });

  it('should add and retrieve nodes', () => {
    const id = graph.addNode({ type: 'rectangle', params: { width: 100, height: 50 } });
    expect(graph.getNode(id)).toBeDefined();
    expect(graph.getNode(id)?.type).toBe('rectangle');
    expect(graph.nodeCount).toBe(1);
  });

  it('should remove nodes and their edges', () => {
    const n1 = graph.addNode({ type: 'rectangle', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    expect(graph.edgeCount).toBe(1);
    graph.removeNode(n1);
    expect(graph.nodeCount).toBe(1);
    expect(graph.edgeCount).toBe(0);
  });

  it('should add edges between nodes', () => {
    const n1 = graph.addNode({ type: 'rectangle', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    const edgeId = graph.addEdge(n1, 'path', n2, 'path');
    expect(edgeId).toBeDefined();
    expect(graph.edgeCount).toBe(1);
  });

  it('should reject cycles', () => {
    const n1 = graph.addNode({ type: 'a', params: {} });
    const n2 = graph.addNode({ type: 'b', params: {} });
    graph.addEdge(n1, 'out', n2, 'in');
    expect(() => graph.addEdge(n2, 'out', n1, 'in')).toThrow(/cycle/i);
  });

  it('should return topological order', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    const n2 = graph.addNode({ type: 'offset', params: {} });
    const n3 = graph.addNode({ type: 'fill', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    graph.addEdge(n2, 'path', n3, 'path');
    const order = graph.topologicalOrder();
    expect(order.indexOf(n1)).toBeLessThan(order.indexOf(n2));
    expect(order.indexOf(n2)).toBeLessThan(order.indexOf(n3));
  });

  it('should get input edges for a node', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    const inputs = graph.getInputEdges(n2);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].source).toBe(n1);
  });

  it('should serialize and deserialize', () => {
    const n1 = graph.addNode({ type: 'rect', params: { width: 100 } });
    const n2 = graph.addNode({ type: 'fill', params: { color: '#f00' } });
    graph.addEdge(n1, 'path', n2, 'path');

    const json = graph.toJSON();
    const restored = VectorGraphModel.fromJSON(json);
    expect(restored.nodeCount).toBe(2);
    expect(restored.edgeCount).toBe(1);
    expect(restored.getNode(n1)?.params.width).toBe(100);
  });

  it('should set and get muted state', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    expect(graph.isMuted(n1)).toBe(false);
    graph.setMuted(n1, true);
    expect(graph.isMuted(n1)).toBe(true);
  });

  it('should set param value', () => {
    const n1 = graph.addNode({ type: 'rect', params: { width: 100 } });
    graph.setParam(n1, 'width', 200);
    expect(graph.getNode(n1)?.params.width).toBe(200);
  });

  it('should set node position', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    graph.setPosition(n1, { x: 100, y: 200 });
    expect(graph.getNode(n1)?.position).toEqual({ x: 100, y: 200 });
  });

  it('should remove edge by id', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    const edgeId = graph.addEdge(n1, 'path', n2, 'path');
    expect(graph.edgeCount).toBe(1);
    graph.removeEdge(edgeId);
    expect(graph.edgeCount).toBe(0);
  });

  it('should get all edges for a node', () => {
    const n1 = graph.addNode({ type: 'rect', params: {} });
    const n2 = graph.addNode({ type: 'fill', params: {} });
    const n3 = graph.addNode({ type: 'stroke', params: {} });
    graph.addEdge(n1, 'path', n2, 'path');
    graph.addEdge(n1, 'path', n3, 'path');
    const edges = graph.getNodeEdges(n1);
    expect(edges).toHaveLength(2);
  });

  describe('addNodeWithId', () => {
    it('should restore a node with a specific id', () => {
      const id = 'fixed-uuid-1234';
      graph.addNodeWithId(id, { type: 'rectangle', params: { width: 50 } });
      expect(graph.nodeCount).toBe(1);
      const node = graph.getNode(id);
      expect(node).toBeDefined();
      expect(node?.id).toBe(id);
      expect(node?.type).toBe('rectangle');
      expect(node?.params.width).toBe(50);
    });

    it('should preserve position when restoring a node', () => {
      const id = 'fixed-uuid-5678';
      graph.addNodeWithId(id, { type: 'ellipse', params: {}, position: { x: 10, y: 20 } });
      expect(graph.getNode(id)?.position).toEqual({ x: 10, y: 20 });
    });
  });

  describe('addEdgeWithId', () => {
    it('should restore an edge with a specific id', () => {
      const n1 = graph.addNode({ type: 'rect', params: {} });
      const n2 = graph.addNode({ type: 'fill', params: {} });
      const edgeId = 'edge-uuid-abcd';
      graph.addEdgeWithId(edgeId, n1, 'path', n2, 'path');
      expect(graph.edgeCount).toBe(1);
      const edges = graph.getInputEdges(n2);
      expect(edges[0].id).toBe(edgeId);
      expect(edges[0].sourcePort).toBe('path');
      expect(edges[0].targetPort).toBe('path');
    });

    it('should reject an edge that would create a cycle', () => {
      const n1 = graph.addNode({ type: 'a', params: {} });
      const n2 = graph.addNode({ type: 'b', params: {} });
      graph.addEdge(n1, 'out', n2, 'in');
      expect(() => graph.addEdgeWithId('cycle-edge', n2, 'out', n1, 'in')).toThrow(/cycle/i);
      // Edge must be rolled back — still only one edge
      expect(graph.edgeCount).toBe(1);
    });
  });

  describe('fromJSON', () => {
    it('should throw when loaded JSON contains a cycle', () => {
      // Build a valid graph and get its JSON, then manually inject a back-edge
      const n1 = graph.addNode({ type: 'a', params: {} });
      const n2 = graph.addNode({ type: 'b', params: {} });
      const json = graph.toJSON();
      // Inject a cyclic edge directly into the serialized form
      json.edges.push({ id: 'bad-edge', source: n1, target: n2, sourcePort: 'out', targetPort: 'in' });
      json.edges.push({ id: 'cycle-edge', source: n2, target: n1, sourcePort: 'out', targetPort: 'in' });
      expect(() => VectorGraphModel.fromJSON(json)).toThrow(/cycle/i);
    });
  });
});
