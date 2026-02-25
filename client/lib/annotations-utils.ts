/**
 * Utility functions for custom annotation system
 * Replaces excalidraw-utils.ts
 */

import type { InstancePosition } from '../../shared/types/canvas';
import type {
	AnnotationElement,
	ArrowAnnotation,
	TextAnnotation,
	AnnotationBinding,
} from '../../shared/types/annotations';
import {
	isArrowAnnotation,
	generateAnnotationId,
	DEFAULT_ARROW_STYLE,
	DEFAULT_TEXT_STYLE,
} from '../../shared/types/annotations';

// biome-ignore lint/suspicious/noExplicitAny: excalidraw types for migration
type ExcalidrawElement = any;

/**
 * Migrate Excalidraw format annotations to new custom format
 * Called on composition load to convert old data
 */
export function migrateExcalidrawAnnotations(
	excalidrawElements: ExcalidrawElement[],
): AnnotationElement[] {
	if (!excalidrawElements || !Array.isArray(excalidrawElements)) {
		return [];
	}

	const migrated: AnnotationElement[] = [];

	for (const el of excalidrawElements) {
		if (!el) continue;

		if (el.type === 'arrow') {
			const endPoint = el.points?.[1] || [0, 0];
			const arrow: ArrowAnnotation = {
				id: el.id || generateAnnotationId(),
				type: 'arrow',
				version: el.version || 1,
				startX: el.x || 0,
				startY: el.y || 0,
				endX: (el.x || 0) + (endPoint[0] || 0),
				endY: (el.y || 0) + (endPoint[1] || 0),
				startBinding: el.startBinding?.elementId
					? { instanceId: el.startBinding.elementId.replace('instance-', '') }
					: null,
				endBinding: el.endBinding?.elementId
					? { instanceId: el.endBinding.elementId.replace('instance-', '') }
					: null,
				strokeColor: el.strokeColor || DEFAULT_ARROW_STYLE.strokeColor,
				strokeWidth: el.strokeWidth || DEFAULT_ARROW_STYLE.strokeWidth,
			};
			migrated.push(arrow);
		} else if (el.type === 'text') {
			const text: TextAnnotation = {
				id: el.id || generateAnnotationId(),
				type: 'text',
				version: el.version || 1,
				x: el.x || 0,
				y: el.y || 0,
				text: el.text || '',
				fontSize: el.fontSize || DEFAULT_TEXT_STYLE.fontSize,
				color: el.strokeColor || DEFAULT_TEXT_STYLE.color,
			};
			migrated.push(text);
		}
		// Skip other element types (rectangles used for instance frames, etc.)
	}

	return migrated;
}

/**
 * Check if annotations are in old Excalidraw format
 * Used to detect if migration is needed
 */
export function needsMigration(annotations: unknown[]): boolean {
	if (!annotations || annotations.length === 0) return false;

	// Check first element for Excalidraw-specific properties
	const first = annotations[0] as ExcalidrawElement;
	if (!first) return false;

	// Excalidraw arrows have 'points' array, our format has startX/endX
	if (first.type === 'arrow' && 'points' in first && !('startX' in first)) {
		return true;
	}

	return false;
}

/**
 * Update arrow positions when an instance is moved
 * Shifts bound arrow endpoints by the same delta as the instance
 */
export function updateArrowsForInstanceMove(
	annotations: AnnotationElement[],
	movedInstanceId: string,
	deltaX: number,
	deltaY: number,
): AnnotationElement[] {
	return annotations.map((ann) => {
		if (!isArrowAnnotation(ann)) return ann;

		const startBoundToMoved = ann.startBinding?.instanceId === movedInstanceId;
		const endBoundToMoved = ann.endBinding?.instanceId === movedInstanceId;

		// Skip if arrow is not bound to the moved instance
		if (!startBoundToMoved && !endBoundToMoved) return ann;

		let newStartX = ann.startX;
		let newStartY = ann.startY;
		let newEndX = ann.endX;
		let newEndY = ann.endY;

		if (startBoundToMoved && endBoundToMoved) {
			// Both ends bound to same instance - move the whole arrow
			newStartX += deltaX;
			newStartY += deltaY;
			newEndX += deltaX;
			newEndY += deltaY;
		} else if (startBoundToMoved) {
			// Only start point moves
			newStartX += deltaX;
			newStartY += deltaY;
		} else {
			// Only end point moves
			newEndX += deltaX;
			newEndY += deltaY;
		}

		return {
			...ann,
			startX: newStartX,
			startY: newStartY,
			endX: newEndX,
			endY: newEndY,
			version: ann.version + 1,
		};
	});
}

/**
 * Instance bounds for binding detection
 */
interface InstanceBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Get instance bounds from position data
 */
export function getInstanceBounds(
	instances: Record<string, InstancePosition>,
): Record<string, InstanceBounds> {
	const bounds: Record<string, InstanceBounds> = {};

	for (const [instanceId, pos] of Object.entries(instances)) {
		bounds[instanceId] = {
			x: pos.x,
			y: pos.y,
			width: pos.width || 200,
			height: pos.height || 200,
		};
	}

	return bounds;
}

/**
 * Detect if a point is near an instance for binding
 * Returns the instance binding if within threshold, null otherwise
 */
export function detectBinding(
	x: number,
	y: number,
	instances: Record<string, InstancePosition>,
	threshold = 20,
): AnnotationBinding | null {
	for (const [instanceId, pos] of Object.entries(instances)) {
		const width = pos.width || 200;
		const height = pos.height || 200;

		// Check if point is within threshold of instance bounds
		const isNear =
			x >= pos.x - threshold &&
			x <= pos.x + width + threshold &&
			y >= pos.y - threshold &&
			y <= pos.y + height + threshold;

		if (isNear) {
			return { instanceId };
		}
	}

	return null;
}

/**
 * Get the center point of an instance for arrow snapping
 */
export function getInstanceCenter(
	instanceId: string,
	instances: Record<string, InstancePosition>,
): { x: number; y: number } | null {
	const pos = instances[instanceId];
	if (!pos) return null;

	const width = pos.width || 200;
	const height = pos.height || 200;

	return {
		x: pos.x + width / 2,
		y: pos.y + height / 2,
	};
}

/**
 * Get the closest edge point of an instance to a given point
 * Used for snapping arrow endpoints to instance edges
 */
export function getClosestEdgePoint(
	pointX: number,
	pointY: number,
	instanceId: string,
	instances: Record<string, InstancePosition>,
): { x: number; y: number } | null {
	const pos = instances[instanceId];
	if (!pos) return null;

	const width = pos.width || 200;
	const height = pos.height || 200;

	const centerX = pos.x + width / 2;
	const centerY = pos.y + height / 2;

	// Calculate angle from center to point
	const angle = Math.atan2(pointY - centerY, pointX - centerX);

	// Find intersection with rectangle edge
	const halfWidth = width / 2;
	const halfHeight = height / 2;

	// Determine which edge the line intersects
	const tanAngle = Math.tan(angle);
	let edgeX: number;
	let edgeY: number;

	if (Math.abs(tanAngle) < halfHeight / halfWidth) {
		// Intersects left or right edge
		edgeX = Math.sign(Math.cos(angle)) * halfWidth;
		edgeY = edgeX * tanAngle;
	} else {
		// Intersects top or bottom edge
		edgeY = Math.sign(Math.sin(angle)) * halfHeight;
		edgeX = edgeY / tanAngle;
	}

	return {
		x: centerX + edgeX,
		y: centerY + edgeY,
	};
}

/**
 * Create a new arrow annotation
 */
export function createArrowAnnotation(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
	options: Partial<{
		strokeColor: string;
		strokeWidth: number;
		startBinding: AnnotationBinding | null;
		endBinding: AnnotationBinding | null;
	}> = {},
): ArrowAnnotation {
	return {
		id: generateAnnotationId(),
		type: 'arrow',
		version: 1,
		startX,
		startY,
		endX,
		endY,
		startBinding: options.startBinding ?? null,
		endBinding: options.endBinding ?? null,
		strokeColor: options.strokeColor ?? DEFAULT_ARROW_STYLE.strokeColor,
		strokeWidth: options.strokeWidth ?? DEFAULT_ARROW_STYLE.strokeWidth,
	};
}

/**
 * Create a new text annotation
 */
export function createTextAnnotation(
	x: number,
	y: number,
	text: string,
	options: Partial<{
		fontSize: number;
		color: string;
	}> = {},
): TextAnnotation {
	return {
		id: generateAnnotationId(),
		type: 'text',
		version: 1,
		x,
		y,
		text,
		fontSize: options.fontSize ?? DEFAULT_TEXT_STYLE.fontSize,
		color: options.color ?? DEFAULT_TEXT_STYLE.color,
	};
}
