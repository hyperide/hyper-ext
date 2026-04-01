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
 * Uses ElementTracer.findDOMElement() when available.
 * TODO(HYP-268): Migrate callers to use ElementTracer directly and remove this function.
 *
 * @param elementId - Element identifier (nodeRef or legacy UUID)
 * @param instanceId - optional data-canvas-instance-id to scope the search
 * @returns Space-separated className string
 */
export function getDOMClassesFromIframe(elementId: string, instanceId?: string | null): string {
  const iframe = getPreviewIframe();
  const doc = iframe?.contentDocument;
  if (!doc) return '';

  const element = findElementInIframe(doc, elementId, instanceId);
  if (!element) return '';

  return element.className;
}

/**
 * Get computed styles from element in iframe.
 * TODO(HYP-268): Migrate callers to use ElementTracer directly and remove this function.
 */
export function getComputedStylesFromIframe(elementId: string, instanceId?: string | null): CSSStyleDeclaration | null {
  const iframe = getPreviewIframe();
  const doc = iframe?.contentDocument;
  if (!doc) return null;

  const element = findElementInIframe(doc, elementId, instanceId);
  if (!element) return null;

  const iframeWindow = iframe.contentWindow;
  if (!iframeWindow) return null;

  return iframeWindow.getComputedStyle(element);
}

/**
 * Get element from iframe by nodeRef.
 * TODO(HYP-268): Migrate callers to use ElementTracer directly and remove this function.
 */
export function getElementFromIframe(elementId: string, instanceId?: string | null): HTMLElement | null {
  const iframe = getPreviewIframe();
  const doc = iframe?.contentDocument;
  if (!doc) return null;

  return findElementInIframe(doc, elementId, instanceId);
}

/**
 * Find element in an iframe document by nodeRef via active ElementTracer.
 * Uses FiberSourceIndex for O(1) lookup by source location.
 */
function findElementInIframe(_doc: Document, elementId: string, _instanceId?: string | null): HTMLElement | null {
  const tracer = getActiveTracer();
  if (!tracer) return null;
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
