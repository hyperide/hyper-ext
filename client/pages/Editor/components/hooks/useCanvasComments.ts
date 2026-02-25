/**
 * Hook for comment sticker positioning
 * Manages RAF loop for updating comment positions during scroll/drag
 */

import { useEffect, type RefObject } from 'react';
import type { CanvasMode, ViewportState } from '@/../../shared/types/canvas';
import { getPreviewIframe } from '@/lib/dom-utils';

interface UseCanvasCommentsProps {
	activeProjectStatus: string | undefined;
	isCodeEditorMode: boolean;
	mode: 'design' | 'interact' | 'code' | null;
	canvasMode: CanvasMode;
	iframeScrollRef: RefObject<{ x: number; y: number }>;
	draggingInstanceRef: RefObject<{
		instanceId: string;
		deltaX: number;
		deltaY: number;
	} | null>;
}

/**
 * RAF loop for updating comment sticker positions during scroll and drag
 */
export function useCanvasComments({
	activeProjectStatus,
	isCodeEditorMode,
	mode,
	canvasMode,
	iframeScrollRef,
	draggingInstanceRef,
}: UseCanvasCommentsProps): void {
	// RAF loop for comment sticker positions - syncs with iframe scroll (works in board mode too)
	useEffect(() => {
		if (
			!activeProjectStatus ||
			activeProjectStatus !== 'running' ||
			isCodeEditorMode ||
			mode !== 'design'
		) {
			return;
		}

		let rafId: number;

		const updateCommentPositions = () => {
			const iframe = getPreviewIframe();
			if (
				!iframe ||
				!iframe.contentDocument ||
				!iframe.contentDocument.documentElement
			) {
				rafId = requestAnimationFrame(updateCommentPositions);
				return;
			}

			const iframeRect = iframe.getBoundingClientRect();
			const scroll = iframeScrollRef.current;
			const isSingleMode = canvasMode === 'single';

			// Update all comment stickers
			const stickers = document.querySelectorAll('[data-comment-sticker-id]');
			const dragging = draggingInstanceRef.current;

			for (const sticker of Array.from(stickers)) {
				const el = sticker as HTMLElement;
				const zoom = Number.parseFloat(el.dataset.commentZoom || '1');
				const stickerInstanceId = el.dataset.commentInstanceId;

				// Always use stored base position (where user clicked)
				let posX = Number.parseFloat(el.dataset.commentBaseX || '0');
				let posY = Number.parseFloat(el.dataset.commentBaseY || '0');

				// Apply drag delta if this sticker belongs to the dragging instance
				if (dragging && stickerInstanceId === dragging.instanceId) {
					posX += dragging.deltaX;
					posY += dragging.deltaY;
				}

				// In single mode, subtract scroll so stickers move with content
				// In board mode, positions are viewport-relative (no scroll adjustment)
				const adjustedX = isSingleMode ? posX - scroll.x : posX;
				const adjustedY = isSingleMode ? posY - scroll.y : posY;

				el.style.left = `${iframeRect.left + adjustedX * zoom}px`;
				el.style.top = `${iframeRect.top + adjustedY * zoom}px`;
			}

			// Update pending comment input
			const pendingInput = document.querySelector(
				'[data-pending-comment-input]',
			) as HTMLElement;
			if (pendingInput) {
				const baseX = Number.parseFloat(pendingInput.dataset.commentBaseX || '0');
				const baseY = Number.parseFloat(pendingInput.dataset.commentBaseY || '0');
				const zoom = Number.parseFloat(pendingInput.dataset.commentZoom || '1');

				// In single mode, subtract scroll so input moves with content
				const adjustedX = isSingleMode ? baseX - scroll.x : baseX;
				const adjustedY = isSingleMode ? baseY - scroll.y : baseY;

				pendingInput.style.left = `${iframeRect.left + adjustedX * zoom}px`;
				pendingInput.style.top = `${iframeRect.top + adjustedY * zoom}px`;
			}

			// Update arrow positions during instance drag (board mode only)
			if (dragging) {
				const arrowGroups = document.querySelectorAll(
					'[data-annotation-type="arrow"]',
				);

				for (const group of Array.from(arrowGroups)) {
					const g = group as SVGGElement;
					const startBinding = g.dataset.startBinding;
					const endBinding = g.dataset.endBinding;

					// Skip arrows not bound to the dragging instance
					if (
						startBinding !== dragging.instanceId &&
						endBinding !== dragging.instanceId
					) {
						continue;
					}

					// Get base coordinates from data attributes
					const baseStartX = Number.parseFloat(g.dataset.baseStartX || '0');
					const baseStartY = Number.parseFloat(g.dataset.baseStartY || '0');
					const baseEndX = Number.parseFloat(g.dataset.baseEndX || '0');
					const baseEndY = Number.parseFloat(g.dataset.baseEndY || '0');

					// Calculate adjusted coordinates
					const startX =
						startBinding === dragging.instanceId
							? baseStartX + dragging.deltaX
							: baseStartX;
					const startY =
						startBinding === dragging.instanceId
							? baseStartY + dragging.deltaY
							: baseStartY;
					const endX =
						endBinding === dragging.instanceId
							? baseEndX + dragging.deltaX
							: baseEndX;
					const endY =
						endBinding === dragging.instanceId
							? baseEndY + dragging.deltaY
							: baseEndY;

					// Update all line elements in the group
					const lines = g.querySelectorAll('line');
					for (const line of Array.from(lines)) {
						line.setAttribute('x1', String(startX));
						line.setAttribute('y1', String(startY));
						line.setAttribute('x2', String(endX));
						line.setAttribute('y2', String(endY));
					}

					// Update selection handles if present
					const startHandle = g.querySelector(
						'[data-arrow-handle$=":start"]',
					) as SVGCircleElement;
					const endHandle = g.querySelector(
						'[data-arrow-handle$=":end"]',
					) as SVGCircleElement;
					if (startHandle) {
						startHandle.setAttribute('cx', String(startX));
						startHandle.setAttribute('cy', String(startY));
					}
					if (endHandle) {
						endHandle.setAttribute('cx', String(endX));
						endHandle.setAttribute('cy', String(endY));
					}

					// Update selection rect if present
					const selectionRect = g.querySelector('rect');
					if (selectionRect) {
						selectionRect.setAttribute('x', String(Math.min(startX, endX) - 8));
						selectionRect.setAttribute('y', String(Math.min(startY, endY) - 8));
						selectionRect.setAttribute(
							'width',
							String(Math.abs(endX - startX) + 16),
						);
						selectionRect.setAttribute(
							'height',
							String(Math.abs(endY - startY) + 16),
						);
					}

					// Update label position (transform on inner g element)
					const labelGroup = g.querySelector('g[transform]') as SVGGElement;
					if (labelGroup) {
						const midX = (startX + endX) / 2;
						const midY = (startY + endY) / 2;
						const dx = endX - startX;
						const dy = endY - startY;
						let angle = Math.atan2(dy, dx) * (180 / Math.PI);
						if (angle > 90 || angle < -90) angle += 180;
						labelGroup.setAttribute(
							'transform',
							`translate(${midX}, ${midY}) rotate(${angle})`,
						);
					}
				}
			}

			rafId = requestAnimationFrame(updateCommentPositions);
		};

		// Start RAF loop
		rafId = requestAnimationFrame(updateCommentPositions);

		return () => {
			if (rafId) {
				cancelAnimationFrame(rafId);
			}
		};
	}, [activeProjectStatus, isCodeEditorMode, mode, canvasMode, iframeScrollRef, draggingInstanceRef]);
}
