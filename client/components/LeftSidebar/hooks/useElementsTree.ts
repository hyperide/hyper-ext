/**
 * Compat hook for building elements tree.
 * SaaS: converts engine AST instances to TreeNode[].
 * VS Code: reads astStructure from SharedEditorState.
 */

import { useMemo } from 'react';
import { useStore } from 'zustand';
import {
	useCanvasEngineOptional,
	useCanvasEngineContext,
	useChildren,
} from '@/lib/canvas-engine';
import type { CanvasEngine } from '@/lib/canvas-engine';
import { useSharedEditorState } from '@/lib/platform/shared-editor-state';
import type { TreeNode } from '../../ElementsTree';

/**
 * Build elements tree from engine AST or SharedEditorState.
 * @param componentName - used as dependency for SaaS re-render
 */
export function useElementsTree(componentName: string | undefined): TreeNode[] {
	const engine = useCanvasEngineOptional();

	if (engine) {
		return useElementsTreeFromEngine(engine, componentName);
	}

	return useElementsTreeFromState();
}

// --------------------------------------------------------------------------
// SaaS path: convert engine instances to TreeNode[]
// --------------------------------------------------------------------------

function useElementsTreeFromEngine(
	engine: CanvasEngine,
	componentName: string | undefined,
): TreeNode[] {
	const { store } = useCanvasEngineContext();
	const updateCounter = useStore(store, (state) => state._updateCounter);
	const rootChildren = useChildren(engine.getRoot().id);

	return useMemo<TreeNode[]>(() => {
		const extractTextFromNode = (node: Record<string, unknown>): string => {
			if ((node as { childrenType?: string }).childrenType === 'jsx') {
				return '';
			}

			let text = '';
			const n = node as {
				childrenType?: string;
				props?: Record<string, unknown>;
				children?: Record<string, unknown>[];
			};

			if (
				n.childrenType &&
				n.props?.children &&
				typeof n.props.children === 'string'
			) {
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
		};

		const convertASTNodeToTreeNode = (node: Record<string, unknown>): TreeNode => {
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
					children: n.children
						? n.children.map(convertASTNodeToTreeNode)
						: [],
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
				children:
					n.type === 'svg'
						? []
						: n.children
							? n.children.map(convertASTNodeToTreeNode)
							: [],
			};
		};

		const convertInstanceToTreeNode = (instanceId: string): TreeNode => {
			const instance = engine.getInstance(instanceId);
			if (!instance) {
				return { id: instanceId, type: 'element', label: 'Unknown' };
			}

			const componentDef = engine.registry.get(instance.type);

			if (
				instance.metadata?.astStructure &&
				Array.isArray(instance.metadata.astStructure)
			) {
				return {
					id: instance.id,
					type: 'component',
					label: componentDef?.label || instance.type,
					name: undefined,
					children: instance.metadata.astStructure.map(
						convertASTNodeToTreeNode,
					),
				};
			}

			return {
				id: instance.id,
				type: 'component',
				label: componentDef?.label || instance.type,
				name: undefined,
				children: [],
			};
		};

		const root = engine.getRoot();
		if (
			root.metadata?.astStructure &&
			Array.isArray(root.metadata.astStructure)
		) {
			return root.metadata.astStructure.map(convertASTNodeToTreeNode);
		}

		return rootChildren.map((child) => convertInstanceToTreeNode(child.id));
	}, [rootChildren, engine, componentName, updateCounter]);
}

// --------------------------------------------------------------------------
// VS Code path: read from SharedEditorState
// --------------------------------------------------------------------------

function useElementsTreeFromState(): TreeNode[] {
	const astStructure = useSharedEditorState((s) => s.astStructure);
	return (astStructure as TreeNode[] | null) ?? [];
}
