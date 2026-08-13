/**
 * Inline content of iframe-console-capture.js as a TS string.
 * Used by IframeCanvas to inject the script without a network request
 * (NodePod Service Worker intercepts src-based <script> loads from iframe).
 *
 * Keep in sync with iframe-console-capture.js.
 */
export const IFRAME_CONSOLE_CAPTURE_SCRIPT = `(() => {
  const BATCH_INTERVAL = 100;
  const MAX_ARG_LENGTH = 500;
  const MAX_ARGS = 5;
  const EVENT_TYPE = 'hypercanvas:console';

  let buffer = [];
  let flushTimer = null;
  const origConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  const stringify = (arg) => {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'string') return arg.slice(0, MAX_ARG_LENGTH);
    if (arg instanceof Error) return (arg.stack || arg.message || String(arg)).slice(0, MAX_ARG_LENGTH);
    try {
      return JSON.stringify(arg, null, 0).slice(0, MAX_ARG_LENGTH);
    } catch {
      return String(arg).slice(0, MAX_ARG_LENGTH);
    }
  };

  const flush = () => {
    flushTimer = null;
    if (buffer.length === 0) return;
    const entries = buffer;
    buffer = [];
    try {
      window.parent.postMessage({ type: EVENT_TYPE, entries }, '*');
    } catch {}
  };

  const scheduleFlush = () => {
    if (flushTimer === null) {
      flushTimer = setTimeout(flush, BATCH_INTERVAL);
    }
  };

  const makeHook = (level) => (...hookArgs) => {
    origConsole[level].apply(console, hookArgs);
    const args = [];
    const len = Math.min(hookArgs.length, MAX_ARGS);
    for (let i = 0; i < len; i++) args.push(stringify(hookArgs[i]));
    buffer.push({ level, args, timestamp: Date.now() });
    scheduleFlush();
  };

  console.log = makeHook('log');
  console.warn = makeHook('warn');
  console.error = makeHook('error');
  console.info = makeHook('info');
  console.debug = makeHook('debug');

  window.addEventListener('error', (event) => {
    const msg = event.message || 'Unknown error';
    const file = event.filename || '';
    const line = event.lineno || 0;
    const col = event.colno || 0;
    try {
      window.parent.postMessage({ type: 'hypercanvas:runtimeError', error: { framework: 'vite', type: 'Runtime Error', message: msg, file, line, fullText: file ? msg + '\\n\\nFile: ' + file + ':' + line + ':' + col : msg } }, '*');
    } catch {}
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason ? reason.message || String(reason) : 'Unhandled promise rejection';
    try {
      window.parent.postMessage({ type: 'hypercanvas:runtimeError', error: { framework: 'vite', type: 'Unhandled Rejection', message: msg, fullText: 'Unhandled Promise Rejection: ' + msg } }, '*');
    } catch {}
  });

  document.addEventListener('DOMContentLoaded', () => {
    const scripts = document.querySelectorAll('script[type="module"][src]');
    for (const script of scripts) {
      import(script.src).catch((err) => {
        const msg = err.message || String(err);
        try {
          window.parent.postMessage({ type: 'hypercanvas:runtimeError', error: { framework: 'vite', type: 'Module Error', message: msg, fullText: err.stack || msg } }, '*');
        } catch {}
      });
    }
  });
})();`;
