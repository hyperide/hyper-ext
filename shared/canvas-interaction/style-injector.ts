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
  const { mode, boardModeActive = false, canvasMode = 'single', transparentBackground = false } = options;

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

  // Empty container styling (design mode only)
  if (mode !== 'interact') {
    parts.push(`
div[data-uniq-id]:empty {
  min-height: 120px;
  border: 2px dashed #cbd5e1;
  background-color: #f8fafc;
  border-radius: 8px;
  position: relative;
  transition: all 0.2s ease;
}

div[data-uniq-id]:empty::after {
  content: 'Drop elements here';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #94a3b8;
  font-size: 14px;
  font-weight: 500;
  pointer-events: none;
}

div[data-uniq-id]:empty:hover {
  border-color: #94a3b8;
  background-color: #f1f5f9;
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
