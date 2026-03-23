/**
 * @file Tests for binary codec — encodes/decodes VectorGraphFile to compact binary
 *
 * Accessed via: Internal module, not exposed
 */

import { describe, expect, it } from 'bun:test';
import { decodeGraphFile, encodeGraphFile } from './kiwi-codec';
import type { VectorGraphFile } from './types';

describe('Kiwi binary codec', () => {
  const sampleFile: VectorGraphFile = {
    version: 1,
    meta: { componentPath: 'src/icons/Arrow.tsx', svgElementId: 'svg-1' },
    base: {
      canvas: { width: 100, height: 100 },
      nodes: {
        n1: { id: 'n1', type: 'rectangle', params: { width: 50, height: 50, x: 0, y: 0 } },
      },
      edges: [],
      muted: [],
    },
    operations: [
      {
        timestamp: 1710000000000,
        description: 'Add rectangle',
        diffs: [
          {
            kind: 'addNode',
            node: { id: 'n1', type: 'rectangle', params: { width: 50 } },
          },
        ],
      },
    ],
    undoPointer: 1,
    viewport: { zoom: 1, panX: 0, panY: 0 },
  };

  it('should encode to Uint8Array', () => {
    const binary = encodeGraphFile(sampleFile);
    expect(binary).toBeInstanceOf(Uint8Array);
    expect(binary.length).toBeGreaterThan(0);
  });

  it('should be smaller than JSON', () => {
    const binary = encodeGraphFile(sampleFile);
    const jsonSize = new TextEncoder().encode(JSON.stringify(sampleFile)).length;
    expect(binary.length).toBeLessThan(jsonSize);
  });

  it('should roundtrip preserve all data', () => {
    const binary = encodeGraphFile(sampleFile);
    const decoded = decodeGraphFile(binary);
    expect(decoded.version).toBe(1);
    expect(decoded.meta.componentPath).toBe('src/icons/Arrow.tsx');
    expect(decoded.meta.svgElementId).toBe('svg-1');
    expect(Object.keys(decoded.base.nodes).length).toBe(1);
    expect(decoded.base.nodes.n1.type).toBe('rectangle');
    expect(decoded.base.nodes.n1.params.width).toBe(50);
    expect(decoded.undoPointer).toBe(1);
    expect(decoded.viewport.zoom).toBe(1);
    expect(decoded.operations.length).toBe(1);
    expect(decoded.operations[0].description).toBe('Add rectangle');
  });

  it('should handle empty graph', () => {
    const empty: VectorGraphFile = {
      version: 1,
      meta: { componentPath: '' },
      base: { canvas: { width: 0, height: 0 }, nodes: {}, edges: [], muted: [] },
      operations: [],
      undoPointer: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
    };
    const binary = encodeGraphFile(empty);
    const decoded = decodeGraphFile(binary);
    expect(decoded.version).toBe(1);
    expect(Object.keys(decoded.base.nodes).length).toBe(0);
  });

  it('should handle graph with edges and muted nodes', () => {
    const file: VectorGraphFile = {
      version: 1,
      meta: { componentPath: 'test.tsx' },
      base: {
        canvas: { width: 200, height: 200 },
        nodes: {
          n1: { id: 'n1', type: 'rectangle', params: { width: 100 } },
          n2: { id: 'n2', type: 'fill', params: { type: 'solid', color: '#ff0000' } },
        },
        edges: [{ id: 'e1', source: 'n1', target: 'n2', sourcePort: 'path', targetPort: 'path' }],
        muted: ['n2'],
      },
      operations: [],
      undoPointer: 0,
      viewport: { zoom: 2, panX: 50, panY: -30 },
    };
    const binary = encodeGraphFile(file);
    const decoded = decodeGraphFile(binary);
    expect(decoded.base.edges.length).toBe(1);
    expect(decoded.base.edges[0].source).toBe('n1');
    expect(decoded.base.muted).toEqual(['n2']);
    expect(decoded.viewport.zoom).toBe(2);
    expect(decoded.viewport.panX).toBe(50);
  });

  it('should handle all GraphDiff kinds in operations', () => {
    const file: VectorGraphFile = {
      version: 1,
      meta: { componentPath: '' },
      base: { canvas: { width: 100, height: 100 }, nodes: {}, edges: [], muted: [] },
      operations: [
        {
          timestamp: 1,
          description: 'param change',
          diffs: [{ kind: 'paramChange', nodeId: 'n1', param: 'width', oldValue: 50, newValue: 100 }],
        },
        {
          timestamp: 2,
          description: 'mute',
          diffs: [{ kind: 'muteNode', nodeId: 'n1', muted: true }],
        },
        {
          timestamp: 3,
          description: 'move',
          diffs: [
            {
              kind: 'moveNode',
              nodeId: 'n1',
              oldPosition: { x: 0, y: 0 },
              newPosition: { x: 50, y: 50 },
            },
          ],
        },
      ],
      undoPointer: 3,
      viewport: { zoom: 1, panX: 0, panY: 0 },
    };
    const binary = encodeGraphFile(file);
    const decoded = decodeGraphFile(binary);
    expect(decoded.operations.length).toBe(3);
    expect(decoded.operations[0].diffs[0].kind).toBe('paramChange');
    expect(decoded.operations[1].diffs[0].kind).toBe('muteNode');
    expect(decoded.operations[2].diffs[0].kind).toBe('moveNode');
  });

  it('should handle removeNode diff with removedEdges and muted flag', () => {
    const file: VectorGraphFile = {
      version: 1,
      meta: { componentPath: '' },
      base: { canvas: { width: 100, height: 100 }, nodes: {}, edges: [], muted: [] },
      operations: [
        {
          timestamp: 1,
          description: 'remove node',
          diffs: [
            {
              kind: 'removeNode',
              node: { id: 'n1', type: 'rectangle', params: { width: 50 } },
              removedEdges: [{ id: 'e1', source: 'n1', target: 'n2', sourcePort: 'path', targetPort: 'path' }],
              muted: true,
            },
          ],
        },
      ],
      undoPointer: 1,
      viewport: { zoom: 1, panX: 0, panY: 0 },
    };
    const binary = encodeGraphFile(file);
    const decoded = decodeGraphFile(binary);
    const diff = decoded.operations[0].diffs[0];
    expect(diff.kind).toBe('removeNode');
    if (diff.kind === 'removeNode') {
      expect(diff.node.id).toBe('n1');
      expect(diff.removedEdges.length).toBe(1);
      expect(diff.removedEdges[0].id).toBe('e1');
      expect(diff.muted).toBe(true);
    }
  });

  it('should handle addEdge and removeEdge diffs', () => {
    const file: VectorGraphFile = {
      version: 1,
      meta: { componentPath: '' },
      base: { canvas: { width: 100, height: 100 }, nodes: {}, edges: [], muted: [] },
      operations: [
        {
          timestamp: 1,
          description: 'add edge',
          diffs: [
            {
              kind: 'addEdge',
              edge: { id: 'e1', source: 'n1', target: 'n2', sourcePort: 'out', targetPort: 'in' },
            },
          ],
        },
        {
          timestamp: 2,
          description: 'remove edge',
          diffs: [
            {
              kind: 'removeEdge',
              edge: { id: 'e1', source: 'n1', target: 'n2', sourcePort: 'out', targetPort: 'in' },
            },
          ],
        },
      ],
      undoPointer: 2,
      viewport: { zoom: 1, panX: 0, panY: 0 },
    };
    const binary = encodeGraphFile(file);
    const decoded = decodeGraphFile(binary);
    expect(decoded.operations[0].diffs[0].kind).toBe('addEdge');
    expect(decoded.operations[1].diffs[0].kind).toBe('removeEdge');
    if (decoded.operations[0].diffs[0].kind === 'addEdge') {
      expect(decoded.operations[0].diffs[0].edge.sourcePort).toBe('out');
    }
  });

  it('should handle node with position', () => {
    const file: VectorGraphFile = {
      version: 1,
      meta: { componentPath: '' },
      base: {
        canvas: { width: 100, height: 100 },
        nodes: {
          n1: { id: 'n1', type: 'rect', params: {}, position: { x: 10, y: 20 } },
        },
        edges: [],
        muted: [],
      },
      operations: [],
      undoPointer: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
    };
    const binary = encodeGraphFile(file);
    const decoded = decodeGraphFile(binary);
    expect(decoded.base.nodes.n1.position).toEqual({ x: 10, y: 20 });
  });

  it('should handle meta with optional lastExportTimestamp', () => {
    const file: VectorGraphFile = {
      version: 1,
      meta: { componentPath: 'test.tsx', svgElementId: 'svg-2', lastExportTimestamp: 1710000000000 },
      base: { canvas: { width: 0, height: 0 }, nodes: {}, edges: [], muted: [] },
      operations: [],
      undoPointer: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
    };
    const binary = encodeGraphFile(file);
    const decoded = decodeGraphFile(binary);
    expect(decoded.meta.lastExportTimestamp).toBe(1710000000000);
  });

  it('should start with VGRF magic bytes', () => {
    const binary = encodeGraphFile(sampleFile);
    const magic = String.fromCharCode(binary[0], binary[1], binary[2], binary[3]);
    expect(magic).toBe('VGRF');
  });

  it('should reject invalid magic bytes', () => {
    const binary = encodeGraphFile(sampleFile);
    binary[0] = 0;
    expect(() => decodeGraphFile(binary)).toThrow();
  });
});
