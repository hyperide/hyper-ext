/**
 * Converts ComponentNode (from shared parser) to TreeNode (for UI tree rendering).
 * Used by both SaaS client and VS Code extension.
 */

import type { TreeNode } from '../types';
import type { ComponentNode } from './component-parser';

const FRAME_TAGS = new Set(['div', 'section', 'main', 'header', 'footer', 'nav', 'article', 'aside', 'form']);

export function extractTextFromNode(node: ComponentNode): string {
  if (node.childrenType === 'jsx') {
    return '';
  }

  let text = '';

  if (node.childrenType && node.props?.children && typeof node.props.children === 'string') {
    text += node.props.children;
  }

  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      const childText = extractTextFromNode(child);
      if (childText) {
        text += (text ? ' ' : '') + childText;
      }
    }
  }

  return text.trim();
}

/**
 * Contract: the `childrenType` taxonomy produced by the static AST walk in `analyzeJSXChildren`
 * (`lib/ast/traverser.ts`) and consumed by component-parser. User-facing impact: a `{…}`
 * expression child is a value BINDING, not on-screen text; quoting it in
 * the inspector tree (`div "{user.name}"`) misreads as a literal string the node renders.
 *
 * Return the raw `{…}` text to show UNQUOTED when a node's children are a PURE non-JSX
 * expression — generalizing the former `{children}`-only special-case to every pure non-JSX
 * expression (`{children}`, `{user.name}`, `{count}`, a string/number literal). On-screen TEXT
 * (childrenType 'text') is NOT an expression and stays quoted via {@link extractTextFromNode}.
 *
 * Node shapes (props.children is the generated child source from analyzeJSXChildren):
 *
 *   <button>{children}</button>      →  'expression',         '{children}'        → unquote
 *   <span>{count}</span>             →  'expression',         '{count}'           → unquote
 *   <div>{user.name}</div>           →  'expression-complex', '{user.name}'       → unquote
 *   <span>{42}</span>                →  'expression-complex', '{42}'              → unquote
 *   <button>Click {count} times</…>  →  'expression-complex', 'Click {count} times' → KEEP QUOTED (mixed)
 *
 * childrenType 'expression' is always a single simple expression (identifier / string- or
 * template-literal, never interleaved with text), so it always unquotes. This intentionally
 * includes a string/number literal const written as a `{…}` expression (`<span>{'hello'}</span>`
 * → `span {'hello'}`): a value wrapped in JSX expression braces is a BINDING, not bare on-screen
 * text — that is the whole point of generalizing the `{children}` special-case. (Bare JSX text
 * `<span>hello</span>` is childrenType 'text' and stays quoted.) childrenType 'expression-complex'
 * covers BOTH a pure multi/complex expression AND text mixed with an expression; only the PURE
 * case is a binding leaf, so mixed content (real on-screen text around a `{…}`) is filtered by
 * {@link isPureExpressionChildText} and stays quoted.
 *
 * JSX-BEARING expressions never reach here: component-parser's `containsJSX` descends into
 * `{items.map(()=><Item/>)}` / ternary-with-JSX / logical-with-JSX and records childrenType
 * 'jsx' with real child ComponentNodes, so those subtrees surface as tree CHILDREN (e.g. an
 * `items.map()` wrapper), never a leaf label. Returns null when the node is not a pure
 * expression leaf (caller falls through to text/testid/default labeling).
 */
function expressionBindingLabel(node: ComponentNode): string | null {
  const childrenType = node.childrenType;
  if (childrenType !== 'expression' && childrenType !== 'expression-complex') {
    return null;
  }
  const children = node.props?.children;
  if (typeof children !== 'string' || children.length === 0) {
    return null;
  }
  // 'expression-complex' may be a pure multi/complex expression OR text interleaved with a
  // `{…}` (`Click {count} times`); only the pure case is a binding leaf. ('expression' is
  // always a single simple expression with no surrounding text, so it skips the check.)
  if (childrenType === 'expression-complex' && !isPureExpressionChildText(children)) {
    return null;
  }
  return children;
}

/**
 * True when `text` (analyzeJSXChildren's generated child source) is entirely `{…}` expression
 * groups with only whitespace between/around them — i.e. NO bare on-screen text. Balanced-brace
 * scan, not a start/end check, so interleaved text is caught:
 *
 *   '{user.name}'           → pure   (single expression)
 *   '{a} {b}'               → pure   (two expressions, whitespace between)
 *   '{{\n  a: 1\n}}'        → pure   (object-literal expression)
 *   'Click {count} times'   → mixed  (bare words 'Click'/'times' at brace depth 0)
 *   '{a} text {b}'          → mixed  ('text' at brace depth 0)
 *
 * A brace inside a string literal could miscount depth in EITHER direction — a stray `}` drops
 * depth early, a stray `{` leaves depth > 0 at end — but both rare cases resolve to "mixed" →
 * quoted, the safe pre-existing label, never a worse outcome.
 */
function isPureExpressionChildText(text: string): boolean {
  let depth = 0;
  let sawExpression = false;
  for (const ch of text) {
    if (ch === '{') {
      depth++;
      sawExpression = true;
    } else if (ch === '}') {
      if (depth > 0) depth--;
    } else if (depth === 0 && !/\s/.test(ch)) {
      return false; // bare on-screen text outside any `{…}` → mixed content
    }
  }
  return sawExpression && depth === 0;
}

function computeLabel(node: ComponentNode): string {
  const tag = node.type;

  if (tag === 'button') {
    const buttonBinding = expressionBindingLabel(node);
    if (buttonBinding) return `button ${buttonBinding}`;
    const buttonText = extractTextFromNode(node);
    if (buttonText) return `button "${buttonText}"`;
    const buttonType = (node.props?.type as string) || 'submit';
    return `button [type="${buttonType}"]`;
  }

  if (tag === 'input') {
    if (node.props?.placeholder) return `input "${node.props.placeholder}"`;
    const inputType = (node.props?.type as string) || 'text';
    return `input [type="${inputType}"]`;
  }

  if (FRAME_TAGS.has(tag)) {
    if (node.props?.['data-testid']) return `${tag} "${node.props['data-testid']}"`;
    const frameBinding = expressionBindingLabel(node);
    if (frameBinding) return `${tag} ${frameBinding}`;
    const text = extractTextFromNode(node);
    if (text) return `${tag} "${text}"`;
    return tag;
  }

  if (/^[A-Z]/.test(tag)) {
    const componentBinding = expressionBindingLabel(node);
    if (componentBinding) return `${tag} ${componentBinding}`;
    const componentText = extractTextFromNode(node);
    if (componentText) return `${tag} "${componentText}"`;
    return tag;
  }

  if (node.props?.['data-testid']) return `${tag} "${node.props['data-testid']}"`;
  const elementBinding = expressionBindingLabel(node);
  if (elementBinding) return `${tag} ${elementBinding}`;
  const elementText = extractTextFromNode(node);
  if (elementText) return `${tag} "${elementText}"`;
  return tag;
}

function resolveTreeNodeType(tag: string): TreeNode['type'] {
  if (FRAME_TAGS.has(tag.toLowerCase())) return 'frame';
  if (/^[A-Z]/.test(tag)) return 'component';
  return 'element';
}

/**
 * Group consecutive children that share the same parentMapId into
 * synthetic map-wrapper TreeNodes, preserving the extension UX.
 */
function groupMapChildren(
  children: ComponentNode[],
): (ComponentNode | { _mapGroup: true; mapId: string; expression: string; children: ComponentNode[] })[] {
  type MapGroup = { _mapGroup: true; mapId: string; expression: string; children: ComponentNode[] };
  const result: (ComponentNode | MapGroup)[] = [];
  let currentMapId: string | null = null;
  let currentGroup: ComponentNode[] = [];
  let currentExpression = '';

  for (const child of children) {
    const mapId = child.mapItem?.parentMapId ?? null;

    if (mapId && mapId === currentMapId) {
      currentGroup.push(child);
    } else {
      if (currentMapId && currentGroup.length > 0) {
        result.push({ _mapGroup: true, mapId: currentMapId, expression: currentExpression, children: currentGroup });
      }
      if (mapId) {
        currentMapId = mapId;
        currentExpression = child.mapItem?.expression ?? 'items';
        currentGroup = [child];
      } else {
        currentMapId = null;
        currentGroup = [];
        result.push(child);
      }
    }
  }

  if (currentMapId && currentGroup.length > 0) {
    result.push({ _mapGroup: true, mapId: currentMapId, expression: currentExpression, children: currentGroup });
  }

  return result;
}

function convertChildren(children: ComponentNode[]): TreeNode[] {
  const grouped = groupMapChildren(children);
  const result: TreeNode[] = [];

  for (const item of grouped) {
    if ('_mapGroup' in item) {
      result.push({
        id: item.mapId,
        type: 'map',
        label: `${item.expression}.map()`,
        children: item.children.map(convertSingleNode),
      });
    } else {
      result.push(convertSingleNode(item));
    }
  }

  return result;
}

function convertSingleNode(node: ComponentNode): TreeNode {
  if (node.type.startsWith('fn:')) {
    const fnName = node.functionItem?.functionName || node.type.slice(3);
    return {
      id: node.id,
      type: 'function',
      label: `${fnName}()`,
      name: undefined,
      loc: node.loc,
      functionLoc: node.functionItem?.functionLoc as TreeNode['functionLoc'],
      children: node.children.length > 0 ? convertChildren(node.children) : [],
    };
  }

  const treeNodeType = resolveTreeNodeType(node.type);
  const label = computeLabel(node);

  return {
    id: node.id,
    type: treeNodeType,
    label,
    name: undefined,
    loc: node.loc,
    children: node.type === 'svg' ? [] : node.children.length > 0 ? convertChildren(node.children) : [],
  };
}

export function convertComponentNodeToTreeNode(node: ComponentNode): TreeNode {
  return convertSingleNode(node);
}

/**
 * Convert an array of ComponentNodes to TreeNodes with map grouping.
 * Use this for root-level arrays (e.g. fragment children) where
 * consecutive map items should be grouped into synthetic map wrappers.
 */
export function convertComponentNodesToTreeNodes(nodes: ComponentNode[]): TreeNode[] {
  return convertChildren(nodes);
}
