/**
 * Console capture script — injected into preview iframe.
 * Intercepts console.log/warn/error/info/debug, batches them via postMessage.
 *
 * MUST be injected AFTER proxy-path-bridge and devtools/error-detection scripts.
 */
(() => {
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
      window.parent.postMessage({ type: EVENT_TYPE, entries }, '*'); // nosemgrep: wildcard-postmessage-configuration -- iframe->parent console capture
    } catch {
      // parent unreachable — silently ignore
    }
  };

  const scheduleFlush = () => {
    if (flushTimer === null) {
      flushTimer = setTimeout(flush, BATCH_INTERVAL);
    }
  };

  const makeHook =
    (level) =>
    (...hookArgs) => {
      origConsole[level].apply(console, hookArgs);
      const args = [];
      const len = Math.min(hookArgs.length, MAX_ARGS);
      for (let i = 0; i < len; i++) {
        args.push(stringify(hookArgs[i]));
      }
      buffer.push({ level, args, timestamp: Date.now() });
      scheduleFlush();
    };

  console.log = makeHook('log');
  console.warn = makeHook('warn');
  console.error = makeHook('error');
  console.info = makeHook('info');
  console.debug = makeHook('debug');
})();
