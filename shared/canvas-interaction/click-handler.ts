/**
 * @file Canvas click/hover handler — attaches DOM listeners to an iframe document.
 *
 * Accessed via: IframeCanvas.tsx, iframe-interaction.ts (extension)
 * Assumptions: TracingResolver (ElementTracer) is initialized with a valid adapter before attaching
 */

import type { ClickHandlerCallbacks, ClickHandlerOptions, TracingResolver } from './types';

/**
 * Elements that act as opaque containers for interaction — clicking their internal
 * children selects the container instead of the child.
 *
 * Tag names stored in UPPERCASE. The lookup normalizes via `.toUpperCase()` to handle
 * SVG elements, whose `tagName` is lowercase in browsers (SVG namespace, XML rules),
 * while HTML elements return uppercase (`DIV`, `INPUT`, etc.).
 *
 * To add more opaque containers (e.g. 'CANVAS', 'VIDEO'), extend this set.
 */
export const OPAQUE_ELEMENT_CONTAINERS = new Set<string>(['SVG']);

/**
 * If `el` is inside (or is) an opaque container, returns the container.
 * Otherwise returns `el` unchanged.
 *
 * Walks up parentElement until an opaque container tag is found or the tree ends.
 * Stops at the first (innermost) matching ancestor.
 */
export function resolveOpaqueTarget(el: HTMLElement): HTMLElement {
  let current: HTMLElement | null = el;
  while (current != null) {
    if (OPAQUE_ELEMENT_CONTAINERS.has(current.tagName.toUpperCase())) {
      return current;
    }
    current = current.parentElement;
  }
  return el;
}

/** Check if target is a form/editable element that should retain native focus behavior. */
function isInteractiveElement(target: HTMLElement): boolean {
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

/**
 * Attach click, hover, and focus handlers to an iframe document.
 * Returns a dispose function to remove all listeners.
 *
 * Uses TracingResolver (dependency inversion — shared/ can't import client/) for
 * fiber-based element identification.
 *
 * Design mode: captures click + pointerdown, prevents default, resolves element
 * via fiber tracing, calls onElementClick.
 * Interact mode: lets events pass through naturally.
 */
export function attachClickHandler(
  iframeDoc: Document,
  callbacks: ClickHandlerCallbacks,
  resolver: TracingResolver,
  _options?: ClickHandlerOptions,
): () => void {
  const { onElementClick, onElementHover, onEmptyClick, getMode, shouldIntercept } = callbacks;

  /** Stop pointerdown in design mode so pointer-event-based components don't react. */
  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (getMode() === 'design') {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleClick = (e: MouseEvent) => {
    const mode = getMode();

    // External interceptor (e.g. comment mode, board mode)
    if (shouldIntercept?.(e)) return;

    if (mode !== 'design' && mode !== 'interact') return;

    // Resolve opaque containers: clicks on SVG internals select the SVG element
    const target = resolveOpaqueTarget(e.target as HTMLElement);

    if (mode === 'design') {
      e.preventDefault();
      e.stopPropagation();
    }

    if (mode !== 'design') return;

    // Try local fiber resolution (synchronous from cache)
    const result = resolver.resolveClickLocal(target);
    if (result) {
      onElementClick(result.nodeRef, target, e, result.itemIndex, result.source);
      return;
    }

    // Fallback: fiber gave us a source but no cached nodeRef
    const source = resolver.getSourceLocation(target);
    if (source) {
      const itemIndex = resolver.getItemIndex(target);
      onElementClick(null, target, e, itemIndex, source);
      return;
    }

    // No fiber source — empty click
    onEmptyClick?.(e);
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (getMode() !== 'design') return;
    if (isInteractiveElement(e.target as HTMLElement)) {
      // In design mode, prevent native focus on interactive elements so the canvas
      // selection/interaction handling stays in control instead of the form control.
      e.preventDefault();
    }
  };

  const handleMouseOver = (e: MouseEvent) => {
    if (getMode() !== 'design') return;
    const target = resolveOpaqueTarget(e.target as HTMLElement);

    const result = resolver.resolveClickLocal(target);
    if (result) {
      onElementHover(result.nodeRef, target, result.itemIndex, result.source);
    }
    // If no fiber source, don't hover — element is not traceable
  };

  const handleMouseOut = (e: MouseEvent) => {
    if (getMode() !== 'design') return;
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (relatedTarget) {
      const source = resolver.getSourceLocation(relatedTarget);
      if (source) return; // Pointer moved to another traceable element
    }
    onElementHover(null, null, null, null);
  };

  iframeDoc.addEventListener('pointerdown', handlePointerDown, { capture: true });
  iframeDoc.addEventListener('click', handleClick, { capture: true });
  iframeDoc.addEventListener('mousedown', handleMouseDown, { capture: true });
  iframeDoc.addEventListener('mouseover', handleMouseOver, { capture: true });
  iframeDoc.addEventListener('mouseout', handleMouseOut, { capture: true });

  return () => {
    iframeDoc.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    iframeDoc.removeEventListener('click', handleClick, { capture: true });
    iframeDoc.removeEventListener('mousedown', handleMouseDown, { capture: true });
    iframeDoc.removeEventListener('mouseover', handleMouseOver, { capture: true });
    iframeDoc.removeEventListener('mouseout', handleMouseOut, { capture: true });
  };
}
