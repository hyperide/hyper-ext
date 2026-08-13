/**
 * Iframe interaction script — injected into user's preview iframe by PreviewProxy.
 *
 * Built as IIFE by esbuild, runs inside the preview iframe (not the VS Code webview).
 * Handles click/hover/context menu, keyboard shortcuts, overlay rects, design CSS.
 * Communicates with parent webview via postMessage.
 */
import { attachClickHandler } from '@shared/canvas-interaction/click-handler';
import { isContainerEmpty } from '@shared/canvas-interaction/empty-container-placeholders';
import {
  findTraceableParent as findTraceableParentIndexAware,
  type TraceableParentStep,
} from '@shared/canvas-interaction/find-traceable-parent';
import { createDesignKeydownHandler } from '@shared/canvas-interaction/keyboard-handler';
import { normalizeEventTarget } from '@shared/canvas-interaction/normalize-event-target';
import type { NodeMapLookup } from '@shared/canvas-interaction/keyboard-handler';
import { resolveCallSiteSource, resolveCallSiteTarget } from '@shared/canvas-interaction/resolve-source';
import { collectDomSiblingRects } from '@shared/canvas-interaction/spacing-guides';
import {
  computeEffectiveRef,
  toggleItemIndex,
  toggleNodeRefInSelection,
} from '@shared/canvas-interaction/selection-utils';
import type { OverlayElementResolver } from '@shared/canvas-interaction/types';
import { type Fiber, getFiberFromDOM } from '@shared/element-tracing/fiber-internals';
import { isTrustedMessageOrigin } from '@shared/utils/trusted-message-origin';
import { scrollIntoViewCenterSmooth, extractComputedStyle } from './dom-utils';
import { parseSourceRef, buildMapUrl, isViteSourceUrl } from './source-map-utils';
import { sendOverlayRects } from './iframe-overlay';
import { handleScreenshotRequest } from './iframe-screenshot';
import {
  _dragPointerDown,
  _dragPointerMove,
  _dragPointerUp,
  _dragCleanup,
  _dragClickSuppressor,
  _dragCleanupForPointerEvent,
  _disableNativeDraggableIn,
  _nativeDragSuppressor,
  _mousedownHandler,
  _previewResizeOrig,
  type DragHandlerContext,
} from './iframe-drag-handlers';
import type { SourceLocation } from '@shared/element-tracing/types';
import { resolveInSourceMap, type SourceMapV3 } from '@shared/element-tracing/source-map-resolver';
import {
  clearGraceCacheForElement,
  hydrateSelectionGraceCache,
  invalidateSelectionGraceCacheForFile,
  makeSelectionGraceCacheState,
  serializeSelectionGraceCache,
} from './selection-grace-cache';
import { getItemIndexFromDOM } from './iframe-utils';
import { detectColorCandidates, probeDrivingCandidates, type ColorCandidate } from './iframe-color-probe';
import {
  clientInternalFrames,
  clientSourceMapCache,
  extractClientChunkFrames,
  extractServerChunkFrames,
  resolveViaClientSourceMap,
  resolveViaServerSourceMap,
  serverSourceMapCache,
} from './iframe-source-maps';
import {
  createIframeResolver,
  invalidateSourceCache,
  getSourceIndex,
  resolveSourceIndexFiberSource,
} from './iframe-resolver';
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
const devtoolsHook = w.__REACT_DEVTOOLS_GLOBAL_HOOK__!;
const originalCommit = devtoolsHook.onCommitFiberRoot;
devtoolsHook.onCommitFiberRoot = (...args: unknown[]) => {
  invalidateSourceCache();
  void warmClientSourceMaps();
  requestServerSourceMaps();
  originalCommit?.(...args);
};
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
    setTimeout(() => {
      needsOverlayUpdate = true;
      scheduleOverlayLoopIfNeeded();
    }, SELECTION_GRACE_RETRY_MS);
  });
  return true;
}
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
/** In-flight fetch keys — prevents duplicate requests. */
const pendingClientFetches = new Set<string>();
/**
 * Pending click to retry once source maps finish warming.
 * Registered when resolveViaClientSourceMap returns null because cache entries are
 * undefined (source map fetch still in flight). Cleared after successful retry or TTL.
 */
let pendingClickElement: HTMLElement | null = null;
const pendingClickTimestamp = { value: 0 };
const PENDING_CLICK_TTL_MS = 5000;
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
    if (loc && !loc.fileName.includes('/')) {
      try {
        const parsed = new URL(url);
        const dir = parsed.pathname.replace(/\/[^/]+$/, ''); // strip filename
        loc = { ...loc, fileName: `${dir}/${loc.fileName}`.replace(/^\//, '') };
      } catch {}
    }
    if (loc && /(?:^|\/)node_modules\//.test(loc.fileName)) {
      clientInternalFrames.add(key);
      clientSourceMapCache.set(key, null); // prevent re-fetching the same chunk map
    } else {
      clientSourceMapCache.set(key, loc);
      if (loc) {
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
 * Retry the most recent pending click after source maps finish warming.
 * Posts hypercanvas:elementClick to the parent webview if the resolution succeeds.
 * Called from warmClientChunk and serverSourceMapResult when new locations are cached.
 */
function retryPendingClick(): void {
  if (!pendingClickElement) return; // codeql[js/useless-conditional] -- pendingClickElement is mutable state; null-check is a live guard
  if (Date.now() - pendingClickTimestamp.value > PENDING_CLICK_TTL_MS) {
    pendingClickElement = null;
    return;
  }
  const fiber = getFiberFromDOM(pendingClickElement);
  if (!fiber) {
    pendingClickElement = null;
    return;
  }
  let source = resolveViaClientSourceMap(fiber) ?? resolveViaServerSourceMap(fiber);
  if (!source) return; // still warming — keep pending
  const element = pendingClickElement;
  pendingClickElement = null;
  const directItemIndex = getItemIndexFromDOM(element);
  const target = resolveCallSiteTarget(source, fiber, renderedComponentPath, directItemIndex);
  source = target.source;
  const itemIndex = target.itemIndex;
  const syntheticRef = `${source.fileName}:${source.line}:${source.column}`;
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
/** In-flight server-side resolve keys — prevents duplicate requests. */
const pendingServerRequests = new Set<string>();
/**
 * Request server source map resolution from the extension host.
 * The host reads the .map file from the local filesystem, decodes VLQ,
 * and responds with `hypercanvas:serverSourceMapResult`.
 */
function requestServerSourceMap(filePath: string, line: number, col: number): void {
  const key = `${filePath}:${line}:${col}`;
  if (serverSourceMapCache.has(key) || pendingServerRequests.has(key)) return;
  pendingServerRequests.add(key);
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
/** Find DOM elements by nodeRef (format: "fileName:line:column"). */
export function findElementsByRef(nodeRef: string, itemIndex: number | null): HTMLElement[] {
  const source = parseSourceRef(nodeRef);
  if (source === null) return [];
  let live = getSourceIndex(renderedComponentPath).findDOMElements(source);
  let matchIsExact = live.length > 0;
  if (live.length === 0) {
    live = getSourceIndex(renderedComponentPath).findClosestLineDOMElements(source);
    if (live.length > 0) matchIsExact = true;
  }
  if (live.length === 0 && source.fileName) {
    const closest = getSourceIndex(renderedComponentPath).findClosestSourceDOMElements(source, {
      matchPathAcrossFormats: true,
    });
    if (closest !== null && closest.elements.length > 0) {
      live = closest.elements;
      const matched = closest.matchedSource;
      const matchedKey = `${matched.fileName}:${matched.line}:${matched.column}`;
      const exactPath = matched.fileName === source.fileName;
      logSelsurvClosestSourceFallback(exactPath ? nodeRef : `${nodeRef}#xfmt`, matchedKey, live.length);
      if (closest.lineDistance === 0 && closest.columnDistance === 0) {
        matchIsExact = true;
      }
    }
  }
  if (itemIndex !== null) {
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
    for (const entry of getSourceIndex(renderedComponentPath).getLiveEntries()) {
      for (const el of entry.elements) {
        if (document.contains(el) && isContainerEmpty(el)) {
          results.push({ elementId: entry.key, element: el });
        }
      }
    }
    return results;
  },
};
/** Monotonic counter so the webview can discard stale snapshots on rapid clicks. */
let elementClickSeq = 0;
let renderedComponentPath: string | null = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('component') ?? null;
  } catch {
    return null;
  }
})();
const state = {
  selectedIds: [] as string[],
  hoveredId: null as string | null,
  hoveredItemIndex: null as number | null,
  selectedItemIndices: {} as Record<string, number | null>,
  engineMode: 'design' as string,
};
(window as unknown as Record<string, unknown>).__hyperCanvasState = state;
(window as unknown as Record<string, unknown>).__hyperCanvasStateGen = 0;
const SELSURV_TAG = '[selsurv]';
function logSelsurvSelectedIdsAssign(reason: string, prev: string[], next: string[]): void {
  if (prev.length === next.length && prev.every((v, i) => v === next[i])) return;
  console.debug(SELSURV_TAG, 'selectedIds change', {
    t: Math.round(performance.now()),
    reason,
    prev,
    next,
  });
}
let lastOverlayLogKey = '';
function logSelsurvOverlayPaint(selectedId: string | null, domElementFound: boolean, rectVisible: boolean): void {
  const key = `${selectedId ?? ''}|${domElementFound}|${rectVisible}`;
  if (key === lastOverlayLogKey) return;
  lastOverlayLogKey = key;
  console.debug(SELSURV_TAG, 'overlay paint', {
    t: Math.round(performance.now()),
    selectedId,
    domElementFound,
    rectVisible,
  });
}

function logSelsurvCachePrune(elementId: string, reason: 'deselected' | 'expired'): void {
  console.debug(SELSURV_TAG, 'grace-cache prune', {
    t: Math.round(performance.now()),
    elementId,
    reason,
  });
}

function logSelsurvLifecycle(event: string, extra?: Record<string, unknown>): void {
  console.debug(SELSURV_TAG, 'lifecycle', {
    t: Math.round(performance.now()),
    event,
    readyState: typeof document !== 'undefined' ? document.readyState : 'n/a',
    ...extra,
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
const activeInstanceId: string | null = null;

document.addEventListener('click', _dragClickSuppressor, true);
const iframeResolver = createIframeResolver({
  renderedComponentPath,
  pendingClickElement,
  pendingClickTimestamp: pendingClickTimestamp,
  warmServerChunkFrames,
  warmFiberChunkFrames,
});
const selectionGraceCache = makeSelectionGraceCacheState();
const dragHandlerCtx: DragHandlerContext = {
  state,
  iframeResolver,
  renderedComponentPath,
  selectionGraceCache: {
    invalidateForFile: (fp: string) => invalidateSelectionGraceCacheForFile(selectionGraceCache, fp),
  },
  findElementsByRef,
};
const _boundPointerDown = (e: PointerEvent) => _dragPointerDown(dragHandlerCtx, e);
const _boundPointerMove = (e: PointerEvent) => _dragPointerMove(dragHandlerCtx, e);
const _boundPointerUp = (e: PointerEvent) => _dragPointerUp(dragHandlerCtx, e);
const _boundMousedown = (e: MouseEvent) => _mousedownHandler(dragHandlerCtx, e);
document.addEventListener('pointerdown', _boundPointerDown, true);
document.addEventListener('pointermove', _boundPointerMove, true);
document.addEventListener('pointerup', _boundPointerUp, true);
document.addEventListener('pointercancel', _dragCleanupForPointerEvent, true);
document.addEventListener('lostpointercapture', _dragCleanupForPointerEvent, true);
document.addEventListener('mousedown', _boundMousedown, true);
document.addEventListener('dragstart', _nativeDragSuppressor, true);
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
        const effectiveRef = source ? computeEffectiveRef(nodeRef, source) : nodeRef;
        if (effectiveRef) {
          logSelsurvSelectedIdsAssign('click:single', state.selectedIds, [effectiveRef]);
          state.selectedIds = [effectiveRef];
          if (itemIndex != null) state.selectedItemIndices = { [effectiveRef]: itemIndex };

          needsOverlayUpdate = true;
          scheduleOverlayLoopIfNeeded();
        }
      }
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:elementClick',
          elementId: nodeRef,
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
      if (pendingClickElement) return; // codeql[js/useless-conditional] -- pendingClickElement is mutable state; guard prevents empty-click while a click is pending
      if (emptyClickEvent.metaKey || emptyClickEvent.ctrlKey) return;
      window.parent.postMessage({ type: 'hypercanvas:emptyClick' }, '*');
    },
    getMode: () => state.engineMode as 'design' | 'interact',
  },
  iframeResolver,
);

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
  const queue: HTMLElement[] = [];
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i];
    if (child instanceof HTMLElement) queue.push(child);
  }
  while (queue.length > 0) {
    const node = queue.shift()!;
    const ref = getSourceKey(node);
    if (ref) {
      refs.push(ref);
    } else {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child instanceof HTMLElement) queue.push(child);
      }
    }
  }
  return refs;
}
const domNodeMapLookup: NodeMapLookup = {
  getEntry(nodeRef: string) {
    const source = parseSourceRef(nodeRef);
    if (source === null) return null;

    const startIdx = state.selectedItemIndices[nodeRef] ?? 0;
    const el = findElementsByRef(nodeRef, startIdx)[0] ?? findElementsByRef(nodeRef, 0)[0];
    if (!el) {
      console.debug(SHIFTPARENT_TAG, 'getEntry missing-base', {
        t: Math.round(performance.now()),
        nodeRef,
        renderedComponentPath,
      });
      return null;
    }
    const trace: TraceableParentStep[] = [];
    const parent = findTraceableParent(el, trace);

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
    const exact = getSourceIndex(renderedComponentPath).findDOMElement(source, itemIndex);
    if (exact) return exact;
    const closest = getSourceIndex(renderedComponentPath).findClosestLineDOMElements(source);
    return closest[itemIndex] ?? closest[0] ?? null;
  },
};
const { handler: keydownHandler } = createDesignKeydownHandler({
  getState: () => ({
    selectedIds: state.selectedIds,
    activeInstanceId,
    selectedItemIndices: state.selectedItemIndices,
  }),
  getDocument: () => document,
  callbacks: {
    onSelectElement: (id, itemIndex) => {
      console.debug(SHIFTPARENT_TAG, 'keyboard:onSelectElement', {
        t: Math.round(performance.now()),
        id,
        itemIndex,
        selectedItemIndices: state.selectedItemIndices,
        selectedIds: state.selectedIds,
      });
      window.parent.postMessage(
        {
          type: 'hypercanvas:elementClick',
          elementId: id,
          itemIndex: itemIndex ?? null,
        },
        '*',
      );
    },
    onSelectMultiple: (ids) =>
      window.parent.postMessage(
        {
          type: 'hypercanvas:selectMultiple',
          elementIds: ids,
        },
        '*',
      ),
    // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    onClearSelection: () => window.parent.postMessage({ type: 'hypercanvas:emptyClick' }, '*'),
    onDeleteElements: (ids) =>
      window.parent.postMessage(
        {
          type: 'hypercanvas:deleteElements',
          elementIds: ids,
        },
        '*',
      ),
    onDuplicateElement: (id) =>
      window.parent.postMessage(
        {
          type: 'keyboard:duplicate',
          elementId: id,
        },
        '*',
      ),
  },
  isDesignMode: () => state.engineMode === 'design',
  nodeMapLookup: domNodeMapLookup,
});

function keydownForwardingHandler(e: KeyboardEvent): void {
  const consumed = keydownHandler(e);
  if (consumed) return;
  if (state.engineMode !== 'design') return;
  if (!e.metaKey && !e.ctrlKey && !e.altKey) return;
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
const contextMenuHandler = (e: MouseEvent) => {
  if (state.engineMode !== 'design') return;
  e.preventDefault();
  e.stopPropagation();
  // Right-click over visible text reports e.target as a Text node; coerce up to the
  // owning Element so resolveClickLocal / extractComputedStyle never see a non-Element.
  const target = normalizeEventTarget(e.target);
  if (!target) return;
  const result = iframeResolver.resolveClickLocal(target);
  const source = result?.source ?? null;
  const elementId = result ? `${result.source.fileName}:${result.source.line}:${result.source.column}` : null;
  const itemIndex = result?.itemIndex ?? null;
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
let prevRectsJSON = '';
let needsOverlayUpdate = true;
let overlayRafScheduled = false;

const SELECTION_GRACE_PERIOD_MS = 2500;
const SELECTION_GRACE_RETRY_MS = 50;
/** sessionStorage key under which the cache snapshot is persisted across reloads. */
const SELECTION_GRACE_PERSIST_KEY = '__hypercanvas_selsurv_grace_cache__';
/** Snapshots older than this are discarded (e.g. user closed and reopened the tab). */
const SELECTION_GRACE_PERSIST_MAX_AGE_MS = 10_000;
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

const SELECTION_GRACE_PERSIST_THROTTLE_MS = 250;
let lastPersistAtMs = 0;
function persistSelectionGraceCache(force = false): void {
  try {
    if (typeof sessionStorage === 'undefined') return;

    if (selectionGraceCache.rectsByElementId.size === 0) {
      sessionStorage.removeItem(SELECTION_GRACE_PERSIST_KEY);
      return;
    }

    const monotonicMs = performance.now();
    if (!force && monotonicMs - lastPersistAtMs < SELECTION_GRACE_PERSIST_THROTTLE_MS) return;
    lastPersistAtMs = monotonicMs;
    const payload = serializeSelectionGraceCache(selectionGraceCache, Date.now());
    sessionStorage.setItem(SELECTION_GRACE_PERSIST_KEY, JSON.stringify(payload));
  } catch {}
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
    try {
      sessionStorage?.removeItem(SELECTION_GRACE_PERSIST_KEY);
    } catch {}
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
    requestAnimationFrame(() => {
      sendOverlayRects({
        state,
        pendingHydratedSelectedIds,
        pendingHydratedItemIndices,
        iframeElementResolver,
        selectionGraceCache,
        gracePeriodMs: SELECTION_GRACE_PERIOD_MS,
        scheduleSelectionGraceRetry,
        persistGraceCache: persistSelectionGraceCache,
        prevRectsJSON,
        setPrevRectsJSON: (v) => {
          prevRectsJSON = v;
        },
        needsOverlayUpdate,
        setNeedsOverlayUpdate: (v) => {
          needsOverlayUpdate = v;
        },
        overlayRafScheduled,
        setOverlayRafScheduled: (v) => {
          overlayRafScheduled = v;
        },
        scheduleOverlayLoopIfNeeded,
        logSelsurvOverlayPaint,
        logSelsurvFindMiss,
        onPrune: logSelsurvCachePrune,
      });
    });
  }
}
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
const overlayMutationObserver =
  typeof MutationObserver !== 'undefined'
    ? new MutationObserver((mutations) => {
        invalidateSourceCache();
        scheduleThrottledOverlayUpdate();
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
// codeql[js/superfluous-trailing-arguments] -- ResizeObserver callback intentionally ignores entries and observer args
const overlayResizeObserver =
  typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => {
        scheduleThrottledOverlayUpdate();
      })
    : null;
if (document.body) {
  setupBodyObservers();
} else {
  document.addEventListener('DOMContentLoaded', setupBodyObservers, { once: true });
}

const overlayScrollHandler = () => {
  window.parent.postMessage({ type: 'hypercanvas:overlayScroll', scrollY: window.scrollY }, '*');
  needsOverlayUpdate = true;
  scheduleOverlayLoopIfNeeded();
};
const overlayResizeHandler = () => {
  scheduleThrottledOverlayUpdate();
};
window.addEventListener('scroll', overlayScrollHandler, true);
window.addEventListener('resize', overlayResizeHandler);

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

    if (evt === 'vite:beforeFullReload') {
      persistSelectionGraceCache(true);
    }

    if (evt === 'vite:afterUpdate') {
      invalidateSourceCache();
      requestAnimationFrame(() => {
        needsOverlayUpdate = true;
        scheduleOverlayLoopIfNeeded();
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
tryHydrateSelectionGraceCache();
scheduleOverlayLoopIfNeeded();
window.addEventListener('unload', () => {
  if (overlayUpdateTimeoutId !== null) clearTimeout(overlayUpdateTimeoutId);
  if (overlayMutationObserver) overlayMutationObserver.disconnect();
  if (overlayResizeObserver) overlayResizeObserver.disconnect();
  window.removeEventListener('scroll', overlayScrollHandler, true);
  window.removeEventListener('resize', overlayResizeHandler);
  document.removeEventListener('keydown', keydownForwardingHandler, true);
  document.removeEventListener('contextmenu', contextMenuHandler, true);
  document.removeEventListener('mousedown', _boundMousedown, true);
  document.removeEventListener('dragstart', _nativeDragSuppressor, true);
  document.removeEventListener('pointerdown', _boundPointerDown, true);
  document.removeEventListener('pointermove', _boundPointerMove, true);
  document.removeEventListener('pointerup', _boundPointerUp, true);
  document.removeEventListener('pointercancel', _dragCleanupForPointerEvent, true);
  document.removeEventListener('lostpointercapture', _dragCleanupForPointerEvent, true);
  document.removeEventListener('click', _dragClickSuppressor, true);
});
import { updateDesignStyles } from './iframe-design-styles';

// nosemgrep: javascript.browser.security.insufficient-postmessage-origin-validation.insufficient-postmessage-origin-validation -- origin IS validated by isTrustedMessageOrigin() as the handler's first statement; Semgrep's syntactic rule can't follow the helper call.
window.addEventListener('message', (event: MessageEvent) => {
  // Reject untrusted frames before dispatching (js/missing-origin-check).
  if (!isTrustedMessageOrigin(event)) return;
  const msg = event.data;
  if (!msg || !msg.type) return;
  if (msg.type === 'hypercanvas:setComponent') {
    if (typeof msg.component === 'string') {
      renderedComponentPath = msg.component;
      invalidateSourceCache();
    }
    return;
  }
  if (msg.type === 'hypercanvas:syntheticKeydown') {
    const syntheticEvent = new KeyboardEvent('keydown', {
      key: msg.key,
      shiftKey: !!msg.shiftKey,
      bubbles: true,
      cancelable: true,
    });

    const prevMode = state.engineMode;
    state.engineMode = 'design';
    keydownHandler(syntheticEvent);
    state.engineMode = prevMode;
    return;
  }
  if (msg.type === 'hypercanvas:clearGraceCache') {
    const elementId = typeof msg.elementId === 'string' ? msg.elementId : null;
    if (elementId) {
      clearGraceCacheForElement(selectionGraceCache, elementId);
    } else {
      selectionGraceCache.rectsByElementId.clear();
      selectionGraceCache.deadlineByElementId.clear();
    }
    needsOverlayUpdate = true;
    scheduleOverlayLoopIfNeeded();
    return;
  }
  if (msg.type === 'hypercanvas:stateUpdate') {
    if (msg.selectedIds !== undefined) {
      logSelsurvSelectedIdsAssign('msg:stateUpdate', state.selectedIds, msg.selectedIds);
      state.selectedIds = msg.selectedIds;
      pendingHydratedSelectedIds = [];
      pendingHydratedItemIndices = {};
    }
    if (msg.hoveredId !== undefined) state.hoveredId = msg.hoveredId;
    if (msg.hoveredItemIndex !== undefined) state.hoveredItemIndex = msg.hoveredItemIndex;
    if (msg.selectedItemIndices !== undefined) {
      console.debug(SHIFTPARENT_TAG, 'stateUpdate:selectedItemIndices', {
        t: Math.round(performance.now()),
        incoming: msg.selectedItemIndices,
        prev: state.selectedItemIndices,
        selectedIds: msg.selectedIds ?? state.selectedIds,
      });
      state.selectedItemIndices = msg.selectedItemIndices;
    }
    if (msg.engineMode !== undefined) {
      state.engineMode = msg.engineMode;
      updateDesignStyles(state.engineMode);
      if (state.engineMode !== 'interact' && document.body) {
        _disableNativeDraggableIn(document.body);
      }
    }
    needsOverlayUpdate = true;
    scheduleOverlayLoopIfNeeded();
    (window as unknown as Record<string, unknown>).__hyperCanvasStateGen =
      (((window as unknown as Record<string, unknown>).__hyperCanvasStateGen as number) ?? 0) + 1;
    return;
  }
  if (msg.type === 'hypercanvas:goToVisual') {
    logSelsurvSelectedIdsAssign('msg:goToVisual', state.selectedIds, [msg.elementId]);
    state.selectedIds = [msg.elementId];
    state.selectedItemIndices = {};
    const el = findElementsByRef(msg.elementId, 0)[0];
    if (el) {
      scrollIntoViewCenterSmooth(el);
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
  if (msg.type === 'hypercanvas:requestComputedStyle') {
    const elementId = msg.elementId as string;
    const itemIndex = (msg.itemIndex as number | null | undefined) ?? null;
    const el = findElementsByRef(elementId, itemIndex)[0] ?? null;
    if (el) {
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
  if (msg.type === 'hypercanvas:scrollToElement') {
    const el = findElementsByRef(msg.elementId, 0)[0];
    if (el) scrollIntoViewCenterSmooth(el);
    return;
  }
  if (msg.type === 'hypercanvas:getElementText') {
    const el = findElementsByRef(msg.elementId, 0)[0] ?? null;
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
  if (msg.type === 'hypercanvas:previewResize') {
    const id = msg.elementId as string;
    const el = findElementsByRef(id, 0)[0] ?? null;
    if (el) {
      if (!_previewResizeOrig.has(id)) {
        _previewResizeOrig.set(id, { width: el.style.width, height: el.style.height });
      }
      if (typeof msg.width === 'number') el.style.width = `${msg.width}px`;
      if (typeof msg.height === 'number') el.style.height = `${msg.height}px`;
      // HYP-590: report the real DOM sibling rects for spacing guides. The webview
      // overlay container only knows selection/placeholder overlays, so under
      // single-select it has no geometry for ordinary siblings. Measured AFTER the
      // live size is applied so reflow is captured; same viewport coordinate space
      // as overlay rects (both raw getBoundingClientRect, identity-mapped). The
      // active element's own rect rides along from the same layout pass — in
      // position-shifting layouts (e.g. centered flex) the webview's overlay
      // position is stale mid-drag, so it must not be mixed with fresh siblings.
      const activeRect = el.getBoundingClientRect();
      // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:siblingRects',
          elementId: id,
          activeRect: {
            left: activeRect.left,
            top: activeRect.top,
            width: activeRect.width,
            height: activeRect.height,
          },
          rects: collectDomSiblingRects(el),
        },
        '*',
      );
    }
    return;
  }
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

  // HYP-544: live applied className request from the extension host (write-time DOM anchor
  // for an inspector color replace). Read the real `class` attribute off the live element and
  // round-trip it back. Resolves with null className when the element can't be found — the
  // host then degrades the write to the static AST behavior.
  if (msg.type === 'hypercanvas:requestLiveClassName') {
    // Use the selected item index so a repeated JSX site (.map() row) anchors on the
    // element the user is actually editing, not always the first rendered instance.
    const liveItemIndex = (msg.itemIndex as number | null | undefined) ?? 0;
    const el = findElementsByRef(msg.elementId as string, liveItemIndex)[0] ?? null;
    // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage(
      {
        type: 'hypercanvas:liveClassNameResult',
        requestId: msg.requestId,
        className: el && typeof el.className === 'string' ? el.className : null,
      },
      '*',
    );
    return;
  }

  // HYP-544 Phase 3: empirical color-probe request from the extension host. When an inspector
  // color edit reaches the host from a source the static AST classifier can't resolve, the host
  // asks the iframe (the only realm with the live DOM + computed style) to find which candidate
  // token actually DRIVES the element's color. Enumerate candidates (§4) then verify each via the
  // Tier-1 off-screen-clone probe (§5.1) — invisible by construction, the real node is never
  // mutated. Round-trip the ranked driving-candidate list back. Resolves an empty list when the
  // element can't be found / nothing drives the color — the host then degrades to the §7 floor.
  if (msg.type === 'hypercanvas:probeColorCandidates') {
    const probeItemIndex = (msg.itemIndex as number | null | undefined) ?? 0;
    const probeEl = findElementsByRef(msg.elementId as string, probeItemIndex)[0] ?? null;
    const prefixes = Array.isArray(msg.prefixes) ? (msg.prefixes as string[]) : [];
    const cssProp = (msg.cssProp as string | undefined) ?? 'backgroundColor';
    const requestedColor = (msg.requestedColor as string | undefined) ?? '';
    const requestClass = (msg.requestClass as string | undefined) ?? undefined;
    let driving: ColorCandidate[] = [];
    if (probeEl && requestedColor) {
      try {
        const candidates = detectColorCandidates(probeEl, prefixes, cssProp);
        driving = probeDrivingCandidates(probeEl, candidates, requestedColor, cssProp, { requestClass });
      } catch {
        driving = [];
      }
    }
    // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage(
      {
        type: 'hypercanvas:probeColorCandidatesResult',
        requestId: msg.requestId,
        driving,
      },
      '*',
    );
    return;
  }

  // Screenshot request from MCP tool
  if (msg.type === 'hypercanvas:takeScreenshot') {
    handleScreenshotRequest(msg.requestId as string, msg.elementId as string | null, findElementsByRef);
    return;
  }
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
      invalidateSourceCache();
      needsOverlayUpdate = true;
      scheduleOverlayLoopIfNeeded();
      retryPendingClick(); // retry any click waiting for server source maps (RSC)
    }
    return;
  }
});
updateDesignStyles(state.engineMode);
if (state.engineMode !== 'interact' && document.body) {
  _disableNativeDraggableIn(document.body);
}

// Bridge-ready handshake (#51). By this point the message listener (above) is mounted and
// __hyperCanvasState exists, so the bridge can safely receive a re-sent selection. Every
// framework now loads this script at first paint: non-Remix previews inject it after <head>
// (PreviewProxy), and Remix renders it as a plain <script src> in its route's SSR JSX
// (framework-routing.ts, #77/#45) — both parser-executed, so the parent is typically already
// up and the re-send is a harmless no-op. Announcing readiness still closes any residual
// round-trip race (e.g. a selection issued before this script executes): it lets the parent
// (usePreviewBridge) re-forward the current selection state once, framework-agnostically.
window.parent.postMessage({ type: 'hypercanvas:bridgeReady' }, '*');
