import { useMemo, useState, useEffect } from 'react';
import type { OverlayElementResolver } from '@shared/canvas-interaction/types';
import { isContainerEmpty } from '@shared/canvas-interaction/empty-container-placeholders';
import { getActiveTracer, subscribeToTracer } from '@/lib/element-tracing/active-tracer';
import { getPreviewIframe } from '@/lib/dom-utils';
import type { CanvasEngine } from '@/lib/canvas-engine';
import { resolveUuidToNodeRef } from '@/lib/element-tracing/id-bridge';

export function useElementResolver(
  iframeLoadedCounter: number,
  engine: CanvasEngine | null,
): OverlayElementResolver | undefined {
  const [tracerVersion, setTracerVersion] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribeToTracer(() => setTracerVersion((v) => v + 1));
    return unsubscribe;
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => {
    if (!engine) return undefined;
    const tracer = getActiveTracer();
    if (!tracer) return undefined;

    return {
      findElements(id: string, itemIndex: number | null): HTMLElement[] {
        const elements = tracer.findDOMElements(id, itemIndex);
        if (elements.length > 0) return elements;
        const nodeRef = resolveUuidToNodeRef(id, engine);
        if (nodeRef !== id) {
          return tracer.findDOMElements(nodeRef, itemIndex);
        }
        return [];
      },
      findEmptyContainers(): Array<{ elementId: string; element: HTMLElement }> {
        const iframe = getPreviewIframe();
        const doc = iframe?.contentDocument;
        const root = doc?.body?.firstElementChild;
        if (!root) return [];

        const tree = tracer.walkComponentTree(root as HTMLElement);
        const sourceIndex = tracer.buildSourceKeyIndex();
        const results: Array<{ elementId: string; element: HTMLElement }> = [];

        function visit(nodes: typeof tree): void {
          for (const node of nodes) {
            if (node.domElement && node.source && isContainerEmpty(node.domElement)) {
              const key = tracer!.makeSourceKey(node.source);
              const entry = sourceIndex.get(key);
              if (entry) {
                results.push({ elementId: entry.nodeRef, element: node.domElement });
              }
            }
            visit(node.children);
          }
        }

        visit(tree);
        return results;
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeLoadedCounter, tracerVersion, engine]);
}
