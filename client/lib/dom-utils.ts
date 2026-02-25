/**
 * DOM utilities for reading runtime classes and styles from iframe
 */

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
 * Build CSS selector for element with optional instance scope
 * @param elementId - data-uniq-id of the element
 * @param instanceId - optional data-canvas-instance-id to scope the search
 * @returns CSS selector string
 */
export function buildElementSelector(
	elementId: string,
	instanceId?: string | null,
): string {
	if (instanceId) {
		return `[data-canvas-instance-id="${instanceId}"] [data-uniq-id="${elementId}"]`;
	}
	return `[data-uniq-id="${elementId}"]`;
}

/**
 * Get DOM classes from element in iframe
 * @param elementId - data-uniq-id of the element
 * @param instanceId - optional data-canvas-instance-id to scope the search
 * @returns Space-separated className string
 */
export function getDOMClassesFromIframe(
	elementId: string,
	instanceId?: string | null,
): string {
	const iframe = getPreviewIframe();
	const doc = iframe?.contentDocument;
	if (!doc) return '';

	const selector = buildElementSelector(elementId, instanceId);
	const element = doc.querySelector(selector) as HTMLElement;
	if (!element) return '';

	// Get computed className (includes all applied classes)
	return element.className;
}

/**
 * Get computed styles from element in iframe
 * @param elementId - data-uniq-id of the element
 * @param instanceId - optional data-canvas-instance-id to scope the search
 * @returns CSSStyleDeclaration or null
 */
export function getComputedStylesFromIframe(
	elementId: string,
	instanceId?: string | null,
): CSSStyleDeclaration | null {
	const iframe = getPreviewIframe();
	const doc = iframe?.contentDocument;
	if (!doc) return null;

	const selector = buildElementSelector(elementId, instanceId);
	const element = doc.querySelector(selector) as HTMLElement;
	if (!element) return null;

	const iframeWindow = iframe.contentWindow;
	if (!iframeWindow) return null;

	return iframeWindow.getComputedStyle(element);
}

/**
 * Get element from iframe by uniq-id
 * @param elementId - data-uniq-id of the element
 * @param instanceId - optional data-canvas-instance-id to scope the search
 * @returns HTMLElement or null
 */
export function getElementFromIframe(
	elementId: string,
	instanceId?: string | null,
): HTMLElement | null {
	const iframe = getPreviewIframe();
	const doc = iframe?.contentDocument;
	if (!doc) return null;

	const selector = buildElementSelector(elementId, instanceId);
	return doc.querySelector(selector) as HTMLElement;
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
