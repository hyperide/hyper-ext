/**
 * @file Table formatter — aligned tabular output for node/edge lists
 *
 * Accessed via: nodes() and edges() commands in REPL
 */

import type { EvalContext } from '../context';

export function formatNodesTable(ctx: EvalContext): string {
  const order = ctx.graph.topologicalOrder();
  if (order.length === 0) return '(empty graph)';

  const rows: string[][] = [];
  for (const id of order) {
    const node = ctx.graph.getNode(id);
    if (!node) continue;
    const shortId = id.slice(0, 8);
    const params = Object.entries(node.params)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    const muted = ctx.graph.isMuted(id) ? '✗' : '';
    rows.push([shortId, node.type, params, muted]);
  }

  const headers = ['ID', 'Type', 'Params', 'Muted'];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));

  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  const separator = widths.map((w) => '─'.repeat(w)).join('  ');
  const dataLines = rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i])).join('  '));

  return [headerLine, separator, ...dataLines].join('\n');
}

export function formatEdgesTable(ctx: EvalContext): string {
  const edges = ctx.graph.getEdges();
  if (edges.length === 0) return '(no edges)';

  const rows = edges.map((e) => [
    e.id.slice(0, 8),
    `${e.source.slice(0, 8)}:${e.sourcePort}`,
    '→',
    `${e.target.slice(0, 8)}:${e.targetPort}`,
  ]);

  return rows.map((r) => r.join('  ')).join('\n');
}
