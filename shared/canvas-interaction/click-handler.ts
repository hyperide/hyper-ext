/**
 * Canvas click/hover handler — attaches DOM listeners to an iframe document.
 *
 * Ported from IframeCanvas.tsx (lines 558-746).
 * In design mode: captures clicks, finds [data-uniq-id] elements, prevents default.
 * In interact mode: lets events pass through naturally.
 */

import type { ClickHandlerCallbacks, ClickHandlerOptions } from './types';

/**
 * Calculate item index for map-rendered elements.
 * When multiple elements share the same data-uniq-id (e.g. inside .map()),
 * returns the index of the clicked/hovered element among siblings.
 * Returns null when there's only one element with this ID.
 */
export function getItemIndex(
  element: Element,
  uniqId: string,
  doc: Document,
  activeInstanceId?: string | null,
): number | null {
  let selector = `[data-uniq-id="${uniqId}"]`;
  if (activeInstanceId) {
    selector = `[data-canvas-instance-id="${activeInstanceId}"] ${selector}`;
  }
  const allWithSameId = doc.querySelectorAll(selector);
  if (allWithSameId.length > 1) {
    return Array.from(allWithSameId).indexOf(element);
  }
  return null;
}

/**
 * Attach click, hover, and focus handlers to an iframe document.
 * Returns a dispose function to remove all listeners.
 *
 * Design mode: preventDefault + stopPropagation, find element, call onElementClick.
 * Interact mode: allow pass-through, only call onEmptyClick on empty space.
 */
export function attachClickHandler(
  iframeDoc: Document,
  callbacks: ClickHandlerCallbacks,
  options?: ClickHandlerOptions,
): () => void {
  const { onElementClick, onElementHover, onEmptyClick, getMode, shouldIntercept } = callbacks;
  const getActiveInstanceId = options?.getActiveInstanceId ?? (() => options?.activeInstanceId ?? null);

  const handleClick = (e: MouseEvent) => {
    const mode = getMode();

    // External interceptor (e.g. comment mode, board mode)
    if (shouldIntercept?.(e)) {
      return;
    }

    if (mode !== 'design' && mode !== 'interact') return;

    if (mode === 'design') {
      e.preventDefault();
      e.stopPropagation();
    }

    const target = e.target as HTMLElement;
    const element = target.closest('[data-uniq-id]') as HTMLElement | null;

    if (!element) {
      onEmptyClick?.(e);
      return;
    }

    // Only trigger element click callback in design mode
    if (mode === 'design') {
      const uniqId = element.dataset.uniqId;
      if (uniqId) {
        const itemIndex = getItemIndex(element, uniqId, iframeDoc, getActiveInstanceId());
        onElementClick(uniqId, element, e, itemIndex);
      }
    }
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (getMode() !== 'design') return;
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    ) {
      e.preventDefault(); // Actually prevents focus on mousedown
    }
  };

  const handleMouseOver = (e: MouseEvent) => {
    if (getMode() !== 'design') return;
    const target = e.target as HTMLElement;
    const element = target.closest('[data-uniq-id]') as HTMLElement | null;
    if (element) {
      const uniqId = element.dataset.uniqId;
      if (uniqId) {
        const itemIndex = getItemIndex(element, uniqId, iframeDoc, getActiveInstanceId());
        onElementHover(uniqId, element, itemIndex);
      }
    }
  };

  const handleMouseOut = (e: MouseEvent) => {
    if (getMode() !== 'design') return;
    const target = e.target as HTMLElement;
    const element = target.closest('[data-uniq-id]') as HTMLElement | null;
    if (element) {
      onElementHover(null, null, null);
    }
  };

  iframeDoc.addEventListener('click', handleClick, { capture: true });
  iframeDoc.addEventListener('mousedown', handleMouseDown, { capture: true });
  iframeDoc.addEventListener('mouseover', handleMouseOver, { capture: true });
  iframeDoc.addEventListener('mouseout', handleMouseOut, { capture: true });

  return () => {
    iframeDoc.removeEventListener('click', handleClick, { capture: true });
    iframeDoc.removeEventListener('mousedown', handleMouseDown, {
      capture: true,
    });
    iframeDoc.removeEventListener('mouseover', handleMouseOver, {
      capture: true,
    });
    iframeDoc.removeEventListener('mouseout', handleMouseOut, {
      capture: true,
    });
  };
}
