/**
 * @file Sandbox — isolated eval scope for CLI expressions
 *
 * Accessed via: Every CLI command execution
 * Tradeoffs: uses new Function() with explicit scope. No access to
 *   process, require, import, globalThis, Bun, fetch.
 */

import type { EvalContext } from './context';
import { createGlobals } from './globals';

/**
 * Globals to shadow with undefined so user code cannot access them.
 * `eval` and `arguments` cannot be shadowed in strict mode (SyntaxError),
 * but `eval` is partially restricted by "use strict" (no variable leaking).
 */
const BLOCKED_GLOBALS = [
  'process',
  'require',
  'globalThis',
  'Bun',
  'fetch',
  'setTimeout',
  'setInterval',
  'queueMicrotask',
  '__dirname',
  '__filename',
  'module',
  'exports',
  'Function',
];

export function runInSandbox(ctx: EvalContext, code: string): unknown {
  const globals = createGlobals(ctx);
  const keys = [...Object.keys(globals), ...BLOCKED_GLOBALS];
  const values = [...Object.values(globals), ...BLOCKED_GLOBALS.map(() => undefined)];

  try {
    const fn = new Function(...keys, `"use strict";\nreturn (()=>{\n${code}\n})();`);
    return fn(...values);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Syntax error: ${err.message}`);
    }
    throw err;
  }
}
