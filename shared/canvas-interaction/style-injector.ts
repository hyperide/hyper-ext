/**
 * Canvas design-mode style injection.
 *
 * Ported from IframeCanvas.tsx (lines 432-515).
 * Injects/updates a <style> element in the iframe <head> with
 * mode-dependent CSS (empty container styling, cursor override, etc.)
 */

import { DRAG_GHOST_CLASS, DRAG_SOURCE_CLASS } from './drag-class-names';
import type { DesignStylesOptions } from './types';

const STYLE_ELEMENT_ID = 'hyper-canvas-dynamic-styles';

/**
 * Build CSS string for design mode styles.
 * Exported for use in contexts where direct DOM access isn't available
 * (e.g. VS Code injected script).
 */
export function buildDesignStylesCSS(options: DesignStylesOptions): string {
  const { boardModeActive = false, canvasMode = 'single', transparentBackground = false } = options;

  const parts: string[] = [];

  // Transparent background (SaaS: always, VS Code: optional)
  if (transparentBackground) {
    parts.push(`
html, body {
  background: transparent !important;
  background-color: transparent !important;
  color-scheme: normal !important;
  /* Prevent Chrome back/forward swipe gesture */
  touch-action: pan-x pan-y !important;
  overscroll-behavior-x: none !important;
  overflow-x: hidden !important;
  ${boardModeActive ? 'pointer-events: none !important;' : ''}
  ${canvasMode === 'multi' ? 'overflow: hidden !important;' : ''}
}`);
  }

  // Default cursor in design mode — covers pseudo-elements so CSS-generated
  // content (::before/::after) doesn't leak pointer/text cursors into the canvas.
  parts.push(`
html.design-mode,
html.design-mode *,
html.design-mode *::before,
html.design-mode *::after {
  cursor: default !important;
}

/* Prevent native focus outlines and focus behavior in design mode.
   All navigation is handled by HyperCanvas selection, not browser focus. */
html.design-mode *:focus,
html.design-mode *:focus-visible {
  outline: none !important;
  box-shadow: none !important;
}
html.design-mode a,
html.design-mode button,
html.design-mode input,
html.design-mode select,
html.design-mode textarea,
html.design-mode [tabindex] {
  -webkit-user-modify: read-only !important;
}

/* Ensure disabled form elements are clickable in design mode.
   Browsers may skip pointer events on disabled elements; override to
   guarantee they can be selected on the canvas. */
html.design-mode button:disabled,
html.design-mode input:disabled,
html.design-mode select:disabled,
html.design-mode textarea:disabled,
html.design-mode fieldset:disabled {
  pointer-events: auto !important;
}

/* Disable native HTML5 drag-tracking on every element in design mode.
   Chromium starts a native drag candidate on pointerdown for elements that
   are draggable (img/a default to draggable=true). Once that drag candidate
   is established, subsequent pointermove events are consumed by the drag
   tracker before our document-capture handler sees them, so the move-element
   pipeline silently aborts (PI-5-DR-EK-IMG repro: 0 pointerdowns, 8 stale
   pointerups in run-20260507-130145). The non-standard webkit-user-drag
   property prevents the drag candidate from being established at all. */
html.design-mode,
html.design-mode * {
  -webkit-user-drag: none !important;
  user-drag: none !important;
}`);

  // Board mode: only instances are clickable
  if (boardModeActive) {
    parts.push(`
[data-canvas-instance-id] {
  pointer-events: auto !important;
}`);
  }

  // Dragged source subtree: disable pointer-events on the element AND every descendant
  // so document.elementFromPoint at the drop coords skips the dragged node and its
  // children, resolving to the real sibling under the cursor rather than an inner child
  // (e.g. a <span> inside the dragged <div>) that would otherwise hit-test first.
  // The class is applied/cleared by the VS Code iframe drag script; SaaS canvas drag
  // lives in the host layer and never sets it, so this rule is inert there (see HYP-55).
  parts.push(`
.${DRAG_SOURCE_CLASS}, .${DRAG_SOURCE_CLASS} * { pointer-events: none !important; }`);

  // Ghost element for drag/reorder visual feedback — follows cursor as a floating clone.
  parts.push(`
.${DRAG_GHOST_CLASS} {
  position: fixed !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
  transform: scale(1.03) !important;
  box-shadow: 0 8px 32px rgba(0,0,0,0.22), 0 0 0 2px rgba(59,130,246,0.5) !important;
  opacity: 0.88 !important;
  border-radius: 4px !important;
  transition: transform 0.12s ease, box-shadow 0.12s ease !important;
  will-change: transform, left, top !important;
}`);

  // Drop indicator for drag/reorder visual feedback (data-dir="h" = horizontal line, "v" = vertical line)
  parts.push(`
.hyper-drop-indicator {
  position: fixed !important;
  background: #3b82f6 !important;
  z-index: 2147483646 !important;
  pointer-events: none !important;
  border-radius: 2px !important;
}
.hyper-drop-indicator[data-dir="h"] { height: 2px !important; }
.hyper-drop-indicator[data-dir="v"] { width: 2px !important; }
.hyper-drop-indicator::before,
.hyper-drop-indicator::after {
  content: '' !important;
  position: absolute !important;
  width: 6px !important;
  height: 6px !important;
  border-radius: 50% !important;
  background: #3b82f6 !important;
}
.hyper-drop-indicator[data-dir="h"]::before,
.hyper-drop-indicator[data-dir="h"]::after {
  top: 50% !important;
  transform: translateY(-50%) !important;
}
.hyper-drop-indicator[data-dir="h"]::before { left: -3px !important; }
.hyper-drop-indicator[data-dir="h"]::after  { right: -3px !important; }
.hyper-drop-indicator[data-dir="v"]::before,
.hyper-drop-indicator[data-dir="v"]::after {
  left: 50% !important;
  transform: translateX(-50%) !important;
}
.hyper-drop-indicator[data-dir="v"]::before { top: -3px !important; }
.hyper-drop-indicator[data-dir="v"]::after  { top: auto !important; bottom: -3px !important; }`);

  return parts.join('\n');
}

/**
 * Inject or update design-mode styles in an iframe document.
 * Creates a <style> element in <head> if it doesn't exist.
 */
export function injectDesignStyles(iframeDoc: Document, options: DesignStylesOptions): void {
  let styleElement = iframeDoc.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;

  if (!styleElement) {
    styleElement = iframeDoc.createElement('style');
    styleElement.id = STYLE_ELEMENT_ID;
    iframeDoc.head.appendChild(styleElement);
  }

  styleElement.textContent = buildDesignStylesCSS(options);
}
