/**
 * @file Tree formatter — ASCII DAG visualization
 *
 * Accessed via: tree() command in REPL
 */

import type { EvalContext } from '../context';

export function formatDAGTree(ctx: EvalContext): string {
  const order = ctx.graph.topologicalOrder();
  if (order.length === 0) return '(empty graph)';

  // Build adjacency: parent → children
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();

  for (const edge of ctx.graph.getEdges()) {
    const list = children.get(edge.source) ?? [];
    list.push(edge.target);
    children.set(edge.source, list);
    hasParent.add(edge.target);
  }

  // Find roots (no incoming edges)
  const roots = order.filter((id) => !hasParent.has(id));

  const lines: string[] = [];

  /**
   * @param prefix - indentation prefix; null means this node is a root (no connector)
   * @param isLast - whether this node is the last sibling at this level
   */
  function walk(nodeId: string, prefix: string | null, isLast: boolean): void {
    const node = ctx.graph.getNode(nodeId);
    if (!node) return;

    const connector = prefix === null ? '' : isLast ? '└→ ' : '├→ ';
    const indent = prefix ?? '';
    const shortId = nodeId.slice(0, 8);
    const paramSummary = summarizeParams(node.type, node.params);
    const mutedMark = ctx.graph.isMuted(nodeId) ? ' [muted]' : '';
    lines.push(`${indent}${connector}${node.type} (${shortId}) ${paramSummary}${mutedMark}`);

    const kids = children.get(nodeId) ?? [];
    // Children of a root get empty string prefix; deeper children get indentation
    const childPrefix = prefix === null ? '' : prefix + (isLast ? '   ' : '│  ');
    for (let i = 0; i < kids.length; i++) {
      walk(kids[i], childPrefix, i === kids.length - 1);
    }
  }

  for (const root of roots) {
    walk(root, null, true);
  }

  return lines.join('\n');
}

function summarizeParams(type: string, params: Record<string, unknown>): string {
  switch (type) {
    case 'rectangle':
      return `${params.width}×${params.height}`;
    case 'ellipse':
      return `rx=${params.rx} ry=${params.ry}`;
    case 'fill': {
      const color = params.color ?? params.fillType;
      return String(color);
    }
    case 'stroke':
      return `${params.color} ${params.width}px`;
    case 'translate':
      return `dx=${params.dx} dy=${params.dy}`;
    case 'rotate':
      return `${params.angle}°`;
    case 'scale':
      return `${params.sx}×${params.sy}`;
    case 'opacity':
      return `${params.value}`;
    default: {
      const entries = Object.entries(params);
      if (entries.length === 0) return '';
      return entries
        .slice(0, 3)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
    }
  }
}
