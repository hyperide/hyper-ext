/**
 * @file FIG node mapper — converts parsed Figma nodes to vector-engine graph
 *
 * Accessed via: FIG import pipeline — maps Figma node types to engine node types
 * Tradeoffs: component instances are flattened (overrides resolved at import time).
 *   Auto-layout, variables, and prototyping are skipped with warnings.
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §FIG Import
 */

import type { FigNode } from './fig-import';
import type { ImportedEdge, ImportedNode, ImportResult } from './svg-import';

interface FigColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface FigPaint {
  type: string;
  color?: FigColor;
}

function colorToHex(c: FigColor): string {
  const r = Math.round(c.r * 255)
    .toString(16)
    .padStart(2, '0');
  const g = Math.round(c.g * 255)
    .toString(16)
    .padStart(2, '0');
  const b = Math.round(c.b * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${r}${g}${b}`;
}

const BOOLEAN_OP_MAP: Record<string, string> = {
  UNION: 'booleanUnion',
  SUBTRACT: 'booleanSubtract',
  INTERSECT: 'booleanIntersect',
  EXCLUDE: 'booleanXor',
};

/**
 * Convert parsed FIG nodes into a vector-engine graph description.
 *
 * Each Figma node type maps to an engine node type:
 * - RECTANGLE → rectangle
 * - ELLIPSE → ellipse
 * - VECTOR → svgPath
 * - LINE → line
 * - BOOLEAN_OPERATION → booleanUnion/Subtract/Intersect/Xor
 * - GROUP/FRAME → group (children wired via edges)
 * - TEXT → textToPath
 *
 * Solid fills and strokes are extracted as separate fill/stroke nodes with edges.
 */
export function mapFigToGraph(figNodes: FigNode[], canvas: { width: number; height: number }): ImportResult {
  const nodes: ImportedNode[] = [];
  const edges: ImportedEdge[] = [];
  let idCounter = 0;

  function nextId(): string {
    return `fig-${idCounter++}`;
  }

  function walk(figNode: FigNode, parentId?: string): string | undefined {
    let nodeId: string | undefined;

    switch (figNode.type) {
      case 'RECTANGLE': {
        nodeId = nextId();
        nodes.push({
          id: nodeId,
          type: 'rectangle',
          params: {
            width: (figNode.properties.width as number) ?? 100,
            height: (figNode.properties.height as number) ?? 100,
            x: (figNode.properties.x as number) ?? 0,
            y: (figNode.properties.y as number) ?? 0,
          },
        });
        break;
      }
      case 'ELLIPSE': {
        nodeId = nextId();
        const w = (figNode.properties.width as number) ?? 100;
        const h = (figNode.properties.height as number) ?? 100;
        nodes.push({
          id: nodeId,
          type: 'ellipse',
          params: { rx: w / 2, ry: h / 2 },
        });
        break;
      }
      case 'VECTOR': {
        nodeId = nextId();
        const fillGeometry = figNode.properties.fillGeometry as string;
        nodes.push({
          id: nodeId,
          type: 'svgPath',
          params: { d: fillGeometry ?? '' },
        });
        break;
      }
      case 'LINE': {
        nodeId = nextId();
        nodes.push({
          id: nodeId,
          type: 'line',
          params: {
            x1: 0,
            y1: 0,
            x2: (figNode.properties.width as number) ?? 100,
            y2: 0,
          },
        });
        break;
      }
      case 'BOOLEAN_OPERATION': {
        nodeId = nextId();
        const op = (figNode.properties.booleanOperation as string) ?? 'UNION';
        nodes.push({
          id: nodeId,
          type: BOOLEAN_OP_MAP[op] ?? 'booleanUnion',
          params: {},
        });
        break;
      }
      case 'GROUP':
      case 'FRAME': {
        nodeId = nextId();
        nodes.push({
          id: nodeId,
          type: 'group',
          params: { opacity: 1 },
        });
        for (const child of figNode.children) {
          const childId = walk(child, nodeId);
          if (childId && nodeId) {
            edges.push({
              source: childId,
              sourcePort: 'path',
              target: nodeId,
              targetPort: 'children',
            });
          }
        }
        break;
      }
      case 'TEXT': {
        nodeId = nextId();
        nodes.push({
          id: nodeId,
          type: 'textToPath',
          params: {
            text: (figNode.properties.characters as string) ?? '',
            fontSize: (figNode.properties.fontSize as number) ?? 16,
            fontUrl: '',
          },
        });
        break;
      }
      default:
        break;
    }

    if (!nodeId) return undefined;

    // Map solid fills to fill nodes
    const fills = figNode.properties.fills as FigPaint[] | undefined;
    if (fills && fills.length > 0) {
      const firstFill = fills[0];
      if (firstFill.type === 'SOLID' && firstFill.color) {
        const fillId = nextId();
        nodes.push({
          id: fillId,
          type: 'fill',
          params: { type: 'solid', color: colorToHex(firstFill.color) },
        });
        edges.push({
          source: nodeId,
          sourcePort: 'path',
          target: fillId,
          targetPort: 'path',
        });
      }
    }

    // Map solid strokes to stroke nodes
    const strokes = figNode.properties.strokes as FigPaint[] | undefined;
    if (strokes && strokes.length > 0) {
      const firstStroke = strokes[0];
      if (firstStroke.type === 'SOLID' && firstStroke.color) {
        const strokeId = nextId();
        nodes.push({
          id: strokeId,
          type: 'stroke',
          params: {
            color: colorToHex(firstStroke.color),
            width: (figNode.properties.strokeWeight as number) ?? 1,
            cap: 'round',
            join: 'round',
          },
        });
        edges.push({
          source: nodeId,
          sourcePort: 'path',
          target: strokeId,
          targetPort: 'path',
        });
      }
    }

    // Wire non-container nodes to parent group (GROUP/FRAME handle children internally)
    if (parentId && figNode.type !== 'GROUP' && figNode.type !== 'FRAME') {
      edges.push({
        source: nodeId,
        sourcePort: 'path',
        target: parentId,
        targetPort: 'children',
      });
    }

    return nodeId;
  }

  for (const node of figNodes) walk(node);

  return { nodes, edges, canvas };
}
