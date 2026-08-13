/**
 * Design-mode CSS utilities for the iframe interaction script.
 * Applies shared design-mode styles to the iframe document.
 */

import { buildDesignStylesCSS } from '@shared/canvas-interaction/style-injector';

/** Apply design-mode CSS to the iframe document. */
export function updateDesignStyles(mode: string): void {
  const styleId = 'hyper-canvas-dynamic-styles';
  let style = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }

  style.textContent = buildDesignStylesCSS({
    mode: mode === 'interact' ? 'interact' : 'design',
  });

  if (mode !== 'interact') {
    document.documentElement.classList.add('design-mode');
  } else {
    document.documentElement.classList.remove('design-mode');
  }
}
