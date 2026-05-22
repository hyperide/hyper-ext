/**
 * @file Find JSX elements by source position for fiber-based tracing.
 *
 * Accessed via: Server mutation routes (resolve nodeRef -> position -> AST element)
 * Assumptions: AST was parsed with `loc: true` (Babel default)
 */

import _traverse, { type NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import type { FindElementResult } from '../types';

const traverse = (_traverse as unknown as { default: typeof _traverse }).default || _traverse;

/**
 * Find a JSX element at the given source position (1-based line, 0-based column).
 * Returns the JSXElement whose opening tag starts at that position.
 *
 * Falls back in priority order:
 * 1. Exact line + column match — highest confidence
 * 2. Line-only match (column differs) — handles Babel vs V8 column offsets
 * 3. Nearby line ±1..±2 search — handles React 19 compiled offset (V8 Error.stack
 *    gives compiled positions; Vite compilation merges "return (" + JSX into one
 *    compiled line, shifting line numbers by 1-2 relative to source AST positions)
 *
 * Prefers negative delta (line-N) over positive when distances are equal, because
 * Vite header lines shift source lines down (compiled line > source line is common).
 */
export function findElementByPosition(ast: t.File, line: number, column: number): FindElementResult | null {
  const MAX_LINE_TOLERANCE = 2;

  let exactResult: FindElementResult | null = null;
  // First match per source line — used for line-only and nearby-line fallbacks
  const lineResults = new Map<number, FindElementResult>();

  traverse(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      const loc = path.node.loc;
      if (!loc) return;

      const elemLine = loc.start.line;

      // Skip elements outside the tolerance window early
      if (Math.abs(elemLine - line) > MAX_LINE_TOLERANCE) return;

      if (elemLine === line && loc.start.column === column) {
        exactResult = { element: path.node, path };
        path.stop();
        return;
      }

      // Record the first element found at this line (line-only candidate)
      if (!lineResults.has(elemLine)) {
        lineResults.set(elemLine, { element: path.node, path });
      }
    },
  });

  if (exactResult) return exactResult;

  // Try exact line first (column mismatch), then ±1, ±2
  // Negative delta (line-N) is tried before positive (line+N) at each distance
  // because Vite header lines make compiled line > source line in common cases.
  for (let delta = 0; delta <= MAX_LINE_TOLERANCE; delta++) {
    const negMatch = lineResults.get(line - delta);
    if (negMatch) return negMatch;
    if (delta > 0) {
      const posMatch = lineResults.get(line + delta);
      if (posMatch) return posMatch;
    }
  }

  return null;
}
