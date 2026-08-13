/**
 * @file Hook to manage ElementTracer lifecycle — creates adapter, transport, and tracer
 * when iframe content loads and React is detected.
 *
 * Accessed via: IframeCanvas.tsx
 * Assumptions: Iframe is same-origin (SaaS proxy); React dev mode with _debugSource present.
 */

import { findNearestSourceLocation } from '@shared/element-tracing/fiber-internals';
import { getOwnFiberSourceLocation } from '@shared/element-tracing/fiber-source-index';
import type { SourceLocation } from '@shared/element-tracing/types';
import { useEffect, useRef, useState } from 'react';
import { setActiveTracer } from '@/lib/element-tracing/active-tracer';
import { ClickRetryQueue } from '@/lib/element-tracing/click-retry-queue';
import { ElementTracer } from '@/lib/element-tracing/element-tracer';
import { FiberSourceIndex, hookIntoReactCommits } from '@/lib/element-tracing/fiber-source-index';
import type { Fiber } from '@/lib/element-tracing/fiber-utils';
import { FiberTag, getFiberFromDOM } from '@/lib/element-tracing/fiber-utils';
import { ModuleSourceMapResolver } from '@/lib/element-tracing/module-source-map-resolver';
import { ReactAdapter } from '@/lib/element-tracing/react-adapter';
import { WSTracingTransport } from '@/lib/element-tracing/ws-tracing-transport';

interface UseElementTracerOptions {
  iframe: HTMLIFrameElement | null;
  projectId: string;
  enabled: boolean;
  /** Incrementing counter that signals iframe content has reloaded (new document). */
  loadCounter?: number;
  /** Currently rendered component path (e.g. "src/examples/DatePicker.tsx") */
  componentPath?: string;
}

interface UseElementTracerResult {
  tracer: ElementTracer | null;
  ready: boolean;
  /**
   * Retry queue for clicks that raced source-map warmup (HYP-635). Click handlers
   * enqueue a missed click here; it re-resolves when the module's map lands.
   */
  clickRetryQueue: ClickRetryQueue | null;
}

/** Fast-retry window: 15 × 200ms = 3s. After that, slow retry every 2s until disposed. */
const FAST_DETECT_ATTEMPTS = 15;
const DETECT_INTERVAL_MS = 200;
const SLOW_DETECT_INTERVAL_MS = 2000;

/**
 * Detect React with fiber source in an iframe document.
 * Cross-realm safe: uses nodeType instead of instanceof HTMLElement.
 * Works with React 18+ createRoot where #root has __reactContainer$
 * but __reactFiber$ lives on its firstElementChild.
 */
function detectReactInIframe(doc: Document): boolean {
  const selectors = ['#root', '#__next', '#app', '[data-reactroot]'];
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (!el || el.nodeType !== 1) continue;

    // Check this element and its first child (React 18+ createRoot pattern)
    const candidates = [el];
    if (el.firstElementChild && el.firstElementChild.nodeType === 1) {
      candidates.push(el.firstElementChild);
    }

    for (const candidate of candidates) {
      const keys = Object.keys(candidate);
      for (const key of keys) {
        if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
          const fiber = (candidate as unknown as Record<string, Fiber>)[key];
          const loc = findNearestSourceLocation(fiber);
          if (loc !== null && typeof loc.fileName === 'string' && typeof loc.line === 'number') {
            return true;
          }
        }
      }
    }
  }
  return false;
}

export function useElementTracer({
  iframe,
  projectId,
  enabled,
  loadCounter,
  componentPath,
}: UseElementTracerOptions): UseElementTracerResult {
  const tracerRef = useRef<ElementTracer | null>(null);
  const clickRetryQueueRef = useRef<ClickRetryQueue | null>(null);
  // The init effect's setTimeout retry chain (up to 3s for React detection) can
  // outlive multiple prop changes. Reading the live value through a ref avoids
  // capturing a stale `componentPath` in the closure when tryInit finally fires.
  const componentPathRef = useRef(componentPath);
  componentPathRef.current = componentPath;
  const [ready, setReady] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadCounter forces re-init when iframe reloads (new document)
  useEffect(() => {
    if (!iframe || !enabled || !projectId) {
      // Tear down if conditions no longer met
      clickRetryQueueRef.current?.cancel();
      clickRetryQueueRef.current = null;
      if (tracerRef.current) {
        tracerRef.current.dispose();
        tracerRef.current = null;
        setReady(false);
      }
      return;
    }

    // Local const preserves null-narrowing across the nested tryInit declaration
    // (TS would widen `iframe` back to `HTMLIFrameElement | null` inside a function
    // declaration captured by closure).
    const iframeEl = iframe;
    let disposed = false;
    let detectTimer: ReturnType<typeof setTimeout> | null = null;
    let unhookCommits: (() => void) | null = null;

    /**
     * Try to detect React and initialize the tracer.
     * React may not be hydrated yet when the iframe fires its load event,
     * so we retry with a short interval.
     * Reads iframe.contentDocument fresh each attempt — the document object
     * changes when the iframe navigates (e.g. about:blank → preview URL).
     */
    function tryInit(attempt: number): void {
      if (disposed) return;

      const doc = iframeEl.contentDocument;
      const iframeWindow = iframeEl.contentWindow;
      if (!doc || !iframeWindow) {
        const delay = attempt < FAST_DETECT_ATTEMPTS ? DETECT_INTERVAL_MS : SLOW_DETECT_INTERVAL_MS;
        detectTimer = setTimeout(() => tryInit(attempt + 1), delay);
        return;
      }

      // Use cross-realm safe detection (nodeType, not instanceof HTMLElement)
      const detected = detectReactInIframe(doc);
      if (attempt === 0 || attempt === FAST_DETECT_ATTEMPTS || detected) {
        console.log(`[Tracer] attempt=${attempt} detected=${detected} body=${doc.body?.children.length}`);
      }
      if (!detected) {
        const delay = attempt < FAST_DETECT_ATTEMPTS ? DETECT_INTERVAL_MS : SLOW_DETECT_INTERVAL_MS;
        detectTimer = setTimeout(() => tryInit(attempt + 1), delay);
        return;
      }

      // React 19 _debugStack frames carry Vite-TRANSFORMED module coords (HYP-594) —
      // map them back to ORIGINAL source coords through the module's own source map so
      // FiberSourceIndex keys and click resolution match server AST/node-map positions.
      // Mirrors the extension's iframe-resolver composition: platform source-map
      // resolver first, raw fiber parsing as fallback.
      let invalidateSourceIndex: (() => void) | null = null;
      let clickRetryQueue: ClickRetryQueue | null = null;
      const moduleSourceMapResolver = new ModuleSourceMapResolver({
        onResolved: () => {
          // Order matters: invalidate the index FIRST so the queued click's
          // re-resolution below sees freshly mapped coords, not stale raw ones.
          invalidateSourceIndex?.();
          clickRetryQueue?.notifyResolved();
        },
      });
      const resolveFiberSource = (fiber: Fiber): SourceLocation | null =>
        moduleSourceMapResolver.resolveFiberSource(fiber) ?? getOwnFiberSourceLocation(fiber);

      const adapter = new ReactAdapter(doc, { resolveFiberSource });

      // Patch: ReactAdapter.getSourceIndex() internally uses findReactRoot which has
      // `instanceof HTMLElement` (Bun-cached, fails cross-realm). Override sourceIndex
      // with a cross-realm safe root fiber provider.
      const crossRealmRootProvider = (): Fiber | null => {
        const selectors = ['#root', '#__next', '#app', '[data-reactroot]'];
        for (const sel of selectors) {
          const el = doc.querySelector(sel);
          if (!el || el.nodeType !== 1) continue;
          // Check element and firstChild for fiber
          for (const candidate of [el, el.firstElementChild]) {
            if (!candidate || candidate.nodeType !== 1) continue;
            const fiber = getFiberFromDOM(candidate as HTMLElement);
            if (fiber) {
              let current: Fiber | null = fiber;
              while (current) {
                if (current.tag === FiberTag.HostRoot) return current;
                current = current.return;
              }
              return fiber;
            }
          }
        }
        return null;
      };
      const sourceIndex = new FiberSourceIndex(crossRealmRootProvider, doc, { resolveFiberSource });
      invalidateSourceIndex = () => sourceIndex.invalidate();
      // Replace adapter's sourceIndex with our cross-realm safe one
      (adapter as unknown as { sourceIndex: FiberSourceIndex }).sourceIndex = sourceIndex;

      // Pre-warm source maps for the already-rendered tree so the first click resolves
      // with source coords instead of raw transformed coords.
      const rootFiber = crossRealmRootProvider();
      if (rootFiber !== null) moduleSourceMapResolver.warmFiberTree(rootFiber);

      const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/element-tracing/${projectId}`;
      const transport = new WSTracingTransport(() => new WebSocket(wsUrl));
      // Call-site walk-up mapper: source-map-MAPPED position ONLY (no getOwnFiberSourceLocation
      // compiled fallback), so a React-19 `_debugStack` ancestor resolves to original coords —
      // never the transformed-module line that misses the server node-map (HYP-970). Parity with
      // the extension's mapOwnFiberSource. resolveFiberSource auto-warms the module's map on miss.
      const tracer = new ElementTracer(adapter, transport, (fiber) =>
        moduleSourceMapResolver.resolveFiberSource(fiber),
      );

      // Retry-on-resolve for the first-click warmup race (HYP-635): a click that
      // misses the node map while its module's source map is still fetching is
      // queued and re-resolved from onResolved above. Tracer readiness is NOT
      // gated on warmup — a hung map fetch must never block selection.
      clickRetryQueue = new ClickRetryQueue({
        resolve: (element) => tracer.resolveClickLocal(element),
        isWarming: (element) => {
          const fiber = getFiberFromDOM(element);
          return fiber !== null && moduleSourceMapResolver.isFiberSourceWarming(fiber);
        },
      });
      clickRetryQueueRef.current = clickRetryQueue;

      // Hook into React commit cycle inside the iframe to invalidate FiberSourceIndex
      unhookCommits = hookIntoReactCommits(sourceIndex, iframeWindow as unknown as typeof globalThis);

      tracer.renderedFile = componentPathRef.current ?? null;
      tracerRef.current = tracer;
      setActiveTracer(tracer);
      if (!disposed) {
        setReady(true);
      }
    }

    tryInit(0);

    return () => {
      disposed = true;
      if (detectTimer !== null) {
        clearTimeout(detectTimer);
      }
      unhookCommits?.();
      clickRetryQueueRef.current?.cancel();
      clickRetryQueueRef.current = null;
      if (tracerRef.current) {
        tracerRef.current.dispose();
        tracerRef.current = null;
        setActiveTracer(null);
      }
      setReady(false);
    };
  }, [iframe, projectId, enabled, loadCounter]);

  // Propagate componentPath changes onto an already-initialized tracer without
  // tearing the tracer down. The init effect above intentionally keeps
  // componentPath out of its deps (it would re-detect React + reopen the WS on
  // every component switch); this lightweight sync effect carries the prop
  // through instead.
  useEffect(() => {
    if (tracerRef.current) {
      tracerRef.current.renderedFile = componentPath ?? null;
    }
  }, [componentPath]);

  return { tracer: tracerRef.current, ready, clickRetryQueue: clickRetryQueueRef.current };
}
