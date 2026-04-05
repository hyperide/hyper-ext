/**
 * @file Hook to manage ElementTracer lifecycle — creates adapter, transport, and tracer
 * when iframe content loads and React is detected.
 *
 * Accessed via: IframeCanvas.tsx
 * Assumptions: Iframe is same-origin (SaaS proxy); React dev mode with _debugSource present.
 */

import { findNearestSourceLocation } from '@shared/element-tracing/fiber-internals';
import { useEffect, useRef, useState } from 'react';
import { setActiveTracer } from '@/lib/element-tracing/active-tracer';
import { ElementTracer } from '@/lib/element-tracing/element-tracer';
import { FiberSourceIndex, hookIntoReactCommits } from '@/lib/element-tracing/fiber-source-index';
import type { Fiber } from '@/lib/element-tracing/fiber-utils';
import { FiberTag, getFiberFromDOM } from '@/lib/element-tracing/fiber-utils';
import { ReactAdapter } from '@/lib/element-tracing/react-adapter';
import { WSTracingTransport } from '@/lib/element-tracing/ws-tracing-transport';

interface UseElementTracerOptions {
  iframe: HTMLIFrameElement | null;
  projectId: string;
  enabled: boolean;
  /** Incrementing counter that signals iframe content has reloaded (new document). */
  loadCounter?: number;
}

interface UseElementTracerResult {
  tracer: ElementTracer | null;
  ready: boolean;
}

/** Max attempts to detect React inside iframe after load (200ms intervals). */
const MAX_DETECT_ATTEMPTS = 15;
const DETECT_INTERVAL_MS = 200;

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
}: UseElementTracerOptions): UseElementTracerResult {
  const tracerRef = useRef<ElementTracer | null>(null);
  const [ready, setReady] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadCounter forces re-init when iframe reloads (new document)
  useEffect(() => {
    if (!iframe || !enabled || !projectId) {
      // Tear down if conditions no longer met
      if (tracerRef.current) {
        tracerRef.current.dispose();
        tracerRef.current = null;
        setReady(false);
      }
      return;
    }

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

      const doc = iframe.contentDocument;
      const iframeWindow = iframe.contentWindow;
      if (!doc || !iframeWindow) {
        if (attempt < MAX_DETECT_ATTEMPTS) {
          detectTimer = setTimeout(() => tryInit(attempt + 1), DETECT_INTERVAL_MS);
        }
        return;
      }

      // Use cross-realm safe detection (nodeType, not instanceof HTMLElement)
      const detected = detectReactInIframe(doc);
      if (attempt === 0 || attempt === MAX_DETECT_ATTEMPTS || detected) {
        console.log(`[Tracer] attempt=${attempt} detected=${detected} body=${doc.body?.children.length}`);
      }
      if (!detected) {
        if (attempt < MAX_DETECT_ATTEMPTS) {
          detectTimer = setTimeout(() => tryInit(attempt + 1), DETECT_INTERVAL_MS);
        }
        return;
      }

      const adapter = new ReactAdapter(doc);

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
      const sourceIndex = new FiberSourceIndex(crossRealmRootProvider, doc);
      // Replace adapter's sourceIndex with our cross-realm safe one
      (adapter as unknown as { sourceIndex: FiberSourceIndex }).sourceIndex = sourceIndex;

      const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/element-tracing/${projectId}`;
      const transport = new WSTracingTransport(() => new WebSocket(wsUrl));
      const tracer = new ElementTracer(adapter, transport);

      // Hook into React commit cycle inside the iframe to invalidate FiberSourceIndex
      unhookCommits = hookIntoReactCommits(sourceIndex, iframeWindow as unknown as typeof globalThis);

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
      if (tracerRef.current) {
        tracerRef.current.dispose();
        tracerRef.current = null;
        setActiveTracer(null);
      }
      setReady(false);
    };
  }, [iframe, projectId, enabled, loadCounter]);

  return { tracer: tracerRef.current, ready };
}
