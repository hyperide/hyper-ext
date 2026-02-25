/**
 * Hook for managing comment-related handlers
 * Handles adding, submitting, canceling, and selecting comments
 */

import { useCallback, useState } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine';
import type { InstancePosition } from './useCanvasComposition';

interface PendingCommentPosition {
	x: number;
	y: number;
	elementId: string | null;
	instanceId: string | null;
}

interface UseCommentHandlersProps {
	engine: CanvasEngine;
	componentPath: string | undefined;
	canvasMode: 'single' | 'multi';
	instances: Record<string, InstancePosition>;
	createComment: (data: {
		content: string;
		componentPath: string;
		elementId?: string;
		instanceId?: string;
		positionX: number;
		positionY: number;
		mentionedUserIds?: string[];
	}) => Promise<{ id: string } | null>;
	setIsAddingComment: (value: boolean) => void;
	setSelectedCommentId: (id: string | null) => void;
	applyInstanceSizeChange: (width: number, height: number) => void;
}

interface UseCommentHandlersReturn {
	pendingCommentPosition: PendingCommentPosition | null;
	setPendingCommentPosition: React.Dispatch<React.SetStateAction<PendingCommentPosition | null>>;
	showSizeSelectionForComment: boolean;
	setShowSizeSelectionForComment: React.Dispatch<React.SetStateAction<boolean>>;
	handleAddComment: (
		position: { x: number; y: number },
		elementId: string | null,
		instanceId: string | null,
	) => void;
	handleBeforeAddComment: () => boolean;
	handleCommentSubmit: (content: string, mentionedUserIds?: string[]) => Promise<void>;
	handleCommentCancel: () => void;
	handleCommentSelect: (commentId: string) => void;
	handleSizeSelectionForComment: (width: number, height: number) => void;
}

/**
 * Manages all comment-related handlers and state
 */
export function useCommentHandlers({
	engine,
	componentPath,
	canvasMode,
	instances,
	createComment,
	setIsAddingComment,
	setSelectedCommentId,
	applyInstanceSizeChange,
}: UseCommentHandlersProps): UseCommentHandlersReturn {
	// Position of pending comment being added
	const [pendingCommentPosition, setPendingCommentPosition] =
		useState<PendingCommentPosition | null>(null);

	// Show size selection dialog before adding comment (when size is Auto)
	const [showSizeSelectionForComment, setShowSizeSelectionForComment] =
		useState(false);

	// Handle adding comment on canvas click
	const handleAddComment = useCallback(
		(
			position: { x: number; y: number },
			elementId: string | null,
			instanceId: string | null,
		) => {
			console.log(
				'[useCommentHandlers] Adding comment at:',
				position,
				'elementId:',
				elementId,
				'instanceId:',
				instanceId,
			);

			// Position comes from iframe click - already in content coordinates (1:1 scale)
			// because iframe's internal coordinate system is unaffected by CSS zoom on parent
			setPendingCommentPosition({
				x: position.x,
				y: position.y,
				elementId,
				instanceId,
			});

			// Exit adding comment mode
			setIsAddingComment(false);

			// Select the new comment to open the thread panel
			// (will be handled after comment is created)
		},
		[setIsAddingComment],
	);

	// Check if size is Auto before adding comment - prompt to select size first
	const handleBeforeAddComment = useCallback(() => {
		// Only check in single mode when size is Auto
		if (canvasMode === 'single' && !instances.default?.width) {
			setShowSizeSelectionForComment(true);
			return false; // Cancel - dialog will handle it
		}
		return true; // Proceed
	}, [canvasMode, instances.default?.width]);

	// Handle comment submission from pending comment input
	const handleCommentSubmit = useCallback(
		async (content: string, mentionedUserIds?: string[]) => {
			if (!componentPath || !pendingCommentPosition) return;

			const newComment = await createComment({
				content,
				componentPath,
				elementId: pendingCommentPosition.elementId || undefined,
				instanceId: pendingCommentPosition.instanceId || undefined,
				positionX: pendingCommentPosition.x,
				positionY: pendingCommentPosition.y,
				mentionedUserIds,
			});

			console.log('[useCommentHandlers] Comment created:', newComment);

			if (newComment) {
				setSelectedCommentId(newComment.id);
			}
			setPendingCommentPosition(null);
		},
		[componentPath, pendingCommentPosition, createComment, setSelectedCommentId],
	);

	// Handle canceling pending comment
	const handleCommentCancel = useCallback(() => {
		setPendingCommentPosition(null);
	}, []);

	// Handle comment sticker click
	const handleCommentSelect = useCallback(
		(commentId: string) => {
			engine.clearSelection();
			setSelectedCommentId(commentId);
		},
		[engine, setSelectedCommentId],
	);

	// Handle size selection from dialog (when adding comment with Auto size)
	const handleSizeSelectionForComment = useCallback(
		(width: number, height: number) => {
			applyInstanceSizeChange(width, height);
			setShowSizeSelectionForComment(false);
			setIsAddingComment(true);
		},
		[applyInstanceSizeChange, setIsAddingComment],
	);

	return {
		pendingCommentPosition,
		setPendingCommentPosition,
		showSizeSelectionForComment,
		setShowSizeSelectionForComment,
		handleAddComment,
		handleBeforeAddComment,
		handleCommentSubmit,
		handleCommentCancel,
		handleCommentSelect,
		handleSizeSelectionForComment,
	};
}
