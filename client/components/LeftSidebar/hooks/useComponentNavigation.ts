/**
 * Compat hook for component navigation (clicking on a component in the list).
 * SaaS: loadComponent(path) from useComponentMeta().
 * VS Code: dispatch({ currentComponent: { name, path } }).
 */

import { useCallback, useMemo } from 'react';
import { useCanvasEngineOptional } from '@/lib/canvas-engine';
import { usePlatformCanvas } from '@/lib/platform';
import { useSharedEditorState, createSharedDispatch } from '@/lib/platform/shared-editor-state';
import type { ComponentListItem } from '../../../../lib/component-scanner/types';

interface UseComponentNavigationResult {
	activePath: string | null;
	loadingComponent: string | null;
	onComponentClick: (component: ComponentListItem) => void;
}

/**
 * @param saasContext - SaaS-only context from useComponentMeta(), null in VS Code
 */
export function useComponentNavigation(saasContext: {
	activeComponentPath: string | null;
	loadComponent: (path: string) => void;
	loadingComponent: string | null;
} | null): UseComponentNavigationResult {
	const engine = useCanvasEngineOptional();
	const canvas = usePlatformCanvas();

	// VS Code: active path from shared state
	const currentComponent = useSharedEditorState((s) => s.currentComponent);
	const dispatch = useMemo(
		() => (engine ? null : createSharedDispatch(canvas)),
		[engine, canvas],
	);

	const activePath = engine
		? (saasContext?.activeComponentPath ?? null)
		: (currentComponent?.path ?? null);

	const loadingComponent = engine ? (saasContext?.loadingComponent ?? null) : null;

	const onComponentClick = useCallback(
		(component: ComponentListItem) => {
			if (engine && saasContext) {
				saasContext.loadComponent(component.path);
			} else {
				dispatch?.({
					currentComponent: { name: component.name, path: component.path },
				});
			}
		},
		[engine, saasContext, dispatch],
	);

	return { activePath, loadingComponent, onComponentClick };
}
