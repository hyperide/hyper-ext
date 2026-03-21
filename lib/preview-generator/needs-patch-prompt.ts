/**
 * @file Builds the AI prompt for the "needs-patch" Auto Fix action.
 *
 * Accessed via: VS Code extension (direct FileIO) and SaaS server endpoint
 *               GET /api/preview/needs-patch-context.
 * Assumptions: Works with any FileIO implementation — Node.js, VS Code, in-memory.
 */

import { join } from 'node:path';
import type { FileIO } from '../ast/file-io';

const ROUTER_CANDIDATES = [
  'src/App.tsx',
  'src/app.tsx',
  'App.tsx',
  'src/main.tsx',
  'src/main.ts',
  'main.tsx',
  'src/router.tsx',
  'src/router.ts',
];

/**
 * Builds a prompt for AI to add a /test-preview route to the project's JSX router.
 * Reads router candidate files and package.json for context.
 */
export async function buildNeedsPatchPrompt(projectRoot: string, io: Pick<FileIO, 'readFile'>): Promise<string> {
  const fileSnippets: string[] = [];

  for (const rel of ROUTER_CANDIDATES) {
    try {
      const content = await io.readFile(join(projectRoot, rel));
      fileSnippets.push(`// ${rel}\n${content.slice(0, 3000)}`);
    } catch {
      /* file doesn't exist */
    }
  }

  let pkgSnippet = '';
  try {
    const pkg = await io.readFile(join(projectRoot, 'package.json'));
    pkgSnippet = `// package.json\n${pkg.slice(0, 1000)}`;
  } catch {
    /* no package.json */
  }

  const context = [pkgSnippet, ...fileSnippets].filter(Boolean).join('\n\n---\n\n');

  return `HyperIDE needs a \`/test-preview\` route in my JSX router to render component previews.

**Task:** Add a route at \`/test-preview\` that renders \`<CanvasPreview />\` imported from \`./src/__canvas_preview__\` (or the correct relative path to that file).

**Rules:**
- The route must be inside the existing \`<Routes>\` (or equivalent). Do not restructure the router.
- Import \`CanvasPreview\` only when it doesn't already exist.
- Tag the import with \`// @hyperide-managed\` so HyperIDE can track it.
- After the change, confirm the file is saved.

**Project files for context:**
${context}`;
}
