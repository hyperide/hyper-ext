import { useCallback, useState, useEffect, useRef } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import type { ViewportState, InstancePosition } from '../../../shared/types/canvas';
import type { AnnotationElement } from '../../../shared/types/annotations';
import { isArrowAnnotation, isTextAnnotation } from '../../../shared/types/annotations';
import { ArrowElement } from './ArrowElement';
import { TextElement } from './TextElement';
import {
	detectBinding,
	createArrowAnnotation,
	createTextAnnotation,
} from '../../lib/annotations-utils';

export type DrawingTool = 'select' | 'arrow' | 'text';

export interface DrawingStyle {
	color: string;
	strokeWidth: number;
	fontSize: number;
}

export interface AnnotationOperationCallbacks {
	onInsert: (annotation: AnnotationElement) => void;
	onUpdate: (id: string, updates: Partial<AnnotationElement>) => void;
	onDelete: (ids: string[]) => void;
	onMove: (id: string, oldPosition: Partial<AnnotationElement>, newPosition: Partial<AnnotationElement>) => void;
}

export interface AnnotationsLayerProps {
	/** Ref to the canvas scroll container — used for DOM containment check in event capture */
	canvasContainerRef: React.RefObject<HTMLDivElement | null>;
	viewport: ViewportState;
	activeTool: DrawingTool;
	annotations: AnnotationElement[];
	instances: Record<string, InstancePosition>;
	drawingStyle: DrawingStyle;
	selectedIds: string[];
	onSelectionChange: (ids: string[], toggle?: boolean) => void;
	/** Called when clicking on empty space (to clear other selections) */
	onEmptyClick?: () => void;
	/** Called when marquee selection should select instances */
	onInstancesSelect?: (instanceIds: string[]) => void;
	/** @deprecated Use operation callbacks for undo/redo support */
	onChange?: (annotations: AnnotationElement[]) => void;
	operations?: AnnotationOperationCallbacks;
	onToolComplete?: () => void;
}

interface DragState {
	annotationId: string;
	endpoint: 'start' | 'end' | 'whole';
	startMouseX: number;
	startMouseY: number;
	initialAnnotation: AnnotationElement;
	hasMoved: boolean;
}

interface DrawingState {
	startX: number;
	startY: number;
	currentX: number;
	currentY: number;
}

interface MarqueeState {
	startX: number;
	startY: number;
	currentX: number;
	currentY: number;
}

interface PendingClick {
	annotationId: string;
	mouseX: number;
	mouseY: number;
	ctrlKey: boolean;
	metaKey: boolean;
}

const DRAG_THRESHOLD = 5; // pixels before we consider it a drag

/**
 * SVG-based annotations layer for board mode
 * Renders arrows and text above instances (z-index: 60)
 *
 * Interaction model:
 * - Pan&zoom ALWAYS works (wheel, space+drag, middle mouse)
 * - Click selects annotation
 * - Cmd/Ctrl+click toggles selection
 * - Drag on selected annotation moves it
 * - Double-click on text starts editing
 */
export function AnnotationsLayer({
	canvasContainerRef,
	viewport,
	activeTool,
	annotations,
	instances,
	drawingStyle,
	selectedIds,
	onSelectionChange,
	onEmptyClick,
	onInstancesSelect,
	onChange,
	operations,
	onToolComplete,
}: AnnotationsLayerProps) {
	const { resolvedTheme } = useTheme();
	const isDark = resolvedTheme === 'dark';

	const [editingTextId, setEditingTextId] = useState<string | null>(null);
	const [editingArrowLabelId, setEditingArrowLabelId] = useState<string | null>(null);
	// Store measured text sizes for hit detection
	const textSizesRef = useRef<Map<string, { width: number; height: number }>>(new Map());
	const [dragState, setDragState] = useState<DragState | null>(null);
	const dragRef = useRef<DragState | null>(null); // Ref to track drag state for events
	const [drawingState, setDrawingState] = useState<DrawingState | null>(null);
	const [marqueeState, setMarqueeState] = useState<MarqueeState | null>(null);
	const marqueeRef = useRef<MarqueeState | null>(null); // Ref to track marquee state for events
	const [pendingClick, setPendingClick] = useState<PendingClick | null>(null);
	const svgRef = useRef<SVGSVGElement>(null);
	// Track if mousedown handled selection (to prevent click from clearing it)
	const mouseDownHandledRef = useRef(false);

	// Convert screen coordinates to canvas coordinates
	const screenToCanvas = useCallback(
		(screenX: number, screenY: number) => {
			const svg = svgRef.current;
			if (!svg) return { x: screenX, y: screenY };

			const rect = svg.getBoundingClientRect();
			const x = (screenX - rect.left) / viewport.zoom - viewport.panX / viewport.zoom;
			const y = (screenY - rect.top) / viewport.zoom - viewport.panY / viewport.zoom;
			return { x, y };
		},
		[viewport],
	);

	// Find annotation under point (in canvas coordinates)
	const findAnnotationAt = useCallback(
		(canvasX: number, canvasY: number): { id: string; endpoint?: 'start' | 'end' } | null => {
			// Check arrows first (handles have priority)
			for (const ann of annotations) {
				if (isArrowAnnotation(ann)) {
					// Check handles first (if selected)
					if (selectedIds.includes(ann.id)) {
						const handleRadius = 12; // slightly larger hit area
						const startDist = Math.sqrt(
							(canvasX - ann.startX) ** 2 + (canvasY - ann.startY) ** 2
						);
						if (startDist <= handleRadius) {
							return { id: ann.id, endpoint: 'start' };
						}
						const endDist = Math.sqrt(
							(canvasX - ann.endX) ** 2 + (canvasY - ann.endY) ** 2
						);
						if (endDist <= handleRadius) {
							return { id: ann.id, endpoint: 'end' };
						}
					}

					// Check line hit area
					const hitWidth = 10;
					const dist = pointToLineDistance(
						canvasX, canvasY,
						ann.startX, ann.startY,
						ann.endX, ann.endY
					);
					if (dist <= hitWidth) {
						return { id: ann.id };
					}
				}

				if (isTextAnnotation(ann)) {
					// Use measured size if available, fallback to estimate
					const measured = textSizesRef.current.get(ann.id);
					const width = measured?.width ?? Math.max(100, ann.text.length * ann.fontSize * 0.6);
					const height = measured?.height ?? ann.fontSize * 1.5;
					if (
						canvasX >= ann.x &&
						canvasX <= ann.x + width &&
						canvasY >= ann.y &&
						canvasY <= ann.y + height
					) {
						return { id: ann.id };
					}
				}
			}
			return null;
		},
		[annotations, selectedIds],
	);

	// Calculate what's inside a marquee selection rect
	const getMarqueeSelection = useCallback(
		(marquee: MarqueeState) => {
			const minX = Math.min(marquee.startX, marquee.currentX);
			const maxX = Math.max(marquee.startX, marquee.currentX);
			const minY = Math.min(marquee.startY, marquee.currentY);
			const maxY = Math.max(marquee.startY, marquee.currentY);

			const width = maxX - minX;
			const height = maxY - minY;

			if (width <= 5 && height <= 5) {
				return { annotationIds: [], instanceIds: [] };
			}

			// Find annotations in marquee
			const annotationIds: string[] = [];
			for (const ann of annotations) {
				if (isArrowAnnotation(ann)) {
					const startInside = ann.startX >= minX && ann.startX <= maxX && ann.startY >= minY && ann.startY <= maxY;
					const endInside = ann.endX >= minX && ann.endX <= maxX && ann.endY >= minY && ann.endY <= maxY;
					const lineIntersects = lineIntersectsRect(
						ann.startX, ann.startY, ann.endX, ann.endY,
						minX, minY, maxX, maxY
					);
					if (startInside || endInside || lineIntersects) {
						annotationIds.push(ann.id);
					}
				} else if (isTextAnnotation(ann)) {
					const inside = ann.x >= minX && ann.x <= maxX && ann.y >= minY && ann.y <= maxY;
					if (inside) {
						annotationIds.push(ann.id);
					}
				}
			}

			// Find instances in marquee
			const instanceIds: string[] = [];
			for (const [instanceId, pos] of Object.entries(instances)) {
				const instLeft = pos.x;
				const instRight = pos.x + pos.width;
				const instTop = pos.y;
				const instBottom = pos.y + pos.height;
				const intersects = !(instRight < minX || instLeft > maxX || instBottom < minY || instTop > maxY);
				if (intersects) {
					instanceIds.push(instanceId);
				}
			}

			return { annotationIds, instanceIds };
		},
		[annotations, instances],
	);

	// Handle mouse down - start potential drag or drawing
	const handleMouseDown = useCallback(
		(e: MouseEvent) => {
			// Only handle left click
			if (e.button !== 0) return;

			const svg = svgRef.current;
			if (!svg) return;

			// Universal containment check: only handle events on the canvas or annotations.
			// Anything outside (sidebars, modals, resize handles, popovers, dialogs) is ignored.
			const target = e.target as HTMLElement;
			if (!svg.contains(target) && !canvasContainerRef.current?.contains(target)) {
				return;
			}

			const { x, y } = screenToCanvas(e.clientX, e.clientY);

			// End text editing if clicking outside the edited text
			if (editingTextId) {
				const hit = findAnnotationAt(x, y);
				if (!hit || hit.id !== editingTextId) {
					// Blur to trigger save, then end editing
					if (document.activeElement instanceof HTMLElement) {
						document.activeElement.blur();
					}
					setEditingTextId(null);
				}
			}

			// Drawing mode - start drawing
			if (activeTool === 'arrow') {
				e.preventDefault();
				e.stopPropagation();
				setDrawingState({
					startX: x,
					startY: y,
					currentX: x,
					currentY: y,
				});
				onSelectionChange([]);
				return;
			}

			if (activeTool === 'text') {
				e.preventDefault();
				e.stopPropagation();
				// Create text at click position
				const newText = createTextAnnotation(x, y, '', {
					fontSize: drawingStyle.fontSize,
					color: drawingStyle.color,
				});
				if (operations) {
					operations.onInsert(newText);
				} else {
					onChange?.([...annotations, newText]);
				}
				onSelectionChange([newText.id]);
				setEditingTextId(newText.id);
				onToolComplete?.();
				return;
			}

			// Select mode - check what's under cursor
			const hit = findAnnotationAt(x, y);

			if (hit) {
				e.preventDefault();
				e.stopPropagation();
				// Mark that mousedown handled this interaction (prevent click from clearing selection)
				mouseDownHandledRef.current = true;

				const isAlreadySelected = selectedIds.includes(hit.id);

				// Handle selection based on modifier keys
				const toggle = e.ctrlKey || e.metaKey;
				if (toggle) {
					// Toggle selection
					if (isAlreadySelected) {
						onSelectionChange(selectedIds.filter((id) => id !== hit.id));
					} else {
						onSelectionChange([...selectedIds, hit.id]);
					}
				} else if (!isAlreadySelected) {
					// Select this element (replace selection)
					onSelectionChange([hit.id]);
				}

				// Start drag if element is (now) selected
				const willBeSelected = toggle
					? !isAlreadySelected
					: true;

				if (willBeSelected) {
					const annotation = annotations.find((a) => a.id === hit.id);
					if (annotation) {
						const newDragState: DragState = {
							annotationId: hit.id,
							endpoint: hit.endpoint || 'whole',
							startMouseX: e.clientX,
							startMouseY: e.clientY,
							initialAnnotation: { ...annotation },
							hasMoved: false,
						};
						dragRef.current = newDragState;
						setDragState(newDragState);
					}
				}
			} else {
				// Nothing hit in annotations - check if clicking on instance overlay elements
				// (frames, badges) - let those events propagate
				const target = e.target as HTMLElement;
				if (
					target.hasAttribute('data-instance-frame') ||
					target.hasAttribute('data-instance-badge') ||
					target.closest('[data-instance-frame]') ||
					target.closest('[data-instance-badge]')
				) {
					// Let the event propagate to instance overlay handlers
					return;
				}

				// Also check if clicking inside an instance area
				const clickedOnInstance = Object.entries(instances).some(([, pos]) => {
					return x >= pos.x && x <= pos.x + pos.width &&
						   y >= pos.y && y <= pos.y + pos.height;
				});

				if (clickedOnInstance) {
					// Let the event propagate to instance overlay handlers
					return;
				}

				// Nothing hit - start marquee selection
				e.preventDefault();
				e.stopPropagation();
				mouseDownHandledRef.current = true;
				const newMarquee = {
					startX: x,
					startY: y,
					currentX: x,
					currentY: y,
				};
				console.log('[Marquee] starting at:', { x, y });
				marqueeRef.current = newMarquee;
				setMarqueeState(newMarquee);
				// Clear current selection when starting marquee (unless Cmd/Ctrl held)
				if (!e.ctrlKey && !e.metaKey) {
					onSelectionChange([]);
					onInstancesSelect?.([]);
				}
			}
		},
		[
			activeTool,
			screenToCanvas,
			findAnnotationAt,
			selectedIds,
			annotations,
			drawingStyle,
			onChange,
			operations,
			onInstancesSelect,
			onToolComplete,
			onSelectionChange,
			editingTextId,
		],
	);

	// Handle mouse move - drag or draw
	const handleMouseMove = useCallback(
		(e: MouseEvent) => {
			// Drawing preview
			if (drawingState) {
				const { x, y } = screenToCanvas(e.clientX, e.clientY);
				setDrawingState((prev) => prev ? { ...prev, currentX: x, currentY: y } : null);
				return;
			}

			// Dragging selected element - check BEFORE marquee to allow arrow dragging
			const currentDrag = dragRef.current;
			if (currentDrag) {
				const dx = e.clientX - currentDrag.startMouseX;
				const dy = e.clientY - currentDrag.startMouseY;
				const distance = Math.sqrt(dx * dx + dy * dy);

				if (!currentDrag.hasMoved && distance > DRAG_THRESHOLD) {
					dragRef.current = { ...currentDrag, hasMoved: true };
					setDragState(dragRef.current);
				}

				if (currentDrag.hasMoved || distance > DRAG_THRESHOLD) {
					const deltaX = dx / viewport.zoom;
					const deltaY = dy / viewport.zoom;
					const initial = currentDrag.initialAnnotation;

					const updated = annotations.map((ann) => {
						if (ann.id !== currentDrag.annotationId) return ann;

						if (isArrowAnnotation(initial) && isArrowAnnotation(ann)) {
							if (currentDrag.endpoint === 'whole') {
								return {
									...ann,
									startX: initial.startX + deltaX,
									startY: initial.startY + deltaY,
									endX: initial.endX + deltaX,
									endY: initial.endY + deltaY,
									startBinding: null,
									endBinding: null,
								};
							}
							if (currentDrag.endpoint === 'start') {
								return {
									...ann,
									startX: initial.startX + deltaX,
									startY: initial.startY + deltaY,
									startBinding: detectBinding(
										initial.startX + deltaX,
										initial.startY + deltaY,
										instances,
									),
								};
							}
							if (currentDrag.endpoint === 'end') {
								return {
									...ann,
									endX: initial.endX + deltaX,
									endY: initial.endY + deltaY,
									endBinding: detectBinding(
										initial.endX + deltaX,
										initial.endY + deltaY,
										instances,
									),
								};
							}
						}

						if (isTextAnnotation(initial) && isTextAnnotation(ann)) {
							return {
								...ann,
								x: initial.x + deltaX,
								y: initial.y + deltaY,
							};
						}

						return ann;
					});

					onChange?.(updated);
				}
				return;
			}

			// Marquee selection - update position and selection in real-time
			if (marqueeRef.current) {
				const { x, y } = screenToCanvas(e.clientX, e.clientY);
				marqueeRef.current = { ...marqueeRef.current, currentX: x, currentY: y };
				setMarqueeState(marqueeRef.current);

				// Update selection in real-time
				const { annotationIds, instanceIds } = getMarqueeSelection(marqueeRef.current);
				onSelectionChange(annotationIds);
				onInstancesSelect?.(instanceIds);
				return;
			}

			// Check if we should start dragging (threshold exceeded)
			if (pendingClick) {
				const dx = e.clientX - pendingClick.mouseX;
				const dy = e.clientY - pendingClick.mouseY;
				const distance = Math.sqrt(dx * dx + dy * dy);

				if (distance > DRAG_THRESHOLD) {
					// Cancel click, don't start drag (element wasn't selected)
					setPendingClick(null);
				}
			}
		},
		[drawingState, marqueeState, pendingClick, dragState, screenToCanvas, viewport, annotations, instances, onChange, getMarqueeSelection, onSelectionChange, onInstancesSelect],
	);

	// Handle mouse up - finish drag/draw or process click
	const handleMouseUp = useCallback(
		(e: MouseEvent) => {
			// Finish drawing
			if (drawingState) {
				const { x, y } = screenToCanvas(e.clientX, e.clientY);
				const dx = x - drawingState.startX;
				const dy = y - drawingState.startY;
				const distance = Math.sqrt(dx * dx + dy * dy);

				if (distance > 10) {
					const startBinding = detectBinding(drawingState.startX, drawingState.startY, instances);
					const endBinding = detectBinding(x, y, instances);

					const newArrow = createArrowAnnotation(
						drawingState.startX,
						drawingState.startY,
						x,
						y,
						{
							strokeColor: drawingStyle.color,
							strokeWidth: drawingStyle.strokeWidth,
							startBinding,
							endBinding,
						},
					);
					if (operations) {
						operations.onInsert(newArrow);
					} else {
						onChange?.([...annotations, newArrow]);
					}
					onSelectionChange([newArrow.id]);
				}

				setDrawingState(null);
				onToolComplete?.();
				return;
			}

			// Finish marquee selection - selection already applied in real-time during mousemove
			if (marqueeRef.current) {
				marqueeRef.current = null;
				setMarqueeState(null);
				return;
			}

			// Process pending click (selection)
			if (pendingClick) {
				const toggle = pendingClick.ctrlKey || pendingClick.metaKey;
				if (toggle) {
					// Toggle selection
					if (selectedIds.includes(pendingClick.annotationId)) {
						onSelectionChange(selectedIds.filter((id) => id !== pendingClick.annotationId));
					} else {
						onSelectionChange([...selectedIds, pendingClick.annotationId]);
					}
				} else {
					// Replace selection
					onSelectionChange([pendingClick.annotationId]);
				}
				setPendingClick(null);
				return;
			}

			// Finish drag
			const finishedDrag = dragRef.current;
			if (finishedDrag) {
				if (finishedDrag.hasMoved) {
					// Commit the move operation
					const currentAnnotation = annotations.find((a) => a.id === finishedDrag.annotationId);
					if (currentAnnotation && operations) {
						const initial = finishedDrag.initialAnnotation;
						if (isArrowAnnotation(initial) && isArrowAnnotation(currentAnnotation)) {
							operations.onMove(
								finishedDrag.annotationId,
								{
									startX: initial.startX,
									startY: initial.startY,
									endX: initial.endX,
									endY: initial.endY,
									startBinding: initial.startBinding,
									endBinding: initial.endBinding,
								},
								{
									startX: currentAnnotation.startX,
									startY: currentAnnotation.startY,
									endX: currentAnnotation.endX,
									endY: currentAnnotation.endY,
									startBinding: currentAnnotation.startBinding,
									endBinding: currentAnnotation.endBinding,
								},
							);
						} else if (isTextAnnotation(initial) && isTextAnnotation(currentAnnotation)) {
							operations.onMove(
								finishedDrag.annotationId,
								{ x: initial.x, y: initial.y },
								{ x: currentAnnotation.x, y: currentAnnotation.y },
							);
						}
					}
				}
				// If didn't move, it was just a click on already selected - do nothing
				dragRef.current = null;
				setDragState(null);
			}
		},
		[
			drawingState,
			marqueeState,
			pendingClick,
			dragState,
			screenToCanvas,
			instances,
			drawingStyle,
			operations,
			onChange,
			annotations,
			onToolComplete,
			selectedIds,
			onSelectionChange,
			onInstancesSelect,
		],
	);

	// Handle double click for text/arrow label editing
	const handleDoubleClick = useCallback(
		(e: MouseEvent) => {
			if (activeTool !== 'select') return;

			const svg = svgRef.current;
			if (!svg) return;

			const rect = svg.getBoundingClientRect();
			if (
				e.clientX < rect.left ||
				e.clientX > rect.right ||
				e.clientY < rect.top ||
				e.clientY > rect.bottom
			) {
				return;
			}

			const { x, y } = screenToCanvas(e.clientX, e.clientY);
			const hit = findAnnotationAt(x, y);

			if (hit) {
				const annotation = annotations.find((a) => a.id === hit.id);
				if (annotation && isTextAnnotation(annotation)) {
					e.preventDefault();
					e.stopPropagation();
					setEditingTextId(annotation.id);
					onSelectionChange([annotation.id]);
				} else if (annotation && isArrowAnnotation(annotation)) {
					// Double-click on arrow - edit label
					e.preventDefault();
					e.stopPropagation();
					setEditingArrowLabelId(annotation.id);
					onSelectionChange([annotation.id]);
				}
			} else {
				// No annotation hit - check if double-clicking on instance overlay
				// Let the event propagate to instance overlay handlers
				const target = e.target as HTMLElement;
				if (
					target.hasAttribute('data-instance-frame') ||
					target.hasAttribute('data-instance-badge') ||
					target.closest('[data-instance-frame]') ||
					target.closest('[data-instance-badge]')
				) {
					return; // Let event propagate
				}

				// Also check if double-clicking inside an instance area
				const clickedOnInstance = Object.entries(instances).some(([, pos]) => {
					return x >= pos.x && x <= pos.x + pos.width &&
						   y >= pos.y && y <= pos.y + pos.height;
				});

				if (clickedOnInstance) {
					return; // Let event propagate
				}
			}
		},
		[activeTool, screenToCanvas, findAnnotationAt, annotations, instances, onSelectionChange],
	);

	// Handle click on empty space to clear selection
	const handleClick = useCallback(
		(e: MouseEvent) => {
			// If mousedown already handled this click (e.g., selected an annotation), skip
			if (mouseDownHandledRef.current) {
				mouseDownHandledRef.current = false;
				return;
			}

			if (activeTool !== 'select') return;

			const svg = svgRef.current;
			if (!svg) return;

			const rect = svg.getBoundingClientRect();
			if (
				e.clientX < rect.left ||
				e.clientX > rect.right ||
				e.clientY < rect.top ||
				e.clientY > rect.bottom
			) {
				return;
			}

			const { x, y } = screenToCanvas(e.clientX, e.clientY);
			const hit = findAnnotationAt(x, y);

			if (!hit) {
				// Clicked on empty space - clear annotation selection and notify parent
				if (selectedIds.length > 0) {
					onSelectionChange([]);
				}
				// End text editing (blur will save the text)
				if (editingTextId) {
					// Blur active element to trigger save
					if (document.activeElement instanceof HTMLElement) {
						document.activeElement.blur();
					}
					setEditingTextId(null);
				}
				// Always notify about empty click (to clear instance selection)
				onEmptyClick?.();
			}
		},
		[activeTool, screenToCanvas, findAnnotationAt, selectedIds, onSelectionChange, onEmptyClick, editingTextId],
	);

	// Global event listeners
	useEffect(() => {
		window.addEventListener('mousedown', handleMouseDown, true);
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
		window.addEventListener('dblclick', handleDoubleClick, true);
		window.addEventListener('click', handleClick);

		return () => {
			window.removeEventListener('mousedown', handleMouseDown, true);
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
			window.removeEventListener('dblclick', handleDoubleClick, true);
			window.removeEventListener('click', handleClick);
		};
	}, [handleMouseDown, handleMouseMove, handleMouseUp, handleDoubleClick, handleClick]);

	// Handle keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Delete selected elements
			if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
				// Don't delete if editing text
				if (editingTextId) return;

				// Don't delete if typing in input
				const target = e.target as HTMLElement;
				if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
					return;
				}

				e.preventDefault();
				if (operations) {
					operations.onDelete(selectedIds);
				} else {
					const updated = annotations.filter((a) => !selectedIds.includes(a.id));
					onChange?.(updated);
				}
				onSelectionChange([]);
			}

			// Escape - clear selection or cancel editing
			if (e.key === 'Escape') {
				if (editingTextId) {
					setEditingTextId(null);
				} else if (editingArrowLabelId) {
					setEditingArrowLabelId(null);
				} else if (selectedIds.length > 0) {
					onSelectionChange([]);
				}
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [selectedIds, editingTextId, editingArrowLabelId, annotations, onChange, operations, onSelectionChange]);

	// Get cursor based on active tool and state
	const getCursor = () => {
		if (dragState?.hasMoved) return 'grabbing';
		if (drawingState) return 'crosshair';
		switch (activeTool) {
			case 'arrow':
				return 'crosshair';
			case 'text':
				return 'text';
			default:
				return 'default';
		}
	};

	return (
		<svg
			ref={svgRef}
			style={{
				position: 'absolute',
				top: 0,
				left: 0,
				width: '100%',
				height: '100%',
				// SVG never captures pointer events - we handle everything via window listeners
				pointerEvents: 'none',
				cursor: getCursor(),
			}}
		>
			{/* Apply viewport transform */}
			<g
				transform={`scale(${viewport.zoom}) translate(${viewport.panX / viewport.zoom}, ${viewport.panY / viewport.zoom})`}
			>
				{/* Render arrows */}
				{annotations.filter(isArrowAnnotation).map((arrow) => (
					<ArrowElement
						key={arrow.id}
						arrow={arrow}
						isSelected={selectedIds.includes(arrow.id)}
						isDark={isDark}
						isEditingLabel={editingArrowLabelId === arrow.id}
						onLabelChange={(label) => {
							if (operations) {
								operations.onUpdate(arrow.id, { label, version: arrow.version + 1 });
							} else {
								const updated = annotations.map((a) =>
									a.id === arrow.id && isArrowAnnotation(a)
										? { ...a, label, version: a.version + 1 }
										: a,
								);
								onChange?.(updated);
							}
						}}
						onLabelEditEnd={() => setEditingArrowLabelId(null)}
					/>
				))}

				{/* Render text elements */}
				{annotations.filter(isTextAnnotation).map((text) => (
					<TextElement
						key={text.id}
						text={text}
						isSelected={selectedIds.includes(text.id)}
						isEditing={editingTextId === text.id}
						isDark={isDark}
						onEndEdit={() => setEditingTextId(null)}
						onChange={(updated) => {
							if (operations) {
								operations.onUpdate(updated.id, { text: updated.text, version: updated.version });
							} else {
								const newAnnotations = annotations.map((a) =>
									a.id === updated.id ? updated : a,
								);
								onChange?.(newAnnotations);
							}
						}}
						onSizeChange={(id, width, height) => {
							textSizesRef.current.set(id, { width, height });
						}}
					/>
				))}

				{/* Drawing preview - temporary arrow while drawing */}
				{drawingState && (
					<line
						x1={drawingState.startX}
						y1={drawingState.startY}
						x2={drawingState.currentX}
						y2={drawingState.currentY}
						stroke={drawingStyle.color}
						strokeWidth={drawingStyle.strokeWidth}
						strokeDasharray="5 5"
						pointerEvents="none"
						className="drawing-preview"
					/>
				)}

				{/* Marquee selection rectangle */}
				{marqueeState && (
					<rect
						x={Math.min(marqueeState.startX, marqueeState.currentX)}
						y={Math.min(marqueeState.startY, marqueeState.currentY)}
						width={Math.abs(marqueeState.currentX - marqueeState.startX)}
						height={Math.abs(marqueeState.currentY - marqueeState.startY)}
						fill="rgba(59, 130, 246, 0.1)"
						stroke="#3b82f6"
						strokeWidth={1 / viewport.zoom}
						strokeDasharray={`${4 / viewport.zoom} ${2 / viewport.zoom}`}
						pointerEvents="none"
					/>
				)}
			</g>
		</svg>
	);
}

// Helper: distance from point to line segment
function pointToLineDistance(
	px: number, py: number,
	x1: number, y1: number,
	x2: number, y2: number
): number {
	const A = px - x1;
	const B = py - y1;
	const C = x2 - x1;
	const D = y2 - y1;

	const dot = A * C + B * D;
	const lenSq = C * C + D * D;
	let param = -1;

	if (lenSq !== 0) {
		param = dot / lenSq;
	}

	let xx: number, yy: number;

	if (param < 0) {
		xx = x1;
		yy = y1;
	} else if (param > 1) {
		xx = x2;
		yy = y2;
	} else {
		xx = x1 + param * C;
		yy = y1 + param * D;
	}

	const dx = px - xx;
	const dy = py - yy;
	return Math.sqrt(dx * dx + dy * dy);
}

// Helper: check if line segment intersects rectangle
function lineIntersectsRect(
	x1: number, y1: number,
	x2: number, y2: number,
	rectMinX: number, rectMinY: number,
	rectMaxX: number, rectMaxY: number
): boolean {
	// Check if line segment intersects any of the 4 edges of the rectangle
	return (
		lineSegmentsIntersect(x1, y1, x2, y2, rectMinX, rectMinY, rectMaxX, rectMinY) || // top
		lineSegmentsIntersect(x1, y1, x2, y2, rectMaxX, rectMinY, rectMaxX, rectMaxY) || // right
		lineSegmentsIntersect(x1, y1, x2, y2, rectMinX, rectMaxY, rectMaxX, rectMaxY) || // bottom
		lineSegmentsIntersect(x1, y1, x2, y2, rectMinX, rectMinY, rectMinX, rectMaxY)    // left
	);
}

// Helper: check if two line segments intersect
function lineSegmentsIntersect(
	x1: number, y1: number, x2: number, y2: number,
	x3: number, y3: number, x4: number, y4: number
): boolean {
	const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
	if (Math.abs(denom) < 0.0001) return false; // parallel

	const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
	const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

	return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}
