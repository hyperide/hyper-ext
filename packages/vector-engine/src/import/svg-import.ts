/**
 * @file SVG import — parse SVG string into vector-engine graph description
 *
 * Accessed via: "Open SVG" action, import from JSX component
 * Tradeoffs: uses txml (4KB, MIT) for XML parsing. Handles well-formed SVG from
 *   design tools. No CSS cascade or advanced features (filters, patterns).
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §SVG Import
 */

import { parse } from 'txml';

export interface ImportedNode {
  id: string;
  type: string;
  params: Record<string, unknown>;
}

export interface ImportedEdge {
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface ImportResult {
  nodes: ImportedNode[];
  edges: ImportedEdge[];
  canvas: { width: number; height: number };
}

interface TxmlNode {
  tagName: string;
  attributes: Record<string, string>;
  children: (TxmlNode | string)[];
}

function isTxmlNode(v: TxmlNode | string): v is TxmlNode {
  return typeof v === 'object';
}

let _idCounter = 0;

function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${_idCounter}`;
}

function parseNum(v: string | undefined, fallback = 0): number {
  if (v === undefined) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Convert SVG points attribute ("x1,y1 x2,y2 ...") to a d-string. */
function pointsToD(points: string, close: boolean): string {
  const pairs = points
    .trim()
    .split(/[\s,]+/)
    .reduce<number[][]>((acc, _, i, arr) => {
      if (i % 2 === 0) acc.push([Number.parseFloat(arr[i]), Number.parseFloat(arr[i + 1])]);
      return acc;
    }, []);

  if (pairs.length === 0) return '';
  const [first, ...rest] = pairs;
  let d = `M ${first[0]} ${first[1]}`;
  for (const [x, y] of rest) {
    d += ` L ${x} ${y}`;
  }
  if (close) d += ' Z';
  return d;
}

/** Parse a transform attribute into {type, params} if it's a simple single-function transform. */
function parseTransformAttr(transform: string): { type: string; params: Record<string, unknown> } | null {
  const m = transform.trim().match(/^(\w+)\(([^)]+)\)$/);
  if (!m) return null;
  const [, fn, args] = m;
  const nums = args.split(/[\s,]+/).map(Number.parseFloat);

  if (fn === 'translate') {
    return { type: 'translate', params: { dx: nums[0] ?? 0, dy: nums[1] ?? 0 } };
  }
  if (fn === 'rotate') {
    return { type: 'rotate', params: { angle: nums[0] ?? 0, originX: nums[1] ?? 0, originY: nums[2] ?? 0 } };
  }
  if (fn === 'scale') {
    return { type: 'scale', params: { sx: nums[0] ?? 1, sy: nums[1] ?? nums[0] ?? 1 } };
  }
  if (fn === 'matrix') {
    return {
      type: 'matrix',
      params: { a: nums[0], b: nums[1], c: nums[2], d: nums[3], e: nums[4], f: nums[5] },
    };
  }
  return null;
}

function walkElement(node: TxmlNode, nodes: ImportedNode[], edges: ImportedEdge[]): string | null {
  const { tagName, attributes } = node;
  let generatorId: string | null = null;

  if (tagName === 'rect') {
    const id = nextId('rect');
    nodes.push({
      id,
      type: 'rectangle',
      params: {
        x: parseNum(attributes.x),
        y: parseNum(attributes.y),
        width: parseNum(attributes.width),
        height: parseNum(attributes.height),
      },
    });
    generatorId = id;
  } else if (tagName === 'circle') {
    const id = nextId('ellipse');
    const r = parseNum(attributes.r);
    nodes.push({
      id,
      type: 'ellipse',
      params: {
        rx: r,
        ry: r,
        cx: parseNum(attributes.cx),
        cy: parseNum(attributes.cy),
      },
    });
    generatorId = id;
  } else if (tagName === 'ellipse') {
    const id = nextId('ellipse');
    nodes.push({
      id,
      type: 'ellipse',
      params: {
        rx: parseNum(attributes.rx),
        ry: parseNum(attributes.ry),
        cx: parseNum(attributes.cx),
        cy: parseNum(attributes.cy),
      },
    });
    generatorId = id;
  } else if (tagName === 'line') {
    const id = nextId('line');
    nodes.push({
      id,
      type: 'line',
      params: {
        x1: parseNum(attributes.x1),
        y1: parseNum(attributes.y1),
        x2: parseNum(attributes.x2),
        y2: parseNum(attributes.y2),
      },
    });
    generatorId = id;
  } else if (tagName === 'path') {
    const id = nextId('path');
    nodes.push({
      id,
      type: 'svgPath',
      params: { d: attributes.d ?? '' },
    });
    generatorId = id;
  } else if (tagName === 'polygon') {
    const id = nextId('path');
    nodes.push({
      id,
      type: 'svgPath',
      params: { d: pointsToD(attributes.points ?? '', true) },
    });
    generatorId = id;
  } else if (tagName === 'polyline') {
    const id = nextId('path');
    nodes.push({
      id,
      type: 'svgPath',
      params: { d: pointsToD(attributes.points ?? '', false) },
    });
    generatorId = id;
  } else if (tagName === 'g') {
    const groupId = nextId('group');
    nodes.push({ id: groupId, type: 'group', params: {} });

    for (const child of node.children) {
      if (!isTxmlNode(child)) continue;
      const childId = walkElement(child, nodes, edges);
      if (childId !== null) {
        edges.push({ source: childId, sourcePort: 'path', target: groupId, targetPort: 'path' });
      }
    }
    generatorId = groupId;
  }

  if (generatorId === null) return null;

  let lastId = generatorId;

  // Apply fill
  const fill = attributes.fill;
  if (fill !== undefined && fill !== 'none') {
    const fillId = nextId('fill');
    nodes.push({ id: fillId, type: 'fill', params: { type: 'solid', color: fill } });
    edges.push({ source: lastId, sourcePort: 'path', target: fillId, targetPort: 'path' });
    lastId = fillId;
  }

  // Apply stroke
  const stroke = attributes.stroke;
  if (stroke !== undefined && stroke !== 'none') {
    const strokeId = nextId('stroke');
    nodes.push({
      id: strokeId,
      type: 'stroke',
      params: {
        color: stroke,
        width: parseNum(attributes['stroke-width'], 1),
        cap: 'butt',
        join: 'miter',
      },
    });
    edges.push({ source: lastId, sourcePort: 'path', target: strokeId, targetPort: 'path' });
    lastId = strokeId;
  }

  // Apply transform
  const transform = attributes.transform;
  if (transform !== undefined) {
    const parsed = parseTransformAttr(transform);
    if (parsed !== null) {
      const transformId = nextId(parsed.type);
      nodes.push({ id: transformId, type: parsed.type, params: parsed.params });
      edges.push({ source: lastId, sourcePort: 'path', target: transformId, targetPort: 'path' });
      lastId = transformId;
    }
  }

  return lastId;
}

/**
 * Parse an SVG string into a vector-engine graph description.
 *
 * Returns nodes, edges, and canvas dimensions derived from the SVG viewBox
 * (or width/height attributes as fallback).
 */
export function svgToGraph(svgString: string): ImportResult {
  _idCounter = 0;

  const parsed = parse(svgString) as TxmlNode[];
  const svgNode = parsed.find((n) => isTxmlNode(n) && n.tagName === 'svg') as TxmlNode | undefined;

  if (!svgNode) {
    return { nodes: [], edges: [], canvas: { width: 0, height: 0 } };
  }

  // Determine canvas size from viewBox or width/height
  let canvasWidth = 0;
  let canvasHeight = 0;
  const viewBox = svgNode.attributes.viewBox;
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number.parseFloat);
    canvasWidth = parts[2] ?? 0;
    canvasHeight = parts[3] ?? 0;
  } else {
    canvasWidth = parseNum(svgNode.attributes.width);
    canvasHeight = parseNum(svgNode.attributes.height);
  }

  const nodes: ImportedNode[] = [];
  const edges: ImportedEdge[] = [];

  for (const child of svgNode.children) {
    if (!isTxmlNode(child)) continue;
    // Skip defs — no geometry nodes
    if (child.tagName === 'defs') continue;
    walkElement(child, nodes, edges);
  }

  return { nodes, edges, canvas: { width: canvasWidth, height: canvasHeight } };
}
