/**
 * @file getSelectedElementRange — resolve the selected element's source range (and its direct
 *   child element ranges) from the canvas engine AST, for the browser-mode i18n READ path.
 *
 * Why it exists / how it's reached: composeBrowserI18nText matches a scanned t(...) binding to the
 *   selected element by source-range containment. That needs the element's [start,end] range. The
 *   engine knows it two ways, mirroring useElementStyleData's own browser lookup:
 *     1. by AST UUID (findNodeById) — when the selection came from the tree/explorer;
 *     2. by nodeRef → source-location → AST node (findAstNodeBySourceLoc) — the canvas-CLICK path,
 *        where selectedId is a tracer nodeRef, NOT a parser UUID. Skipping (2) left the i18n read
 *        dead for ordinary canvas clicks (Codex review finding).
 *
 *   It also returns each DIRECT JSXElement child's range so the matcher can exclude a binding that
 *   actually belongs to a nested descendant — VS Code only inspects direct children, so selecting
 *   <div><span>{t('x')}</span></div> must NOT surface the span's binding under the div.
 */
import type { CanvasEngine } from '@/lib/canvas-engine';
import type { ASTNode } from '@/lib/canvas-engine/types/ast';
import { getActiveTracer } from '@/lib/element-tracing/active-tracer';
import { findAstNodeBySourceLoc } from '@/lib/element-tracing/id-bridge';

export interface SelectedElementRange {
  start: { line: number; column: number };
  end: { line: number; column: number };
  /** Ranges of the element's direct JSXElement children — bindings inside these belong to them. */
  childRanges: Array<{ start: { line: number; column: number }; end: { line: number; column: number } }>;
}

/** Find an AST node by id, recursing through children (mirrors RightSidebar/utils findNodeById). */
function findById(nodes: ASTNode[], id: string): ASTNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Collect the sampleStructure (preferred) / astStructure trees from the engine root + children. */
function getAstTrees(engine: CanvasEngine): ASTNode[][] {
  const trees: ASTNode[][] = [];
  const root = engine.getRoot();
  const rootAst = root.metadata?.sampleStructure ?? root.metadata?.astStructure;
  if (Array.isArray(rootAst)) trees.push(rootAst as ASTNode[]);
  for (const childId of root.children || []) {
    const inst = engine.getInstance(childId);
    const childAst = inst?.metadata?.sampleStructure ?? inst?.metadata?.astStructure;
    if (Array.isArray(childAst)) trees.push(childAst as ASTNode[]);
  }
  return trees;
}

function toRange(node: ASTNode): SelectedElementRange | null {
  if (!node.loc) return null;
  const childRanges = (node.children ?? [])
    .filter((c): c is ASTNode & { loc: NonNullable<ASTNode['loc']> } => c.loc != null)
    .map((c) => ({ start: c.loc.start, end: c.loc.end }));
  return { start: node.loc.start, end: node.loc.end, childRanges };
}

/**
 * Resolve the selected element's source range, or null when it can't be located (no engine, no
 * selection, or the id resolves to no AST node with a loc).
 */
export function getSelectedElementRange(
  engine: CanvasEngine | null,
  selectedId: string | null,
): SelectedElementRange | null {
  if (!engine || !selectedId) return null;
  const trees = getAstTrees(engine);

  // 1) Direct UUID lookup (tree/explorer selection).
  for (const tree of trees) {
    const node = findById(tree, selectedId);
    if (node) return toRange(node);
  }

  // 2) Canvas-click selection: selectedId is a tracer nodeRef → resolve to a source loc → AST node.
  const tracer = getActiveTracer();
  const source = tracer?.getSourceByNodeRef(selectedId);
  if (source) {
    for (const tree of trees) {
      const node = findAstNodeBySourceLoc(tree, source.line, source.column);
      if (node) return toRange(node);
    }
  }

  return null;
}
