/**
 * Compat hook for building elements tree.
 * SaaS: converts engine AST instances to TreeNode[].
 * VS Code: reads astStructure from SharedEditorState.
 */

import { useMemo, useSyncExternalStore } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine';
import { useCanvasEngineContextOptional, useCanvasEngineOptional } from '@/lib/canvas-engine';
import { useSharedEditorState } from '@/lib/platform/shared-editor-state';
import type { TreeNode } from '../../ElementsTree';

const EMPTY_TREE: TreeNode[] = [];
const NOOP_UNSUB = () => {};

/**
 * Build elements tree from engine AST or SharedEditorState.
 * All hooks are called unconditionally to satisfy Rules of Hooks.
 * @param componentName - used as dependency for SaaS re-render
 */
export function useElementsTree(componentName: string | undefined): TreeNode[] {
  const engine = useCanvasEngineOptional();
  const context = useCanvasEngineContextOptional();
  const store = context?.store ?? null;

  // Subscribe to canvas store updates reactively (no-op when store is null)
  const updateCounter = useSyncExternalStore(
    store ? (cb) => store.subscribe(cb) : () => NOOP_UNSUB,
    () => store?.getState()._updateCounter ?? 0,
    () => 0,
  );

  // Always subscribe to shared state (VS Code path)
  const stateResult = useSharedEditorState((s) => s.astStructure);

  return useMemo<TreeNode[]>(() => {
    if (engine && store) {
      return buildTreeFromEngine(engine, store);
    }
    return (stateResult as TreeNode[] | null) ?? EMPTY_TREE;
    // updateCounter triggers re-render when engine AST changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, store, componentName, updateCounter, stateResult]);
}

// --------------------------------------------------------------------------
// SaaS path: convert engine instances to TreeNode[]
// --------------------------------------------------------------------------

type StoreApi = {
  getState: () => {
    instances: Map<
      string,
      { id: string; type: string; parentId?: string | null; children: string[]; metadata?: Record<string, unknown> }
    >;
  };
};

function buildTreeFromEngine(engine: CanvasEngine, store: StoreApi): TreeNode[] {
  const root = engine.getRoot();

  // Prefer sampleStructure (what the iframe actually renders) over astStructure (component definition)
  const structure = root.metadata?.sampleStructure ?? root.metadata?.astStructure;
  if (structure && Array.isArray(structure)) {
    return structure.map(convertASTNodeToTreeNode);
  }

  const state = store.getState();
  const rootInstance = state.instances.get(root.id);
  if (!rootInstance) return EMPTY_TREE;

  return rootInstance.children.map((childId) => {
    const instance = engine.getInstance(childId);
    if (!instance) {
      return { id: childId, type: 'element' as const, label: 'Unknown' };
    }

    const componentDef = engine.registry.get(instance.type);

    if (instance.metadata?.astStructure && Array.isArray(instance.metadata.astStructure)) {
      return {
        id: instance.id,
        type: 'component' as const,
        label: componentDef?.label || instance.type,
        name: undefined,
        children: instance.metadata.astStructure.map(convertASTNodeToTreeNode),
      };
    }

    return {
      id: instance.id,
      type: 'component' as const,
      label: componentDef?.label || instance.type,
      name: undefined,
      children: [],
    };
  });
}

// --------------------------------------------------------------------------
// AST node conversion helpers
// --------------------------------------------------------------------------

function extractTextFromNode(node: Record<string, unknown>): string {
  if ((node as { childrenType?: string }).childrenType === 'jsx') {
    return '';
  }

  let text = '';
  const n = node as {
    childrenType?: string;
    props?: Record<string, unknown>;
    children?: Record<string, unknown>[];
  };

  if (n.childrenType && n.props?.children && typeof n.props.children === 'string') {
    text += n.props.children;
  }

  if (n.children && Array.isArray(n.children)) {
    for (const child of n.children) {
      const childText = extractTextFromNode(child);
      if (childText) {
        text += (text ? ' ' : '') + childText;
      }
    }
  }

  return text.trim();
}

function convertASTNodeToTreeNode(node: Record<string, unknown>): TreeNode {
  const n = node as {
    id: string;
    type: string;
    functionItem?: { functionName?: string; functionLoc?: unknown };
    props?: Record<string, unknown>;
    children?: Record<string, unknown>[];
    childrenType?: string;
  };

  if (n.type?.startsWith('fn:')) {
    const fnName = n.functionItem?.functionName || n.type.slice(3);
    return {
      id: n.id,
      type: 'function',
      label: `${fnName}()`,
      name: undefined,
      functionLoc: n.functionItem?.functionLoc as TreeNode['functionLoc'],
      children: n.children ? n.children.map(convertASTNodeToTreeNode) : [],
    };
  }

  let label = n.type;
  let treeNodeType: TreeNode['type'] = 'component';

  if (n.type === 'div') {
    treeNodeType = 'frame';
    if (n.props?.['data-test-id']) {
      label = `div "${n.props['data-test-id']}"`;
    } else {
      const divText = extractTextFromNode(node);
      if (divText) {
        label = `div "${divText}"`;
      }
    }
  } else if (n.type === 'button') {
    const buttonText = extractTextFromNode(node);
    if (buttonText) {
      label = `button "${buttonText}"`;
    } else {
      const buttonType = (n.props?.type as string) || 'submit';
      label = `button [type="${buttonType}"]`;
    }
  } else if (n.type === 'input') {
    if (n.props?.placeholder) {
      label = `input "${n.props.placeholder}"`;
    } else {
      const inputType = (n.props?.type as string) || 'text';
      label = `input [type="${inputType}"]`;
    }
  } else if (/^[A-Z]/.test(n.type)) {
    const componentText = extractTextFromNode(node);
    if (componentText) {
      label = `${n.type} "${componentText}"`;
    }
  } else if (n.props?.['data-test-id']) {
    label = `${n.type} "${n.props['data-test-id']}"`;
  } else {
    const elementText = extractTextFromNode(node);
    if (elementText) {
      label = `${n.type} "${elementText}"`;
    }
  }

  return {
    id: n.id,
    type: treeNodeType,
    label,
    name: undefined,
    children: n.type === 'svg' ? [] : n.children ? n.children.map(convertASTNodeToTreeNode) : [],
  };
}
