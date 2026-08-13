import type { SourceLocation } from '@shared/element-tracing/types';
import type { Fiber } from '@shared/element-tracing/fiber-internals';
import { isSyntheticPreviewPath, selectNonSyntheticCachedLocation } from '@shared/element-tracing/synthetic-preview';

/** Cache: "chunkUrl:line:col" → resolved SourceLocation (null = warmed but unresolvable). */
export const clientSourceMapCache = new Map<string, SourceLocation | null>();

/**
 * Keys that resolved to React-internal paths (e.g. node_modules).
 * Lookup skips (continues to next frame) rather than stopping when it finds these.
 */
export const clientInternalFrames = new Set<string>();

/** Cache: "filePath:line:col" → resolved SourceLocation (null = not resolvable). */
export const serverSourceMapCache = new Map<string, SourceLocation | null>();

/** Extract client chunk frames (HTTP URLs) from an Error.stack string.
 *  Supports Next.js (_next/static/chunks/) AND Vite (/src/ source files). */
export function extractClientChunkFrames(err: Error): Array<{ url: string; line: number; col: number }> {
  const frames: Array<{ url: string; line: number; col: number }> = [];
  for (const ln of (err.stack ?? '').split('\n')) {
    const m = ln.match(/^\s+at\s+(?:[^(]+\s+\()?(.+):(\d+):(\d+)\)?$/);
    if (!m) continue;
    const url = m[1];
    // Next.js static chunk URLs
    if (url.includes('_next/static/chunks/')) {
      frames.push({ url, line: Number.parseInt(m[2], 10), col: Number.parseInt(m[3], 10) });
      continue;
    }
    // Bun hot dev server bundled chunks — source map needed to resolve to src file
    if (url.includes('/_bun/client/') || url.includes('/_bun/')) {
      frames.push({ url, line: Number.parseInt(m[2], 10), col: Number.parseInt(m[3], 10) });
      continue;
    }
    // Vite source files (React 19: _debugStack has compiled positions that need source map)
    if (url.startsWith('http') && url.includes('/src/') && !url.includes('node_modules')) {
      frames.push({ url, line: Number.parseInt(m[2], 10), col: Number.parseInt(m[3], 10) });
    }
  }
  return frames;
}

/**
 * Extract server-side chunk frames from an Error.stack.
 *
 * Supported formats:
 * - React 19.0: "Server/file:///path/.next/server/chunks/…"
 * - React 19.1+: "about://React/Server/file:///path/.next/dev/server/chunks/…"
 * - Plain: "file:///path/.next/…"
 */
export function extractServerChunkFrames(err: Error): Array<{ filePath: string; line: number; col: number }> {
  const frames: Array<{ filePath: string; line: number; col: number }> = [];
  for (const ln of (err.stack ?? '').split('\n')) {
    const m = ln.match(/^\s+at\s+(?:[^(]+\s+\()?(.+):(\d+):(\d+)\)?$/);
    if (!m) continue;
    const raw = m[1];
    // Find file:/// anywhere in the URL (handles about://React/Server/file:/// prefix)
    const fileIdx = raw.indexOf('file:///');
    if (fileIdx === -1) continue;
    const fileUrl = raw.slice(fileIdx);
    // Only Next.js server chunks
    if (!fileUrl.includes('.next/')) continue;
    let filePath: string;
    try {
      filePath = decodeURIComponent(new URL(fileUrl).pathname);
    } catch {
      filePath = decodeURIComponent(fileUrl.replace(/^file:\/\//, ''));
    }
    frames.push({ filePath, line: Number.parseInt(m[2], 10), col: Number.parseInt(m[3], 10) });
  }
  return frames;
}

/**
 * Resolve server source map for THIS fiber's own _debugStack only.
 * Unlike resolveViaServerSourceMap (which walks the return chain), this gives
 * per-element precision for source cache building — each RSC element has a
 * unique compiled position in its _debugStack.
 */
export function resolveOwnServerSourceMap(fiber: Fiber): SourceLocation | null {
  // HostComponent fibers (tag=5) in React 19.1 RSC have _debugStack directly
  if (fiber._debugStack) {
    const frames = extractServerChunkFrames(fiber._debugStack).map((frame) =>
      serverSourceMapCache.get(`${frame.filePath}:${frame.line}:${frame.col}`),
    );
    const picked = selectNonSyntheticCachedLocation(frames);
    if (picked.found) return picked.value;
  }
  return null;
}

/**
 * Next.js/Turbopack bundles React internals (jsxDEV) into the same chunk as user code.
 * The jsxDEV frame comes first in the stack; it maps to node_modules and is recorded in
 * clientInternalFrames — the lookup skips it (continue) and tries the user component frame.
 * A null in clientSourceMapCache (fetch failed or no mapping) stops the search for this
 * fiber so we do not misattribute the element to an ancestor component.
 */
export function resolveViaClientSourceMap(fiber: Fiber): SourceLocation | null {
  let current: Fiber | null = fiber;
  while (current !== null) {
    if (current._debugStack) {
      for (const frame of extractClientChunkFrames(current._debugStack)) {
        const key = `${frame.url}:${frame.line}:${frame.col}`;
        if (clientInternalFrames.has(key)) continue; // React-internal frame — skip to next
        const cached = clientSourceMapCache.get(key);
        if (cached) {
          // The synthetic preview entry (__canvas_preview__.tsx) renders every user
          // component; Vite source maps can collapse a compiled position back to it.
          // It is never a valid go-to-code target — skip it so the caller falls back
          // to the element's own fiber source (the real component file). (HYP-429)
          if (isSyntheticPreviewPath(cached.fileName)) continue;
          return cached; // resolved to user source file
        }
        if (cached === null) return null; // warmed but unresolvable — don't walk ancestors
        // undefined: warm-up still in flight, try next frame
      }
    }
    current = (current.return as Fiber | null | undefined) ?? null;
  }
  return null;
}

/** Check if a fiber has server chunk frames that are not yet resolved.
 * Returns false if all frames are already cached (even as null), avoiding
 * stuck pending clicks when no future serverSourceMapResult can arrive. */
export function hasUnresolvedServerFrames(fiber: Fiber): boolean {
  let c: Fiber | null = fiber;
  while (c !== null) {
    if (c._debugStack) {
      for (const frame of extractServerChunkFrames(c._debugStack)) {
        const key = `${frame.filePath}:${frame.line}:${frame.col}`;
        if (!serverSourceMapCache.has(key)) return true;
      }
      break;
    }
    c = (c.return as typeof c | undefined) ?? null;
  }
  return false;
}

/** Look up server source map cache for the first matching server chunk frame. */
export function resolveViaServerSourceMap(fiber: Fiber): SourceLocation | null {
  let current: Fiber | null = fiber;
  while (current !== null) {
    if (current._debugStack) {
      // Same synthetic-skip selection as resolveOwnServerSourceMap, applied per fiber
      // as we walk the return chain. This is the async server-map fallback consumed by
      // resolveClickLocal / retryPendingClick (RSC / React 19 pending click): a clicked
      // element must never resolve to the synthetic __canvas_preview__ entry. (HYP-424 / HYP-429)
      const frames = extractServerChunkFrames(current._debugStack).map((frame) =>
        serverSourceMapCache.get(`${frame.filePath}:${frame.line}:${frame.col}`),
      );
      const picked = selectNonSyntheticCachedLocation(frames);
      if (picked.found) return picked.value;
    }
    current = (current.return as typeof current | undefined) ?? null;
  }
  return null;
}
