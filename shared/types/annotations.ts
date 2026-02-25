/**
 * Custom annotation types for board mode drawings (arrows, text)
 * Replaces Excalidraw format with simpler custom format
 */

/**
 * Base interface for all annotation elements
 */
interface BaseAnnotation {
	id: string;
	type: 'arrow' | 'text';
	version: number;
}

/**
 * Binding reference to an instance
 */
export interface AnnotationBinding {
	instanceId: string;
}

/**
 * Arrow annotation - straight line with arrowhead and optional label
 */
export interface ArrowAnnotation extends BaseAnnotation {
	type: 'arrow';
	startX: number;
	startY: number;
	endX: number;
	endY: number;
	startBinding: AnnotationBinding | null;
	endBinding: AnnotationBinding | null;
	strokeColor: string;
	strokeWidth: number;
	/** Optional text label displayed along the arrow line */
	label?: string;
}

/**
 * Text annotation
 */
export interface TextAnnotation extends BaseAnnotation {
	type: 'text';
	x: number;
	y: number;
	text: string;
	fontSize: number;
	color: string;
}

/**
 * Union type for all annotation elements
 */
export type AnnotationElement = ArrowAnnotation | TextAnnotation;

/**
 * Type guard for ArrowAnnotation
 */
export function isArrowAnnotation(
	annotation: AnnotationElement,
): annotation is ArrowAnnotation {
	return annotation.type === 'arrow';
}

/**
 * Type guard for TextAnnotation
 */
export function isTextAnnotation(
	annotation: AnnotationElement,
): annotation is TextAnnotation {
	return annotation.type === 'text';
}

/**
 * Default values for new arrows
 */
export const DEFAULT_ARROW_STYLE = {
	strokeColor: '#000000',
	strokeWidth: 2,
} as const;

/**
 * Default values for new text
 */
export const DEFAULT_TEXT_STYLE = {
	fontSize: 16,
	color: '#000000',
} as const;

/**
 * Generate unique ID for annotation
 */
export function generateAnnotationId(): string {
	return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
