/**
 * @file Platform-converged data source for the PropsEditor (HYP-709).
 *
 * Accessed via: `PropsEditor` (RightSidebar inspector), in BOTH realms.
 *
 * Why this exists: the original PropsEditor read selection + AST from `useCanvasEngine()`
 * (throws without a provider → unusable in the VS Code webview) and fetched its props schema
 * + Tamagui tokens through `authFetch` (the ext has no HTTP proxy to the Hono server). To let
 * ONE PropsEditor serve both realms (CTO rule: fix once, no parallel impls), this module funnels
 * every environment-backed dependency through a single seam that branches on platform:
 *
 *   - Selection / file path / selected AST node:
 *       SaaS  → CanvasEngine metadata (engine is the source of truth; preserves drag/undo state)
 *       ext   → SharedEditorState (`selectedIds`, `currentComponent.path`, `astStructure`)
 *     Both converge on the same `ComponentNode`-shaped `astStructure` (id/type/props/children),
 *     mirroring `useElementsTree`.
 *
 *   - Props schema + Tamagui tokens (a thin DATA seam, not UI props):
 *       SaaS  → authFetch (`/api/component-props-types`, `/api/tamagui/tokens`)
 *       ext   → canvasRPC (`component:propsTypes`, `tamagui:getTokens`) → extension host, which
 *               runs the same shared cores (TS Compiler API + lib/tamagui/extract-tokens).
 *
 *   - Prop writes:
 *       SaaS  → engine.updateASTProp (keeps the engine undo/redo stack + instant canvas update)
 *       ext   → usePlatformAst().updateProps (host AstService, one undo step)
 *
 * Assumptions / invariants:
 *   - In the ext realm `astStructure` may be null during preview startup → callers render an
 *     empty/loading state (the editor self-gates on `filePath && elementType`).
 *   - Node IDs in `astStructure` equal `selectedIds[0]` in both realms (the canonical nodeRef).
 */

import type { ComponentPropsSchema } from '@shared/types/props';
import { useCallback, useEffect, useState } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine';
import { useCanvasEngineOptional } from '@/lib/canvas-engine';
import type { ASTNode } from '@/lib/canvas-engine/types/ast';
import { canvasRPC, usePlatformAst, usePlatformCanvas, usePlatformContext } from '@/lib/platform';
import { useSelectedIds as useSharedSelectedIds, useSharedEditorState } from '@/lib/platform/shared-editor-state';
// `useSelectedIdsOptional` returns [] without a CanvasEngineProvider — safe to call
// unconditionally in the ext realm (the throwing `useSelectedIds` would crash the webview).
import { useSelectedIdsOptional as useEngineSelectedIds } from '@/lib/canvas-engine';
import { authFetch } from '@/utils/authFetch';

export interface TamaguiTokens {
  color: string[];
  size: string[];
  space: string[];
}

const EMPTY_TOKENS: TamaguiTokens = { color: [], size: [], space: [] };

interface PropsEditorSelection {
  selectedId: string | null;
  filePath: string | null;
  elementType: string | null;
  astNode: ASTNode | null;
}

/** Find a node by id in a `ComponentNode`/`ASTNode`-shaped tree (SaaS engine metadata). */
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
 * Ext-realm TreeNode subset (SharedEditorState.astStructure). Unlike the SaaS ComponentNode,
 * its `id` is a generated UUID (NOT the selection nodeRef), `type` is a category
 * (`'component' | 'element' | ...`), the JSX tag lives in `label`, and there are no `props`.
 * The selection↔node bridge is `loc.start` (line/column), which matches the `file:line:column`
 * nodeRef the ext uses as a selectedId. See HYP-709 / tree-adapter.convertSingleNode.
 */
interface ExtTreeNode {
  id: string;
  type: string;
  label: string;
  loc?: { start: { line: number; column: number } };
  children?: ExtTreeNode[];
}

/** Parse a `path:line:column` nodeRef into its line/column (ext selection id format). */
function parseNodeRefLoc(nodeRef: string): { line: number; column: number } | null {
  const m = nodeRef.match(/:(\d+):(\d+)$/);
  if (!m) return null;
  return { line: Number(m[1]), column: Number(m[2]) };
}

/** Find the ext TreeNode whose source location matches a selection nodeRef's line/column. */
function findNodeByLoc(nodes: ExtTreeNode[], line: number, column: number): ExtTreeNode | null {
  for (const node of nodes) {
    const s = node.loc?.start;
    if (s && s.line === line && s.column === column) return node;
    if (node.children) {
      const found = findNodeByLoc(node.children, line, column);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Recover the JSX tag from a TreeNode `label`. The label is the tag, sometimes decorated by
 * `computeLabel` (e.g. `Button "text"`, `YStack {children}`, `input [type="text"]`). The tag is
 * the leading token before the first space. Returns null for non-component labels so HTML
 * elements + decorated primitives don't trigger a (futile) typed-props lookup.
 */
function elementTypeFromLabel(label: string | undefined): string | null {
  if (!label) return null;
  const tag = label.split(/[\s[{"]/, 1)[0];
  return tag.length > 0 ? tag : null;
}

// ---------------------------------------------------------------------------
// Selection / file path / selected AST node — converged across realms
// ---------------------------------------------------------------------------

/** SaaS: resolve the selected element's file path + AST node from engine metadata. */
function selectionFromEngine(engine: CanvasEngine, selectedId: string | null): PropsEditorSelection {
  if (!selectedId) return { selectedId: null, filePath: null, elementType: null, astNode: null };

  const root = engine.getRoot();

  let filePath: string | null = (root.metadata?.filePath as string | undefined) ?? null;
  if (!filePath) {
    for (const childId of root.children ?? []) {
      const inst = engine.getInstance(childId);
      if (inst?.metadata?.filePath) {
        filePath = inst.metadata.filePath as string;
        break;
      }
    }
  }

  const search = (struct: unknown): ASTNode | null =>
    Array.isArray(struct) ? findNodeById(struct as ASTNode[], selectedId) : null;

  let astNode = search(root.metadata?.astStructure);
  if (!astNode) {
    for (const childId of root.children ?? []) {
      const inst = engine.getInstance(childId);
      astNode = search(inst?.metadata?.astStructure);
      if (astNode) break;
    }
  }

  return { selectedId, filePath, elementType: astNode?.type ?? null, astNode };
}

/**
 * Resolve the selected element's id, file path, type, and AST node — from the CanvasEngine
 * (SaaS) or SharedEditorState (ext). All hooks run unconditionally (Rules of Hooks).
 */
export function usePropsEditorSelection(): PropsEditorSelection {
  const engine = useCanvasEngineOptional();

  // Engine path (SaaS) — selection lives in the engine.
  const engineSelectedIds = useEngineSelectedIds();
  // SharedEditorState path (ext) — selection + AST synced from the host.
  const sharedSelectedIds = useSharedSelectedIds();
  const sharedComponentPath = useSharedEditorState((s) => s.currentComponent?.path);
  const sharedAstStructure = useSharedEditorState((s) => s.astStructure);

  if (engine) {
    return selectionFromEngine(engine, engineSelectedIds[0] ?? null);
  }

  // Ext realm: the selection id is a `file:line:column` nodeRef, but astStructure is a TreeNode
  // tree keyed by UUID with the JSX tag in `label` and no props. Bridge them via source location.
  const selectedId = sharedSelectedIds[0] ?? null;
  const loc = selectedId ? parseNodeRefLoc(selectedId) : null;
  const treeNode =
    loc && Array.isArray(sharedAstStructure)
      ? findNodeByLoc(sharedAstStructure as ExtTreeNode[], loc.line, loc.column)
      : null;

  return {
    selectedId,
    filePath: sharedComponentPath ?? null,
    elementType: elementTypeFromLabel(treeNode?.label),
    // TreeNode carries no prop values (unlike SaaS ComponentNode). The PropsEditor seeds from an
    // empty node and the user's edits write fresh values via usePlatformAst().updateProps.
    astNode: treeNode
      ? ({ id: treeNode.id, type: elementTypeFromLabel(treeNode.label) ?? '', props: {} } as ASTNode)
      : null,
  };
}

// ---------------------------------------------------------------------------
// Data seam — props schema + Tamagui tokens
// ---------------------------------------------------------------------------

/**
 * Fetch the Tamagui design tokens for the active project. Browser hits the Hono route;
 * the ext asks the host (which runs the shared static extraction core).
 */
export function useTamaguiTokensSource(): { tokens: TamaguiTokens; loading: boolean } {
  const context = usePlatformContext();
  const canvas = usePlatformCanvas();
  const [tokens, setTokens] = useState<TamaguiTokens>(EMPTY_TOKENS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        let next: TamaguiTokens = EMPTY_TOKENS;

        if (context === 'vscode-webview') {
          const res = await canvasRPC<{ tokens?: TamaguiTokens }>(
            canvas,
            { type: 'tamagui:getTokens', requestId: crypto.randomUUID() },
            'component:response',
          );
          if (res.success && res.data?.tokens) next = res.data.tokens;
        } else {
          const response = await authFetch('/api/tamagui/tokens');
          const data = await response.json();
          if (response.ok && data.success && data.tokens) next = data.tokens;
        }

        if (!cancelled) setTokens(next);
      } catch (err) {
        console.error('[PropsEditor] Failed to fetch Tamagui tokens:', err);
        if (!cancelled) setTokens(EMPTY_TOKENS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [context, canvas]);

  return { tokens, loading };
}

/**
 * Fetch the typed props schema for the selected component. Browser hits the Hono route;
 * the ext asks the host (TS Compiler API extraction). Returns null for HTML elements or
 * components without a typed props interface (silent — the editor renders nothing).
 */
export function usePropsSchemaSource(
  filePath: string | null,
  elementType: string | null,
): { schema: ComponentPropsSchema | null; loading: boolean; error: string | null } {
  const context = usePlatformContext();
  const canvas = usePlatformCanvas();
  const [schema, setSchema] = useState<ComponentPropsSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // HTML elements (lowercase tag) have no TypeScript props interface — skip.
    const isHtmlElement = !!elementType && elementType[0] === elementType[0].toLowerCase();

    if (!filePath || !elementType || isHtmlElement) {
      setSchema(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    // Clear the previous selection's schema before the new lookup so a silent miss can't
    // leave the prior component's props visible (and editable) for the now-selected element.
    setSchema(null);

    async function load(fp: string, type: string) {
      try {
        let next: ComponentPropsSchema | null = null;

        if (context === 'vscode-webview') {
          const res = await canvasRPC<{ componentName?: string; props?: ComponentPropsSchema['props'] }>(
            canvas,
            { type: 'component:propsTypes', requestId: crypto.randomUUID(), filePath: fp, componentName: type },
            'component:response',
          );
          if (res.success && res.data?.props) {
            next = { componentName: res.data.componentName ?? type, props: res.data.props };
          }
        } else {
          const url = `/api/component-props-types?filePath=${encodeURIComponent(fp)}&componentName=${encodeURIComponent(type)}`;
          const response = await authFetch(url);
          if (response.ok) {
            const data = await response.json();
            if (data.success) next = { componentName: data.componentName, props: data.props };
          } else if (response.status !== 404 && response.status !== 400) {
            throw new Error(`HTTP ${response.status}`);
          }
          // 404/400 → component has no typed props; render nothing (silent).
        }

        if (!cancelled) setSchema(next);
      } catch (err) {
        console.error('[PropsEditor] Error loading schema:', err);
        if (!cancelled) setError('Failed to load props schema');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load(filePath, elementType);
    return () => {
      cancelled = true;
    };
  }, [filePath, elementType, context, canvas]);

  return { schema, loading, error };
}

// ---------------------------------------------------------------------------
// Prop writes — converged across realms
// ---------------------------------------------------------------------------

/**
 * Return a `(propName, value) => void` writer for the selected element. SaaS routes through
 * the engine (undo/redo + instant canvas); the ext routes through the host AstService.
 */
export function usePropWriter(
  selectedId: string | null,
  filePath: string | null,
): (name: string, value: unknown) => void {
  const engine = useCanvasEngineOptional();
  const platformAst = usePlatformAst();

  return useCallback(
    (propName: string, value: unknown) => {
      if (!selectedId || !filePath) return;
      if (engine) {
        engine.updateASTProp(selectedId, filePath, propName, value);
        return;
      }
      void platformAst.updateProps({ elementId: selectedId, filePath, props: { [propName]: value } });
    },
    [engine, platformAst, selectedId, filePath],
  );
}
