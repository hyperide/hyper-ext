/**
 * @file Batch runner — execute expressions/scripts in non-interactive mode
 *
 * Accessed via: vecli 'expression', vecli -e file.js, pipe
 */

import type { PathOpsBackend } from 'vector-wasm';
import { createContext, executeAndRender } from './context';
import { runInSandbox } from './sandbox';

export interface BatchOptions {
  expression?: string;
  script?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  stdinData?: string;
  /** Real PathOps backend; omit for the MockPathOps no-op stub. */
  pathOps?: PathOpsBackend;
}

export function runBatch(opts: BatchOptions): string {
  const ctx = createContext(opts.canvasWidth, opts.canvasHeight, opts.pathOps);
  if (opts.stdinData !== undefined) {
    ctx.stdinData = opts.stdinData;
  }
  const code = opts.expression ?? opts.script ?? '';
  if (!code) return '';

  const result = runInSandbox(ctx, code);

  // If sandbox returned a string (from .svg() or .export("svg")), use it
  if (typeof result === 'string') return result;

  // If no explicit export but graph has nodes, auto-export SVG
  if (ctx.graph.nodeCount > 0) {
    return executeAndRender(ctx);
  }

  return '';
}
