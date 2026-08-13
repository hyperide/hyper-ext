/**
 * @file ModuleSourceMapResolver — maps React 19 _debugStack module coords to original source coords.
 *
 * Accessed via: useElementTracer (SaaS canvas iframe) — injected as resolveFiberSource into
 *   ReactAdapter and FiberSourceIndex; mirrors the extension's iframe-resolver composition.
 * Assumptions: The project dev server (Vite) serves transformed modules same-origin through the
 *   /project-preview/<projectId>/ proxy, and each module carries a sourceMappingURL comment —
 *   inline base64 data: URL in Vite dev mode, or a (relative) URL to a .map file. React 19
 *   _debugStack frames point at TRANSFORMED module coordinates; server resolve-element and
 *   node-map lookups need ORIGINAL source coordinates, so positions are mapped through the
 *   module's own source map. Fetches are async — resolution is sync-from-cache with background
 *   warming (cold calls return null and the caller falls back to raw parseDebugStack coords).
 */

import type { Fiber } from '../../../shared/element-tracing/fiber-internals';
import { stripContainerPrefix, stripPreviewProxyPrefix } from '../../../shared/element-tracing/path-normalization';
import { resolveInSourceMap, type SourceMapV3 } from '../../../shared/element-tracing/source-map-resolver';
import type { SourceLocation } from '../../../shared/element-tracing/types';

/** Minimal fetch signature — keeps the option assignable from both DOM and Bun fetch types. */
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ModuleSourceMapResolverOptions {
  /** Injectable fetch for tests. Defaults to globalThis fetch. */
  fetchFn?: FetchLike;
  /** Called whenever a new source map finishes loading — invalidate fiber-source indexes here. */
  onResolved?: () => void;
}

interface ModuleFrame {
  url: string;
  line: number;
  col: number;
}

/** V8 stack frame: "    at FuncName (URL:line:col)" or "    at URL:line:col". */
const STACK_FRAME_RE = /^\s+at\s+(?:[^(]+\s+\()?(.+):(\d+):(\d+)\)?$/;

const INLINE_SOURCE_MAP_RE = /\/\/[#@] sourceMappingURL=data:application\/json[^,]*;base64,([A-Za-z0-9+/=]+)\s*$/m;
const SOURCE_MAP_URL_RE = /\/\/[#@] sourceMappingURL=(\S+)\s*$/m;

/**
 * First fetchable module frame of a _debugStack: an http(s) URL outside node_modules.
 * The leading jsxDEV frame lives in node_modules/.vite/deps/ and is skipped; the next
 * frame is the JSX call site inside the transformed user module.
 */
function extractModuleFrame(err: Error): ModuleFrame | null {
  for (const line of (err.stack ?? '').split('\n')) {
    const m = line.match(STACK_FRAME_RE);
    if (!m) continue;
    const url = m[1];
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
    if (url.includes('/node_modules/')) continue;
    return { url, line: Number.parseInt(m[2], 10), col: Number.parseInt(m[3], 10) };
  }
  return null;
}

/**
 * Resolve every source path in the map per the source-map spec, then normalize to a
 * project-relative path.
 *
 * Vite per-module transform maps carry `sources: ["Hero.tsx"]` — basename only (the
 * proven HYP-594 root cause: taken verbatim, FiberSourceIndex keys become
 * "Hero.tsx:6:6" while node-map queries use "src/components/Hero.tsx:6:6" → exact-key
 * miss → no selection outline). Per spec each source resolves against `sourceRoot`
 * (if present) and then the map's own URL — `baseUrl` here: the module URL for inline
 * maps, the .map file URL for external ones.
 *
 * Must run BEFORE resolveInSourceMap: it would re-prepend sourceRoot and its own
 * normalization drops the leading slash, making "/app/…" (container mount) ambiguous
 * with a real "app/…" directory (Next.js app router, Remix). `sourceRoot` is cleared
 * after being applied here.
 */
function resolveMapSources(sm: SourceMapV3, baseUrl: string): SourceMapV3 {
  if (sm.sources) {
    const root = sm.sourceRoot ?? '';
    sm.sources = sm.sources.map((src) => normalizeMapSource(src, root, baseUrl));
    sm.sourceRoot = undefined;
  }
  if (sm.sections) {
    for (const section of sm.sections) {
      if (section.map) resolveMapSources(section.map, baseUrl);
    }
  }
  return sm;
}

/**
 * Prepend sourceRoot to a source per spec, mirroring the canonical `source-map`
 * lib's util.join: absolute sources (scheme or "/"-rooted) bypass the root, and
 * a bare "/" root stays origin-root instead of degrading to "" (which would
 * wrongly resolve sources against the module's own directory).
 */
function joinSourceRoot(sourceRoot: string, src: string): string {
  if (!sourceRoot || src.startsWith('/') || /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(src)) return src;
  return sourceRoot.endsWith('/') ? `${sourceRoot}${src}` : `${sourceRoot}/${src}`;
}

function normalizeMapSource(src: string, sourceRoot: string, baseUrl: string): string {
  if (!src) return src;
  const joined = joinSourceRoot(sourceRoot, src);

  let pathname: string;
  try {
    // URL resolution also drops the base's ?t=<vite timestamp> query for relative sources.
    pathname = new URL(joined, baseUrl).pathname;
  } catch {
    return stripContainerPrefix(joined);
  }

  // Container-absolute source ("/app/src/…") — strip the mount prefix while the
  // leading slash still disambiguates it from a real "app/" directory.
  const containerStripped = stripContainerPrefix(pathname);
  if (containerStripped !== pathname) return containerStripped;

  // Same-origin proxied source ("/project-preview/<id>/src/…") → project-relative.
  return stripPreviewProxyPrefix(pathname).replace(/^\/+/, '');
}

export class ModuleSourceMapResolver {
  private readonly fetchFn: FetchLike;
  private readonly onResolved?: () => void;
  /** Module URL → parsed source map. null = warmed but unresolvable (no retry storm). */
  private readonly maps = new Map<string, SourceMapV3 | null>();
  /** "url:line:col" → mapped location. Avoids re-decoding VLQ per fiber on index rebuilds. */
  private readonly positions = new Map<string, SourceLocation | null>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(options: ModuleSourceMapResolverOptions = {}) {
    // Wrap instead of storing the bare reference — an unbound window.fetch throws
    // "Illegal invocation" in browsers.
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.onResolved = options.onResolved;
  }

  /**
   * Resolve a fiber's nearest _debugStack frame to original source coords, sync from cache.
   * Cold cache: kicks off a background source-map fetch and returns null — the caller falls
   * back to raw parseDebugStack coords until onResolved fires.
   */
  resolveFiberSource(fiber: Fiber): SourceLocation | null {
    const frame = this.findFrame(fiber);
    if (frame === null) return null;

    if (!this.maps.has(frame.url)) {
      this.warm(frame.url);
      return null;
    }

    const positionKey = `${frame.url}:${frame.line}:${frame.col}`;
    const memo = this.positions.get(positionKey);
    if (memo !== undefined) return memo;

    const sm = this.maps.get(frame.url);
    const loc = sm ? resolveInSourceMap(sm, frame.line, frame.col) : null;
    this.positions.set(positionKey, loc);
    return loc;
  }

  /** Kick off background source-map fetches for every module referenced by the fiber tree. */
  warmFiberTree(root: Fiber): void {
    const stack: Fiber[] = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      if (current._debugStack) {
        const frame = extractModuleFrame(current._debugStack);
        if (frame !== null && !this.maps.has(frame.url)) this.warm(frame.url);
      }
      if (current.sibling !== null) stack.push(current.sibling);
      if (current.child !== null) stack.push(current.child);
    }
  }

  /** Await all in-flight source-map fetches (test hook / explicit pre-warm barrier). */
  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled(this.pending.values());
    }
  }

  /** Nearest _debugStack up the return chain (host fibers may lack their own in edge cases). */
  private findFrame(fiber: Fiber): ModuleFrame | null {
    let current: Fiber | null = fiber;
    while (current !== null) {
      if (current._debugStack) return extractModuleFrame(current._debugStack);
      current = current.return ?? null;
    }
    return null;
  }

  private warm(url: string): void {
    if (this.maps.has(url) || this.pending.has(url)) return;
    const task = this.load(url)
      .then((sm) => {
        this.maps.set(url, sm);
        if (sm !== null) this.onResolved?.();
      })
      .catch((error: unknown) => {
        this.maps.set(url, null);
        console.debug('[tracing] module source-map fetch failed', url, error);
      })
      .finally(() => {
        this.pending.delete(url);
      });
    this.pending.set(url, task);
  }

  private async load(url: string): Promise<SourceMapV3 | null> {
    const res = await this.fetchFn(url);
    if (!res.ok) return null;
    const body = await res.text();

    const inline = body.match(INLINE_SOURCE_MAP_RE);
    if (inline) {
      // Inline map: sources resolve against the module URL itself.
      return resolveMapSources(JSON.parse(atob(inline[1])) as SourceMapV3, url);
    }

    const ref = body.match(SOURCE_MAP_URL_RE);
    if (ref && !ref[1].startsWith('data:')) {
      // External map: per spec, sources resolve against the .map file URL.
      const mapUrl = new URL(ref[1], url).href;
      const mapRes = await this.fetchFn(mapUrl);
      if (!mapRes.ok) return null;
      return resolveMapSources((await mapRes.json()) as SourceMapV3, mapUrl);
    }

    return null;
  }
}
