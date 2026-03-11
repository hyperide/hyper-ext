/**
 * Compat hook for building elements tree.
 * SaaS: converts engine AST instances to TreeNode[].
 * VS Code: reads astStructure from SharedEditorState.
 */

import type { ComponentNode } from '@lib/services/component-parser';
import { convertComponentNodeToTreeNode } from '@lib/services/tree-adapter';
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: componentName and updateCounter trigger re-render when engine AST changes
  return useMemo<TreeNode[]>(() => {
    if (engine && store) {
      return buildTreeFromEngine(engine, store);
    }
    return (stateResult as TreeNode[] | null) ?? EMPTY_TREE;
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
    return (structure as ComponentNode[]).map(convertComponentNodeToTreeNode);
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
        children: (instance.metadata.astStructure as ComponentNode[]).map(convertComponentNodeToTreeNode),
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
