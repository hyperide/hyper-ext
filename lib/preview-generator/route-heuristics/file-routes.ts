/**
 * @file File-based route extraction (Remix flat routes, Next.js pages/ + app/).
 *
 * Accessed via: route-heuristics/index.ts when the detected framework is file-routed.
 * Assumptions: pure string work on already-listed relative paths — no I/O here, so it stays
 *   browser-safe and trivially testable. The caller supplies the file list (via FileIO.listFiles).
 * Best-effort: an unrecognized filename simply contributes no route.
 */

import type { RouteSuggestion } from './types';

/** Strip a known route-file extension; return null if the file isn't a route module. */
function stripRouteExtension(fileName: string): string | null {
  const match = fileName.match(/^(.*)\.(tsx|ts|jsx|js|mdx)$/);
  return match ? match[1] : null;
}

/** Next.js `app/` route group `(marketing)` and private `_folder` segments don't appear in the URL. */
function isNextNonUrlSegment(segment: string): boolean {
  return segment.startsWith('(') || segment.startsWith('_') || segment.startsWith('@');
}

/** Convert a Next.js dynamic `[id]` / catch-all `[...slug]` segment into an `:param` form. */
function nextDynamicSegment(segment: string): string {
  const inner = segment.slice(1, -1);
  if (inner.startsWith('...')) return `:${inner.slice(3)}*`;
  return `:${inner}`;
}

/** Join URL segments into a clean absolute path; `[]` collapses to `/`. */
function joinSegments(segments: string[]): string {
  const cleaned = segments.filter((s) => s.length > 0);
  return cleaned.length === 0 ? '/' : `/${cleaned.join('/')}`;
}

/**
 * Next.js App Router: `app/about/page.tsx` → `/about`, `app/users/[id]/page.tsx` → `/users/:id`.
 * `relPath` is relative to the app dir (e.g. `about/page.tsx`). Only `page.*` files are routes.
 */
export function nextAppRouteFromPath(relPath: string): RouteSuggestion | null {
  const parts = relPath.split('/');
  const fileBase = stripRouteExtension(parts[parts.length - 1]);
  if (fileBase !== 'page') return null;
  const dirs = parts.slice(0, -1);
  const segments: string[] = [];
  for (const dir of dirs) {
    if (isNextNonUrlSegment(dir)) continue;
    segments.push(dir.startsWith('[') && dir.endsWith(']') ? nextDynamicSegment(dir) : dir);
  }
  return { path: joinSegments(segments), source: 'file-route' };
}

/**
 * Next.js Pages Router: `pages/about.tsx` → `/about`, `pages/index.tsx` → `/`,
 * `pages/users/[id].tsx` → `/users/:id`. `_app`/`_document`/`api` are not user routes.
 */
export function nextPagesRouteFromPath(relPath: string): RouteSuggestion | null {
  const parts = relPath.split('/');
  if (parts[0] === 'api') return null;
  const fileBase = stripRouteExtension(parts[parts.length - 1]);
  if (fileBase == null || fileBase.startsWith('_')) return null;
  const dirs = parts.slice(0, -1);
  const segments: string[] = [];
  for (const dir of [...dirs, fileBase]) {
    if (dir === 'index') continue;
    segments.push(dir.startsWith('[') && dir.endsWith(']') ? nextDynamicSegment(dir) : dir);
  }
  return { path: joinSegments(segments), source: 'file-route' };
}

/**
 * Remix flat routes: `app/routes/about.tsx` → `/about`, `_index.tsx` → `/`,
 * `users.$id.tsx` → `/users/:id`. Dots are path separators; `_`-prefixed segments are
 * pathless layouts (dropped). `relPath` is relative to the routes dir.
 */
export function remixRouteFromPath(relPath: string): RouteSuggestion | null {
  const parts = relPath.split('/');
  const fileBase = stripRouteExtension(parts[parts.length - 1]);
  if (fileBase == null) return null;
  // Folder-route convention: `users.profile/route.tsx` — the folder name carries the route.
  const routeName = fileBase === 'route' && parts.length > 1 ? parts[parts.length - 2] : fileBase;
  if (routeName === '_index') return { path: '/', source: 'file-route' };
  const segments: string[] = [];
  for (const raw of routeName.split('.')) {
    if (raw === '_index' || raw.length === 0) continue;
    if (raw.startsWith('_')) continue; // pathless layout segment
    if (raw === '$') {
      segments.push('*'); // splat
    } else if (raw.startsWith('$')) {
      segments.push(`:${raw.slice(1)}`);
    } else {
      segments.push(raw);
    }
  }
  return { path: joinSegments(segments), source: 'file-route' };
}
