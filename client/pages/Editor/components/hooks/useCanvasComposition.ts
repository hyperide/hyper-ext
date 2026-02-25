/**
 * Hook for canvas composition management
 * Handles loading, saving, and syncing composition state
 */

import { useCallback, useEffect, useRef } from 'react';
import { authFetch } from '@/utils/authFetch';
import { DEFAULT_VIEWPORT, type ViewportState } from '@/../../shared/types/canvas';
import {
	migrateExcalidrawAnnotations,
	needsMigration,
} from '@/lib/annotations-utils';
import type { AnnotationStoreApi } from '@/lib/annotation-store';

export interface InstancePosition {
	x: number;
	y: number;
	width?: number;
	height?: number;
}

interface UseCanvasCompositionProps {
	projectId: string | undefined;
	componentPath: string | undefined;
	isBoardModeActive: boolean;
	viewport: ViewportState;
	annotationStore: AnnotationStoreApi;
	setViewport: React.Dispatch<React.SetStateAction<ViewportState>>;
	setInstances: React.Dispatch<React.SetStateAction<Record<string, InstancePosition>>>;
}

interface UseCanvasCompositionReturn {
	reloadComposition: () => Promise<void>;
	lastSavedCompositionRef: React.MutableRefObject<string>;
}

/**
 * Manages canvas composition loading, saving, and sync
 */
export function useCanvasComposition({
	projectId,
	componentPath,
	isBoardModeActive,
	viewport,
	annotationStore,
	setViewport,
	setInstances,
}: UseCanvasCompositionProps): UseCanvasCompositionReturn {
	// Guard: save effects must not fire until load completes
	const isLoadedRef = useRef(false);

	// Track last saved viewport to avoid redundant saves
	const lastSavedViewportRef = useRef<string>('');

	// Combined ref for backward compatibility (used by InstanceEditPopup etc.)
	const lastSavedCompositionRef = useRef<string>('');

	// Load canvas composition on mount or when component changes
	useEffect(() => {
		isLoadedRef.current = false;

		if (!projectId || !componentPath) {
			setViewport(DEFAULT_VIEWPORT);
			setInstances({});
			annotationStore.clear();
			return;
		}

		const loadComposition = async () => {
			try {
				const response = await authFetch(
					`/api/canvas-composition/${projectId}/${encodeURIComponent(componentPath)}`,
				);
				if (response.ok) {
					const data = await response.json();
					if (data.composition) {
						const loadedViewport = data.composition.viewport || DEFAULT_VIEWPORT;
						const rawAnnotations = data.composition.annotations || [];
						const migratedAnnotations = needsMigration(rawAnnotations)
							? migrateExcalidrawAnnotations(rawAnnotations)
							: rawAnnotations;

						setViewport(loadedViewport);
						setInstances(data.composition.instances || {});
						annotationStore.replaceAll(migratedAnnotations);

						// Prevent save effects from firing immediately after load
						lastSavedViewportRef.current = JSON.stringify(loadedViewport);
						lastSavedCompositionRef.current = JSON.stringify({
							viewport: loadedViewport,
							annotations: migratedAnnotations,
						});
					} else {
						setViewport(DEFAULT_VIEWPORT);
						setInstances({});
						annotationStore.clear();
						lastSavedViewportRef.current = JSON.stringify(DEFAULT_VIEWPORT);
						lastSavedCompositionRef.current = JSON.stringify({
							viewport: DEFAULT_VIEWPORT,
							annotations: [],
						});
					}
				} else {
					setViewport(DEFAULT_VIEWPORT);
					setInstances({});
					annotationStore.clear();
				}
			} catch (error) {
				console.error('[useCanvasComposition] Failed to load composition:', error);
				setViewport(DEFAULT_VIEWPORT);
				setInstances({});
				annotationStore.clear();
			}

			isLoadedRef.current = true;
		};

		loadComposition();
	}, [projectId, componentPath, setViewport, setInstances, annotationStore]);

	// Helper function to reload composition (for external changes)
	const reloadComposition = useCallback(async () => {
		if (!projectId || !componentPath) return;

		try {
			const response = await authFetch(
				`/api/canvas-composition/${projectId}/${encodeURIComponent(componentPath)}`,
			);
			if (response.ok) {
				const data = await response.json();
				console.log('[useCanvasComposition] reloadComposition data:', data);
				if (data.composition) {
					const newViewport = data.composition.viewport || DEFAULT_VIEWPORT;
					const newInstances = data.composition.instances || {};
					// Migrate from Excalidraw format if needed
					const rawAnnotations = data.composition.annotations || [];
					const newAnnotations = needsMigration(rawAnnotations)
						? migrateExcalidrawAnnotations(rawAnnotations)
						: rawAnnotations;

					// Update refs to prevent save loop
					lastSavedViewportRef.current = JSON.stringify(newViewport);
					lastSavedCompositionRef.current = JSON.stringify({
						viewport: newViewport,
						annotations: newAnnotations,
					});

					console.log('[useCanvasComposition] Setting instances:', newInstances);
					console.log(
						'[useCanvasComposition] Setting annotations:',
						newAnnotations?.length,
					);
					// NOTE: Don't setViewport here - viewport is local state per tab
					// SSE reload would cause race condition with user's pan/zoom
					setInstances(newInstances);
					annotationStore.replaceAll(newAnnotations);
				}
			}
		} catch (err) {
			console.error('[useCanvasComposition] Failed to reload composition:', err);
		}
	}, [projectId, componentPath, setInstances, annotationStore]);

	// Listen for CustomEvent (immediate, from AI agent in same tab)
	useEffect(() => {
		const handleCanvasChanged = () => {
			console.log(
				'[useCanvasComposition] CustomEvent canvasCompositionChanged received',
			);
			reloadComposition();
		};
		window.addEventListener('canvasCompositionChanged', handleCanvasChanged);
		return () =>
			window.removeEventListener(
				'canvasCompositionChanged',
				handleCanvasChanged,
			);
	}, [reloadComposition]);

	// Save viewport debounced — annotations are saved by the store itself
	useEffect(() => {
		if (!isBoardModeActive || !projectId || !componentPath) {
			return;
		}
		if (!isLoadedRef.current) return;

		const timeoutId = setTimeout(async () => {
			try {
				const viewportSig = JSON.stringify(viewport);

				if (viewportSig === lastSavedViewportRef.current) return;

				await authFetch(`/api/canvas-composition/${projectId}/viewport`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ componentPath, viewport }),
				});
				lastSavedViewportRef.current = viewportSig;
				console.log('[useCanvasComposition] Saved viewport');
			} catch (error) {
				console.error('[useCanvasComposition] Failed to save viewport:', error);
			}
		}, 500);

		return () => clearTimeout(timeoutId);
	}, [viewport, isBoardModeActive, projectId, componentPath]);

	return {
		reloadComposition,
		lastSavedCompositionRef,
	};
}
