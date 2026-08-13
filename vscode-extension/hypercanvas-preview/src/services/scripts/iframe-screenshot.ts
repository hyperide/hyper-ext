/**
 * Screenshot handler for the iframe interaction script.
 * Captures DOM elements via html2canvas and posts results back to the parent webview.
 */

import html2canvas from 'html2canvas';

/** Take a screenshot of an element or the whole document and post it back. */
export function handleScreenshotRequest(
  requestId: string,
  elementId: string | null,
  findElements: (id: string, idx: number | null) => HTMLElement[],
): void {
  const target = elementId ? (findElements(elementId, 0)[0] ?? null) : document.body;

  if (!target) {
    // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage({ type: 'hypercanvas:screenshotResult', requestId, dataUrl: null }, '*');
    return;
  }

  html2canvas(target, { useCORS: true, allowTaint: true, backgroundColor: null, scale: 1 })
    .then((canvas) => {
      const dataUrl = canvas.toDataURL('image/png');
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage({ type: 'hypercanvas:screenshotResult', requestId, dataUrl }, '*');
    })
    .catch((err) => {
      console.error('[HyperCanvas] Screenshot failed:', err);
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage({ type: 'hypercanvas:screenshotResult', requestId, dataUrl: null }, '*');
    });
}
