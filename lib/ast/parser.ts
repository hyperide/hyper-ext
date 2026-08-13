/**
 * AST parsing and printing utilities
 * Uses recast to preserve code formatting.
 *
 * BROWSER-SAFE: this module pulls ZERO node:* builtins, so it bundles for the webview (HYP-747).
 * The recast/@babel/parser deps it uses are pure JS in this code path (recast's `fs` is `false` via
 * its "browser" field; @babel/parser is pure JS; parseCode/printAST/spliceNodeSource/printNodeSource
 * touch no node API). The filesystem-bound half — `createFileParser`, `readAndParseFile`, `writeAST`
 * (which need `node:path` + `process.cwd()` + `NodeFileIO`) — lives in the node-only `./parser.node`
 * entrypoint; Node callers import from there, browser callers never do.
 *
 * One recast wrinkle: recast's "browser" field maps `fs:false` but NOT `os`, and `getLineTerminator`
 * has a static `require("os").EOL` behind a dead-in-browser `isBrowser()` guard. esbuild still tries
 * to resolve that `require` at bundle time, so the webview esbuild config stubs `os` to an empty
 * module (vscode-extension/hypercanvas-preview/esbuild.js). That stays bundler-level on purpose —
 * never reach into the AST core to dodge it.
 */

import { parse as babelParse } from '@babel/parser';
import type * as t from '@babel/types';
import { parse as recastParse, print as recastPrint } from 'recast';

/**
 * Babel parser wrapper for recast
 * Provides TypeScript and JSX support
 */
export const babelParserWrapper = {
  parse(source: string) {
    return babelParse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      tokens: true, // CRITICAL: recast checks ast.tokens to verify custom parser succeeded
    });
  },
};

/**
 * Parse source code into AST
 * @param sourceCode - Source code to parse
 * @param options - Parse options
 * @returns Parsed AST
 */
export function parseCode(sourceCode: string): t.File {
  return recastParse(sourceCode, {
    parser: babelParserWrapper,
  });
}

/**
 * Print AST back to source code
 * Preserves original formatting for existing nodes; new string literals use single quotes
 * to match project style (biome quoteStyle: 'single').
 * @param ast - AST to print
 * @returns Generated source code
 */
export function printAST(ast: t.File): string {
  return recastPrint(ast, { quote: 'single' }).code;
}

/**
 * Format-preserving, surgical replacement of a single AST node's source text.
 *
 * Re-prints ONLY `node` (recast reuses `.original` for any of its untouched descendants, so their
 * bytes round-trip identically) and splices the result into `sourceCode` over the node's original
 * `[start, end)` byte range. Every byte OUTSIDE that range — surrounding JSX children, sibling
 * attributes, indentation, closing tags — is left untouched.
 *
 * Use this instead of {@link printAST} when a mutation replaces a node reference (e.g. swapping a
 * `className` attribute value via `setAttribute`): a whole-file recast reprint of a freshly built
 * node that has no `.original` would otherwise reformat the enclosing JSX element's children
 * (HYP-575).
 *
 * Returns `null` when the node has no usable source range (a synthetic node, or a parse that did
 * not attach offsets), so callers can fall back to {@link printAST}.
 */
export function spliceNodeSource(
  sourceCode: string,
  node: t.Node,
  originalStart: number,
  originalEnd: number,
): string | null {
  if (
    !Number.isInteger(originalStart) ||
    !Number.isInteger(originalEnd) ||
    originalStart < 0 ||
    originalEnd > sourceCode.length ||
    originalStart > originalEnd
  ) {
    return null;
  }
  const printed = recastPrint(node, { quote: 'single' }).code;
  return sourceCode.slice(0, originalStart) + printed + sourceCode.slice(originalEnd);
}

/**
 * Print a single node to source text (format-preserving for its untouched descendants), without
 * splicing. Returns the printed string, or `null` for a node with no usable offsets when `requireRange`
 * is set. Used when several disjoint nodes must be spliced into one source in a single pass (HYP-544:
 * the className value's span PLUS a same-file const literal's span) — each `[start, end) → printed`
 * pair is applied in descending order so offsets never drift.
 */
export function printNodeSource(node: t.Node): string {
  return recastPrint(node, { quote: 'single' }).code;
}
