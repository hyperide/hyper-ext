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
 * True for a node whose only content is the bare `{children}` passthrough
 * (`<button>{children}</button>`). The static AST walk records this as the raw
 * JSX-expression text `{children}` with childrenType 'expression'. Quoting it in
 * the tree (`button "{children}"`) reads as literal on-screen text, which is
 * misleading — it is a children binding, invariant to any runtime sample. We
 * keep the braces (they signal a JSX binding/expression) but drop the
 * surrounding quotes, labeling it `button {children}`. Narrow on purpose: a real
 * expression like `{user.name}` stays quoted and informative.
 */
function isChildrenPassthrough(node: ComponentNode): boolean {
  return node.childrenType === 'expression' && node.props?.children === '{children}';
}

function computeLabel(node: ComponentNode): string {
  const tag = node.type;

  if (tag === 'button') {
    if (isChildrenPassthrough(node)) return `button {children}`;
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
    if (isChildrenPassthrough(node)) return `${tag} {children}`;
    const text = extractTextFromNode(node);
    if (text) return `${tag} "${text}"`;
    return tag;
  }

  if (/^[A-Z]/.test(tag)) {
    if (isChildrenPassthrough(node)) return `${tag} {children}`;
    const componentText = extractTextFromNode(node);
    if (componentText) return `${tag} "${componentText}"`;
    return tag;
  }

  if (node.props?.['data-testid']) return `${tag} "${node.props['data-testid']}"`;
  if (isChildrenPassthrough(node)) return `${tag} {children}`;
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
