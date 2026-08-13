/**
 * @file TUI expression evaluator — non-UI transform from a vecli expression to SVG
 *
 * Accessed via: the interactive TUI (`vecli` with no args in a TTY)
 *
 * Assumptions: wraps `runBatch` so a thrown sandbox error never escapes into the
 * ink render loop — the TUI must keep running and show the error in its pane.
 */

import { runBatch } from '../batch';

export interface EvaluateOptions {
  canvasWidth?: number;
  canvasHeight?: number;
}

export interface EvaluateResult {
  /** Rendered SVG markup, or '' on empty input or error. */
  svg: string;
  /** Error message when evaluation threw, otherwise undefined. */
  error?: string;
}

/**
 * Evaluate a vecli expression and return its SVG (or a captured error).
 * Never throws — the TUI relies on that to stay alive across bad input.
 */
export function evaluateExpression(expression: string, opts: EvaluateOptions = {}): EvaluateResult {
  const code = expression.trim();
  if (!code) return { svg: '' };

  try {
    const svg = runBatch({
      expression: code,
      canvasWidth: opts.canvasWidth,
      canvasHeight: opts.canvasHeight,
    });
    return { svg };
  } catch (err) {
    return { svg: '', error: err instanceof Error ? err.message : String(err) };
  }
}
