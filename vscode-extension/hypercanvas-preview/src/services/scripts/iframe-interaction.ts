/**
 * Iframe interaction script — injected into user's preview iframe by PreviewProxy.
 *
 * Built as IIFE by esbuild, runs inside the preview iframe (not the VS Code webview).
 * Handles click/hover/context menu, keyboard shortcuts, overlay rects, design CSS.
 * Communicates with parent webview via postMessage.
 */

import { attachClickHandler } from '@shared/canvas-interaction/click-handler';
import { resolveDragSource } from '@shared/canvas-interaction/drag-source-resolver';
import { isHorizontalLayout as _isHorizontalLayoutShared } from '@shared/canvas-interaction/drop-indicator-orientation';
import { isContainerEmpty } from '@shared/canvas-interaction/empty-container-placeholders';
import {
  findTraceableParent as findTraceableParentIndexAware,
  type TraceableParentStep,
} from '@shared/canvas-interaction/find-traceable-parent';
import { createDesignKeydownHandler } from '@shared/canvas-interaction/keyboard-handler';
import {
  computeOrderWritePlan,
  type OrderWritePlan,
  type SiblingInfo,
} from '@shared/canvas-interaction/order-drag-detect';
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
import {
  applySelectionGraceCache,
  hydrateSelectionGraceCache,
  invalidateSelectionGraceCacheForFile,
  makeSelectionGraceCacheState,
  serializeSelectionGraceCache,
} from './selection-grace-cache';

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

// Hook into Vite HMR so the source-cache rebuild and source-map warm cycle fire
// against the freshly-applied module BEFORE the next overlay paint queries it.
// Without this, the cache is invalidated only when React commits — which can lag
// behind the Vite swap by a frame or two and produces the visible 500ms gap users
// reported when changing i18n keys (HYP — selection-survive-text-change Task 3).
//
// vite:beforeUpdate fires while the old module is still mounted; do not invalidate
// here, just remember to refresh maps. vite:afterUpdate fires once HMR finishes
// applying the new module, which is when the new fibers exist — invalidate then.
type ViteHmrApi = {
  on(event: 'vite:beforeUpdate' | 'vite:afterUpdate', cb: () => void): void;
};
type WindowWithHmr = typeof window & { __vite_hot__?: ViteHmrApi };
function tryRegisterViteHmrHooks(): boolean {
  const api = (window as WindowWithHmr).__vite_hot__;
  if (!api || typeof api.on !== 'function') return false;
  api.on('vite:afterUpdate', () => {
    invalidateSourceCache();
    void warmClientSourceMaps();
    requestServerSourceMaps();
    needsOverlayUpdate = true;
    scheduleOverlayLoopIfNeeded();
  });
  return true;
}
// __vite_hot__ may not exist yet during the first frames after iframe load — Vite
// installs it asynchronously when the runtime client boots. Poll briefly until it
// shows up; give up after 5s rather than leaking a forever-running interval.
if (!tryRegisterViteHmrHooks()) {
  const HMR_HOOK_POLL_MS = 100;
  const HMR_HOOK_TIMEOUT_MS = 5000;
  const start = performance.now();
  const intervalId = setInterval(() => {
    if (tryRegisterViteHmrHooks() || performance.now() - start > HMR_HOOK_TIMEOUT_MS) {
      clearInterval(intervalId);
    }
  }, HMR_HOOK_POLL_MS);
}

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
  let matchIsExact = live.length > 0;
  if (live.length === 0) {
    // Same fileName + line, column drift only — same JSX site, itemIndex still meaningful.
    live = getSourceIndex().findClosestLineDOMElements(source);
    if (live.length > 0) matchIsExact = true;
  }

  // Last-resort fallback: same fileName, closest source by (line, column) within a bounded
  // line distance. After HMR the requested line/column may shift slightly (e.g. the user
  // edited an i18n key; surrounding lines re-numbered) before the parent rebroadcasts the
  // new selectedId. Picking the closest entry keeps the overlay anchored across the gap;
  // the bound prevents a heavy refactor from re-anchoring the selection 200 lines away.
  //
  // Path-format-relaxed matching also covers tree-driven selection that dispatches an
  // absolute path ("/workspace/src/Foo.tsx" or Windows "C:\\workspace\\src\\Foo.tsx")
  // while FiberSourceIndex stores Vite-relative paths ("src/Foo.tsx"). The relaxed
  // mode is a strict superset of exact-path matching (pathsMatchAcrossFormats(x, x) is
  // always true), so a single call covers both HMR line-shift and cross-format cases.
  if (live.length === 0 && source.fileName) {
    const closest = getSourceIndex().findClosestSourceDOMElements(source, { matchPathAcrossFormats: true });
    if (closest !== null && closest.elements.length > 0) {
      live = closest.elements;
      const matched = closest.matchedSource;
      const matchedKey = `${matched.fileName}:${matched.line}:${matched.column}`;
      const exactPath = matched.fileName === source.fileName;
      logSelsurvClosestSourceFallback(exactPath ? nodeRef : `${nodeRef}#xfmt`, matchedKey, live.length);
      // Treat as exact when (line, column) match precisely — only the path format
      // differs (POSIX vs Windows, abs vs Vite-relative). Same JSX site, so itemIndex
      // slicing is still meaningful. Otherwise matchIsExact stays false: a different
      // (line, column) means a different JSX call site whose `.map()` cardinality may
      // differ, and applying the original itemIndex could target a sibling row.
      if (closest.lineDistance === 0 && closest.columnDistance === 0) {
        matchIsExact = true;
      }
    }
  }

  if (itemIndex !== null) {
    // For an inexact match (different (line, column) — possibly a sibling JSX site),
    // the matched element's `.map()` cardinality may differ. Slicing by itemIndex
    // could point at the wrong row, so we let the grace cache replay the prior rect
    // instead of guessing.
    if (!matchIsExact) return [];
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

// === Selection-survive diagnostics (Task 2 of selection-survive-text-change plan) ===
// Tag: [selsurv]. Goal: pinpoint whether the 500ms gap user reports is
// (a) selectedIds[0] reset to empty/different value, or
// (b) DOM lookup miss for an unchanged ID (cache wiped by HMR).
// Filter logs in DevTools console with `[selsurv]`.
const SELSURV_TAG = '[selsurv]';
function logSelsurvSelectedIdsAssign(reason: string, prev: string[], next: string[]): void {
  if (prev.length === next.length && prev.every((v, i) => v === next[i])) return;
  // biome-ignore lint/suspicious/noConsole: diagnostic logging gated by tag, see Task 2
  console.debug(SELSURV_TAG, 'selectedIds change', {
    t: Math.round(performance.now()),
    reason,
    prev,
    next,
  });
}
let lastOverlayLogKey = '';
function logSelsurvOverlayPaint(selectedId: string | null, domElementFound: boolean, rectVisible: boolean): void {
  // Coalesce identical consecutive paints so the console isn't flooded.
  const key = `${selectedId ?? ''}|${domElementFound}|${rectVisible}`;
  if (key === lastOverlayLogKey) return;
  lastOverlayLogKey = key;
  // biome-ignore lint/suspicious/noConsole: diagnostic logging gated by tag, see Task 2
  console.debug(SELSURV_TAG, 'overlay paint', {
    t: Math.round(performance.now()),
    selectedId,
    domElementFound,
    rectVisible,
  });
}
// Task 1 of selection-flicker-some-elements: surface grace-cache pruning so we
// can tell whether the overlay disappears because the deadline expired (HMR
// took longer than SELECTION_GRACE_PERIOD_MS) or because selectedIds dropped
// the entry.
function logSelsurvCachePrune(elementId: string, reason: 'deselected' | 'expired'): void {
  console.debug(SELSURV_TAG, 'grace-cache prune', {
    t: Math.round(performance.now()),
    elementId,
    reason,
  });
}
// Task 1: log HMR-related lifecycle events (Vite + full-document reload) so the
// timeline can be aligned with selection-loss moments. Vite client emits these
// events on the Window via a custom EventEmitter; we additionally listen to
// `beforeunload`/`load` to detect a true full reload (hypothesis B).
function logSelsurvLifecycle(event: string, extra?: Record<string, unknown>): void {
  console.debug(SELSURV_TAG, 'lifecycle', {
    t: Math.round(performance.now()),
    event,
    readyState: typeof document !== 'undefined' ? document.readyState : 'n/a',
    ...(extra ?? {}),
  });
}
let lastFindMissLogKey = '';
function logSelsurvFindMiss(selectedId: string, itemIndex: number | null): void {
  const key = `${selectedId}|${itemIndex ?? ''}`;
  if (key === lastFindMissLogKey) return;
  lastFindMissLogKey = key;
  console.debug(SELSURV_TAG, 'findElements miss', {
    t: Math.round(performance.now()),
    selectedId,
    itemIndex,
  });
}
let lastClosestSourceLogKey = '';
function logSelsurvClosestSourceFallback(requestedRef: string, matchedKey: string, count: number): void {
  const key = `${requestedRef}->${matchedKey}|${count}`;
  if (key === lastClosestSourceLogKey) return;
  lastClosestSourceLogKey = key;
  console.debug(SELSURV_TAG, 'closest-source fallback', {
    t: Math.round(performance.now()),
    requested: requestedRef,
    matched: matchedKey,
    count,
  });
}
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
        logSelsurvSelectedIdsAssign('click:additive', state.selectedIds, nextIds);
        state.selectedIds = nextIds;
        state.selectedItemIndices = nextIndices;
      } else {
        // Optimistic local update so keyboard shortcuts (Cmd+D, Delete) work immediately
        // without waiting for the state round-trip: iframe → extension host → StateHub → iframe.
        // When nodeRef is null (server round-trip pending), synthesize a ref from source so
        // state.selectedIds is populated — matches sourceToElementId() in the extension host.
        const effectiveRef = source ? computeEffectiveRef(nodeRef, source) : nodeRef;
        if (effectiveRef) {
          logSelsurvSelectedIdsAssign('click:single', state.selectedIds, [effectiveRef]);
          state.selectedIds = [effectiveRef];
          if (itemIndex != null) state.selectedItemIndices = { [effectiveRef]: itemIndex };
          // Drag-end regression fix (docs/plans/2026-05-08-drag-selection-rect-regressions-ralphex-plan.md):
          // Mark the overlay loop dirty NOW so a fresh paint runs against the
          // optimistic selection without waiting for the parent stateUpdate
          // round-trip. Symptom (1) repro: after a drag the RAF loop bailed
          // (needsOverlayUpdate=false; computedRects last paint was empty due
          // to grace-cache invalidation), and an HMR-stalled round-trip kept
          // it dormant — the user's post-drag click set selectedIds locally
          // but no paint ever ran, so the rect never appeared. Dirtying here
          // is safe: the round-trip stateUpdate later re-dirties the loop
          // anyway, and a same-frame double paint dedupes via prevRectsJSON.
          needsOverlayUpdate = true;
          scheduleOverlayLoopIfNeeded();
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

// Diagnostic tag for Shift+Enter / parent-walk regression (Task 2 of
// docs/plans/2026-05-08-shift-enter-rect-ralphex-plan.md). Filter DevTools
// console with `[shiftparent]`. Goal: capture for each parent-walk
//   1. the selectedId Shift+Enter started from,
//   2. each DOM ancestor walked + its getSourceKey result,
//   3. the chosen parentRef,
//   4. whether findElementsByRef(parentRef) immediately finds a DOM element.
// Combined with the existing [selsurv] `findElements miss` log on the overlay
// path, this pinpoints whether the rect vanishes because (a) parentRef itself
// is malformed/missing, (b) parentRef is well-formed but FiberSourceIndex was
// indexed under a deduplicated key, or (c) the OUTERMOST host fiber whose key
// equals parentRef has been unmounted by HMR mid-walk.
const SHIFTPARENT_TAG = '[shiftparent]';
function logShiftParentWalk(
  selectedId: string,
  steps: TraceableParentStep[],
  parent: { tag: string; ref: string } | null,
  parentLookupStatus: 'indexed' | null,
): void {
  console.debug(SHIFTPARENT_TAG, 'parent-walk', {
    t: Math.round(performance.now()),
    selectedId,
    renderedComponentPath,
    steps,
    parentRef: parent?.ref ?? null,
    parentTag: parent?.tag ?? null,
    parentLookupStatus,
  });
}

/**
 * Find the nearest ancestor DOM element with a traceable fiber source whose
 * key resolves back to itself in the FiberSourceIndex.
 *
 * Index-aware to keep the inspector path and rect-overlay path in sync after
 * Shift+Enter parent navigation (regression fix from
 * docs/plans/2026-05-08-shift-enter-rect-ralphex-plan.md, Task 3).
 *
 * Calls `findElementsByRef(ref, null)` (full set, not itemIndex 0) so that
 * walked-up `.map()`-row siblings register as members of the indexed entry.
 */
function findTraceableParent(
  el: HTMLElement,
  trace?: TraceableParentStep[],
): { element: HTMLElement; ref: string } | null {
  return findTraceableParentIndexAware(
    el,
    {
      getSourceKey,
      findElementsByRef: (ref) => findElementsByRef(ref, null),
      stopAt: document.body,
    },
    trace,
  );
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

    // Use findElementsByRef so the cross-format closest-source fallback applies.
    // Without this, tree-clicked elements (absolute path nodeRef, possibly Windows
    // backslashes) fail the exact and closest-line lookups (both compare fileName),
    // so getEntry returns null and Shift+Enter clears selection instead of
    // navigating to parent.
    //
    // Start the walk-up from the user's actually-selected instance, not always
    // from instance 0. The win this buys is correctness of ref *derivation* in
    // dedup/HMR-mid-walk cases (covered by `find-traceable-parent.test.ts` —
    // sibling-outer skip and unmounted-outer skip): starting from the wrong
    // base element lets the walk pick an ancestor whose `getSourceKey` hashes
    // to a deduped sibling host, so the returned `parentRef` no longer
    // resolves back to anything in the index → rect overlay vanishes. By
    // starting from row N's element, the predicate
    // `findElementsByRef(ref).includes(parent)` evaluates against the right
    // chain.
    //
    // Known pre-existing limitation (NOT introduced or resolved by this fix):
    // when the parent itself is a repeated-instance host (e.g. bulka's
    // `Section` wrapper `<div>` rendered once per Section invocation), all
    // instances share the SAME source ref. The walk now correctly identifies
    // row N's parent DOM element internally, but `onSelectElement(parentRef)`
    // (keyboard-handler.ts:181) emits id-only with `itemIndex: null` and
    // `useCanvasInteraction.ts:211` only updates `selectedItemIndices` when
    // `msg.itemIndex` is non-null. Result: `overlay-rects.ts:113` calls
    // `findElements(parentRef, null)` and highlights every parent instance.
    // Fixing the visible rect-pinning requires plumbing parent itemIndex
    // through the keyboard-handler callback API + SaaS engine.select; that
    // refactor is out of the plan's scope (docs/plans/
    // 2026-05-08-shift-enter-rect-ralphex-plan.md → "Out of scope:
    // Refactoring the keyboard shortcut state machine").
    //
    // Falls back to `0` when no entry exists for nodeRef (chained navigation
    // after a Shift+Enter selects a parent and selectedItemIndices wasn't
    // patched for the new id — see useCanvasInteraction.ts:211 contract).
    const startIdx = state.selectedItemIndices[nodeRef] ?? 0;
    const el = findElementsByRef(nodeRef, startIdx)[0] ?? findElementsByRef(nodeRef, 0)[0];
    if (!el) {
      // Diagnostic: parent-walk asked about a nodeRef the rect path also can't
      // resolve. Emitting from the keyboard-side too lets us cross-reference
      // against the [selsurv] `findElements miss` log timestamp.
      console.debug(SHIFTPARENT_TAG, 'getEntry missing-base', {
        t: Math.round(performance.now()),
        nodeRef,
        renderedComponentPath,
      });
      return null;
    }

    const trace: TraceableParentStep[] = [];
    const parent = findTraceableParent(el, trace);
    // The walk-up's index-aware predicate (`findElementsByRef(ref).includes(parent)`)
    // already proved the parent is in the indexed set, so when `parent !== null`
    // we know hits >= 1. We don't recall `findElementsByRef` here just for the
    // diagnostic — that doubled the per-keypress cost without adding signal.
    // Distinguish only the resolvable-vs-unresolvable case in the log.
    logShiftParentWalk(
      nodeRef,
      trace,
      parent ? { tag: parent.element.tagName.toLowerCase(), ref: parent.ref } : null,
      parent ? 'indexed' : null,
    );
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
    selectedItemIndices: state.selectedItemIndices,
  }),
  getDocument: () => document,
  callbacks: {
    onSelectElement: (id, itemIndex) =>
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:elementClick',
          elementId: id,
          itemIndex: itemIndex ?? null,
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

// === Element drag/move state machine ===
// Tracks pointerdown → threshold → drag → drop to post hypercanvas:moveElement.
// AstService.moveElement handles same-file, cross-file, cross-parent, and
// cross-component moves — no JSX-parent constraint, so the iframe sends raw
// source/target NodeRefs without lifting to a common DOM ancestor.
// Suppresses the click event that fires after pointerup to prevent accidental deselect.
const DRAG_THRESHOLD_PX = 5;

// Delegates to the shared `isHorizontalLayout` (drop-indicator-orientation.ts),
// which walks past wrapper divs and treats `grid-cols-N` (multi-track,
// default `grid-auto-flow: row`) as a horizontal layout. The old inline
// version checked only `dropEl.parentElement` and required
// `gridAutoFlow.includes('column')` — that broke Tailwind grids and any
// drop element wrapped in a transparent block container.
function _isHorizontalLayout(el: HTMLElement): boolean {
  return _isHorizontalLayoutShared(el);
}

let _dragState: 'idle' | 'pending' | 'dragging' = 'idle';
let _dragSourceId: string | null = null;
let _dragSourceFilePath: string | null = null;
let _dragStartX = 0;
let _dragStartY = 0;
let _dragSuppressNextClick = false;
let _dragSourceEl: HTMLElement | null = null;
let _dragGhostEl: HTMLElement | null = null;
let _dragIndicatorEl: HTMLElement | null = null;
let _dragBadgeEl: HTMLElement | null = null;
let _dragOffsetX = 0;
let _dragOffsetY = 0;
// Pointer/selection guard state: when pending drag begins on a text container
// (<p>, <h3>, <span> with text), native text-selection grabs the pointer and
// pointermove never crosses DRAG_THRESHOLD_PX. We capture the pointer and
// disable user-select on body for the duration of the drag, restoring on up.
let _dragCapturedPointerId: number | null = null;
let _dragCapturedTarget: HTMLElement | null = null;
// `null` sentinel = "nothing saved, do not restore". Without it, _dragCleanup
// running twice (pointerup then lostpointercapture, or compat-fired pointercancel
// alongside pointerup) writes the empty string to body styles on the second
// pass, clobbering whatever the host app set inline (e.g. modals that disable
// selection while open).
let _dragPrevBodyUserSelect: string | null = null;
let _dragPrevBodyWebkitUserSelect: string | null = null;

function _dragPointerDown(e: PointerEvent): void {
  if (state.engineMode !== 'design' || e.button !== 0) return;
  // Reentry guard: a second pointerdown without an intervening pointerup
  // (multi-touch, missed pointercancel, etc) would otherwise overwrite
  // _dragPrevBodyUserSelect with 'none' and leak user-select forever.
  if (_dragState !== 'idle') return;
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

  // Suppress native text-selection that otherwise consumes pointermove on
  // <p>/<h3>/<span> with text. Without this, the user's drag never crosses
  // DRAG_THRESHOLD_PX because the browser is busy extending a text range
  // instead of dispatching pointermove events with non-trivial deltas.
  // preventDefault on pointerdown stops the compat-fired mousedown's default
  // (selection start) in modern browsers; user-select:none on body blocks
  // selection for the rest of the drag regardless.
  e.preventDefault();
  _dragPrevBodyUserSelect = document.body.style.userSelect;
  _dragPrevBodyWebkitUserSelect =
    (document.body.style as unknown as { webkitUserSelect?: string }).webkitUserSelect ?? '';
  document.body.style.userSelect = 'none';
  (document.body.style as unknown as { webkitUserSelect?: string }).webkitUserSelect = 'none';

  // Capture the pointer on the resolved dragEl (not the raw event target) so
  // capture survives when the user grabs a decorative inner element (emoji
  // span, aria-hidden wrapper) that may re-render mid-drag. dragEl is held
  // alive by `_dragSourceEl` and is the element receiving the opacity/pointer-
  // events styling during drag, so it's the stable choice.
  // Track the pointer id regardless of capture success so the multi-touch
  // guards in _dragPointerMove / _dragPointerUp still reject hijacks from a
  // second pointer when setPointerCapture happens to throw (e.g. target
  // detached mid-render). _dragCapturedTarget is only set on success so the
  // cleanup path doesn't call releasePointerCapture on a target that never
  // captured.
  _dragCapturedPointerId = e.pointerId;
  if (typeof dragEl.setPointerCapture === 'function') {
    try {
      dragEl.setPointerCapture(e.pointerId);
      _dragCapturedTarget = dragEl;
    } catch {
      // setPointerCapture can throw if the target was detached; ignore.
    }
  }
}

function _dragPointerMove(e: PointerEvent): void {
  // Multi-touch guard: once we've captured a pointer, ignore moves from any
  // other pointerId. Without this, a second finger / pen lifts the touch off
  // the first one's start coords, dx/dy explode past DRAG_THRESHOLD_PX, and
  // the ghost jumps to (and follows) the wrong cursor.
  if (_dragCapturedPointerId !== null && e.pointerId !== _dragCapturedPointerId) return;
  if (_dragState === 'pending') {
    const dx = e.clientX - _dragStartX;
    const dy = e.clientY - _dragStartY;
    if (Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD_PX) {
      _dragState = 'dragging';
      if (_dragSourceEl) {
        const rect = _dragSourceEl.getBoundingClientRect();
        _dragOffsetX = _dragStartX - rect.left;
        _dragOffsetY = _dragStartY - rect.top;

        // Fade the source element in place — shows "where it came from"
        _dragSourceEl.style.opacity = '0.35';
        _dragSourceEl.style.pointerEvents = 'none';

        // Create ghost clone that follows the cursor
        const ghost = _dragSourceEl.cloneNode(true) as HTMLElement;
        ghost.className = 'hyper-drag-ghost';
        ghost.removeAttribute('data-uniq-id');
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        ghost.style.left = `${_dragStartX - _dragOffsetX}px`;
        ghost.style.top = `${_dragStartY - _dragOffsetY}px`;
        document.body.appendChild(ghost);
        _dragGhostEl = ghost;

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

  if (_dragGhostEl) {
    _dragGhostEl.style.left = `${e.clientX - _dragOffsetX}px`;
    _dragGhostEl.style.top = `${e.clientY - _dragOffsetY}px`;
  }

  if (_dragIndicatorEl) {
    const rawDropEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    // Mirror the walk-up that `_dragPointerUp` does: when the cursor is over
    // a decorative inner element (emoji span, aria-hidden wrapper) without
    // its own source, climb to the source-bearing ancestor so the indicator
    // shows the same target the drop will resolve to. Without this, the
    // indicator hides over emoji/decorative children but the drop still
    // lands on an ancestor — UX says "you can't drop" while the file mutates.
    let dropEl: HTMLElement | null = rawDropEl;
    let dropSrc = dropEl ? iframeResolver.getSourceLocation(dropEl) : null;
    if (!dropSrc && rawDropEl) {
      const bodyEl = typeof document !== 'undefined' ? document.body : null;
      let cur = rawDropEl.parentElement;
      while (cur && cur !== bodyEl) {
        const ancestorSrc = iframeResolver.getSourceLocation(cur);
        if (ancestorSrc) {
          dropSrc = ancestorSrc;
          dropEl = cur;
          break;
        }
        cur = cur.parentElement;
      }
    }
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

// Runs the DOM/state cleanup for any drag-end path: pointerup, pointercancel,
// lostpointercapture. Restores userSelect, releases pointer capture, removes
// ghost/indicator/badge, clears source-el styles. Idempotent — safe to call
// multiple times in a row (every branch nulls its target ref).
function _dragCleanup(): void {
  _dragState = 'idle';
  _dragSourceId = null;
  _dragSourceFilePath = null;

  if (_dragGhostEl) {
    _dragGhostEl.remove();
    _dragGhostEl = null;
  }
  if (_dragBadgeEl) {
    _dragBadgeEl.remove();
    _dragBadgeEl = null;
  }
  if (_dragIndicatorEl) {
    _dragIndicatorEl.remove();
    _dragIndicatorEl = null;
  }
  if (_dragSourceEl) {
    _dragSourceEl.style.opacity = '';
    _dragSourceEl.style.pointerEvents = '';
    _dragSourceEl = null;
  }
  _dragOffsetX = 0;
  _dragOffsetY = 0;

  // Only restore when we actually saved values on a matching pointerdown.
  // After restoration both sentinels go back to `null` so a second cleanup
  // pass (pointerup → lostpointercapture chain) leaves host-set inline
  // styles alone.
  if (_dragPrevBodyUserSelect !== null) {
    document.body.style.userSelect = _dragPrevBodyUserSelect;
    _dragPrevBodyUserSelect = null;
  }
  if (_dragPrevBodyWebkitUserSelect !== null) {
    (document.body.style as unknown as { webkitUserSelect?: string }).webkitUserSelect = _dragPrevBodyWebkitUserSelect;
    _dragPrevBodyWebkitUserSelect = null;
  }
  if (
    _dragCapturedTarget &&
    _dragCapturedPointerId !== null &&
    typeof _dragCapturedTarget.releasePointerCapture === 'function'
  ) {
    try {
      _dragCapturedTarget.releasePointerCapture(_dragCapturedPointerId);
    } catch {
      // Capture may have been lost already; ignore.
    }
  }
  _dragCapturedPointerId = null;
  _dragCapturedTarget = null;
}

function _dragPointerUp(e: PointerEvent): void {
  // Multi-touch guard: only the captured pointer's release ends the drag.
  // A different pointerId lifting first must not consume the captured drag.
  if (_dragCapturedPointerId !== null && e.pointerId !== _dragCapturedPointerId) return;
  const wasDragging = _dragState === 'dragging';
  const sourceId = _dragSourceId;
  const sourceFilePath = _dragSourceFilePath;
  // Capture the live source element BEFORE cleanup nulls it out — the
  // order-driven branch below needs it to walk up to the common parent and
  // collect sibling DOM/className data. The AST-move branch never used it.
  const sourceEl = _dragSourceEl;

  _dragCleanup();

  if (!wasDragging || !sourceId || !sourceFilePath) return;

  // Suppress the synthetic click that browsers fire after pointerup. The user
  // committed a drag (ghost rendered, threshold crossed) regardless of whether
  // the drop ultimately resolves to a valid target — without this, a drag that
  // ends over empty space / the same source / a non-source-bearing element
  // produces a click that re-selects whatever lands under the cursor.
  // Failsafe: when threshold is crossed, browsers typically do NOT fire a
  // compat click, and a pointerup outside the iframe never produces a click
  // at all. Without this timeout the flag would leak and suppress an
  // unrelated legitimate click made later. Synthetic click (if any) fires
  // synchronously before this macrotask, so suppression still works.
  _dragSuppressNextClick = true;
  setTimeout(() => {
    _dragSuppressNextClick = false;
  }, 0);

  const rawDropEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  if (!rawDropEl) return;

  // moveElement (Task 7+) accepts any source/target geometry — same parent,
  // different parent, different component, different file, leaf target. The
  // iframe no longer lifts to a common DOM ancestor: send the NodeRef of
  // whatever the user dropped on. The drop indicator only highlights
  // source-bearing elements, but `elementFromPoint` returns the literal
  // element under the cursor — which may be a decorative inner span (emoji,
  // aria-hidden wrapper) without a source of its own. Walk up the DOM until
  // we find a source-bearing ancestor so the drop matches what the indicator
  // showed (mirrors `resolveDragSource` on the drag-source side).
  let dropEl: HTMLElement | null = rawDropEl;
  let dropSrc = iframeResolver.getSourceLocation(dropEl);
  if (!dropSrc) {
    const bodyEl = typeof document !== 'undefined' ? document.body : null;
    let cur = rawDropEl.parentElement;
    while (cur && cur !== bodyEl) {
      const ancestorSrc = iframeResolver.getSourceLocation(cur);
      if (ancestorSrc) {
        dropSrc = ancestorSrc;
        dropEl = cur;
        break;
      }
      cur = cur.parentElement;
    }
  }
  if (!dropSrc || !dropEl) return;
  const targetId = `${dropSrc.fileName}:${dropSrc.line}:${dropSrc.column}`;
  if (targetId === sourceId) return;

  const rect = dropEl.getBoundingClientRect();
  const position: 'before' | 'after' = _isHorizontalLayout(dropEl)
    ? e.clientX < rect.left + rect.width / 2
      ? 'before'
      : 'after'
    : e.clientY < rect.top + rect.height / 2
      ? 'before'
      : 'after';

  // === Order-driven parent fast path (Tailwind `order-N`) ===
  // When the source and drop resolve to siblings under a parent that already
  // declares `order-*` siblings, mutate the order classes on the active
  // breakpoint instead of rewriting JSX. Falls through to the AST move on any
  // mismatch (cross-parent, no order classes, dynamic `className={cn(...)}`,
  // adapter not implemented). See plan 2026-05-08-tw-order-drag-ralphex-plan.md.
  if (sourceEl) {
    const orderPlan = _resolveOrderWritePlan(sourceEl, dropEl, e.clientX, e.clientY);
    if (orderPlan) {
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:writeOrders',
          breakpoint: orderPlan.breakpoint,
          entries: orderPlan.entries,
        },
        '*',
      );
      return;
    }
  }

  // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
  window.parent.postMessage(
    {
      type: 'hypercanvas:moveElement',
      sourceId,
      targetId,
      filePath: sourceFilePath,
      position,
    },
    '*',
  );

  // Drag-end regression fix (docs/plans/2026-05-08-drag-selection-rect-regressions-ralphex-plan.md):
  // The AST mutation about to land will renumber line/column for elements in
  // the source file. The grace cache (designed for i18n text changes where
  // line/col stay stable) would otherwise replay the previously-selected
  // element's OLD bbox for up to SELECTION_GRACE_PERIOD_MS — that is the
  // user-reported "stale rect lingers at old position" symptom (#2).
  //
  // Drop every cached rect for the mutated file *before* the next paint runs,
  // so the next miss returns no replay rather than the stale geometry. Also
  // invalidate target file for cross-file moves; here we only know the source
  // file from the iframe side, but the dropTargetEl's source location was
  // resolved into `dropSrc` above — drop its file too if different.
  invalidateSelectionGraceCacheForFile(selectionGraceCache, sourceFilePath);
  if (dropSrc.fileName && dropSrc.fileName !== sourceFilePath) {
    invalidateSelectionGraceCacheForFile(selectionGraceCache, dropSrc.fileName);
  }
  // Mark overlays dirty so the next RAF tick re-runs the lookup; without this
  // the loop may have just bailed (needsOverlayUpdate=false) and would not
  // rediscover the empty cache state until the next MutationObserver hit.
  needsOverlayUpdate = true;
  scheduleOverlayLoopIfNeeded();
}

/**
 * Walk both source and drop DOMs upward to find the lowest common ancestor where
 * source-branch and drop-branch are distinct direct children. Returns the parent
 * plus the two "sibling" elements at that level. `null` when no such ancestor
 * exists (e.g. one is contained in the other, or they share no ancestor before
 * `<body>`).
 *
 * The branches are NOT necessarily the same as the elements the user clicked /
 * dropped on — e.g. dropping inside a `<p>` nested under an order-driven `<div>`
 * surfaces the `<div>` as the drop branch, which is the level the order-N class
 * lives on.
 */
function _findReorderSiblings(
  sourceEl: HTMLElement,
  dropEl: HTMLElement,
): { parent: HTMLElement; sourceSibling: HTMLElement; dropSibling: HTMLElement } | null {
  if (sourceEl === dropEl) return null;
  // If one contains the other, there's no sibling-pair to reorder at any level.
  if (sourceEl.contains(dropEl) || dropEl.contains(sourceEl)) return null;

  let srcAncestor: HTMLElement | null = sourceEl;
  while (srcAncestor?.parentElement) {
    const parentEl: HTMLElement = srcAncestor.parentElement;
    let dropBranch: HTMLElement | null = dropEl;
    while (dropBranch && dropBranch.parentElement !== parentEl) {
      dropBranch = dropBranch.parentElement;
    }
    if (dropBranch && dropBranch !== srcAncestor) {
      return { parent: parentEl, sourceSibling: srcAncestor, dropSibling: dropBranch };
    }
    srcAncestor = parentEl;
  }
  return null;
}

/**
 * Build the order-write plan for a drag-drop, or return `null` to fall back to
 * the AST-move path. Pure DOM inspection — collects classNames + source refs for
 * the parent's children, asks `computeOrderWritePlan` (pure function) for the
 * concrete write entries.
 *
 * Position is re-derived here from the cursor coordinate against `dropSibling`
 * (the LCA-walked branch that actually owns the order-N class), NOT against the
 * raw `dropEl` the cursor landed on. When the cursor lifted on a deep inner
 * element (e.g. a `<button>` inside an outer order-driven `<Card>`), the inner
 * rect's halves don't reflect the user's intent w.r.t. the outer slot; using
 * the cursor coord against `dropSibling.getBoundingClientRect()` does. The
 * earlier iteration that re-derived from source-vs-drop centres (no cursor
 * involvement) is what the codex finding 2 was about — fixed there too.
 */
function _resolveOrderWritePlan(
  sourceEl: HTMLElement,
  dropEl: HTMLElement,
  clientX: number,
  clientY: number,
): OrderWritePlan | null {
  const lca = _findReorderSiblings(sourceEl, dropEl);
  if (!lca) return null;
  const { parent, sourceSibling, dropSibling } = lca;
  // dropSibling and dropEl may live in containers with different orientation
  // (an inner flex-row inside an outer grid). Re-evaluate against dropSibling.
  const dropSiblingRect = dropSibling.getBoundingClientRect();
  const position: 'before' | 'after' = _isHorizontalLayout(dropSibling)
    ? clientX < dropSiblingRect.left + dropSiblingRect.width / 2
      ? 'before'
      : 'after'
    : clientY < dropSiblingRect.top + dropSiblingRect.height / 2
      ? 'before'
      : 'after';

  // Collect source-bearing children only — skip whitespace text, comments, and
  // wrapper artefacts that have no React fiber / source location.
  // NB: read class via `getAttribute('class')` — `Element.className` is
  // `SVGAnimatedString` for SVG elements, not a string.
  const siblings: SiblingInfo[] = [];
  let domIndex = 0;
  for (const child of Array.from(parent.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const loc = iframeResolver.getSourceLocation(child);
    if (!loc) continue;
    siblings.push({
      elementId: `${loc.fileName}:${loc.line}:${loc.column}`,
      filePath: loc.fileName,
      className: child.getAttribute('class') ?? '',
      domIndex: domIndex++,
    });
  }

  // The LCA-walked source/drop branches may have different NodeRefs than the
  // raw source/target IDs the drag pipeline computed (e.g. `dropEl` was a `<p>`
  // inside an order-driven `<div>` — `dropSibling` is the wrapping `<div>`).
  // Pass through the *branch*-level NodeRefs so the plan keys correctly.
  const sourceLoc = iframeResolver.getSourceLocation(sourceSibling);
  const dropLoc = iframeResolver.getSourceLocation(dropSibling);
  if (!sourceLoc || !dropLoc) return null;
  const sourceBranchId = `${sourceLoc.fileName}:${sourceLoc.line}:${sourceLoc.column}`;
  const dropBranchId = `${dropLoc.fileName}:${dropLoc.line}:${dropLoc.column}`;
  // Sanity: the branch IDs must be in our siblings list. If not, source-bearing
  // walk picked a different element than the LCA branch did — fall back rather
  // than guess.
  if (!siblings.some((s) => s.elementId === sourceBranchId)) return null;
  if (!siblings.some((s) => s.elementId === dropBranchId)) return null;

  return computeOrderWritePlan({
    siblings,
    source: sourceBranchId,
    target: dropBranchId,
    position,
    viewportWidth: window.innerWidth,
  });
}

function _dragClickSuppressor(e: MouseEvent): void {
  if (!_dragSuppressNextClick) return;
  _dragSuppressNextClick = false;
  // stopImmediatePropagation prevents same-node listeners registered after this one
  // (e.g. attachClickHandler's handleClick) from firing.
  e.stopImmediatePropagation();
  e.preventDefault();
}

// Block native HTML5 drag-and-drop in design mode. Browsers default
// `<img>` and `<a>` to draggable=true; once Chromium establishes a native
// drag candidate at pointerdown, subsequent pointer events are consumed
// by the drag tracker before our document-capture listener sees them,
// so img-source drags silently fail (PI-5-DR-EK-IMG repro:
// 0 pointerdowns / 8 stale pointerups in run-20260507-130145).
//
// Two-layer fix: (1) CSS `-webkit-user-drag: none` in design mode (see
// style-injector.ts) prevents Chromium from establishing the drag
// candidate. (2) Walk every img/a/[draggable] node and explicitly set
// `draggable = false` — belt and braces for elements where the CSS
// property isn't enough (some Chromium versions still establish a drag
// candidate when `el.draggable === true`, regardless of CSS).
// (3) Keep the dragstart preventDefault as a final guard for any element
// that slipped past (1) and (2) — e.g. user code calling el.draggable=true
// after our walk.
const _nativeDragSuppressor = (e: DragEvent): void => {
  if (state.engineMode !== 'design') return;
  e.preventDefault();
};
document.addEventListener('dragstart', _nativeDragSuppressor, true);

function _disableNativeDraggableIn(root: ParentNode): void {
  // Disable native drag on every element that can default to draggable=true.
  // Includes elements with an explicit `draggable="true"` attribute set by
  // user code (e.g. custom drag-and-drop libraries) — they would otherwise
  // re-establish the drag candidate on pointerdown.
  const candidates = root.querySelectorAll('img, a, [draggable="true"], [draggable=""]');
  for (const el of candidates) {
    if (el instanceof HTMLElement) el.draggable = false;
  }
  // The root itself may match if it was just inserted as a single img/a node.
  if (root instanceof HTMLElement && (root.tagName === 'IMG' || root.tagName === 'A')) {
    root.draggable = false;
  }
}

document.addEventListener('pointerdown', _dragPointerDown, true);
document.addEventListener('pointermove', _dragPointerMove, true);
document.addEventListener('pointerup', _dragPointerUp, true);
// pointercancel fires on touch interruption, OS-level focus loss, browser
// gesture takeover. lostpointercapture fires when the captured pointer is
// hijacked. Without these, userSelect:'none' / opacity / capture leak forever
// and the iframe becomes unusable until reload. Gate by pointerId: these
// listeners are document-level capture-phase, so an unrelated widget in the
// rendered app losing its own pointer capture (different pointerId) would
// otherwise abort our active drag mid-gesture.
function _dragCleanupForPointerEvent(e: PointerEvent): void {
  if (_dragCapturedPointerId !== null && e.pointerId !== _dragCapturedPointerId) return;
  _dragCleanup();
}
document.addEventListener('pointercancel', _dragCleanupForPointerEvent, true);
document.addEventListener('lostpointercapture', _dragCleanupForPointerEvent, true);

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

// === Selection-survive grace cache (Task 3 of selection-survive-text-change) ===
// When the JSX text mutates via i18n key change, React commits a new fiber tree.
// Between the commit and the moment FiberSourceIndex is rebuilt against the new
// host fibers, findElements(selectedId) misses for one or more frames even though
// the source location (and therefore the element identity) has not changed.
// Without this cache, the overlay disappears for ~500ms — confirmed by user
// screenshot before this fix landed. Pure logic + tests live in selection-grace-cache.ts.
//
// Task 2 of selection-flicker-some-elements: TTL bumped from 800 → 2500 ms because
// HMR full-document reload (Vite emits `vite:beforeFullReload` rather than fast
// refresh) takes longer than 800 ms on heavier projects, and the cache must outlast
// the entire reload + bundle eval + first paint cycle. The cache is also persisted
// to sessionStorage so it survives the document teardown that wipes module state.
const SELECTION_GRACE_PERIOD_MS = 2500;
const SELECTION_GRACE_RETRY_MS = 50;
/** sessionStorage key under which the cache snapshot is persisted across reloads. */
const SELECTION_GRACE_PERSIST_KEY = '__hypercanvas_selsurv_grace_cache__';
/** Snapshots older than this are discarded (e.g. user closed and reopened the tab). */
const SELECTION_GRACE_PERSIST_MAX_AGE_MS = 10_000;
const selectionGraceCache = makeSelectionGraceCacheState();
let selectionGraceRetryTimeoutId: ReturnType<typeof setTimeout> | null = null;
/**
 * Element IDs hydrated from sessionStorage on iframe boot. Used as a stand-in for
 * `state.selectedIds` until the parent webview confirms the post-reload selection
 * via `hypercanvas:stateUpdate`. Without this stand-in the very first overlay
 * paint (which runs with `state.selectedIds=[]`) would prune the hydrated entries
 * as 'deselected', defeating the persistence.
 *
 * Cleared on the first `stateUpdate` carrying `selectedIds`.
 */
let pendingHydratedSelectedIds: string[] = [];
/**
 * `.map()` item indices restored from sessionStorage on iframe boot. Used as a
 * stand-in for `state.selectedItemIndices` until the parent rebroadcasts the
 * post-reload selection. Without this, the very first paint after a full reload
 * would call `findElements(id, null)` which returns ALL instances at that source
 * — briefly highlighting every `.map()` row instead of the one the user selected.
 */
let pendingHydratedItemIndices: Record<string, number | null> = {};

// Throttle for the per-paint persist call. Lifecycle hooks (beforeunload,
// vite:beforeFullReload) call persistSelectionGraceCache(true) to bypass the
// throttle for the actual teardown flush.
const SELECTION_GRACE_PERSIST_THROTTLE_MS = 250;
let lastPersistAtMs = 0;

function persistSelectionGraceCache(force = false): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    // Cache emptied (e.g. user deselected). Always wipe sessionStorage immediately —
    // never throttle this branch. Otherwise a fast reload within the throttle window
    // would hydrate stale rects and ghost the deselected element.
    // Do NOT touch lastPersistAtMs here: a wipe must not poison the throttle window
    // for a subsequent reselection write — that would drop the next selection across
    // a reload firing within 250 ms of the deselect.
    if (selectionGraceCache.rectsByElementId.size === 0) {
      sessionStorage.removeItem(SELECTION_GRACE_PERSIST_KEY);
      return;
    }
    // performance.now() is monotonic; Date.now() can jump backward (NTP/DST) and
    // briefly disable the throttle. Wall-clock time is still needed for the
    // serialized payload so the next document can compute age vs Date.now().
    const monotonicMs = performance.now();
    if (!force && monotonicMs - lastPersistAtMs < SELECTION_GRACE_PERSIST_THROTTLE_MS) return;
    lastPersistAtMs = monotonicMs;
    const payload = serializeSelectionGraceCache(selectionGraceCache, Date.now());
    sessionStorage.setItem(SELECTION_GRACE_PERSIST_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage may throw (private mode, quota exceeded, sandboxed iframe).
    // Persistence is best-effort — failure just degrades to in-memory-only behaviour.
  }
}

function tryHydrateSelectionGraceCache(): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const raw = sessionStorage.getItem(SELECTION_GRACE_PERSIST_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    const { hydratedIds, hydratedItemIndices } = hydrateSelectionGraceCache({
      state: selectionGraceCache,
      serialized: parsed,
      now: performance.now(),
      wallClockNow: Date.now(),
      gracePeriodMs: SELECTION_GRACE_PERIOD_MS,
      maxAgeMs: SELECTION_GRACE_PERSIST_MAX_AGE_MS,
    });
    if (hydratedIds.length > 0) {
      pendingHydratedSelectedIds = hydratedIds;
      pendingHydratedItemIndices = hydratedItemIndices;
      logSelsurvLifecycle('graceCache:hydrated', { count: hydratedIds.length });
    } else {
      sessionStorage.removeItem(SELECTION_GRACE_PERSIST_KEY);
    }
  } catch {
    // Malformed payload or storage error — nothing to recover, drop it.
    try {
      sessionStorage?.removeItem(SELECTION_GRACE_PERSIST_KEY);
    } catch {
      // ignore
    }
  }
}

function scheduleSelectionGraceRetry(): void {
  if (selectionGraceRetryTimeoutId !== null) return;
  selectionGraceRetryTimeoutId = setTimeout(() => {
    selectionGraceRetryTimeoutId = null;
    needsOverlayUpdate = true;
    scheduleOverlayLoopIfNeeded();
  }, SELECTION_GRACE_RETRY_MS);
}

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

  // After an iframe full-reload, parent has not yet broadcast the post-reload
  // selectedIds, so `state.selectedIds` is empty even though the user has a live
  // selection in the parent webview. Use the IDs hydrated from sessionStorage so
  // the very first paints replay the cached rect. Cleared on first real stateUpdate.
  const usingHydratedStandIn = state.selectedIds.length === 0 && pendingHydratedSelectedIds.length > 0;
  const effectiveSelectedIds = usingHydratedStandIn ? pendingHydratedSelectedIds : state.selectedIds;
  // Without restoring the hydrated `.map()` indices, `findElements(id, null)` returns
  // every instance at that source location — flashing the selection rect across all
  // rows of a `.map()` for the boot window. The hydrated indices target the exact
  // instance the user had selected before the reload.
  const effectiveSelectedItemIndices = usingHydratedStandIn ? pendingHydratedItemIndices : state.selectedItemIndices;

  const result = computeOverlayRects(
    {
      selectedIds: effectiveSelectedIds,
      hoveredId: state.hoveredId,
      hoveredItemIndex: state.hoveredItemIndex,
      selectedItemIndices: effectiveSelectedItemIndices,
      engineMode: state.engineMode,
    },
    iframeElementResolver,
  );

  // Replay last-known selection rect for IDs whose DOM lookup transiently missed
  // (typically during the post-HMR window before FiberSourceIndex rebuild). See
  // selection-grace-cache.ts for the full strategy.
  const graced = applySelectionGraceCache({
    selectedIds: effectiveSelectedIds,
    computedRects: result.overlayRects,
    cache: selectionGraceCache,
    now: performance.now(),
    gracePeriodMs: SELECTION_GRACE_PERIOD_MS,
    onPrune: logSelsurvCachePrune,
    selectedItemIndices: effectiveSelectedItemIndices,
  });
  result.overlayRects = graced.rects;
  if (graced.inGracePeriod) {
    scheduleSelectionGraceRetry();
  }
  // Persist on paint as a backstop in case Vite's beforeFullReload and beforeunload
  // both fail to fire (sudden navigation, sandboxed teardown).
  // Throttled to 250 ms so scroll/hover paints don't hammer sessionStorage.
  persistSelectionGraceCache();

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

  // Diagnostic: did this paint find a DOM element for the current selection,
  // and is its rect non-empty? See Task 2 of selection-survive-text-change plan.
  // Tag: [selsurv]. Only logs when (selectedId, found, visible) tuple changes.
  // Read effectiveSelectedIds — during boot-mode (post-hydrate, pre-stateUpdate)
  // state.selectedIds is empty even though we are painting from the stand-in.
  {
    const sel0 = effectiveSelectedIds[0] ?? null;
    if (sel0 !== null) {
      const itemIdx = effectiveSelectedItemIndices[sel0] ?? null;
      const elements = iframeElementResolver.findElements(sel0, itemIdx);
      const domElementFound = elements.length > 0;
      const selectionRect = result.overlayRects.find((r) => r.type === 'selection' && r.elementId === sel0);
      const rectVisible = !!selectionRect && selectionRect.width > 0 && selectionRect.height > 0;
      logSelsurvOverlayPaint(sel0, domElementFound, rectVisible);
      // Task 1 of selection-flicker-some-elements: explicitly surface findElements
      // misses so we can tell post-HMR fiber-resolution gaps apart from genuine
      // deselection. Coalesced inside the helper.
      if (!domElementFound) {
        logSelsurvFindMiss(sel0, itemIdx);
      }
    } else {
      logSelsurvOverlayPaint(null, false, false);
    }
  }

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
    ? new MutationObserver((mutations) => {
        invalidateSourceCache();
        scheduleThrottledOverlayUpdate();
        // Disable native drag on freshly-added img/a nodes. Bounded scan: only
        // walks the subtrees that just changed, not the whole document.
        for (const m of mutations) {
          if (m.type !== 'childList') continue;
          for (const node of m.addedNodes) {
            if (node instanceof HTMLElement) _disableNativeDraggableIn(node);
          }
        }
      })
    : null;

function setupBodyObservers(): void {
  if (!document.body) return;
  // One-time initial sweep so existing img/a nodes have draggable=false
  // before the user can interact with them. Subsequent additions are
  // handled by the mutation observer above.
  _disableNativeDraggableIn(document.body);
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

// Task 1 of selection-flicker-some-elements: surface HMR + full-reload timing.
// `vite:beforeUpdate` / `vite:afterUpdate` are emitted on `window` by Vite's
// hot-runtime client; webpack-dev-server fires `webpackHotUpdate` similarly.
// `beforeunload` + readystatechange let us tell a fast-refresh apart from a
// full-document reload (hypothesis B).
const VITE_LIFECYCLE_EVENTS = [
  'vite:beforeUpdate',
  'vite:afterUpdate',
  'vite:beforeFullReload',
  'vite:beforePrune',
  'vite:invalidate',
  'vite:error',
];
for (const evt of VITE_LIFECYCLE_EVENTS) {
  window.addEventListener(evt, () => {
    logSelsurvLifecycle(evt);
    // Vite full reload typically fires before any further paint runs — flush the
    // grace cache to sessionStorage now so the post-reload IIFE can hydrate it.
    // beforePrune fires per-pruned-module on every HMR partial update, where the
    // document is NOT reloaded and the in-memory cache is preserved — flushing
    // there would just hammer sessionStorage with redundant sync writes.
    if (evt === 'vite:beforeFullReload') {
      persistSelectionGraceCache(true);
    }
    // After every HMR apply (vite:afterUpdate), force IMMEDIATE overlay repaint
    // — bypassing the 50 ms throttle. The selected element's text content may
    // have changed (e.g. i18n key swap rewrites the t() argument and HMR
    // updates the rendered string), which means its bounding rect has shifted
    // and the existing overlay is now stale. The MutationObserver also fires,
    // but its 50 ms throttle visibly lags the text update — users notice the
    // outline "stuck on old position" for ~50 ms. requestAnimationFrame is
    // the right cadence: we want to paint after the same frame that React
    // committed the text update.
    if (evt === 'vite:afterUpdate') {
      invalidateSourceCache();
      requestAnimationFrame(() => {
        needsOverlayUpdate = true;
        sendOverlayRects();
      });
    }
  });
}
window.addEventListener('beforeunload', () => {
  logSelsurvLifecycle('beforeunload');
  persistSelectionGraceCache(true);
});
document.addEventListener('readystatechange', () => {
  logSelsurvLifecycle('readystatechange');
});

// Restore the grace cache from sessionStorage. Must run before the first paint so
// the cached rect is replayed across an iframe full-reload (hypothesis B).
tryHydrateSelectionGraceCache();

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
  document.removeEventListener('dragstart', _nativeDragSuppressor, true);
  document.removeEventListener('pointerdown', _dragPointerDown, true);
  document.removeEventListener('pointermove', _dragPointerMove, true);
  document.removeEventListener('pointerup', _dragPointerUp, true);
  document.removeEventListener('pointercancel', _dragCleanupForPointerEvent, true);
  document.removeEventListener('lostpointercapture', _dragCleanupForPointerEvent, true);
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
    // Mode flip → re-sweep. The CSS rule covers most cases; the JS sweep
    // handles elements where the browser ignores `-webkit-user-drag`.
    if (document.body) _disableNativeDraggableIn(document.body);
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
    if (msg.selectedIds !== undefined) {
      logSelsurvSelectedIdsAssign('msg:stateUpdate', state.selectedIds, msg.selectedIds);
      state.selectedIds = msg.selectedIds;
      // Parent has authoritative selection now — drop the post-reload stand-in
      // so subsequent paints follow normal pruning rules.
      pendingHydratedSelectedIds = [];
      pendingHydratedItemIndices = {};
    }
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
    logSelsurvSelectedIdsAssign('msg:goToVisual', state.selectedIds, [msg.elementId]);
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
