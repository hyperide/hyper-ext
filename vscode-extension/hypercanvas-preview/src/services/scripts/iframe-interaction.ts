/**
 * Iframe interaction script — injected into user's preview iframe by PreviewProxy.
 *
 * Built as IIFE by esbuild, runs inside the preview iframe (not the VS Code webview).
 * Handles click/hover/context menu, keyboard shortcuts, overlay rects, design CSS.
 * Communicates with parent webview via postMessage.
 */

import { attachClickHandler } from '@shared/canvas-interaction/click-handler';
import { isContainerEmpty } from '@shared/canvas-interaction/empty-container-placeholders';
import { createDesignKeydownHandler } from '@shared/canvas-interaction/keyboard-handler';
import { computeOverlayRects } from '@shared/canvas-interaction/overlay-rects';
import { resolveCallSiteSource } from '@shared/canvas-interaction/resolve-source';
import { buildDesignStylesCSS } from '@shared/canvas-interaction/style-injector';
import type { LocalResolveResult, OverlayElementResolver, TracingResolver } from '@shared/canvas-interaction/types';
import {
  type Fiber,
  FiberTag,
  findNearestSourceLocation,
  getFiberFromDOM,
  getItemIndexFromFiber,
} from '@shared/element-tracing/fiber-internals';
import { FiberSourceIndex, getOwnFiberSourceLocation } from '@shared/element-tracing/fiber-source-index';
import { resolveInSourceMap, type SourceMapV3 } from '@shared/element-tracing/source-map-resolver';
import type { SourceLocation } from '@shared/element-tracing/types';
import html2canvas from 'html2canvas';

// ============================================
// Composition helpers (combine shared fiber primitives for IIFE-specific use)
// ============================================

/**
 * Direct fiber resolution — returns source only for Vite/Babel projects.
 * Returns null for Next.js RSC/Turbopack (all _debugStack frames filtered as .next/ internal).
 * DO NOT use directly for user-facing features — use iframeResolver.getSourceLocation()
 * or the full resolution chain (own-server → client → chain-server) instead.
 */
function getSourceLocationFromDOM(el: HTMLElement): SourceLocation | null {
  const fiber = getFiberFromDOM(el);
  if (fiber === null) return null;
  return findNearestSourceLocation(fiber);
}

/**
 * Count preceding component instances rendered from the same JSX call site.
 *
 * Uses fiber tree sibling walk — supports React 18 (_debugSource) and React 19 (_debugStack).
 * Counts at the component level, not DOM element level, so map-rendered items are correct.
 */
/**
 * Resolve source location for a fiber via source map caches.
 * Used as callback for getItemIndexFromFiber when parseDebugStack returns null (RSC/Turbopack).
 */
function resolveLocationViaSourceMaps(fiber: Fiber): SourceLocation | null {
  return resolveOwnServerSourceMap(fiber) ?? resolveViaClientSourceMap(fiber);
}

function getItemIndexFromDOM(element: HTMLElement): number {
  const fiber = getFiberFromDOM(element);
  if (fiber === null) return 0;
  return getItemIndexFromFiber(fiber, resolveLocationViaSourceMaps);
}

// ============================================
// Inline TracingResolver for the extension's iframe
// ============================================

/**
 * Lightweight TracingResolver for use in the extension's injected iframe.
 * Uses shared fiber primitives from @shared/element-tracing/fiber-internals.
 * Does not cache node maps — all resolution is fiber-only.
 */
const iframeResolver: TracingResolver = {
  getSourceLocation(element: HTMLElement): SourceLocation | null {
    const fiber = getFiberFromDOM(element);
    let loc = getSourceLocationFromDOM(element);

    // React 19: _debugStack gives compiled positions. Try source map resolution
    // to get correct source positions. Also handles Next.js RSC/Turbopack.
    if (fiber) {
      const smLoc = resolveOwnServerSourceMap(fiber) ?? resolveViaClientSourceMap(fiber);
      if (smLoc) loc = smLoc;
    }

    // Resolve to call site for imported component internals (shared logic)
    if (loc) {
      return resolveCallSiteSource(loc, fiber, renderedComponentPath);
    }
    return loc;
  },

  getItemIndex(element: HTMLElement): number {
    return getItemIndexFromDOM(element);
  },

  resolveClickLocal(element: HTMLElement): LocalResolveResult | null {
    // Every new click clears any previous pending retry — stale warming results
    // must not overwrite a newer selection (codex P2).
    pendingClickElement = null;

    // Direct fiber resolution (React 18 _debugSource / React 19 _debugStack, Vite).
    let source = getSourceLocationFromDOM(element);
    const fiber = getFiberFromDOM(element);

    // React 19 + Vite: _debugStack gives COMPILED positions. Try source map to get source.
    // Also handles Next.js RSC/Turbopack when direct resolution fails.
    if (fiber !== null) {
      const smSource = resolveOwnServerSourceMap(fiber) ?? resolveViaClientSourceMap(fiber);
      if (smSource) {
        source = smSource;
      } else if (source === null) {
        // No source at all — warm source maps for async retry
        warmServerChunkFrames(fiber);
        source = resolveViaServerSourceMap(fiber);

        if (source === null) {
          warmFiberChunkFrames(fiber);
          const hasPending = (() => {
            let c: Fiber | null = fiber;
            while (c !== null) {
              if (c._debugStack) {
                for (const frame of extractClientChunkFrames(c._debugStack)) {
                  const key = `${frame.url}:${frame.line}:${frame.col}`;
                  if (!clientSourceMapCache.has(key) && !clientInternalFrames.has(key)) return true;
                }
                break;
              }
              c = (c.return as Fiber | null | undefined) ?? null;
            }
            return hasUnresolvedServerFrames(fiber);
          })();
          if (hasPending) {
            pendingClickElement = element;
            pendingClickTimestamp = Date.now();
          }
        }
      }
    }

    if (source === null) return null;

    // Resolve to call site for imported component internals (shared logic)
    const fiber2 = getFiberFromDOM(element);
    source = resolveCallSiteSource(source, fiber2, renderedComponentPath);

    const itemIndex = getItemIndexFromDOM(element);
    // Extension's inline resolver does not have a node map cache,
    // so we generate a synthetic nodeRef from source location.
    // The extension host's NodeMapService will resolve this to a real entry.
    const syntheticRef = `${source.fileName}:${source.line}:${source.column}`;

    return {
      nodeRef: syntheticRef,
      entry: {
        nodeRef: syntheticRef,
        tag: '',
        loc: source,
        endLoc: source,
        parentRef: null,
        children: [],
        isComponent: false,
        fingerprint: '',
      },
      source,
      itemIndex,
    };
  },

  findDOMElement(): HTMLElement | null {
    // Not used in click handler flow — only used for overlay rendering
    return null;
  },
};

// ============================================
// Fiber-based source cache for reverse lookup (nodeRef → DOM elements)
// ============================================

let sourceIndex: FiberSourceIndex | null = null;

function invalidateSourceCache(): void {
  sourceIndex?.invalidate();
}

function findReactRootElement(): HTMLElement | null {
  const selectors = ['#root', '#__next', '#app', '[data-reactroot]'];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!el || el.nodeType !== 1) continue;

    const candidates = [el, el.firstElementChild];
    for (const candidate of candidates) {
      if (!candidate || candidate.nodeType !== 1) continue;
      if (getFiberFromDOM(candidate as HTMLElement)) return candidate as HTMLElement;
    }

    return el as HTMLElement;
  }

  if (document.body) {
    const walker = document.createTreeWalker(document.body, 1 /* NodeFilter.SHOW_ELEMENT */);
    let node: Node | null = walker.currentNode;
    while (node) {
      if (node instanceof HTMLElement && getFiberFromDOM(node)) {
        return node;
      }
      node = walker.nextNode();
    }
  }

  return null;
}

function findHostRootFiber(): Fiber | null {
  const rootElement = findReactRootElement();
  if (!rootElement) return null;

  let fiber = getFiberFromDOM(rootElement);
  if (!fiber && rootElement.firstElementChild instanceof HTMLElement) {
    fiber = getFiberFromDOM(rootElement.firstElementChild);
  }
  if (!fiber) return null;

  let current: Fiber | null = fiber;
  while (current !== null) {
    if (current.tag === FiberTag.HostRoot) {
      return current;
    }
    current = current.return;
  }

  return fiber;
}

function resolveSourceIndexFiberSource(fiber: Fiber): SourceLocation | null {
  return resolveOwnServerSourceMap(fiber) ?? resolveViaClientSourceMap(fiber) ?? getOwnFiberSourceLocation(fiber);
}

function getSourceIndex(): FiberSourceIndex {
  if (sourceIndex) return sourceIndex;

  sourceIndex = new FiberSourceIndex(findHostRootFiber, document, {
    resolveFiberSource: resolveSourceIndexFiberSource,
    mapSource: (source, fiber) => resolveCallSiteSource(source, fiber, renderedComponentPath),
  });

  return sourceIndex;
}

function parseSourceRef(nodeRef: string): SourceLocation | null {
  const match = nodeRef.match(/^(.*):(\d+):(\d+)$/);
  if (!match) return null;
  return {
    fileName: match[1],
    line: Number.parseInt(match[2], 10),
    column: Number.parseInt(match[3], 10),
  };
}

// Hook into React commit cycle to invalidate source cache and kick off source map pre-warming.
// The IIFE runs in <head> BEFORE React loads. We must ensure __REACT_DEVTOOLS_GLOBAL_HOOK__
// exists so React calls onCommitFiberRoot during hydration — this is when fibers are created.
// Without this, the load-event fallback fires before hydration and finds no fibers.
type DevToolsHook = {
  supportsFiber?: boolean;
  renderers?: Map<number, unknown>;
  inject?: (renderer: unknown) => number;
  onScheduleFiberRoot?: (...args: unknown[]) => void;
  onCommitFiberRoot?: (...args: unknown[]) => void;
  onCommitFiberUnmount?: (...args: unknown[]) => void;
  onPostCommitFiberRoot?: (...args: unknown[]) => void;
  checkDCE?: (...args: unknown[]) => void;
  isDisabled?: boolean;
};
const w = window as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook };
if (!w.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
  const renderers = new Map<number, unknown>();
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers,
    inject(renderer: unknown) {
      const id = renderers.size + 1;
      renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
    isDisabled: false,
  };
}
// biome-ignore lint/style/noNonNullAssertion: guaranteed non-null — either existed or we just created it
const devtoolsHook = w.__REACT_DEVTOOLS_GLOBAL_HOOK__!;
const originalCommit = devtoolsHook.onCommitFiberRoot;
devtoolsHook.onCommitFiberRoot = (...args: unknown[]) => {
  invalidateSourceCache();
  void warmClientSourceMaps();
  requestServerSourceMaps();
  originalCommit?.(...args);
};

// ============================================
// Approach A: client-side Next.js source map pre-warming
// Fetches /_next/static/chunks/*.js.map from the dev server and caches
// resolved SourceLocations so the first click is instant.
// ============================================

/** Cache: "chunkUrl:line:col" → resolved SourceLocation (null = warmed but unresolvable). */
const clientSourceMapCache = new Map<string, SourceLocation | null>();
/**
 * Keys that resolved to React-internal paths (e.g. node_modules).
 * Lookup skips (continues to next frame) rather than stopping when it finds these.
 */
const clientInternalFrames = new Set<string>();
/** In-flight fetch keys — prevents duplicate requests. */
const pendingClientFetches = new Set<string>();

/**
 * Pending click to retry once source maps finish warming.
 * Registered when resolveViaClientSourceMap returns null because cache entries are
 * undefined (source map fetch still in flight). Cleared after successful retry or TTL.
 */
let pendingClickElement: HTMLElement | null = null;
let pendingClickTimestamp = 0;
const PENDING_CLICK_TTL_MS = 5000;

/** Extract client chunk frames (HTTP URLs) from an Error.stack string.
 *  Supports Next.js (_next/static/chunks/) AND Vite (/src/ source files). */
function extractClientChunkFrames(err: Error): Array<{ url: string; line: number; col: number }> {
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
    // Vite source files (React 19: _debugStack has compiled positions that need source map)
    if (url.startsWith('http') && url.includes('/src/') && !url.includes('node_modules')) {
      frames.push({ url, line: Number.parseInt(m[2], 10), col: Number.parseInt(m[3], 10) });
    }
  }
  return frames;
}

/**
 * Build a .map URL by appending .map to the pathname, preserving query params.
 * Naive `url + ".map"` breaks when Vite adds ?t=<timestamp> for HMR:
 *   /src/App.tsx?t=123  →  /src/App.tsx?t=123.map  (WRONG — Vite misroutes)
 * Correct: /src/App.tsx?t=123  →  /src/App.tsx.map?t=123
 */
function buildMapUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.pathname += '.map';
    return parsed.href;
  } catch {
    // Not a full URL (relative path) — split on ? manually
    const qIdx = url.indexOf('?');
    if (qIdx === -1) return `${url}.map`;
    return `${url.substring(0, qIdx)}.map${url.substring(qIdx)}`;
  }
}

/**
 * Async: fetch source map for one client chunk URL, resolve and cache the given position.
 * Marks overlays dirty when the result arrives so the overlay re-renders immediately.
 * Also retries any pending click that was waiting for source maps to warm.
 */
async function warmClientChunk(url: string, line: number, col: number): Promise<void> {
  const key = `${url}:${line}:${col}`;
  if (clientSourceMapCache.has(key) || pendingClientFetches.has(key)) return;
  pendingClientFetches.add(key);
  try {
    let sm: SourceMapV3 | null = null;

    // Try .map file first (Next.js, webpack).
    // Must append .map to the pathname, NOT after query params.
    // Vite adds ?t=<timestamp> for HMR — naively appending .map after the query
    // creates e.g. /src/App.tsx?t=123.map which Vite misroutes through the OXC
    // transform plugin instead of the source map middleware, causing PARSE_ERROR.
    const mapUrl = url.endsWith('.map') ? url : buildMapUrl(url);
    const mapRes = await fetch(mapUrl);
    if (mapRes.ok) {
      sm = (await mapRes.json()) as SourceMapV3;
    } else {
      // Vite: source maps are INLINE in the module itself (data: URI)
      const srcRes = await fetch(url);
      if (srcRes.ok) {
        const text = await srcRes.text();
        const inlineMatch = text.match(/\/\/# sourceMappingURL=data:application\/json;base64,(.+)$/m);
        if (inlineMatch) {
          const decoded = atob(inlineMatch[1]);
          sm = JSON.parse(decoded) as SourceMapV3;
        }
      }
    }

    if (!sm) {
      clientSourceMapCache.set(key, null);
      return;
    }
    let loc = resolveInSourceMap(sm, line, col);
    // Vite inline source maps have relative `sources: ["TweetComposer.tsx"]` without path.
    // Reconstruct full path from the original URL: "/src/components/TweetComposer.tsx"
    if (loc && !loc.fileName.includes('/')) {
      try {
        const parsed = new URL(url);
        const dir = parsed.pathname.replace(/\/[^/]+$/, ''); // strip filename
        loc = { ...loc, fileName: `${dir}/${loc.fileName}`.replace(/^\//, '') };
      } catch {
        // Not a valid URL — keep as-is
      }
    }
    // Bundled chunks include React internals (e.g. jsxDEV) whose source maps point to
    // node_modules. Mark those in clientInternalFrames so the lookup skips to the next
    // frame (the user component call site) rather than stopping on them.
    if (loc && /(?:^|\/)node_modules\//.test(loc.fileName)) {
      clientInternalFrames.add(key);
      clientSourceMapCache.set(key, null); // prevent re-fetching the same chunk map
    } else {
      clientSourceMapCache.set(key, loc);
      if (loc) {
        needsOverlayUpdate = true;
        scheduleOverlayLoopIfNeeded();
        retryPendingClick(); // retry any click waiting for this source map
      }
    }
  } catch {
    clientSourceMapCache.set(key, null);
  } finally {
    pendingClientFetches.delete(key);
  }
}

/**
 * Kick off warming for all client chunk frames in a fiber's _debugStack chain.
 * Used to trigger warming on first click without waiting for the next load/commit.
 */
function warmFiberChunkFrames(fiber: Fiber): void {
  let current: Fiber | null = fiber;
  while (current !== null) {
    if (current._debugStack) {
      for (const frame of extractClientChunkFrames(current._debugStack)) {
        void warmClientChunk(frame.url, frame.line, frame.col);
      }
      break;
    }
    current = (current.return as typeof current | undefined) ?? null;
  }
}

/**
 * Walk all DOM elements and kick off async source map fetches for every
 * Next.js client chunk URL found in fiber `_debugStack` fields.
 * Called from `onCommitFiberRoot` so maps are ready before the first user click.
 *
 * DOM element fibers are HostComponent (tag=5) — they never have `_debugStack`.
 * We must walk up the return chain to reach the nearest FunctionComponent fiber.
 * React 19 may set `return`/`_debugOwner` to `undefined` rather than `null` —
 * use `?? null` throughout to normalise.
 */
function warmClientSourceMaps(): void {
  if (!document.body) return;
  const walker = document.createTreeWalker(document.body, 1 /* SHOW_ELEMENT */);
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node instanceof HTMLElement) {
      const domFiber = getFiberFromDOM(node);
      if (domFiber) warmFiberChunkFrames(domFiber);
    }
    node = walker.nextNode();
  }
}

/**
 * Look up the source map cache for the first matching client chunk frame
 * found walking up the fiber's return chain.
 *
 * Next.js/Turbopack bundles React internals (jsxDEV) into the same chunk as user code.
 * The jsxDEV frame comes first in the stack; it maps to node_modules and is recorded in
 * clientInternalFrames — the lookup skips it (continue) and tries the user component frame.
 * A null in clientSourceMapCache (fetch failed or no mapping) stops the search for this
 * fiber so we do not misattribute the element to an ancestor component.
 */
function resolveViaClientSourceMap(fiber: Fiber): SourceLocation | null {
  let current: Fiber | null = fiber;
  while (current !== null) {
    if (current._debugStack) {
      for (const frame of extractClientChunkFrames(current._debugStack)) {
        const key = `${frame.url}:${frame.line}:${frame.col}`;
        if (clientInternalFrames.has(key)) continue; // React-internal frame — skip to next
        const cached = clientSourceMapCache.get(key);
        if (cached) return cached; // resolved to user source file
        if (cached === null) return null; // warmed but unresolvable — don't walk ancestors
        // undefined: warm-up still in flight, try next frame
      }
    }
    current = (current.return as Fiber | null | undefined) ?? null;
  }
  return null;
}

/**
 * Retry the most recent pending click after source maps finish warming.
 * Posts hypercanvas:elementClick to the parent webview if the resolution succeeds.
 * Called from warmClientChunk and serverSourceMapResult when new locations are cached.
 */
function retryPendingClick(): void {
  if (!pendingClickElement) return;
  if (Date.now() - pendingClickTimestamp > PENDING_CLICK_TTL_MS) {
    pendingClickElement = null;
    return;
  }
  const fiber = getFiberFromDOM(pendingClickElement);
  if (!fiber) {
    pendingClickElement = null;
    return;
  }
  // Try client source maps first, then server source maps (RSC)
  const source = resolveViaClientSourceMap(fiber) ?? resolveViaServerSourceMap(fiber);
  if (!source) return; // still warming — keep pending
  const element = pendingClickElement;
  pendingClickElement = null;
  const itemIndex = getItemIndexFromDOM(element);
  const syntheticRef = `${source.fileName}:${source.line}:${source.column}`;
  // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
  window.parent.postMessage({ type: 'hypercanvas:elementClick', elementId: syntheticRef, itemIndex, source }, '*');
}

// ============================================
// Approach B: extension-host proxy for server-side (RSC) source maps
// Server chunk paths (file:/// or Server/file:///) are not browser-fetchable;
// the extension host reads them from the local filesystem via postMessage RPC.
// ============================================

/** Cache: "filePath:line:col" → resolved SourceLocation (null = not resolvable). */
const serverSourceMapCache = new Map<string, SourceLocation | null>();
/** In-flight server-side resolve keys — prevents duplicate requests. */
const pendingServerRequests = new Set<string>();

/**
 * Extract server-side chunk frames from an Error.stack.
 *
 * Supported formats:
 * - React 19.0: "Server/file:///path/.next/server/chunks/…"
 * - React 19.1+: "about://React/Server/file:///path/.next/dev/server/chunks/…"
 * - Plain: "file:///path/.next/…"
 */
function extractServerChunkFrames(err: Error): Array<{ filePath: string; line: number; col: number }> {
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
 * Request server source map resolution from the extension host.
 * The host reads the .map file from the local filesystem, decodes VLQ,
 * and responds with `hypercanvas:serverSourceMapResult`.
 */
function requestServerSourceMap(filePath: string, line: number, col: number): void {
  const key = `${filePath}:${line}:${col}`;
  if (serverSourceMapCache.has(key) || pendingServerRequests.has(key)) return;
  pendingServerRequests.add(key);
  // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
  window.parent.postMessage({ type: 'hypercanvas:resolveServerSourceMap', filePath, line, col }, '*');
}

/**
 * Walk all DOM elements and request server source map resolution for RSC chunk frames.
 * Called from `onCommitFiberRoot` alongside warmClientSourceMaps.
 * Like warmClientSourceMaps, must walk up to FunctionComponent fibers.
 */
function requestServerSourceMaps(): void {
  if (!document.body) return;
  const walker = document.createTreeWalker(document.body, 1);
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node instanceof HTMLElement) {
      let current = getFiberFromDOM(node);
      while (current !== null) {
        if (current._debugStack) {
          for (const frame of extractServerChunkFrames(current._debugStack)) {
            requestServerSourceMap(frame.filePath, frame.line, frame.col);
          }
          break;
        }
        current = (current.return as typeof current | undefined) ?? null;
      }
    }
    node = walker.nextNode();
  }
}

/**
 * Kick off server source map warming for a single fiber's _debugStack chain.
 * Used on click to ensure RSC frames are requested even when client frames are also pending.
 */
function warmServerChunkFrames(fiber: Fiber): void {
  let c: Fiber | null = fiber;
  while (c !== null) {
    if (c._debugStack) {
      for (const frame of extractServerChunkFrames(c._debugStack)) {
        requestServerSourceMap(frame.filePath, frame.line, frame.col);
      }
      break;
    }
    c = (c.return as typeof c | undefined) ?? null;
  }
}

/**
 * Resolve server source map for THIS fiber's own _debugStack only.
 * Unlike resolveViaServerSourceMap (which walks the return chain), this gives
 * per-element precision for source cache building — each RSC element has a
 * unique compiled position in its _debugStack.
 */
function resolveOwnServerSourceMap(fiber: Fiber): SourceLocation | null {
  // HostComponent fibers (tag=5) in React 19.1 RSC have _debugStack directly
  if (fiber._debugStack) {
    for (const frame of extractServerChunkFrames(fiber._debugStack)) {
      const cached = serverSourceMapCache.get(`${frame.filePath}:${frame.line}:${frame.col}`);
      if (cached) return cached;
      if (cached === null) return null; // warmed but unresolvable
    }
  }
  return null;
}

/**
 * Check if a fiber has server chunk frames that are not yet resolved.
 * Returns false if all frames are already cached (even as null), avoiding
 * stuck pending clicks when no future serverSourceMapResult can arrive.
 */
function hasUnresolvedServerFrames(fiber: Fiber): boolean {
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
function resolveViaServerSourceMap(fiber: Fiber): SourceLocation | null {
  let current: Fiber | null = fiber;
  while (current !== null) {
    if (current._debugStack) {
      for (const frame of extractServerChunkFrames(current._debugStack)) {
        const cached = serverSourceMapCache.get(`${frame.filePath}:${frame.line}:${frame.col}`);
        if (cached !== undefined) return cached;
      }
    }
    current = (current.return as typeof current | undefined) ?? null;
  }
  return null;
}

/** Find DOM elements by nodeRef (format: "fileName:line:column"). */
function findElementsByRef(nodeRef: string, itemIndex: number | null): HTMLElement[] {
  const source = parseSourceRef(nodeRef);
  if (source === null) return [];

  let live = getSourceIndex().findDOMElements(source);
  if (live.length === 0) {
    live = getSourceIndex().findClosestLineDOMElements(source);
  }

  if (itemIndex !== null) {
    return live[itemIndex] ? [live[itemIndex]] : [];
  }
  return live;
}

/** Overlay element resolver using the fiber-based source cache. */
const iframeElementResolver: OverlayElementResolver = {
  findElements: findElementsByRef,
  findEmptyContainers(): Array<{ elementId: string; element: HTMLElement }> {
    const results: Array<{ elementId: string; element: HTMLElement }> = [];
    for (const entry of getSourceIndex().getLiveEntries()) {
      for (const el of entry.elements) {
        if (document.contains(el) && isContainerEmpty(el)) {
          results.push({ elementId: entry.key, element: el });
        }
      }
    }
    return results;
  },
};

/**
 * Scroll an element into view, preferring smooth scrolling when supported.
 * Falls back to basic scrollIntoView in older environments.
 */
function scrollIntoViewCenterSmooth(el: Element): void {
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    try {
      el.scrollIntoView({ block: 'center' });
    } catch {
      el.scrollIntoView();
    }
  }
}

// === Rendered component path (from URL ?component= param) ===
// Used to determine if a clicked element is from the rendered file or an imported component.
// Same logic as ElementTracer.renderedFile in SaaS.
// Mutable: updated on component switch via hypercanvas:setComponent postMessage.
let renderedComponentPath: string | null = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('component') ?? null;
  } catch {
    return null;
  }
})();

// === State (synced from parent webview via postMessage) ===
const state = {
  selectedIds: [] as string[],
  hoveredId: null as string | null,
  hoveredItemIndex: null as number | null,
  selectedItemIndices: {} as Record<string, number | null>,
  engineMode: 'design' as string,
};
// Expose for E2E test tooling (waitForFunction polling)
(window as unknown as Record<string, unknown>).__hyperCanvasState = state;
(window as unknown as Record<string, unknown>).__hyperCanvasStateGen = 0;
// Always null until VS Code extension supports component instances (SaaS-only for now).
// Change to `let` and sync via stateUpdate when instance support is added.
const activeInstanceId: string | null = null;

// === Shared click handler (fiber-based via iframeResolver) ===
attachClickHandler(
  document,
  {
    onElementClick: (nodeRef, _el, _e, itemIndex, source) => {
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:elementClick',
          elementId: nodeRef,
          itemIndex,
          source,
        },
        '*',
      );
    },
    onElementHover: (nodeRef, _el, itemIndex, source) => {
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:elementHover',
          elementId: nodeRef,
          itemIndex,
          source,
        },
        '*',
      );
    },
    onEmptyClick: () => {
      // Suppress empty-click while source maps are warming for the last click target.
      // retryPendingClick() will fire the real elementClick once maps resolve (codex P1).
      if (pendingClickElement) return;
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage({ type: 'hypercanvas:emptyClick' }, '*');
    },
    getMode: () => state.engineMode as 'design' | 'interact',
  },
  iframeResolver,
);

// === DOM-based NodeMapLookup for keyboard navigation ===
// Builds parent/children/sibling relationships from DOM tree + fiber source resolution.
// Unlike NodeMapService (which uses AST), this uses live DOM — works without extension host.
function getSourceKey(el: HTMLElement): string | null {
  const fiber = getFiberFromDOM(el);
  if (!fiber) return null;
  // Use the same resolution chain as FiberSourceIndex so that nodeRef keys
  // produced here are identical to the keys stored in the index. Using
  // findNearestSourceLocation() here causes key mismatch because that function
  // walks up the fiber.return chain and may return an ancestor's location
  // instead of the fiber's own location.
  let loc = resolveSourceIndexFiberSource(fiber);
  if (!loc) return null;
  loc = resolveCallSiteSource(loc, fiber, renderedComponentPath);
  return `${loc.fileName}:${loc.line}:${loc.column}`;
}

/** Find the nearest ancestor DOM element that has a traceable fiber source. */
function findTraceableParent(el: HTMLElement): { element: HTMLElement; ref: string } | null {
  let current = el.parentElement;
  while (current && current !== document.body) {
    const ref = getSourceKey(current);
    if (ref) return { element: current, ref };
    current = current.parentElement;
  }
  return null;
}

/** Find direct child DOM elements that have traceable fiber sources. */
function findTraceableChildren(el: HTMLElement): string[] {
  const refs: string[] = [];
  // BFS — stop descending once we find a traceable child (they are the "direct" children
  // in the component tree sense, not arbitrary descendants).
  const queue: HTMLElement[] = [];
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i];
    if (child instanceof HTMLElement) queue.push(child);
  }
  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length check guarantees shift() is non-null
    const node = queue.shift()!;
    const ref = getSourceKey(node);
    if (ref) {
      refs.push(ref);
      // Don't descend further — this is a "direct" traceable child
    } else {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child instanceof HTMLElement) queue.push(child);
      }
    }
  }
  return refs;
}

const domNodeMapLookup: import('@shared/canvas-interaction/keyboard-handler').NodeMapLookup = {
  getEntry(nodeRef: string) {
    const source = parseSourceRef(nodeRef);
    if (source === null) return null;

    let elements = getSourceIndex().findDOMElements(source);
    if (elements.length === 0) {
      elements = getSourceIndex().findClosestLineDOMElements(source);
    }
    const el = elements[0];
    if (!el) return null;

    const parent = findTraceableParent(el);
    const children = findTraceableChildren(el);

    return {
      nodeRef,
      tag: el.tagName.toLowerCase(),
      loc: source,
      endLoc: source,
      parentRef: parent?.ref ?? null,
      children,
      isComponent: false,
      fingerprint: '',
    };
  },
  findDOMElement(source, itemIndex) {
    const exact = getSourceIndex().findDOMElement(source, itemIndex);
    if (exact) return exact;

    const closest = getSourceIndex().findClosestLineDOMElements(source);
    return closest[itemIndex] ?? closest[0] ?? null;
  },
};

// === Shared keyboard handler ===
const { handler: keydownHandler } = createDesignKeydownHandler({
  getState: () => ({
    selectedIds: state.selectedIds,
    activeInstanceId,
  }),
  getDocument: () => document,
  callbacks: {
    onSelectElement: (id) =>
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:elementClick',
          elementId: id,
          itemIndex: null,
        },
        '*',
      ),
    onSelectMultiple: (ids) =>
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:selectMultiple',
          elementIds: ids,
        },
        '*',
      ),
    onClearSelection: () =>
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage({ type: 'hypercanvas:emptyClick' }, '*'),
    onDeleteElements: (ids) =>
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:deleteElements',
          elementIds: ids,
        },
        '*',
      ),
  },
  isDesignMode: () => state.engineMode === 'design',
  // DOM-based lookup — builds parent/children from live DOM + fiber source resolution.
  nodeMapLookup: domNodeMapLookup,
});
// Forward unhandled modifier keystrokes to parent webview so VS Code's
// built-in keyboard forwarding picks them up (Cmd+S, Cmd+P, etc.).
// Without this, the iframe swallows all events and VS Code shortcuts break.
// See: https://github.com/Microsoft/vscode/issues/65333
function keydownForwardingHandler(e: KeyboardEvent): void {
  const consumed = keydownHandler(e);
  if (consumed) return;

  // In interact mode, keep all events inside the iframe — the user
  // is interacting with the app (forms, inputs, app-level shortcuts).
  if (state.engineMode !== 'design') return;

  // Only forward modifier combos — plain keystrokes stay in the iframe
  if (!e.metaKey && !e.ctrlKey && !e.altKey) return;

  // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
  window.parent.postMessage(
    {
      type: 'hypercanvas:keydown',
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      repeat: e.repeat,
    },
    '*',
  );
}
document.addEventListener('keydown', keydownForwardingHandler, true);

// === Context menu handler ===
const contextMenuHandler = (e: MouseEvent) => {
  if (state.engineMode !== 'design') return;
  e.preventDefault();
  e.stopPropagation();

  const target = e.target as HTMLElement;

  // Resolve element source — same chain as click handler (supports RSC/Turbopack)
  const result = iframeResolver.resolveClickLocal(target);
  const source = result?.source ?? null;
  const elementId = result ? `${result.source.fileName}:${result.source.line}:${result.source.column}` : null;
  const itemIndex = result?.itemIndex ?? null;

  // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
  window.parent.postMessage(
    {
      type: 'hypercanvas:contextMenu',
      elementId,
      itemIndex,
      source,
      x: e.clientX,
      y: e.clientY,
    },
    '*',
  );
};
document.addEventListener('contextmenu', contextMenuHandler, true);

// === Focus prevention in design mode (mousedown, not focusin) ===
const mousedownHandler = (e: MouseEvent) => {
  if (state.engineMode !== 'design') return;
  const target = e.target as HTMLElement;
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  ) {
    e.preventDefault(); // Actually prevents focus on mousedown
  }
};
document.addEventListener('mousedown', mousedownHandler, true);

// === Overlay rects with dirty-flag optimization ===
let prevRectsJSON = '';
let needsOverlayUpdate = true;
let overlayRafScheduled = false;

function scheduleOverlayLoopIfNeeded(): void {
  if (!overlayRafScheduled) {
    overlayRafScheduled = true;
    requestAnimationFrame(sendOverlayRects);
  }
}

function sendOverlayRects(): void {
  overlayRafScheduled = false;

  if (!needsOverlayUpdate) {
    // Nothing changed; do not reschedule another frame to avoid a perpetual RAF loop.
    return;
  }
  needsOverlayUpdate = false;

  const result = computeOverlayRects(
    {
      selectedIds: state.selectedIds,
      hoveredId: state.hoveredId,
      hoveredItemIndex: state.hoveredItemIndex,
      selectedItemIndices: state.selectedItemIndices,
      engineMode: state.engineMode,
    },
    iframeElementResolver,
  );

  const rects = result.overlayRects.map((r) => ({
    key: r.key,
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    type: r.type,
  }));

  const { placeholderRects } = result;

  const payload = JSON.stringify({ rects, placeholderRects });
  if (payload !== prevRectsJSON) {
    prevRectsJSON = payload;
    // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage({ type: 'hypercanvas:overlayRects', rects, placeholderRects }, '*');
  }

  // Only continue the overlay loop while updates are needed or overlays are active.
  if (needsOverlayUpdate || state.selectedIds.length > 0 || state.hoveredId !== null || placeholderRects.length > 0) {
    scheduleOverlayLoopIfNeeded();
  }
}

// Throttle overlay updates triggered by high-frequency DOM/layout events.
// 50 ms (~20 FPS) chosen to balance overlay responsiveness with DOM/layout change frequency.
const OVERLAY_THROTTLE_DELAY_MS = 50;
let overlayUpdateTimeoutId: ReturnType<typeof setTimeout> | null = null;

function scheduleThrottledOverlayUpdate(): void {
  needsOverlayUpdate = true;
  if (overlayUpdateTimeoutId !== null) return;
  overlayUpdateTimeoutId = setTimeout(() => {
    overlayUpdateTimeoutId = null;
    scheduleOverlayLoopIfNeeded();
  }, OVERLAY_THROTTLE_DELAY_MS);
}

// Mark overlays dirty when DOM/layout changes
const overlayMutationObserver =
  typeof MutationObserver !== 'undefined'
    ? new MutationObserver(() => {
        invalidateSourceCache();
        scheduleThrottledOverlayUpdate();
      })
    : null;

function setupBodyObservers(): void {
  if (!document.body) return;
  if (overlayMutationObserver) {
    overlayMutationObserver.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  if (overlayResizeObserver) {
    overlayResizeObserver.observe(document.body);
  }
}

const overlayResizeObserver =
  typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => {
        scheduleThrottledOverlayUpdate();
      })
    : null;

// Script is injected at the start of <head>, so document.body may not exist yet.
// Set up observers immediately if body is ready, otherwise wait for DOMContentLoaded.
if (document.body) {
  setupBodyObservers();
} else {
  document.addEventListener('DOMContentLoaded', setupBodyObservers, { once: true });
}

// Also mark dirty on scroll and window resize
const overlayScrollHandler = () => {
  scheduleThrottledOverlayUpdate();
};
const overlayResizeHandler = () => {
  scheduleThrottledOverlayUpdate();
};
window.addEventListener('scroll', overlayScrollHandler, true);
window.addEventListener('resize', overlayResizeHandler);

// Start the loop
scheduleOverlayLoopIfNeeded();

// Clean up observers and listeners when the iframe is unloaded
window.addEventListener('unload', () => {
  if (overlayUpdateTimeoutId !== null) clearTimeout(overlayUpdateTimeoutId);
  if (overlayMutationObserver) overlayMutationObserver.disconnect();
  if (overlayResizeObserver) overlayResizeObserver.disconnect();
  window.removeEventListener('scroll', overlayScrollHandler, true);
  window.removeEventListener('resize', overlayResizeHandler);
  document.removeEventListener('keydown', keydownForwardingHandler, true);
  document.removeEventListener('contextmenu', contextMenuHandler, true);
  document.removeEventListener('mousedown', mousedownHandler, true);
});

// === Design mode CSS (shared) ===
function updateDesignStyles(mode: string): void {
  const styleId = 'hyper-canvas-dynamic-styles';
  let style = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }

  style.textContent = buildDesignStylesCSS({
    mode: mode === 'interact' ? 'interact' : 'design',
  });

  if (mode !== 'interact') {
    if (document.body) document.body.classList.add('design-mode');
  } else {
    if (document.body) document.body.classList.remove('design-mode');
  }
}

// === Screenshot handler ===
function handleScreenshotRequest(requestId: string, elementId: string | null): void {
  const target = elementId ? (findElementsByRef(elementId, 0)[0] ?? null) : document.body;

  if (!target) {
    // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage({ type: 'hypercanvas:screenshotResult', requestId, dataUrl: null }, '*');
    return;
  }

  html2canvas(target, { useCORS: true, allowTaint: true, backgroundColor: null, scale: 1 })
    .then((canvas) => {
      const dataUrl = canvas.toDataURL('image/png');
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage({ type: 'hypercanvas:screenshotResult', requestId, dataUrl }, '*');
    })
    .catch((err) => {
      console.error('[HyperCanvas] Screenshot failed:', err);
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage({ type: 'hypercanvas:screenshotResult', requestId, dataUrl: null }, '*');
    });
}

// === Receive messages from parent webview ===
// nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview iframe, origin not applicable
window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  // Component switch: update renderedComponentPath so resolveCallSiteSource uses
  // the correct file path after explorer-driven component switches.
  if (msg.type === 'hypercanvas:setComponent') {
    if (typeof msg.component === 'string') {
      renderedComponentPath = msg.component;
      // Invalidate fiber source cache — DOM elements now belong to a different component tree.
      invalidateSourceCache();
    }
    return;
  }

  // Keyboard command from VS Code keybinding — bypass isDesignMode check
  // (command already has when clause, no need to double-check mode)
  if (msg.type === 'hypercanvas:syntheticKeydown') {
    const syntheticEvent = new KeyboardEvent('keydown', {
      key: msg.key,
      shiftKey: !!msg.shiftKey,
      bubbles: true,
      cancelable: true,
    });
    // Call handler directly — it checks isDesignMode internally,
    // but VS Code keybinding already has the when clause.
    // Force design mode flag temporarily for the synthetic event.
    const prevMode = state.engineMode;
    state.engineMode = 'design';
    keydownHandler(syntheticEvent);
    state.engineMode = prevMode;
    return;
  }

  if (msg.type === 'hypercanvas:stateUpdate') {
    if (msg.selectedIds !== undefined) state.selectedIds = msg.selectedIds;
    if (msg.hoveredId !== undefined) state.hoveredId = msg.hoveredId;
    if (msg.hoveredItemIndex !== undefined) state.hoveredItemIndex = msg.hoveredItemIndex;
    if (msg.selectedItemIndices !== undefined) state.selectedItemIndices = msg.selectedItemIndices;
    if (msg.engineMode !== undefined) {
      state.engineMode = msg.engineMode;
      updateDesignStyles(state.engineMode);
    }
    needsOverlayUpdate = true;
    scheduleOverlayLoopIfNeeded();
    // Bump generation counter for E2E test synchronization
    (window as unknown as Record<string, unknown>).__hyperCanvasStateGen =
      (((window as unknown as Record<string, unknown>).__hyperCanvasStateGen as number) ?? 0) + 1;
    return;
  }

  // Go to Visual: select element and scroll to it
  if (msg.type === 'hypercanvas:goToVisual') {
    state.selectedIds = [msg.elementId];
    state.selectedItemIndices = {};
    const el = findElementsByRef(msg.elementId, 0)[0];
    if (el) scrollIntoViewCenterSmooth(el);
    needsOverlayUpdate = true;
    scheduleOverlayLoopIfNeeded();
    return;
  }

  // Content extraction requests from extension (Copy Text / Copy as HTML)
  if (msg.type === 'hypercanvas:getElementText') {
    const el = findElementsByRef(msg.elementId, 0)[0] ?? null;
    // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage(
      {
        type: 'hypercanvas:elementContentResult',
        requestId: msg.requestId,
        text: el ? el.innerText : null,
        html: null,
      },
      '*',
    );
    return;
  }
  if (msg.type === 'hypercanvas:getElementHTML') {
    const el = findElementsByRef(msg.elementId, 0)[0] ?? null;
    // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage(
      {
        type: 'hypercanvas:elementContentResult',
        requestId: msg.requestId,
        text: null,
        html: el ? el.outerHTML : null,
      },
      '*',
    );
    return;
  }

  // Screenshot request from MCP tool
  if (msg.type === 'hypercanvas:takeScreenshot') {
    handleScreenshotRequest(msg.requestId as string, msg.elementId as string | null);
    return;
  }

  // Approach B: extension host resolved a server-side (RSC) source map
  if (msg.type === 'hypercanvas:serverSourceMapResult') {
    const { filePath, line, col, result } = msg as {
      filePath: string;
      line: number;
      col: number;
      result: SourceLocation | null;
    };
    const key = `${filePath}:${line}:${col}`;
    serverSourceMapCache.set(key, result);
    pendingServerRequests.delete(key);
    if (result) {
      // Newly resolved element — invalidate overlay cache so it redraws
      invalidateSourceCache();
      needsOverlayUpdate = true;
      scheduleOverlayLoopIfNeeded();
      retryPendingClick(); // retry any click waiting for server source maps (RSC)
    }
    return;
  }
});

// Initialize design mode
updateDesignStyles(state.engineMode);
