/**
 * @file Bridges nodeRef (element tracing) ↔ UUID (ComponentNode) ID systems.
 *
 * Accessed via: useElementSelection, useElementStyleData, CanvasEditor overlay resolver
 * Assumptions: Both systems share Babel source locations (line:column).
 *   NodeMapEntry.loc and ComponentNode.loc.start come from the same Babel parse,
 *   so line:column values match for the same JSX element.
 */

import type { CanvasEngine } from '../canvas-engine';
import type { ASTNode } from '../canvas-engine/types/ast';
import { getActiveTracer } from './active-tracer';

/**
 * Find an AST node by source location (line + column).
 * Used as fallback when UUID-based lookup fails because the ID is a nodeRef.
 */
export function findAstNodeBySourceLoc(nodes: ASTNode[], line: number, column: number): ASTNode | null {
  for (const node of nodes) {
    if (node.loc?.start.line === line && node.loc?.start.column === column) {
      return node;
    }
    if (node.children) {
      const found = findAstNodeBySourceLoc(node.children, line, column);
      if (found) return found;
    }
  }
  return null;
}

/** Recursively find an AST node by id (UUID). */
function findNodeById(nodes: ASTNode[], id: string): ASTNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Get the sampleStructure (or astStructure fallback) from the engine root and children.
 * All returned trees are parsed from the same source file (the component being rendered),
 * so line:column pairs are unique across all trees.
 */
function getAstTrees(engine: CanvasEngine): ASTNode[][] {
  const trees: ASTNode[][] = [];
  const root = engine.getRoot();
  const rootAst = root.metadata?.sampleStructure ?? root.metadata?.astStructure;
  if (Array.isArray(rootAst)) {
    trees.push(rootAst as ASTNode[]);
  }
  for (const childId of root.children || []) {
    const inst = engine.getInstance(childId);
    const childAst = inst?.metadata?.sampleStructure ?? inst?.metadata?.astStructure;
    if (Array.isArray(childAst)) {
      trees.push(childAst as ASTNode[]);
    }
  }
  return trees;
}

/**
 * Resolve a nodeRef to the corresponding AST node UUID.
 * Returns the original id unchanged if resolution fails or id is already a UUID.
 */
export function resolveNodeRefToUuid(id: string, engine: CanvasEngine): string {
  const tracer = getActiveTracer();
  if (!tracer) return id;

  const source = tracer.getSourceByNodeRef(id);
  if (!source) return id; // Not a known nodeRef — likely already a UUID

  for (const tree of getAstTrees(engine)) {
    const astNode = findAstNodeBySourceLoc(tree, source.line, source.column);
    if (astNode) return astNode.id;
  }
  // Silent-death point: the nodeRef has a source location but no AST node matches it —
  // inspector/style flows that need a UUID will silently fall back to the raw nodeRef.
  console.debug(
    '[tracing] id-bridge: no AST node at',
    `${source.fileName}:${source.line}:${source.column}`,
    'for nodeRef',
    id,
  );
  return id;
}

/**
 * Get the Babel source location of an AST node by its UUID.
 * Feeds the style-write loc fallback (HYP-593): the server cross-checks this loc
 * against its node map when the selected id is a parse UUID it cannot resolve.
 */
export function getElementLocByUuid(
  id: string,
  engine: CanvasEngine,
): { line: number; column: number; endLine?: number; endColumn?: number } | null {
  let astNode: ASTNode | null = null;
  for (const tree of getAstTrees(engine)) {
    astNode = findNodeById(tree, id);
    if (astNode) break;
  }
  if (!astNode?.loc) return null;
  return {
    line: astNode.loc.start.line,
    column: astNode.loc.start.column,
    endLine: astNode.loc.end.line,
    endColumn: astNode.loc.end.column,
  };
}

/**
 * Resolve a UUID to the corresponding nodeRef.
 * Returns the original id unchanged if resolution fails or id is already a nodeRef.
 */
export function resolveUuidToNodeRef(id: string, engine: CanvasEngine): string {
  const tracer = getActiveTracer();
  if (!tracer) return id;

  // Find the AST node by UUID to get its source location
  let astNode: ASTNode | null = null;
  for (const tree of getAstTrees(engine)) {
    astNode = findNodeById(tree, id);
    if (astNode) break;
  }
  if (!astNode?.loc) return id;

  const sourceIndex = tracer.buildSourceKeyIndex();

  // Cross-file collision guard (HYP-594): several tracked files can host an element at
  // the same line:column (live repro: src/App.tsx h1 and src/components/Hero.tsx h1,
  // both at 4:6). The positional scan below returns whichever file's node map arrived
  // first — possibly a file with no fibers in the preview, so the overlay never draws.
  // Prefer the entry from the currently rendered component file when one exists.
  if (tracer.renderedFile) {
    const renderedEntry = sourceIndex.get(
      tracer.makeSourceKey({
        fileName: tracer.renderedFile,
        line: astNode.loc.start.line,
        column: astNode.loc.start.column,
      }),
    );
    if (renderedEntry) return renderedEntry.nodeRef;
  }

  // Search the tracer's source index for a matching source location
  for (const [, entry] of sourceIndex) {
    if (entry.source.line === astNode.loc.start.line && entry.source.column === astNode.loc.start.column) {
      return entry.nodeRef;
    }
  }
  return id;
}

/**
 * Map an array of IDs (potentially nodeRefs) to UUIDs.
 * IDs that are already UUIDs pass through unchanged.
 */
export function resolveIdsToUuids(ids: string[], engine: CanvasEngine): string[] {
  if (ids.length === 0) return ids;
  return ids.map((id) => resolveNodeRefToUuid(id, engine));
}
