/**
 * Canvas design-mode style injection.
 *
 * Ported from IframeCanvas.tsx (lines 432-515).
 * Injects/updates a <style> element in the iframe <head> with
 * mode-dependent CSS (empty container styling, cursor override, etc.)
 */

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

  // Default cursor in design mode
  parts.push(`
body.design-mode, body.design-mode * {
  cursor: default !important;
}

/* Prevent native focus outlines and focus behavior in design mode.
   All navigation is handled by HyperCanvas selection, not browser focus. */
body.design-mode *:focus,
body.design-mode *:focus-visible {
  outline: none !important;
  box-shadow: none !important;
}
body.design-mode a,
body.design-mode button,
body.design-mode input,
body.design-mode select,
body.design-mode textarea,
body.design-mode [tabindex] {
  -webkit-user-modify: read-only !important;
}

/* Ensure disabled form elements are clickable in design mode.
   Browsers may skip pointer events on disabled elements; override to
   guarantee they can be selected on the canvas. */
body.design-mode button:disabled,
body.design-mode input:disabled,
body.design-mode select:disabled,
body.design-mode textarea:disabled,
body.design-mode fieldset:disabled {
  pointer-events: auto !important;
}`);

  // Board mode: only instances are clickable
  if (boardModeActive) {
    parts.push(`
[data-canvas-instance-id] {
  pointer-events: auto !important;
}`);
  }

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
