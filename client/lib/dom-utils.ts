/**
 * DOM utilities for reading runtime classes and styles from iframe
 */

import { getActiveTracer } from '@/lib/element-tracing/active-tracer';

/**
 * ID of the preview iframe element.
 * Used to distinguish preview iframe from other iframes (e.g., IDE iframe).
 */
export const PREVIEW_IFRAME_ID = 'preview-iframe';

/**
 * Get preview iframe element by ID
 * @returns HTMLIFrameElement or null
 */
export function getPreviewIframe(): HTMLIFrameElement | null {
  return document.getElementById(PREVIEW_IFRAME_ID) as HTMLIFrameElement | null;
}

/**
 * Get DOM classes from element in iframe.
 * TODO(HYP-268): Migrate callers to use ElementTracer directly and remove this function.
 *
 * @param elementId - Element identifier (nodeRef)
 * @returns Space-separated className string
 */
export function getDOMClassesFromIframe(elementId: string): string {
  const element = getElementFromIframe(elementId);
  if (!element) return '';
  return element.className;
}

/**
 * Get computed styles from element in iframe.
 * TODO(HYP-268): Migrate callers to use ElementTracer directly and remove this function.
 */
export function getComputedStylesFromIframe(elementId: string): CSSStyleDeclaration | null {
  const iframe = getPreviewIframe();
  const element = getElementFromIframe(elementId);
  if (!element) return null;

  const iframeWindow = iframe?.contentWindow;
  if (!iframeWindow) return null;

  return iframeWindow.getComputedStyle(element);
}

/**
 * Get element from iframe by nodeRef.
 * When itemIndex is provided, returns the specific .map() item at that index.
 * TODO(HYP-268): Migrate callers to use ElementTracer directly and remove this function.
 */
export function getElementFromIframe(elementId: string, itemIndex?: number | null): HTMLElement | null {
  const tracer = getActiveTracer();
  if (!tracer) return null;

  if (itemIndex != null) {
    const elements = tracer.findDOMElements(elementId, itemIndex);
    return elements[0] ?? null;
  }
  return tracer.findDOMElementByNodeRef(elementId);
}

/**
 * Check if iframe is available and accessible
 * @returns true if iframe is accessible
 */
export function isIframeAccessible(): boolean {
  const iframe = getPreviewIframe();
  if (!iframe) return false;

  try {
    return !!iframe.contentDocument;
  } catch {
    return false;
  }
}
