/**
 * Hook for managing element interaction handlers
 * Handles element click and hover events on the canvas
 */

import { useCallback } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine';

interface UseElementInteractionProps {
	engine: CanvasEngine;
	selectedCommentId: string | null;
	selectedAnnotationIds: string[];
	setSelectedCommentId: (id: string | null) => void;
	setSelectedAnnotationIds: (ids: string[]) => void;
}

interface UseElementInteractionReturn {
	handleElementClick: (
		element: HTMLElement | null,
		event?: MouseEvent,
		itemIndex?: number | null,
	) => void;
	handleElementHover: (
		element: HTMLElement | null,
		itemIndex?: number | null,
	) => void;
	handleHoverElement: (id: string | null) => void;
}

/**
 * Manages element click and hover interactions
 */
export function useElementInteraction({
	engine,
	selectedCommentId,
	selectedAnnotationIds,
	setSelectedCommentId,
	setSelectedAnnotationIds,
}: UseElementInteractionProps): UseElementInteractionReturn {
	// Handle element click with modifier key support
	const handleElementClick = useCallback(
		(
			element: HTMLElement | null,
			event?: MouseEvent,
			itemIndex?: number | null,
		) => {
			// Deselect comment when clicking on canvas (any element or empty space)
			if (selectedCommentId) {
				setSelectedCommentId(null);
			}

			// Clear annotation selection when clicking on instance or empty space
			if (selectedAnnotationIds.length > 0) {
				setSelectedAnnotationIds([]);
			}

			if (!element) {
				// Clicked on empty canvas - clear selection only if no modifier key pressed
				if (!event?.metaKey && !event?.ctrlKey) {
					engine.clearSelection();
				}
				return;
			}

			const uniqId = element.dataset.uniqId;
			if (!uniqId) {
				return;
			}

			// Cmd/Ctrl+Click - toggle selection
			if (event?.metaKey || event?.ctrlKey) {
				const currentSelection = engine.getSelection();
				if (currentSelection.selectedIds.includes(uniqId)) {
					engine.removeFromSelection(uniqId);
				} else {
					engine.addToSelection(uniqId);
				}
			} else {
				// Normal click - replace selection with item index support
				// itemIndex is set when element is rendered multiple times via .map()
				engine.selectWithItemIndex(uniqId, itemIndex ?? null);
			}
		},
		[engine, selectedCommentId, setSelectedCommentId, selectedAnnotationIds, setSelectedAnnotationIds],
	);

	// Handle element hover with item index support
	const handleElementHover = useCallback(
		(element: HTMLElement | null, itemIndex?: number | null) => {
			const uniqId = element?.dataset.uniqId;
			if (uniqId) {
				engine.setHoveredWithItemIndex(uniqId, itemIndex ?? null);
			} else {
				engine.setHovered(null);
			}
		},
		[engine],
	);

	// Simple hover handler (used by LeftSidebar tree)
	// Goes through engine so hoveredId in zustand store stays in sync
	const handleHoverElement = useCallback((id: string | null) => {
		engine.setHovered(id);
	}, [engine]);

	return {
		handleElementClick,
		handleElementHover,
		handleHoverElement,
	};
}
