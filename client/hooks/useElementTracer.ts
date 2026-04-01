/**
 * @file Hook to manage ElementTracer lifecycle — creates adapter, transport, and tracer
 * when iframe content loads and React is detected.
 *
 * Accessed via: IframeCanvas.tsx
 * Assumptions: Iframe is same-origin (SaaS proxy); React dev mode with _debugSource present.
 */

import { useEffect, useRef, useState } from 'react';
import { setActiveTracer } from '@/lib/element-tracing/active-tracer';
import { ElementTracer } from '@/lib/element-tracing/element-tracer';
import { hookIntoReactCommits } from '@/lib/element-tracing/fiber-source-index';
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

    const doc = iframe.contentDocument;
    const iframeWindow = iframe.contentWindow;
    if (!doc || !iframeWindow) return;

    let disposed = false;
    let detectTimer: ReturnType<typeof setTimeout> | null = null;
    let unhookCommits: (() => void) | null = null;

    /**
     * Try to detect React and initialize the tracer.
     * React may not be hydrated yet when the iframe fires its load event,
     * so we retry with a short interval.
     */
    function tryInit(attempt: number): void {
      if (disposed) return;

      const adapter = new ReactAdapter(doc);
      if (!adapter.detect(doc)) {
        if (attempt < MAX_DETECT_ATTEMPTS) {
          detectTimer = setTimeout(() => tryInit(attempt + 1), DETECT_INTERVAL_MS);
        }
        return;
      }

      const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/element-tracing/${projectId}`;
      const transport = new WSTracingTransport(() => new WebSocket(wsUrl));
      const tracer = new ElementTracer(adapter, transport);

      // Hook into React commit cycle inside the iframe to invalidate FiberSourceIndex
      unhookCommits = hookIntoReactCommits(adapter.getSourceIndex(), iframeWindow as unknown as typeof globalThis);

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
