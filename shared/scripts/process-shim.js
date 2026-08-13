/**
 * Process shim — injected into the preview iframe before any user code runs.
 *
 * Defines `globalThis.process` (with `process.env.NODE_ENV`) when absent so a previewed
 * user app that value-imports a node-ish library reading `process.env` at module-init does
 * not crash the browser realm with "process is not defined" (which blanks the whole preview).
 * Idempotent and non-destructive: only fills what's missing, never clobbers a real `process`.
 *
 * Served by:
 *   - SaaS proxy: server/proxy/hypercanvas-scripts.ts → /__hypercanvas/process-shim.js
 *   - VS Code extension: PreviewProxy injects the same logic (non-Remix into <head>; Remix
 *     references this path). See vscode-extension/.../PreviewProxy.ts processShimScriptContent.
 *
 * SYNC: the extension keeps an inline twin in PreviewProxy.ts (processShimScriptContent).
 * Keep the two bodies behaviorally identical.
 */
(function () {
  try {
    const g = typeof globalThis !== 'undefined' ? globalThis : window;
    if (typeof g.process === 'undefined' || g.process === null) {
      g.process = { env: {} };
    }
    if (typeof g.process.env === 'undefined' || g.process.env === null) {
      g.process.env = {};
    }
    if (typeof g.process.env.NODE_ENV === 'undefined') {
      g.process.env.NODE_ENV = 'development';
    }
  } catch {
    // Never let the shim itself break the preview.
  }
})();
