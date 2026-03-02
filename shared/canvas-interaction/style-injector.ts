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
}`);

  // Board mode: only instances are clickable
  if (boardModeActive) {
    parts.push(`
[data-canvas-instance-id] {
  pointer-events: auto !important;
}`);
  }

  // Empty containers: min-height prevents collapse to 0px so overlays are visible.
  // Scoped to design mode — interact mode must not alter the real layout.
  parts.push(`
body.design-mode .hc-empty {
  min-height: 28px !important;
}`);

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
