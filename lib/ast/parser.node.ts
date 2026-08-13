/**
 * Node-only AST file I/O — the filesystem-bound half of the AST parser.
 *
 * Reached at runtime ONLY from Node contexts (server routes, the Docker backend, the VS Code
 * EXTENSION HOST — never the webview/browser bundle). Splitting this out of `parser.ts` keeps the
 * pure parse/print helpers (`parseCode`, `printAST`, `spliceNodeSource`, …) importable from the
 * browser without dragging `node:path` / `node:fs` into the webview esbuild graph (HYP-747). The
 * retarget core (`shared/i18n-text/retarget/core.ts`, reachable from the NodePod webview transport)
 * imports only the pure helpers from `parser.ts`; nothing browser-reachable imports THIS file.
 *
 * Invariant: importing `parser.ts` must instantiate ZERO `NodeFileIO` and pull ZERO `node:*`. The
 * eager module-scope `new NodeFileIO()` that used to live in `parser.ts` (which forced
 * node:fs/node:path into every importer, including the browser path) now lives here, behind this
 * node-only entrypoint. `createFileParser` itself touches `node:path` + `process.cwd()`, so it lives
 * here too — its only callers are Node (server, extension host, style-write).
 *
 * Every former top-level node caller of `createFileParser` / `readAndParseFile` / `writeAST` from
 * `parser.ts` re-points here; behavior is byte-identical (same default `createFileParser(new
 * NodeFileIO())`).
 */

import * as path from 'node:path';
import type * as t from '@babel/types';
import type { ParsedFile } from '../types';
import type { FileIO } from './file-io';
import { NodeFileIO } from './node-file-io';
import { parseCode, printAST } from './parser';

/**
 * Create file-bound parser functions using given FileIO implementation.
 *
 * Resolves relative paths against `process.cwd()` and reads/writes through `io`, so it is inherently
 * Node-bound (path + process). Browser callers must instead drive the pure `parseCode` /
 * `spliceNodeSource` helpers from `parser.ts` over content they already hold.
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
