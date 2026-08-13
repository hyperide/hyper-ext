/**
 * Utility functions for custom annotation system
 * Replaces excalidraw-utils.ts
 */

import type {
  AnnotationBinding,
  AnnotationElement,
  ArrowAnnotation,
  TextAnnotation,
} from '../../shared/types/annotations';
import { DEFAULT_ARROW_STYLE, DEFAULT_TEXT_STYLE, generateAnnotationId } from '../../shared/types/annotations';
import type { InstancePosition } from '../../shared/types/canvas';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- excalidraw types for migration
type ExcalidrawElement = any;

/**
 * Migrate Excalidraw format annotations to new custom format
 * Called on composition load to convert old data
 */
export function migrateExcalidrawAnnotations(excalidrawElements: ExcalidrawElement[]): AnnotationElement[] {
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
        endBinding: el.endBinding?.elementId ? { instanceId: el.endBinding.elementId.replace('instance-', '') } : null,
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
