/**
 * Iframe interaction script — injected into user's preview iframe by PreviewProxy.
 *
 * Built as IIFE by esbuild, runs inside the preview iframe (not the VS Code webview).
 * Handles click/hover/context menu, keyboard shortcuts, overlay rects, design CSS.
 * Communicates with parent webview via postMessage.
 */

import { attachClickHandler } from '@shared/canvas-interaction/click-handler';
import { resolveDragSource } from '@shared/canvas-interaction/drag-source-resolver';
import { liftToCommonSiblings } from '@shared/canvas-interaction/drop-target-lift';
import { isContainerEmpty } from '@shared/canvas-interaction/empty-container-placeholders';
import { createDesignKeydownHandler } from '@shared/canvas-interaction/keyboard-handler';
import { computeOverlayRects } from '@shared/canvas-interaction/overlay-rects';
import { resolveCallSiteSource, resolveCallSiteTarget } from '@shared/canvas-interaction/resolve-source';
import {
  computeEffectiveRef,
  toggleItemIndex,
  toggleNodeRefInSelection,
} from '@shared/canvas-interaction/selection-utils';
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
    const fiber = getFiberFromDOM(element);
    const directItemIndex = getItemIndexFromDOM(element);
    const source = getSourceLocationFromDOM(element);
    if (source === null) return directItemIndex;
    return resolveCallSiteTarget(source, fiber, renderedComponentPath, directItemIndex).itemIndex;
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

    const directItemIndex = getItemIndexFromDOM(element);
    const target = resolveCallSiteTarget(source, fiber, renderedComponentPath, directItemIndex);
    source = target.source;
    const itemIndex = target.itemIndex;
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

function isViteSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes('/src/') && !parsed.pathname.includes('/node_modules/');
  } catch {
    return url.includes('/src/') && !url.includes('/node_modules/');
  }
}

async function loadInlineSourceMap(url: string): Promise<SourceMapV3 | null> {
  const srcRes = await fetch(url);
  if (!srcRes.ok) return null;

  const text = await srcRes.text();
  const inlineMatch = text.match(/\/\/# sourceMappingURL=data:application\/json;base64,(.+)$/m);
  const encoded = inlineMatch?.[1];
  if (!encoded) return null;

  const decoded = atob(encoded);
  return JSON.parse(decoded) as SourceMapV3;
}

async function loadExternalSourceMap(url: string): Promise<SourceMapV3 | null> {
  const mapUrl = url.endsWith('.map') ? url : buildMapUrl(url);
  const mapRes = await fetch(mapUrl);
  if (!mapRes.ok) return null;
  if (mapRes.status === 204) return null;
  const contentType = mapRes.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) return null;
  return (await mapRes.json()) as SourceMapV3;
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

    if (isViteSourceUrl(url)) {
      sm = await loadInlineSourceMap(url);
      if (!sm) {
        sm = await loadExternalSourceMap(url);
      }
    } else {
      // Next.js and webpack expose external source maps for bundled chunks.
      sm = await loadExternalSourceMap(url);
      if (!sm) {
        sm = await loadInlineSourceMap(url);
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
        // FiberSourceIndex stores source-derived keys; source-map cache updates
        // can change those keys from compiled positions to original locations.
        invalidateSourceCache();
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
  let source = resolveViaClientSourceMap(fiber) ?? resolveViaServerSourceMap(fiber);
  if (!source) return; // still warming — keep pending
  const element = pendingClickElement;
  pendingClickElement = null;
  const directItemIndex = getItemIndexFromDOM(element);
  const target = resolveCallSiteTarget(source, fiber, renderedComponentPath, directItemIndex);
  source = target.source;
  const itemIndex = target.itemIndex;
  const syntheticRef = `${source.fileName}:${source.line}:${source.column}`;
  // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
  window.parent.postMessage(
    {
      type: 'hypercanvas:elementClick',
      elementId: syntheticRef,
      itemIndex,
      source,
      computedStyle: extractComputedStyle(element),
      computedStyleSeq: ++elementClickSeq,
    },
    '*',
  );
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
  // Fallback: filename-agnostic line:col search.
  // Needed when tree→canvas dispatch uses an absolute filesystem path but the
  // FiberSourceIndex stores Vite-relative paths (e.g. "src/Foo.tsx" vs "/abs/Foo.tsx").
  if (live.length === 0 && source.fileName) {
    for (const entry of getSourceIndex().getLiveEntries()) {
      if (entry.source.line === source.line && entry.source.column === source.column) {
        const liveEls = entry.elements.filter((el) => document.contains(el));
        if (liveEls.length > 0) {
          live = liveEls;
          break;
        }
      }
    }
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

// ============================================
// Computed style extraction for Inspector fill/color population
// ============================================

const COMPUTED_STYLE_PROPS = [
  'backgroundColor',
  'backgroundImage',
  'color',
  'borderColor',
  'borderTopColor',
  'borderWidth',
  'borderStyle',
  'borderRadius',
  'opacity',
  'fontSize',
  'width',
  'height',
] as const;

/** Monotonic counter so the webview can discard stale snapshots on rapid clicks. */
let elementClickSeq = 0;

function extractComputedStyle(el: HTMLElement): Record<string, string> {
  const cs = window.getComputedStyle(el);
  const result: Record<string, string> = {};
  for (const prop of COMPUTED_STYLE_PROPS) {
    const value = cs[prop as keyof CSSStyleDeclaration] as string;
    if (value) result[prop] = value;
  }
  return result;
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

// Suppress the synthetic click that fires after a drag ends.
// Must be registered BEFORE attachClickHandler so it fires first on the same node
// and stopImmediatePropagation() can prevent handleClick from running.
document.addEventListener('click', _dragClickSuppressor, true);

// === Shared click handler (fiber-based via iframeResolver) ===
attachClickHandler(
  document,
  {
    onElementClick: (nodeRef, el, e, itemIndex, source) => {
      const additive = e.metaKey || e.ctrlKey;

      if (additive) {
        const nextIds = toggleNodeRefInSelection(state.selectedIds, nodeRef);
        const nextIndices = toggleItemIndex(state.selectedItemIndices, nodeRef, nextIds, itemIndex);
        state.selectedIds = nextIds;
        state.selectedItemIndices = nextIndices;
      } else {
        // Optimistic local update so keyboard shortcuts (Cmd+D, Delete) work immediately
        // without waiting for the state round-trip: iframe → extension host → StateHub → iframe.
        // When nodeRef is null (server round-trip pending), synthesize a ref from source so
        // state.selectedIds is populated — matches sourceToElementId() in the extension host.
        const effectiveRef = source ? computeEffectiveRef(nodeRef, source) : nodeRef;
        if (effectiveRef) {
          state.selectedIds = [effectiveRef];
          if (itemIndex != null) state.selectedItemIndices = { [effectiveRef]: itemIndex };
        }
      }

      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:elementClick',
          elementId: nodeRef,
          // Send already-computed selection so parent doesn't need local state tracking.
          selectedIds: state.selectedIds,
          selectedItemIndices: state.selectedItemIndices,
          itemIndex,
          source,
          additive,
          computedStyle: extractComputedStyle(el),
          computedStyleSeq: ++elementClickSeq,
          domTextContent: el.innerText?.trim() || undefined,
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
    onEmptyClick: (emptyClickEvent) => {
      // Suppress empty-click while source maps are warming for the last click target.
      // retryPendingClick() will fire the real elementClick once maps resolve (codex P1).
      if (pendingClickElement) return;
      // Cmd/Ctrl+click on empty space: keep existing selection (Figma behavior).
      if (emptyClickEvent.metaKey || emptyClickEvent.ctrlKey) return;
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
  let loc = resolveSourceIndexFiberSource(fiber);
  if (!loc) return null;
  if (renderedComponentPath) {
    loc = resolveCallSiteSource(loc, fiber, renderedComponentPath);
  }
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

    // Use findElementsByRef so the filename-agnostic line:col fallback applies.
    // Without this, tree-clicked elements (absolute path nodeRef) fail the exact
    // and closest-line lookups (both compare fileName), so getEntry returns null
    // and Shift+Enter clears selection instead of navigating to parent.
    const el = findElementsByRef(nodeRef, 0)[0];
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
    onDuplicateElement: (id) =>
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'keyboard:duplicate',
          elementId: id,
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
      computedStyle: elementId ? extractComputedStyle(target) : undefined,
      computedStyleSeq: elementId ? ++elementClickSeq : undefined,
    },
    '*',
  );
};
document.addEventListener('contextmenu', contextMenuHandler, true);

// === Resize live-preview state ===
// Maps elementId → original inline width/height so cancel can restore.
const _previewResizeOrig = new Map<string, { width: string; height: string }>();

// === Element drag/reorder state machine ===
// Tracks pointerdown → threshold → drag → drop to post hypercanvas:reorderElement.
// Suppresses the click event that fires after pointerup to prevent accidental deselect.
const DRAG_THRESHOLD_PX = 5;

function _dragEffectiveBg(el: HTMLElement): string {
  let node: HTMLElement | null = el;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    node = node.parentElement;
  }
  return '#ffffff';
}

function _isHorizontalLayout(el: HTMLElement): boolean {
  const parent = el.parentElement;
  if (!parent) return false;
  const s = getComputedStyle(parent);
  const d = s.display;
  if (d === 'flex' || d === 'inline-flex') return s.flexDirection === 'row' || s.flexDirection === 'row-reverse';
  if (d === 'grid' || d === 'inline-grid') return s.gridAutoFlow.includes('column');
  return false;
}

let _dragState: 'idle' | 'pending' | 'dragging' = 'idle';
let _dragSourceId: string | null = null;
let _dragSourceFilePath: string | null = null;
let _dragStartX = 0;
let _dragStartY = 0;
let _dragSuppressNextClick = false;
let _dragSourceEl: HTMLElement | null = null;
let _dragIndicatorEl: HTMLElement | null = null;
let _dragBadgeEl: HTMLElement | null = null;
let _dragOrigStyleAttr = '';

function _dragPointerDown(e: PointerEvent): void {
  if (state.engineMode !== 'design' || e.button !== 0) return;
  const target = e.target as HTMLElement;
  // resolveDragSource: walks up for decorative children (emoji, aria-hidden),
  // then falls back to _debugSource when source maps are cold (React 18 Vite/Babel).
  const resolved = resolveDragSource(target, (el) => iframeResolver.getSourceLocation(el), renderedComponentPath);
  if (!resolved) return;

  // "What is selected is what gets dragged" — if there is a current single selection
  // and the user grabs anywhere inside that selected element (including decorative
  // children like emoji spans, or nested <div>{t('...')}</div>), drag the selected
  // element itself rather than the inner click target. Without this, grabbing an
  // emoji inside a card resolves to a span/inner-div and the visible "card" the
  // user sees outlined is NOT what moves.
  let dragEl = resolved.el;
  let dragSrc = resolved.source;
  if (state.selectedIds.length === 1) {
    const selectedRef = state.selectedIds[0];
    let cur: HTMLElement | null = target;
    while (cur && cur !== document.body) {
      const loc = iframeResolver.getSourceLocation(cur);
      if (loc) {
        const ref = `${loc.fileName}:${loc.line}:${loc.column}`;
        if (ref === selectedRef) {
          dragEl = cur;
          dragSrc = loc;
          break;
        }
      }
      cur = cur.parentElement;
    }
  }

  _dragSourceId = `${dragSrc.fileName}:${dragSrc.line}:${dragSrc.column}`;
  _dragSourceFilePath = dragSrc.fileName;
  _dragStartX = e.clientX;
  _dragStartY = e.clientY;
  _dragState = 'pending';
  _dragSourceEl = dragEl;
}

function _dragPointerMove(e: PointerEvent): void {
  if (_dragState === 'pending') {
    const dx = e.clientX - _dragStartX;
    const dy = e.clientY - _dragStartY;
    if (Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD_PX) {
      _dragState = 'dragging';
      if (_dragSourceEl) {
        _dragOrigStyleAttr = _dragSourceEl.getAttribute('style') ?? '';
        const s = _dragSourceEl.style;
        const computedBg = getComputedStyle(_dragSourceEl).backgroundColor;
        if (computedBg === 'rgba(0, 0, 0, 0)' || computedBg === 'transparent') {
          s.backgroundColor = _dragEffectiveBg(_dragSourceEl);
        }
        s.transition = 'box-shadow 0.12s ease';
        s.transform = 'scale(1.03)';
        s.boxShadow = '0 8px 32px rgba(0,0,0,0.22), 0 0 0 2px rgba(59,130,246,0.5)';
        s.opacity = '0.88';
        s.position = 'relative';
        s.zIndex = '2147483647';
        s.pointerEvents = 'none';
        const indicator = document.createElement('div');
        indicator.className = 'hyper-drop-indicator';
        indicator.style.display = 'none';
        document.body.appendChild(indicator);
        _dragIndicatorEl = indicator;

        // Multi-select badge: show count when multiple elements are selected
        if (state.selectedIds.length > 1) {
          const badge = document.createElement('div');
          badge.style.cssText =
            'position:absolute;top:-8px;right:-8px;background:#3b82f6;color:white;' +
            'border-radius:50%;width:20px;height:20px;display:flex;align-items:center;' +
            'justify-content:center;font-size:11px;font-weight:bold;pointer-events:none;' +
            'z-index:2147483647;';
          badge.textContent = String(state.selectedIds.length);
          _dragSourceEl.appendChild(badge);
          _dragBadgeEl = badge;
        }
      }
    }
    return;
  }

  if (_dragState !== 'dragging') return;

  const dx = e.clientX - _dragStartX;
  const dy = e.clientY - _dragStartY;
  if (_dragSourceEl) {
    _dragSourceEl.style.transform = `scale(1.03) translate(${dx}px, ${dy}px)`;
  }

  if (_dragIndicatorEl) {
    const dropEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const dropSrc = dropEl ? iframeResolver.getSourceLocation(dropEl) : null;
    if (dropSrc && dropEl && `${dropSrc.fileName}:${dropSrc.line}:${dropSrc.column}` !== _dragSourceId) {
      const r = dropEl.getBoundingClientRect();
      const ind = _dragIndicatorEl;
      if (_isHorizontalLayout(dropEl)) {
        ind.dataset.dir = 'v';
        const lineX = (e.clientX < r.left + r.width / 2 ? r.left : r.right) - 1;
        ind.style.left = `${lineX}px`;
        ind.style.top = `${r.top}px`;
        ind.style.height = `${r.height}px`;
        ind.style.width = '';
      } else {
        ind.dataset.dir = 'h';
        const lineY = (e.clientY < r.top + r.height / 2 ? r.top : r.bottom) - 1;
        ind.style.top = `${lineY}px`;
        ind.style.left = `${r.left}px`;
        ind.style.width = `${r.width}px`;
        ind.style.height = '';
      }
      ind.style.display = 'block';
    } else {
      _dragIndicatorEl.style.display = 'none';
    }
  }
}

function _dragPointerUp(e: PointerEvent): void {
  const wasDragging = _dragState === 'dragging';
  const sourceId = _dragSourceId;
  const sourceFilePath = _dragSourceFilePath;
  _dragState = 'idle';
  _dragSourceId = null;
  _dragSourceFilePath = null;

  if (_dragSourceEl) {
    _dragSourceEl.setAttribute('style', _dragOrigStyleAttr);
    _dragSourceEl = null;
  }
  _dragOrigStyleAttr = '';
  if (_dragBadgeEl) {
    _dragBadgeEl.remove();
    _dragBadgeEl = null;
  }
  if (_dragIndicatorEl) {
    _dragIndicatorEl.remove();
    _dragIndicatorEl = null;
  }

  if (!wasDragging || !sourceId || !sourceFilePath) return;

  const rawDropEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  if (!rawDropEl) return;
  // Resolve drop side similarly to drag side: if cursor is over a decorative
  // child (emoji span, aria-hidden) walk up to the nearest source-bearing
  // ancestor. Otherwise dropping on the emoji of another card returns null
  // and the reorder is silently swallowed.
  const dropResolved = _resolveSourceWithFallback(rawDropEl);
  if (!dropResolved) return;

  // Lift both source and drop target up to siblings of a common DOM ancestor.
  // This is essential because AstService.reorderElement requires source and
  // target to share a direct JSX parent — without lifting, a drop on Card B
  // while dragging an inner div inside Card A would fail with "Elements must
  // share a direct JSX parent". By promoting both to children of their nearest
  // common DOM ancestor (which usually maps to the JSX list container), the
  // reorder lands at the card-vs-card level the user actually expects.
  const dragEl = _dragSourceEl ?? rawDropEl;
  const lifted = liftToCommonSiblings(dragEl, dropResolved.el);
  const finalSourceEl = lifted.source ?? dragEl;
  const finalDropEl = lifted.drop ?? dropResolved.el;
  // Source location must be readable on the lifted element; fall back to the
  // pre-lift element if the parent layer has no own source.
  const finalSourceSrc =
    _resolveSourceWithFallback(finalSourceEl)?.source ?? _resolveSourceWithFallback(dragEl)?.source;
  const finalDropSrc = _resolveSourceWithFallback(finalDropEl)?.source ?? dropResolved.source;
  if (!finalSourceSrc || !finalDropSrc) return;
  const finalSourceId = `${finalSourceSrc.fileName}:${finalSourceSrc.line}:${finalSourceSrc.column}`;
  const targetId = `${finalDropSrc.fileName}:${finalDropSrc.line}:${finalDropSrc.column}`;
  if (targetId === finalSourceId) return;

  const rect = finalDropEl.getBoundingClientRect();
  const position: 'before' | 'after' = _isHorizontalLayout(finalDropEl)
    ? e.clientX < rect.left + rect.width / 2
      ? 'before'
      : 'after'
    : e.clientY < rect.top + rect.height / 2
      ? 'before'
      : 'after';

  _dragSuppressNextClick = true;
  // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
  window.parent.postMessage(
    {
      type: 'hypercanvas:reorderElement',
      sourceId: finalSourceId,
      targetId,
      filePath: finalSourceSrc.fileName,
      position,
    },
    '*',
  );
}

// Drop-target lift logic lives in shared/canvas-interaction/drop-target-lift.ts
// and is unit-tested separately. Re-imported below at the top of this module.

/**
 * Resolve source location for a DOM element. Falls back to the nearest
 * source-bearing ancestor when the element itself is decorative (e.g. an
 * aria-hidden emoji span). Returns the element used as the resolution anchor
 * along with its source location.
 */
function _resolveSourceWithFallback(
  el: HTMLElement,
): { el: HTMLElement; source: { fileName: string; line: number; column: number } } | null {
  const direct = iframeResolver.getSourceLocation(el);
  if (direct) return { el, source: direct };
  const bodyEl = typeof document !== 'undefined' ? document.body : null;
  let cur: HTMLElement | null = el.parentElement;
  while (cur && cur !== bodyEl) {
    const s = iframeResolver.getSourceLocation(cur);
    if (s) return { el: cur, source: s };
    cur = cur.parentElement;
  }
  return null;
}

function _dragClickSuppressor(e: MouseEvent): void {
  if (!_dragSuppressNextClick) return;
  _dragSuppressNextClick = false;
  // stopImmediatePropagation prevents same-node listeners registered after this one
  // (e.g. attachClickHandler's handleClick) from firing.
  e.stopImmediatePropagation();
  e.preventDefault();
}

document.addEventListener('pointerdown', _dragPointerDown, true);
document.addEventListener('pointermove', _dragPointerMove, true);
document.addEventListener('pointerup', _dragPointerUp, true);

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
    ...(r.elementId && { elementId: r.elementId }),
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    type: r.type,
    ...(r.resizable && { resizable: r.resizable }),
  }));

  const { placeholderRects } = result;

  const payload = JSON.stringify({ rects, placeholderRects });
  if (payload !== prevRectsJSON) {
    prevRectsJSON = payload;
    // Include window.scrollY so the webview can use it as the baseline for scroll
    // compensation — see hypercanvas:overlayScroll handling in useCanvasInteraction.ts.
    // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage(
      { type: 'hypercanvas:overlayRects', rects, placeholderRects, scrollY: window.scrollY },
      '*',
    );
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

// Scroll must update overlays on every frame — skip the throttle to avoid 50 ms lag.
// Additionally, post an immediate overlayScroll message so the webview can apply a
// CSS transform compensation before the RAF-computed rects arrive (~1 frame later).
// Always use window.scrollY — both here and in sendOverlayRects (baseline) — so the
// two values are in the same coordinate space and compensation arithmetic is exact.
// Nested-container scrollTop lives in a different space and must not be mixed in.
const overlayScrollHandler = () => {
  // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
  window.parent.postMessage({ type: 'hypercanvas:overlayScroll', scrollY: window.scrollY }, '*');
  needsOverlayUpdate = true;
  scheduleOverlayLoopIfNeeded();
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
  document.removeEventListener('pointerdown', _dragPointerDown, true);
  document.removeEventListener('pointermove', _dragPointerMove, true);
  document.removeEventListener('pointerup', _dragPointerUp, true);
  document.removeEventListener('click', _dragClickSuppressor, true);
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
    document.documentElement.classList.add('design-mode');
  } else {
    document.documentElement.classList.remove('design-mode');
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

  // Go to Visual: select element, scroll, and send computed style snapshot
  if (msg.type === 'hypercanvas:goToVisual') {
    state.selectedIds = [msg.elementId];
    state.selectedItemIndices = {};
    const el = findElementsByRef(msg.elementId, 0)[0];
    if (el) {
      scrollIntoViewCenterSmooth(el);
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:computedStyleResult',
          elementId: msg.elementId,
          itemIndex: null,
          computedStyle: extractComputedStyle(el),
          computedStyleSeq: ++elementClickSeq,
        },
        '*',
      );
    }
    needsOverlayUpdate = true;
    scheduleOverlayLoopIfNeeded();
    return;
  }

  // Computed style request — for keyboard navigation and non-click selections
  if (msg.type === 'hypercanvas:requestComputedStyle') {
    const elementId = msg.elementId as string;
    const itemIndex = (msg.itemIndex as number | null | undefined) ?? null;
    const el = findElementsByRef(elementId, itemIndex)[0] ?? null;
    if (el) {
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:computedStyleResult',
          elementId,
          itemIndex,
          computedStyle: extractComputedStyle(el),
          computedStyleSeq: ++elementClickSeq,
        },
        '*',
      );
    }
    return;
  }

  // Scroll to element without changing selection (tree row click → canvas scroll)
  if (msg.type === 'hypercanvas:scrollToElement') {
    const el = findElementsByRef(msg.elementId, 0)[0];
    if (el) scrollIntoViewCenterSmooth(el);
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

  // Live resize preview — apply inline size to element so user sees instant feedback
  if (msg.type === 'hypercanvas:previewResize') {
    const id = msg.elementId as string;
    const el = findElementsByRef(id, 0)[0] ?? null;
    if (el) {
      if (!_previewResizeOrig.has(id)) {
        _previewResizeOrig.set(id, { width: el.style.width, height: el.style.height });
      }
      if (typeof msg.width === 'number') el.style.width = `${msg.width}px`;
      if (typeof msg.height === 'number') el.style.height = `${msg.height}px`;
    }
    return;
  }

  // Restore inline size on cancel (no AST write)
  if (msg.type === 'hypercanvas:clearPreviewResize') {
    const id = msg.elementId as string;
    const el = findElementsByRef(id, 0)[0] ?? null;
    const orig = _previewResizeOrig.get(id);
    if (el && orig) {
      el.style.width = orig.width;
      el.style.height = orig.height;
    }
    _previewResizeOrig.delete(id);
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
