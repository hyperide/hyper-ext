/**
 * @file Detect whether an opened file is previewable in the Hyper Canvas, and rank
 *   renderable alternatives to recommend when it is not.
 *
 * Reached at runtime from the VS Code extension host's `onComponentMissing`
 * self-heal handler (extension.ts). When the previewed file fires the iframe's
 * `_ComponentMissingSignal` (no `Component` in the registry AND no `SampleDefault`),
 * the host classifies the source here: a ReactDOM entry/bootstrap (`main.tsx` —
 * `createRoot(...).render(<App/>)`) or any file with no renderable component export
 * can NEVER converge into a preview, so it must fail fast with a clear error +
 * recommendations instead of the iframe spinning on "Generating sample…" forever
 * (the bug this module fixes).
 *
 * Invariant: `classifyNonPreviewable` returns non-null ONLY for files with ZERO
 * renderable exports. A file with any renderable export (named OR default) is left
 * to the normal preview/retry pipeline — so a real component that merely lacks a
 * sample (e.g. a shadcn primitive) is never mis-flagged as non-previewable.
 */

import { parse } from '@babel/parser';
import { scanRenderableExportNames } from './scanner';

export type NonPreviewableReason = 'entry-file' | 'no-renderable-export';

export interface ComponentRecommendation {
  /** Path of a renderable component file, relative to the project root. */
  path: string;
  /** PascalCase component name to display on the recommendation button. */
  name: string;
}

function parseSource(sourceCode: string) {
  return parse(sourceCode, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
    errorRecovery: true,
  });
}

/**
 * True when the default export is a component the preview could mount:
 * `export default function App()`, `export default class App`,
 * `export default App`, `export default memo(App)` / `forwardRef(...)`,
 * an anonymous default component function, or a default JSX expression.
 *
 * Inclusive by design: anything that is NOT an obvious data literal
 * (object / array / string / number / boolean / null) counts as renderable, so a
 * genuine component is never mis-classified as non-previewable.
 */
export function hasRenderableDefaultExport(sourceCode: string): boolean {
  const ast = parseSource(sourceCode);
  for (const node of ast.program.body) {
    if (node.type !== 'ExportDefaultDeclaration') continue;
    const decl = node.declaration;
    switch (decl.type) {
      case 'ObjectExpression':
      case 'ArrayExpression':
      case 'StringLiteral':
      case 'NumericLiteral':
      case 'BooleanLiteral':
      case 'NullLiteral':
      case 'BigIntLiteral':
        return false;
      default:
        return true;
    }
  }
  return false;
}

/** True when the file exports any renderable component (named or default). */
export function hasRenderableComponentExport(sourceCode: string): boolean {
  return scanRenderableExportNames(sourceCode).length > 0 || hasRenderableDefaultExport(sourceCode);
}

/**
 * True when the file is a ReactDOM entry/bootstrap — it mounts the app via
 * `createRoot(...).render(...)`, `hydrateRoot(...)`, or `ReactDOM.render/hydrate(...)`.
 * These files have no renderable export and only exist to boot the app, so they are
 * never previewable as a component.
 */
export function isEntryBootstrap(sourceCode: string): boolean {
  return (
    /\b(?:createRoot|hydrateRoot)\s*\(/.test(sourceCode) || /\bReactDOM\s*\.\s*(?:render|hydrate)\s*\(/.test(sourceCode)
  );
}

/**
 * Classify whether the opened file can be previewed. Returns the reason it CANNOT
 * (so the caller surfaces a clear error), or `null` when the file has a renderable
 * export and should flow through the normal preview pipeline.
 */
export function classifyNonPreviewable(sourceCode: string): NonPreviewableReason | null {
  if (hasRenderableComponentExport(sourceCode)) return null;
  return isEntryBootstrap(sourceCode) ? 'entry-file' : 'no-renderable-export';
}

const POSIX_SEP = /\\/g;

function normalizePath(path: string): string {
  return path.replace(POSIX_SEP, '/');
}

/** Score a recommendation: lower sorts first. App / index roots bubble to the top. */
function recommendationRank(rec: ComponentRecommendation): number {
  const base = normalizePath(rec.path).split('/').pop() ?? '';
  const stem = base.replace(/\.[jt]sx?$/, '').toLowerCase();
  if (stem === 'app') return 0;
  if (stem === 'index') return 1;
  if (rec.name.toLowerCase() === 'app') return 0;
  return 2;
}

/**
 * Rank and trim renderable-component recommendations for the error UI. App / index
 * roots come first (most users want the app shell), then the rest in stable path
 * order. The opened file is excluded; duplicates are de-duped by path.
 */
export function rankComponentRecommendations(
  files: ComponentRecommendation[],
  opts: { excludePath?: string; limit?: number } = {},
): ComponentRecommendation[] {
  const { excludePath, limit = 8 } = opts;
  const excluded = excludePath ? normalizePath(excludePath) : null;
  const seen = new Set<string>();
  const unique: ComponentRecommendation[] = [];
  for (const file of files) {
    const norm = normalizePath(file.path);
    if (norm === excluded || seen.has(norm)) continue;
    seen.add(norm);
    unique.push(file);
  }
  unique.sort((a, b) => {
    const rankDelta = recommendationRank(a) - recommendationRank(b);
    if (rankDelta !== 0) return rankDelta;
    return normalizePath(a.path).localeCompare(normalizePath(b.path));
  });
  return unique.slice(0, limit);
}
