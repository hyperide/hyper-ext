import { useCallback, useRef } from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';

const ANIMATION_DURATION = 150; // ms

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function useAnimatedPanelCollapse(
  panelRef: React.RefObject<PanelImperativeHandle | null>,
  options: {
    collapsedSize?: number;
    canExpand?: boolean;
    onCollapseStart?: () => void;
    onExpandStart?: () => void;
  } = {},
) {
  const { collapsedSize = 24, canExpand = true, onCollapseStart, onExpandStart } = options;
  const lastExpandedSize = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const isAnimating = useRef(false);

  const animateToSize = useCallback(
    (fromSize: number, toSize: number, onComplete?: () => void) => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      isAnimating.current = true;
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
        const easedProgress = easeOutCubic(progress);

        const currentSize = fromSize + (toSize - fromSize) * easedProgress;
        panelRef.current?.resize(currentSize);

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          animationRef.current = null;
          onComplete?.();
          // Delay clearing isAnimating to handle async onResize events from panel.collapse()
          requestAnimationFrame(() => {
            isAnimating.current = false;
          });
        }
      };

      animationRef.current = requestAnimationFrame(animate);
    },
    [panelRef],
  );

  const collapse = useCallback(() => {
    const panel = panelRef.current;
    if (!panel || panel.isCollapsed() || isAnimating.current) return;

    onCollapseStart?.();
    const currentSize = panel.getSize().inPixels;
    lastExpandedSize.current = currentSize;

    // Animate to collapsed size, then call collapse() to set proper state
    animateToSize(currentSize, collapsedSize, () => {
      panel.collapse();
    });
  }, [panelRef, collapsedSize, animateToSize, onCollapseStart]);

  const expand = useCallback(() => {
    const panel = panelRef.current;
    if (!panel || !panel.isCollapsed() || isAnimating.current || !canExpand) return;

    onExpandStart?.();
    const targetSize = lastExpandedSize.current ?? 100;

    // Set animating BEFORE panel.expand() to block onResize events
    isAnimating.current = true;

    // Call expand() first to exit collapsed state, then animate
    panel.expand();

    // Small delay to let expand() take effect
    requestAnimationFrame(() => {
      const currentSize = panel.getSize().inPixels;
      if (currentSize !== targetSize) {
        animateToSize(currentSize, targetSize);
      } else {
        // No animation needed, delay clearing the flag to handle async onResize events
        requestAnimationFrame(() => {
          isAnimating.current = false;
        });
      }
    });
  }, [panelRef, animateToSize, canExpand, onExpandStart]);

  const toggle = useCallback(() => {
    if (isAnimating.current) return;
    const panel = panelRef.current;
    if (!panel) return;

    if (panel.isCollapsed()) {
      expand();
    } else {
      collapse();
    }
  }, [panelRef, collapse, expand]);

  return { collapse, expand, toggle, isAnimating };
}
