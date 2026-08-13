import { describe, expect, it } from 'bun:test';
import { type FigNode, parseFigFile } from './fig-import';
import { mapFigToGraph } from './fig-mapper';

function buildTriangleBlob(): Uint8Array {
  const buf = new ArrayBuffer(512);
  const view = new DataView(buf);
  let offset = 0;

  // Header: 3 counts together
  view.setUint32(offset, 3, true);
  offset += 4; // vertexCount
  view.setUint32(offset, 3, true);
  offset += 4; // segmentCount
  view.setUint32(offset, 1, true);
  offset += 4; // regionCount

  // 3 vertices: styleOverrideIdx(u32) + x(f32) + y(f32) = 12 bytes each
  for (const [x, y] of [
    [0, 0],
    [100, 0],
    [50, 86.6],
  ]) {
    view.setUint32(offset, 0, true);
    offset += 4; // styleOverrideIdx
    view.setFloat32(offset, x, true);
    offset += 4;
    view.setFloat32(offset, y, true);
    offset += 4;
  }

  // 3 segments: styleOverrideIdx(u32) + start(u32) + tsX(f32) + tsY(f32) + end(u32) + teX(f32) + teY(f32) = 28 bytes each
  for (const [s, e] of [
    [0, 1],
    [1, 2],
    [2, 0],
  ]) {
    view.setUint32(offset, 0, true);
    offset += 4; // styleOverrideIdx
    view.setUint32(offset, s, true);
    offset += 4; // start
    view.setFloat32(offset, 0, true);
    offset += 4; // tangentStart.x
    view.setFloat32(offset, 0, true);
    offset += 4; // tangentStart.y
    view.setUint32(offset, e, true);
    offset += 4; // end
    view.setFloat32(offset, 0, true);
    offset += 4; // tangentEnd.x
    view.setFloat32(offset, 0, true);
    offset += 4; // tangentEnd.y
  }

  // 1 region: windingRule(u32) + loopCount(u32) + loop
  view.setUint32(offset, 1, true);
  offset += 4; // nonZero = 1
  view.setUint32(offset, 1, true);
  offset += 4; // 1 loop
  view.setUint32(offset, 3, true);
  offset += 4; // 3 segments in loop
  for (const idx of [0, 1, 2]) {
    view.setUint32(offset, idx, true);
    offset += 4;
  }

  return new Uint8Array(buf, 0, offset);
}

describe('FIG import', () => {
  it('should export parseFigFile function', () => {
    expect(typeof parseFigFile).toBe('function');
  });

  it('should return empty result for empty data', () => {
    const result = parseFigFile(new ArrayBuffer(0));
    expect(result.nodes).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Empty file');
  });

  it('should return errors for malformed input', () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const result = parseFigFile(garbage.buffer);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should have correct output shape', () => {
    const result = parseFigFile(new ArrayBuffer(0));
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('canvas');
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('should handle non-zip binary data gracefully', () => {
    // Data that doesn't start with PK magic
    const data = new Uint8Array(100);
    data[0] = 0xff;
    const result = parseFigFile(data.buffer);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should report "too small" for tiny binary data', () => {
    const data = new Uint8Array([0xff, 0x01, 0x02]);
    const result = parseFigFile(data.buffer);
    expect(result.errors).toContain('File too small to contain valid Kiwi data');
  });
});

describe('FIG node mapper', () => {
  it('should map RECTANGLE to rectangle node', () => {
    const figNodes: FigNode[] = [
      {
        type: 'RECTANGLE',
        name: 'Rect1',
        id: 'node-1',
        children: [],
        properties: { width: 100, height: 50, x: 10, y: 20 },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    const rect = result.nodes.find((n) => n.type === 'rectangle');
    expect(rect).toBeDefined();
    expect(rect?.params.width).toBe(100);
    expect(rect?.params.height).toBe(50);
    expect(rect?.params.x).toBe(10);
    expect(rect?.params.y).toBe(20);
  });

  it('should map ELLIPSE to ellipse node', () => {
    const figNodes: FigNode[] = [
      {
        type: 'ELLIPSE',
        name: 'Circle',
        id: 'node-2',
        children: [],
        properties: { width: 100, height: 100 },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    const ellipse = result.nodes.find((n) => n.type === 'ellipse');
    expect(ellipse).toBeDefined();
    expect(ellipse?.params.rx).toBe(50);
    expect(ellipse?.params.ry).toBe(50);
  });

  it('should map VECTOR to svgPath', () => {
    const figNodes: FigNode[] = [
      {
        type: 'VECTOR',
        name: 'Path',
        id: 'node-3',
        children: [],
        properties: { fillGeometry: 'M 0 0 L 100 0 Z' },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    const pathNode = result.nodes.find((n) => n.type === 'svgPath');
    expect(pathNode).toBeDefined();
    expect(pathNode?.params.d).toBe('M 0 0 L 100 0 Z');
  });

  it('should map LINE node', () => {
    const figNodes: FigNode[] = [
      {
        type: 'LINE',
        name: 'Line1',
        id: 'node-l1',
        children: [],
        properties: { width: 200 },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    const lineNode = result.nodes.find((n) => n.type === 'line');
    expect(lineNode).toBeDefined();
    expect(lineNode?.params.x2).toBe(200);
  });

  it('should map BOOLEAN_OPERATION with different operations', () => {
    const ops = ['UNION', 'SUBTRACT', 'INTERSECT', 'EXCLUDE'] as const;
    const expected = ['booleanUnion', 'booleanSubtract', 'booleanIntersect', 'booleanXor'];

    for (let i = 0; i < ops.length; i++) {
      const figNodes: FigNode[] = [
        {
          type: 'BOOLEAN_OPERATION',
          name: 'Bool',
          id: `bool-${i}`,
          children: [],
          properties: { booleanOperation: ops[i] },
        },
      ];
      const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
      const boolNode = result.nodes.find((n) => n.type === expected[i]);
      expect(boolNode).toBeDefined();
    }
  });

  it('should map GROUP with children and create edges', () => {
    const figNodes: FigNode[] = [
      {
        type: 'GROUP',
        name: 'G1',
        id: 'node-4',
        children: [
          {
            type: 'RECTANGLE',
            name: 'Child',
            id: 'node-5',
            children: [],
            properties: { width: 50, height: 50 },
          },
        ],
        properties: {},
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    expect(result.nodes.find((n) => n.type === 'group')).toBeDefined();
    expect(result.nodes.find((n) => n.type === 'rectangle')).toBeDefined();
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
    // Child should be wired to group
    const childEdge = result.edges.find((e) => e.targetPort === 'children');
    expect(childEdge).toBeDefined();
  });

  it('should map FRAME same as GROUP', () => {
    const figNodes: FigNode[] = [
      {
        type: 'FRAME',
        name: 'Frame1',
        id: 'node-f1',
        children: [
          {
            type: 'ELLIPSE',
            name: 'E',
            id: 'node-e1',
            children: [],
            properties: { width: 80, height: 80 },
          },
        ],
        properties: {},
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    expect(result.nodes.find((n) => n.type === 'group')).toBeDefined();
    expect(result.nodes.find((n) => n.type === 'ellipse')).toBeDefined();
  });

  it('should add fill node for solid fills', () => {
    const figNodes: FigNode[] = [
      {
        type: 'RECTANGLE',
        name: 'Colored',
        id: 'node-6',
        children: [],
        properties: {
          width: 100,
          height: 100,
          fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }],
        },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    const fill = result.nodes.find((n) => n.type === 'fill');
    expect(fill).toBeDefined();
    expect(fill?.params.color).toBe('#ff0000');
  });

  it('should handle unknown types gracefully', () => {
    const figNodes: FigNode[] = [
      {
        type: 'UNKNOWN_FANCY',
        name: 'X',
        id: 'node-99',
        children: [],
        properties: {},
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    expect(result.nodes.length).toBe(0);
  });

  it('should map TEXT to textToPath', () => {
    const figNodes: FigNode[] = [
      {
        type: 'TEXT',
        name: 'Label',
        id: 'node-7',
        children: [],
        properties: { characters: 'Hello', fontSize: 24 },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    const textNode = result.nodes.find((n) => n.type === 'textToPath');
    expect(textNode).toBeDefined();
    expect(textNode?.params.text).toBe('Hello');
    expect(textNode?.params.fontSize).toBe(24);
  });

  it('should map strokes', () => {
    const figNodes: FigNode[] = [
      {
        type: 'RECTANGLE',
        name: 'Stroked',
        id: 'node-8',
        children: [],
        properties: {
          width: 100,
          height: 100,
          strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
          strokeWeight: 2,
        },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    const stroke = result.nodes.find((n) => n.type === 'stroke');
    expect(stroke).toBeDefined();
    expect(stroke?.params.width).toBe(2);
    expect(stroke?.params.color).toBe('#000000');
  });

  it('should pass canvas dimensions through', () => {
    const result = mapFigToGraph([], { width: 800, height: 600 });
    expect(result.canvas).toEqual({ width: 800, height: 600 });
  });

  it('should create edges for both fill and stroke on same node', () => {
    const figNodes: FigNode[] = [
      {
        type: 'RECTANGLE',
        name: 'Both',
        id: 'node-10',
        children: [],
        properties: {
          width: 100,
          height: 100,
          fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
          strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
          strokeWeight: 1,
        },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    expect(result.nodes.find((n) => n.type === 'fill')).toBeDefined();
    expect(result.nodes.find((n) => n.type === 'stroke')).toBeDefined();
    // rect → fill edge + rect → stroke edge
    const fillEdge = result.edges.find((e) => {
      const targetNode = result.nodes.find((n) => n.id === e.target);
      return targetNode?.type === 'fill';
    });
    const strokeEdge = result.edges.find((e) => {
      const targetNode = result.nodes.find((n) => n.id === e.target);
      return targetNode?.type === 'stroke';
    });
    expect(fillEdge).toBeDefined();
    expect(strokeEdge).toBeDefined();
  });

  it('should skip non-SOLID fills', () => {
    const figNodes: FigNode[] = [
      {
        type: 'RECTANGLE',
        name: 'Gradient',
        id: 'node-11',
        children: [],
        properties: {
          width: 100,
          height: 100,
          fills: [{ type: 'GRADIENT_LINEAR' }],
        },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    expect(result.nodes.find((n) => n.type === 'fill')).toBeUndefined();
  });

  it('should use defaults when properties are missing', () => {
    const figNodes: FigNode[] = [
      {
        type: 'RECTANGLE',
        name: 'NoProps',
        id: 'node-12',
        children: [],
        properties: {},
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    const rect = result.nodes.find((n) => n.type === 'rectangle');
    expect(rect).toBeDefined();
    expect(rect?.params.width).toBe(100);
    expect(rect?.params.height).toBe(100);
  });
});

describe('FIG mapper with vectorNetworkBlob', () => {
  it('should decode VECTOR node with binary blob', () => {
    const blob = buildTriangleBlob();
    const figNodes: FigNode[] = [
      {
        type: 'VECTOR',
        name: 'Triangle',
        id: 'v1',
        children: [],
        properties: { vectorNetworkBlob: Array.from(blob) },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    const pathNode = result.nodes.find((n) => n.type === 'svgPath');
    expect(pathNode).toBeDefined();
    // Triangle blob decodes to a full SVG path string (e.g. "M 0 0 L 100 0 L 50 86.6 L 0 0 Z").
    // The previous `toHaveLength(1)` was a botched refactor of the original
    // `.length).toBeGreaterThan(0)` intent (commit 5b341504) — a 1-char path is impossible.
    expect((pathNode!.params.d as string).length).toBeGreaterThan(0);
    expect(pathNode!.params.d as string).toContain('M');
  });

  it('should fallback to fillGeometry when no blob', () => {
    const figNodes: FigNode[] = [
      {
        type: 'VECTOR',
        name: 'P',
        id: 'v2',
        children: [],
        properties: { fillGeometry: 'M 0 0 L 100 0 Z' },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    const pathNode = result.nodes.find((n) => n.type === 'svgPath');
    expect(pathNode).toBeDefined();
    expect(pathNode?.params.d).toBe('M 0 0 L 100 0 Z');
  });

  it('should fallback when blob is empty/invalid', () => {
    const figNodes: FigNode[] = [
      {
        type: 'VECTOR',
        name: 'Empty',
        id: 'v3',
        children: [],
        properties: { vectorNetworkBlob: [0, 1, 2], fillGeometry: 'M 0 0 L 50 0 Z' },
      },
    ];
    const result = mapFigToGraph(figNodes, { width: 400, height: 300 });
    const pathNode = result.nodes.find((n) => n.type === 'svgPath');
    expect(pathNode?.params.d).toBe('M 0 0 L 50 0 Z');
  });
});
