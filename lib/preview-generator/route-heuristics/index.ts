/**
 * @file Code-derived route suggestions for the app-preview address bar.
 *
 * Accessed via: PreviewFileManager.getRouteSuggestions() → extension preview panel + SaaS canvas.
 * Assumptions: best-effort throughout. Any extractor failure is swallowed; an empty result is a
 *   valid answer that the UI reads as "render no dropdown". Never throws to the caller.
 * Past intent: HYP — make App.tsx previewable AS AN APP with a browser-like address bar whose
 *   suggestions come from the project's own routes (React Router / Remix / Next / generic links).
 */

import { join, relative } from 'node:path';
import type { FileIO } from '../../ast/file-io';
import { detectFramework } from '../framework-routing';
import { extractRoutesFromSource } from './ast-routes';
import { nextAppRouteFromPath, nextPagesRouteFromPath, remixRouteFromPath } from './file-routes';
import type { RouteSuggestion } from './types';

export type { RouteSuggestion } from './types';
export { extractRoutesFromSource } from './ast-routes';
export { nextAppRouteFromPath, nextPagesRouteFromPath, remixRouteFromPath } from './file-routes';

/** Source roots scanned for JSX/AST route declarations and link references. */
const AST_SCAN_ROOTS = ['src', 'app', 'client'] as const;

/** Rank by source quality, then by path so the order is stable across runs. */
const SOURCE_RANK: Record<RouteSuggestion['source'], number> = {
  'route-config': 0,
  'file-route': 1,
  link: 2,
};

/**
 * Merge raw suggestions: drop blanks, dedupe by path (keeping the best-ranked source),
 * and sort so explicit route declarations precede scanned links, then alphabetically.
 */
export function mergeRouteSuggestions(raw: RouteSuggestion[]): RouteSuggestion[] {
  const byPath = new Map<string, RouteSuggestion>();
  for (const item of raw) {
    const path = normalizePath(item.path);
    if (path == null) continue;
    const existing = byPath.get(path);
    if (!existing || SOURCE_RANK[item.source] < SOURCE_RANK[existing.source]) {
      byPath.set(path, { path, source: item.source });
    }
  }
  return [...byPath.values()].sort(sortSuggestions);
}

/** Normalize a candidate path: trim, require leading slash, reject empties / external URLs / anchors. */
function normalizePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('http://') || trimmed.startsWith('https://')) return null;
  if (trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) return null;
  if (!trimmed.startsWith('/')) return null;
  // Drop the preview's OWN injected route — `/test-preview` is the HyperIDE-managed mount
  // point (vite-spa-jsx-router patches it into the app's <Routes>), not a user address.
  if (trimmed === '/test-preview' || trimmed.startsWith('/test-preview/')) return null;
  // Collapse a trailing slash (but keep the root "/").
  if (trimmed.length > 1 && trimmed.endsWith('/')) return trimmed.slice(0, -1);
  return trimmed;
}

function sortSuggestions(a: RouteSuggestion, b: RouteSuggestion): number {
  if (SOURCE_RANK[a.source] !== SOURCE_RANK[b.source]) return SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
  return a.path.localeCompare(b.path);
}

/** Read + AST-scan one file, swallowing every error (unreadable / unparsable → no routes). */
async function scanFileForRoutes(io: FileIO, absPath: string): Promise<RouteSuggestion[]> {
  let source: string;
  try {
    source = await io.readFile(absPath);
  } catch {
    return [];
  }
  try {
    return extractRoutesFromSource(source);
  } catch {
    return [];
  }
}

/** AST-scan every source file under the common roots (React Router declarations + link scan). */
async function collectAstRoutes(projectRoot: string, io: FileIO): Promise<RouteSuggestion[]> {
  if (!io.listFiles) return [];
  const out: RouteSuggestion[] = [];
  const seen = new Set<string>();
  for (const root of AST_SCAN_ROOTS) {
    let files: string[];
    try {
      // Include `.ts`/`.js`: a data-router config (`createBrowserRouter([{ path }])`) commonly
      // lives in a non-JSX `src/router.ts` / `routes.ts`, not only in `.tsx` view files.
      files = await io.listFiles(join(projectRoot, root), ['.tsx', '.jsx', '.ts', '.js']);
    } catch {
      continue;
    }
    for (const file of files) {
      // Skip declaration files and the generated preview — neither holds user routes.
      if (file.endsWith('.d.ts') || file.includes('__canvas_preview__')) continue;
      const abs = file.includes(projectRoot) ? file : join(projectRoot, file);
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push(...(await scanFileForRoutes(io, abs)));
    }
  }
  return out;
}

/** Map a file-routed framework's listed files to route suggestions via the filename convention. */
async function collectFileRoutes(
  projectRoot: string,
  io: FileIO,
  baseDir: string,
  toRoute: (relPath: string) => RouteSuggestion | null,
): Promise<RouteSuggestion[]> {
  if (!io.listFiles) return [];
  let files: string[];
  try {
    files = await io.listFiles(join(projectRoot, baseDir), ['.tsx', '.ts', '.jsx', '.js']);
  } catch {
    return [];
  }
  const baseAbs = join(projectRoot, baseDir);
  const out: RouteSuggestion[] = [];
  for (const file of files) {
    const abs = file.includes(baseAbs) ? file : join(baseAbs, file);
    const rel = relative(baseAbs, abs);
    if (rel.startsWith('..')) continue;
    const route = toRoute(rel);
    if (route) out.push(route);
  }
  return out;
}

/** Pick the file-route collection strategy for the detected framework, if any. */
async function collectFrameworkFileRoutes(projectRoot: string, io: FileIO): Promise<RouteSuggestion[]> {
  let detection: Awaited<ReturnType<typeof detectFramework>>;
  try {
    detection = await detectFramework(projectRoot, io);
  } catch {
    return [];
  }
  switch (detection.framework) {
    case 'nextjs-app-router':
      return collectFileRoutes(projectRoot, io, detection.appDir ?? 'app', nextAppRouteFromPath);
    case 'nextjs-pages-router':
      return collectFileRoutes(projectRoot, io, detection.pagesDir ?? 'pages', nextPagesRouteFromPath);
    case 'remix':
      return collectFileRoutes(projectRoot, io, detection.routesDir ?? 'app/routes', remixRouteFromPath);
    default:
      return [];
  }
}

/**
 * Best-effort code-derived route suggestions for a project. Combines file-based routes
 * (Remix/Next conventions) with AST-derived ones (React Router declarations + link scan),
 * then merges, dedupes and ranks. Returns `[]` on any failure or when nothing is found —
 * the address bar treats an empty list as "render no dropdown".
 */
export async function getRouteSuggestions(projectRoot: string, io: FileIO): Promise<RouteSuggestion[]> {
  try {
    const [fileRoutes, astRoutes] = await Promise.all([
      collectFrameworkFileRoutes(projectRoot, io),
      collectAstRoutes(projectRoot, io),
    ]);
    return mergeRouteSuggestions([...fileRoutes, ...astRoutes]);
  } catch {
    return [];
  }
}
