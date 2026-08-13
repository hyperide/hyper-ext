/**
 * Chrome-detection — injected into the preview iframe.
 *
 * Posts `{ type: 'chrome-detected' }` to the parent when the previewed page renders its own
 * navigation chrome (nav/header/aside), so the host can adapt the canvas frame.
 *
 * Served by:
 *   - SaaS proxy: server/proxy/hypercanvas-scripts.ts → /__hypercanvas/chrome-detection.js
 *   - VS Code extension: PreviewProxy (chromeDetectionScriptContent).
 *
 * SYNC: the extension keeps an inline twin in PreviewProxy.ts (chromeDetectionScriptContent).
 * Keep the two bodies behaviorally identical.
 */
(function () {
  window.addEventListener(
    'load',
    function () {
      const hasChrome = document.querySelector('nav, header, aside') !== null;
      if (hasChrome) {
        window.parent.postMessage({ type: 'chrome-detected' }, '*');
      }
    },
    { once: true },
  );
})();
