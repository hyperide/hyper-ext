/**
 * @file AST-based route extraction from a single source file.
 *
 * Accessed via: route-heuristics/index.ts (per-file scan of project sources).
 * Assumptions: BROWSER-SAFE — reuses the pure-JS babel parser wrapper from lib/ast/parser,
 *   so this bundles for the webview alongside the rest of the preview generator.
 * Best-effort: a parse failure throws; callers treat any throw as "no routes from this file".
 *
 * Covers, in one AST walk per file:
 *   - React Router JSX: `<Route path="/x" />` (incl. self-closing + index routes ignored).
 *   - React Router data API: `createBrowserRouter([{ path: '/x', children: [...] }])` and
 *     `createRoutesFromElements(...)` is handled by the JSX branch since it contains <Route>.
 *   - Generic link scan: `to="/x"` (Link/NavLink) and `href="/x"` (anchors), absolute paths only.
 */

import { parseCode } from '../../ast/parser';
import type { RouteSuggestion } from './types';

type AnyNode = { type?: string } & Record<string, unknown>;

/** Pull a static string from a JSX attribute value (string literal or `{'...'}` expression). */
function jsxAttrStringValue(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const node = value as AnyNode;
  if (node.type === 'StringLiteral' && typeof node.value === 'string') return node.value;
  if (node.type === 'JSXExpressionContainer') {
    const expr = node.expression as AnyNode | undefined;
    if (expr?.type === 'StringLiteral' && typeof expr.value === 'string') return expr.value as string;
  }
  return null;
}

/** Read a named string attribute off a JSX opening element (e.g. `path`, `to`, `href`). */
function readJsxStringAttr(opening: AnyNode, attrName: string): string | null {
  const attrs = opening.attributes as AnyNode[] | undefined;
  if (!Array.isArray(attrs)) return null;
  for (const attr of attrs) {
    if (attr.type !== 'JSXAttribute') continue;
    const name = attr.name as AnyNode | undefined;
    if (name?.type !== 'JSXIdentifier' || name.name !== attrName) continue;
    return jsxAttrStringValue(attr.value);
  }
  return null;
}

/** The tag name of a JSX opening element, or null for member-expression tags. */
function jsxTagName(opening: AnyNode): string | null {
  const name = opening.name as AnyNode | undefined;
  if (name?.type === 'JSXIdentifier' && typeof name.name === 'string') return name.name;
  return null;
}

/** Collect a route path from a `<Route path="…">` element. Relative segments are kept as-is. */
function collectFromRouteElement(opening: AnyNode, out: RouteSuggestion[]): void {
  if (jsxTagName(opening) !== 'Route') return;
  const path = readJsxStringAttr(opening, 'path');
  if (path == null) return; // index route or layout route — no own address
  out.push({ path, source: 'route-config' });
}

/** Collect a link target from a `<Link to>` / `<NavLink to>` / `<a href>` element. */
function collectFromLinkElement(opening: AnyNode, out: RouteSuggestion[]): void {
  const tag = jsxTagName(opening);
  if (tag === 'Link' || tag === 'NavLink') {
    const to = readJsxStringAttr(opening, 'to');
    if (to && to.startsWith('/')) out.push({ path: to, source: 'link' });
    return;
  }
  if (tag === 'a') {
    const href = readJsxStringAttr(opening, 'href');
    if (href && href.startsWith('/')) out.push({ path: href, source: 'link' });
  }
}

/** Read a static string `path` property from an object expression in a router config array. */
function collectFromRouteObject(node: AnyNode, out: RouteSuggestion[]): void {
  if (node.type !== 'ObjectExpression') return;
  const props = node.properties as AnyNode[] | undefined;
  if (!Array.isArray(props)) return;
  for (const prop of props) {
    if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') continue;
    const key = prop.key as AnyNode | undefined;
    const keyName = key?.type === 'Identifier' ? key.name : key?.type === 'StringLiteral' ? key.value : null;
    if (keyName !== 'path') continue;
    const val = prop.value as AnyNode | undefined;
    if (val?.type === 'StringLiteral' && typeof val.value === 'string') {
      out.push({ path: val.value as string, source: 'route-config' });
    }
  }
}

/** Walk every node once, dispatching JSX elements and route-config objects to collectors. */
function walk(node: unknown, out: RouteSuggestion[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out);
    return;
  }
  const n = node as AnyNode;
  if (n.type === 'JSXOpeningElement') {
    collectFromRouteElement(n, out);
    collectFromLinkElement(n, out);
  } else if (n.type === 'ObjectExpression') {
    collectFromRouteObject(n, out);
  }
  for (const key of Object.keys(n)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'range' || key === 'tokens') continue;
    walk(n[key], out);
  }
}

/**
 * Extract route suggestions from a single source file's text. Throws on a parse error
 * (caller catches and treats as "no routes"). Returns raw, undeduped suggestions — the
 * index merges and ranks across files.
 */
export function extractRoutesFromSource(sourceCode: string): RouteSuggestion[] {
  const ast = parseCode(sourceCode);
  const out: RouteSuggestion[] = [];
  walk(ast.program.body, out);
  return out;
}
