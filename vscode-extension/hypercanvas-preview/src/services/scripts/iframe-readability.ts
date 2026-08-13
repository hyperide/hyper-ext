/**
 * iframe-readability — readability-aid sample reporter (HYP-1002), injected into the preview
 * iframe by PreviewProxy (part of the iframe-interaction IIFE bundle).
 *
 * The preview iframe is the only realm with the live component DOM + computed styles. This module
 * collects the surface-backed text colours (via the shared, cross-platform collector) and posts
 * them to the preview-panel webview, which runs the shared decision and — when a flip is
 * warranted — paints the canvas surface behind the transparent iframe. It NEVER mutates the DOM
 * or the component source; it only reads and reports.
 */
import { collectReadabilitySamples, type ReadabilitySample } from '@shared/utils/readability-samples';

/** postMessage payload from the iframe to the preview-panel webview. */
export interface ReadabilitySamplesMessage {
  type: 'hypercanvas:readabilitySamples';
  hasOwnBackground: boolean;
  samples: ReadabilitySample[];
}

/** Trailing debounce after an HMR update before re-collecting (the DOM repaints async). */
const REEVAL_DEBOUNCE_MS = 150;

function componentRoot(): Element | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById('root') ?? document.body ?? null;
}

/** Collect surface-backed text samples and post them to the parent webview. */
function reportReadabilitySamples(target: Window = window.parent): void {
  const root = componentRoot();
  if (!root) return;
  const { hasOwnBackground, samples } = collectReadabilitySamples(root);
  const message: ReadabilitySamplesMessage = {
    type: 'hypercanvas:readabilitySamples',
    hasOwnBackground,
    samples,
  };
  target.postMessage(message, '*');
}

/**
 * Schedule readability reporting once the preview has painted, and again (debounced) after each
 * Vite HMR update. Safe to call once at iframe-interaction startup.
 */
export function setupReadabilityReporting(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      requestAnimationFrame(() => reportReadabilitySamples());
    }, REEVAL_DEBOUNCE_MS);
  };

  const kick = (): void => {
    const fonts = document.fonts;
    if (fonts?.ready) {
      fonts.ready.then(schedule).catch(schedule);
    } else {
      schedule();
    }
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    kick();
  } else {
    document.addEventListener('DOMContentLoaded', kick, { once: true });
  }
  window.addEventListener('load', kick, { once: true });

  // Re-report on ANY meaningful DOM change (debounced). This is the load-bearing trigger for BOTH
  // HMR / React Fast-Refresh (Vite delivers those via `import.meta.hot.on`, not window events, so a
  // DOM observer is the reliable signal here) AND the extension's postMessage in-place component
  // switch (no iframe reload → no load event). The consumer keys its decision by the sample-content
  // signature, so identical re-reports are cheap no-ops.
  if (typeof MutationObserver !== 'undefined') {
    const observe = (): void => {
      if (!document.body) return;
      new MutationObserver(schedule).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    };
    if (document.body) observe();
    else document.addEventListener('DOMContentLoaded', observe, { once: true });
  }
}
