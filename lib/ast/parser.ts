/**
 * AST parsing and printing utilities
 * Uses recast to preserve code formatting
 */

import * as path from 'node:path';
import { parse as babelParse } from '@babel/parser';
import type * as t from '@babel/types';
import { parse as recastParse, print as recastPrint } from 'recast';
import type { ParsedFile } from '../types';
import type { FileIO } from './file-io';
import { NodeFileIO } from './node-file-io';

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
 * Create file-bound parser functions using given FileIO implementation
 */
export function createFileParser(io: FileIO) {
  // Content-based AST cache: avoids re-parsing unchanged files
  const astCache = new Map<string, { content: string; ast: t.File }>();

  return {
    async readAndParseFile(filePath: string): Promise<ParsedFile> {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

      await io.access(absolutePath);
      const sourceCode = await io.readFile(absolutePath);

      const cached = astCache.get(absolutePath);
      if (cached && cached.content === sourceCode) {
        return { ast: cached.ast, absolutePath };
      }

      const ast = parseCode(sourceCode);
      astCache.set(absolutePath, { content: sourceCode, ast });

      return { ast, absolutePath };
    },

    async writeAST(ast: t.File, filePath: string): Promise<void> {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

      const output = printAST(ast);
      await io.writeFile(absolutePath, output);

      // Invalidate cache — file content changed, next read will re-parse
      astCache.delete(absolutePath);
    },

    async readFileContent(filePath: string): Promise<string> {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

      return io.readFile(absolutePath);
    },

    /**
     * Drop any cached AST for `filePath`. Use after an external mutation
     * (file watcher event, HMR rewrite) so the next `readAndParseFile` call
     * re-reads from disk and re-parses. The content-equality check in
     * `readAndParseFile` already self-heals when content differs, but
     * explicit invalidation guarantees freshness regardless of cache
     * implementation details.
     */
    invalidate(filePath: string): void {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
      astCache.delete(absolutePath);
    },

    /** Drop every cached AST. Use when a global state reset is needed. */
    invalidateAll(): void {
      astCache.clear();
    },
  };
}

// Default Node.js file parser (backward-compatible top-level functions)
const defaultParser = createFileParser(new NodeFileIO());

/**
 * Read file and parse into AST
 * @param filePath - Path to file (relative or absolute)
 * @returns Parsed file with absolute path
 */
export const readAndParseFile = defaultParser.readAndParseFile;

/**
 * Write AST to file
 * @param ast - AST to write
 * @param filePath - Path to write to (absolute or relative)
 */
export const writeAST = defaultParser.writeAST;
