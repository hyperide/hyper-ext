import { useEffect, useState } from 'react';
import { getPreviewIframe } from '@/lib/dom-utils';

interface UseIframeLoadTrackingOptions {
  /** Project is running and ready */
  enabled: boolean;
  /** Track instance elements in board mode */
  isBoardModeActive: boolean;
  /** Component name for logging */
  componentName?: string;
}

interface UseIframeLoadTrackingResult {
  /** Counter incremented on each iframe load */
  iframeLoadedCounter: number;
  /** Counter incremented when instance elements appear in DOM */
  instancesReadyCounter: number;
  /** Manually increment iframe loaded counter */
  triggerIframeReload: () => void;
}

/**
 * Tracks iframe load events and instance element appearance.
 * Used to trigger recomputation of overlays when iframe content changes.
 */
export function useIframeLoadTracking({
  enabled,
  isBoardModeActive,
  componentName,
}: UseIframeLoadTrackingOptions): UseIframeLoadTrackingResult {
  const [iframeLoadedCounter, setIframeLoadedCounter] = useState(0);
  const [instancesReadyCounter, setInstancesReadyCounter] = useState(0);

  // Track iframe load state to recompute boundaries when iframe reloads
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const iframe = getPreviewIframe();
    if (!iframe) {
      console.log('[useIframeLoadTracking] Iframe not found yet, will retry when mode/component changes');
      return;
    }

    const handleIframeLoad = () => {
      console.log('[useIframeLoadTracking] Iframe loaded, incrementing counter', componentName);
      setIframeLoadedCounter((prev) => prev + 1);
    };

    iframe.addEventListener('load', handleIframeLoad);

    return () => {
      iframe.removeEventListener('load', handleIframeLoad);
    };
  }, [enabled, componentName]);

  // Watch for instance elements appearing in iframe DOM
  // This triggers when React components inside iframe finish rendering
  useEffect(() => {
    const iframe = getPreviewIframe();
    const iframeDoc = iframe?.contentDocument;
    if (!iframeDoc || !isBoardModeActive) return;

    // Check if instances already exist
    const existingInstances = iframeDoc.querySelectorAll('[data-canvas-instance-id]');
    if (existingInstances.length > 0) {
      setInstancesReadyCounter((prev) => prev + 1);
      return;
    }

    // Watch for instance elements to appear
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
              if (node.hasAttribute('data-canvas-instance-id') || node.querySelector('[data-canvas-instance-id]')) {
                setInstancesReadyCounter((prev) => prev + 1);
                observer.disconnect();
                return;
              }
            }
          }
        }
      }
    });

    observer.observe(iframeDoc.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [iframeLoadedCounter, isBoardModeActive]);

  const triggerIframeReload = () => {
    setIframeLoadedCounter((prev) => prev + 1);
  };

  return {
    iframeLoadedCounter,
    instancesReadyCounter,
    triggerIframeReload,
  };
}
