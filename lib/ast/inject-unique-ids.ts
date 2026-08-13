/**
 * Inject data-uniq-id into all JSX elements that don't have one.
 * Source-code-in, source-code-out wrapper around injectUniqueIdsIntoAST.
 * Uses recast to preserve formatting.
 */

import { parse as recastParse, print as recastPrint } from 'recast';
import { injectUniqueIdsIntoAST } from './operations';
import { babelParserWrapper } from './parser';

export interface InjectIdsResult {
  code: string;
  addedCount: number;
}

/**
 * Inject data-uniq-id attributes into all JSX elements missing them.
 * Deduplicates existing IDs. Pure function — no I/O side effects.
 */
export function injectIdsIntoSource(sourceCode: string): InjectIdsResult {
  const ast = recastParse(sourceCode, { parser: babelParserWrapper });
  const addedCount = injectUniqueIdsIntoAST(ast);
  const code = recastPrint(ast).code;
  return { code, addedCount };
}
