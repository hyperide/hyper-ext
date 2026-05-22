/**
 * @file Builds NodeMap entries from a Babel AST
 *
 * Accessed via: Internal module — consumed by NodeMapService
 * Assumptions: AST has source locations (parsed with standard Babel config)
 */

import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import type { NodeMapEntry, NodeRef, SourceLocation } from '../../shared/element-tracing/types';

const traverse = (_traverse as unknown as { default: typeof _traverse }).default || _traverse;

/** Convert Babel SourceLocation to our SourceLocation type */
function toSourceLocation(loc: t.SourceLocation | null | undefined, fileName: string, isEnd = false): SourceLocation {
  if (!loc) {
    return { fileName, line: 0, column: 0 };
  }
  const pos = isEnd ? loc.end : loc.start;
  return { fileName, line: pos.line, column: pos.column };
}

/** Build the tag string from a JSX opening element's name */
function buildTagName(name: t.JSXOpeningElement['name']): string {
  if (t.isJSXIdentifier(name)) {
    return name.name;
  }
  if (t.isJSXMemberExpression(name)) {
    return `${buildTagName(name.object)}.${name.property.name}`;
  }
  if (t.isJSXNamespacedName(name)) {
    return `${name.namespace.name}:${name.name.name}`;
  }
  return 'Unknown';
}

/** Return true if tag is a component (uppercase first char or contains dot) */
function isComponentTag(tag: string): boolean {
  return /^[A-Z]/.test(tag) || tag.includes('.');
}

/**
 * djb2 hash → 4 hex chars.
 * Deterministic, collision-resistant enough for structural fingerprinting.
 */
function djb2Hex(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).slice(-4).padStart(4, '0');
}

/** Extract sorted JSXAttribute names (not spread attributes, not values). */
function collectPropNames(opening: t.JSXOpeningElement): string[] {
  const names: string[] = [];
  for (const attr of opening.attributes) {
    if (t.isJSXAttribute(attr)) {
      const name = t.isJSXIdentifier(attr.name) ? attr.name.name : `${attr.name.namespace.name}:${attr.name.name.name}`;
      names.push(name);
    }
  }
  return names.sort();
}

/**
 * Computes subtree height for a node. Leaf = 0, parent = max(childHeights) + 1.
 */
function computeSubtreeHeight(ref: NodeRef, refToEntry: Map<NodeRef, NodeMapEntry>): number {
  const e = refToEntry.get(ref);
  if (!e || e.children.length === 0) return 0;
  let max = 0;
  for (const childRef of e.children) {
    const h = computeSubtreeHeight(childRef, refToEntry);
    if (h > max) max = h;
  }
  return max + 1;
}

/**
 * Computes a structural fingerprint: hash of (sorted prop names, children count, subtree height).
 * Excludes text content and prop values — only structural shape matters.
 */
function computeFingerprint(e: NodeMapEntry, propNames: string[], refToEntry: Map<NodeRef, NodeMapEntry>): string {
  const height = computeSubtreeHeight(e.nodeRef, refToEntry);
  const input = `${propNames.join(',')}|${e.children.length}|${height}`;
  return djb2Hex(input);
}

interface TraversalPath {
  isJSXElement(): boolean;
  isJSXFragment(): boolean;
  node: t.Node;
  parentPath: TraversalPath | null;
}

/** Find the nodeRef of the closest ancestor JSXElement or JSXFragment. */
function findAncestorRef(startParent: TraversalPath | null, nodeToRef: WeakMap<t.Node, NodeRef>): NodeRef | null {
  let current = startParent;
  while (current) {
    if (current.isJSXElement() || current.isJSXFragment()) {
      const ref = nodeToRef.get(current.node);
      if (ref !== undefined) return ref;
    }
    current = current.parentPath;
  }
  return null;
}

/**
 * Builds a flat list of NodeMapEntry from all JSX elements and fragments in the AST.
 * Three-pass: collect entries → populate children → compute fingerprints.
 */
export function buildNodeMap(ast: t.File, filePath: string): NodeMapEntry[] {
  const entries: NodeMapEntry[] = [];
  let counter = 0;

  // Map from Babel node identity (via traversal path) to assigned nodeRef
  // We use a WeakMap keyed on the AST node itself
  const nodeToRef = new WeakMap<t.Node, NodeRef>();

  // Per-entry prop names collected during first pass (keyed by nodeRef)
  const entryPropNames = new Map<NodeRef, string[]>();

  // First pass: collect entries, assign nodeRefs, determine parentRef
  traverse(ast, {
    JSXElement(path) {
      const node = path.node;
      const opening = node.openingElement;
      const tag = buildTagName(opening.name);
      const nodeRef: NodeRef = `${filePath}:${counter++}`;
      nodeToRef.set(node, nodeRef);

      const parentRef = findAncestorRef(path.parentPath as unknown as TraversalPath, nodeToRef);
      const propNames = collectPropNames(opening);
      entryPropNames.set(nodeRef, propNames);

      const component = isComponentTag(tag);
      const mapEntry: NodeMapEntry = {
        nodeRef,
        tag,
        loc: toSourceLocation(node.loc, filePath),
        endLoc: toSourceLocation(node.loc, filePath, true),
        parentRef,
        children: [],
        isComponent: component,
        fingerprint: '', // computed in third pass
        ...(component ? { componentName: tag } : {}),
      };
      entries.push(mapEntry);
    },

    JSXFragment(path) {
      const node = path.node;
      const nodeRef: NodeRef = `${filePath}:${counter++}`;
      nodeToRef.set(node, nodeRef);

      const parentRef = findAncestorRef(path.parentPath as unknown as TraversalPath, nodeToRef);
      entryPropNames.set(nodeRef, []);

      const mapEntry: NodeMapEntry = {
        nodeRef,
        tag: 'Fragment',
        loc: toSourceLocation(node.loc, filePath),
        endLoc: toSourceLocation(node.loc, filePath, true),
        parentRef,
        children: [],
        isComponent: false,
        fingerprint: '', // computed in third pass
      };
      entries.push(mapEntry);
    },
  });

  // Build a lookup map for efficient parent→children wiring
  const refToEntry = new Map<NodeRef, NodeMapEntry>();
  for (const e of entries) {
    refToEntry.set(e.nodeRef, e);
  }

  // Second pass: populate children arrays
  for (const e of entries) {
    if (e.parentRef !== null) {
      const parent = refToEntry.get(e.parentRef);
      if (parent) {
        parent.children.push(e.nodeRef);
      }
    }
  }

  // Third pass: compute fingerprints (requires children to be populated)
  for (const e of entries) {
    const propNames = entryPropNames.get(e.nodeRef) ?? [];
    e.fingerprint = computeFingerprint(e, propNames, refToEntry);
  }

  return entries;
}
