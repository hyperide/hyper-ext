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
 *
 * Also returns `null` when '\r' or '\t' occurs BEFORE the end of the span: AST offsets index
 * recast's NORMALIZED text (CRLF→LF joins, tab expansion — empirically confirmed by the offset
 * premise test in parser.test.ts), so with such a char anywhere in `[0, originalEnd)` the range is
 * shifted against the raw bytes and a blind splice would silently overwrite unrelated code
 * (HYP-877 review). Chars after the span cannot shift it, so a stray tab further down keeps the
 * surgical path. Unlike {@link spliceStringLiteralValue} there is no original raw text to verify
 * the span against, so the only safe move is the caller's whole-file fallback.
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
    originalStart > originalEnd ||
    /[\r\t]/.test(sourceCode.slice(0, originalEnd))
  ) {
    return null;
  }
  const printed = recastPrint(node, { quote: 'single' }).code;
  return sourceCode.slice(0, originalStart) + printed + sourceCode.slice(originalEnd);
}

/**
 * Byte-surgical replacement of an EXISTING quoted string literal's contents, preserving the
 * original quote character (HYP-877). Unlike {@link spliceNodeSource}, this never runs the recast
 * printer at all — a freshly built `t.stringLiteral` would be printed with the configured
 * `quote: 'single'` and churn a double-quoted attribute (`className="…"` → `className='…'`) even
 * though only the class list changed. Here the replacement is assembled from the literal's own
 * quote char plus `newValue`, so every byte outside the literal — including the quote style —
 * round-trips exactly.
 *
 * AST node offsets do NOT reliably index the raw on-disk text: recast normalizes the source before
 * parsing (CRLF→LF joins, tab expansion), so on a CRLF or tab-indented file the offsets are shifted
 * and a blind offset splice would silently corrupt the file (HYP-877 review). The splice therefore
 * anchors on `originalRaw` — the literal's original source text (`node.extra.raw`) — and only ever
 * replaces a span that byte-equals it: the normalized offset fast path and the CRLF-mapped offset
 * are each VERIFIED against `originalRaw`, and the last resort is a unique-occurrence search.
 *
 * Returns `null` when the literal cannot be located unambiguously, `originalRaw` is not a `'`/`"`
 * quoted literal, or the new value cannot be emitted verbatim inside EITHER quote char (JSX
 * attribute strings have NO backslash escapes) — callers then fall back to an AST-level write.
 * A value that merely clashes with the ORIGINAL quote char (e.g. `bg-[url('x.png')]` inside a
 * `'…'` attribute) is emitted with the alternate quote char instead: still a byte-local,
 * valid-JSX splice.
 */
export function spliceStringLiteralValue(
  sourceCode: string,
  originalRaw: string,
  normalizedStart: number,
  newValue: string,
): string | null {
  if (originalRaw.length < 2) return null;
  const originalQuote = originalRaw[0];
  if ((originalQuote !== '"' && originalQuote !== "'") || originalRaw[originalRaw.length - 1] !== originalQuote) {
    return null;
  }

  // No escape sequences exist in JSX attribute strings, so the value must sit verbatim inside SOME
  // quote char: prefer the original, fall back to the alternate, bail if neither can hold it.
  if (/[\\\r\n]/.test(newValue)) return null;
  const alternateQuote = originalQuote === '"' ? "'" : '"';
  const quote = newValue.includes(originalQuote)
    ? newValue.includes(alternateQuote)
      ? null
      : alternateQuote
    : originalQuote;
  if (quote === null) return null;

  const start = locateRawLiteral(sourceCode, originalRaw, normalizedStart);
  if (start === null) return null;
  return sourceCode.slice(0, start) + quote + newValue + quote + sourceCode.slice(start + originalRaw.length);
}

/**
 * Find the raw-source start offset of a literal whose AST offset is LF-normalized/tab-expanded.
 * An offset-based candidate is only trusted when the raw prefix before it PROVES the offset is
 * undrifted (no '\r'/'\t' → identity) or exactly mappable (CRLF only → {@link
 * normalizedToRawOffset}), AND the bytes there equal `originalRaw` — a drifted offset that happens
 * to land on an identical duplicate literal must not win (HYP-877 review). Tabs before the node
 * make the offset unusable, so the only remaining safe candidate is a UNIQUE occurrence of the
 * literal's raw text anywhere in the source. Ambiguous or missing → null.
 */
function locateRawLiteral(sourceCode: string, originalRaw: string, normalizedStart: number): number | null {
  if (Number.isInteger(normalizedStart) && normalizedStart >= 0 && normalizedStart <= sourceCode.length) {
    const candidate = sourceCode.slice(0, normalizedStart).includes('\r')
      ? normalizedToRawOffset(sourceCode, normalizedStart)
      : normalizedStart;
    // The tab check runs on the RAW prefix up to the candidate itself: on a mixed CRLF+tab source
    // the normalized offset undershoots the raw position, so slicing by normalizedStart could hide
    // a tab sitting just before the literal and bless a drifted candidate (review round 3).
    if (!sourceCode.slice(0, candidate).includes('\t') && sourceCode.startsWith(originalRaw, candidate)) {
      return candidate;
    }
  }
  const first = sourceCode.indexOf(originalRaw);
  if (first !== -1 && sourceCode.indexOf(originalRaw, first + 1) === -1) return first;
  return null;
}

/**
 * Map an LF-normalized character offset (what recast-parsed AST nodes carry in `start`/`end`) back
 * to an offset in a CRLF raw source. recast joins lines with '\n' before handing the source to the
 * parser, so on a CRLF file every node offset is short by one char per preceding line. Identity for
 * sources without '\r'. Tab expansion is NOT modeled here — callers must verify the mapped offset
 * against known content (see {@link spliceStringLiteralValue}).
 */
function normalizedToRawOffset(sourceCode: string, offset: number): number {
  if (!sourceCode.includes('\r')) return offset;
  let raw = 0;
  let normalized = 0;
  while (normalized < offset && raw < sourceCode.length) {
    if (sourceCode[raw] === '\r' && sourceCode[raw + 1] === '\n') raw++;
    raw++;
    normalized++;
  }
  return raw;
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
