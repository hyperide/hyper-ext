/**
 * Hook for rendering off-screen instance indicators (arrows on canvas edges)
 * Shows arrows pointing to instances that are outside the visible viewport
 */

import type { ViewportState } from '@/../../shared/types/canvas';
import { getPreviewIframe } from '@/lib/dom-utils';
import { useEffect, type RefObject } from 'react';

interface UseOffscreenIndicatorsProps {
  enabled: boolean; // Only show in board mode
  overlayContainerRef: RefObject<HTMLDivElement>;
  viewport: ViewportState;
  iframeLoadedCounter: number;
}

interface InstanceBounds {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

type Edge = 'top' | 'bottom' | 'left' | 'right';

interface EdgeIndicator {
  edge: Edge;
  position: number; // Position along the edge (0-1)
  count: number;
  instanceIds: string[];
}

/**
 * Renders arrow indicators on viewport edges pointing to off-screen instances
 */
export function useOffscreenIndicators({
  enabled,
  overlayContainerRef,
  viewport,
  iframeLoadedCounter,
}: UseOffscreenIndicatorsProps) {
  useEffect(() => {
    if (!enabled) return;

    const container = overlayContainerRef.current;
    if (!container) return;

    const iframe = getPreviewIframe();
    if (!iframe?.contentDocument) return;

    const iframeDoc = iframe.contentDocument;

    let rafId: number;
    const indicatorElements = new Map<string, HTMLDivElement>();

    // Arrow SVG for each direction
    const arrowSvg = (rotation: number) => `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="transform: rotate(${rotation}deg)">
        <path d="M12 4l-8 8h6v8h4v-8h6z"/>
      </svg>
    `;

    const updateIndicators = () => {
      const containerRect = container.getBoundingClientRect();
      const viewportWidth = containerRect.width;
      const viewportHeight = containerRect.height;

      // Get all instance elements and their bounds
      const instanceElements = iframeDoc.querySelectorAll('[data-canvas-instance-id]');
      const instances: InstanceBounds[] = [];

      for (const element of instanceElements) {
        const htmlElement = element as HTMLElement;
        const instanceId = htmlElement.dataset.canvasInstanceId;
        if (!instanceId) continue;

        // Get position in iframe coordinates
        const left = Number.parseInt(htmlElement.style.left || '0', 10);
        const top = Number.parseInt(htmlElement.style.top || '0', 10);
        const rect = htmlElement.getBoundingClientRect();
        const width = rect.width / viewport.zoom;
        const height = rect.height / viewport.zoom;

        instances.push({
          id: instanceId,
          left,
          top,
          right: left + width,
          bottom: top + height,
          centerX: left + width / 2,
          centerY: top + height / 2,
        });
      }

      // Calculate visible area in iframe coordinates
      const visibleLeft = -viewport.panX / viewport.zoom;
      const visibleTop = -viewport.panY / viewport.zoom;
      const visibleRight = visibleLeft + viewportWidth / viewport.zoom;
      const visibleBottom = visibleTop + viewportHeight / viewport.zoom;

      // Find instances that are completely outside visible area
      const offscreenInstances: { instance: InstanceBounds; edges: Edge[] }[] = [];

      for (const instance of instances) {
        const edges: Edge[] = [];

        // Check if instance is completely outside viewport
        const isCompletelyOutside =
          instance.right < visibleLeft ||
          instance.left > visibleRight ||
          instance.bottom < visibleTop ||
          instance.top > visibleBottom;

        if (!isCompletelyOutside) continue;

        // Determine which edges to show arrow on
        if (instance.bottom < visibleTop) edges.push('top');
        if (instance.top > visibleBottom) edges.push('bottom');
        if (instance.right < visibleLeft) edges.push('left');
        if (instance.left > visibleRight) edges.push('right');

        if (edges.length > 0) {
          offscreenInstances.push({ instance, edges });
        }
      }

      // Group indicators by edge and position
      const edgeIndicators: Map<string, EdgeIndicator> = new Map();

      for (const { instance, edges } of offscreenInstances) {
        for (const edge of edges) {
          // Calculate position along edge (normalized 0-1)
          let position: number;
          if (edge === 'top' || edge === 'bottom') {
            // Clamp X position to visible range
            const clampedX = Math.max(visibleLeft, Math.min(visibleRight, instance.centerX));
            position = (clampedX - visibleLeft) / (visibleRight - visibleLeft);
          } else {
            // Clamp Y position to visible range
            const clampedY = Math.max(visibleTop, Math.min(visibleBottom, instance.centerY));
            position = (clampedY - visibleTop) / (visibleBottom - visibleTop);
          }

          // Round position to bucket nearby indicators together
          const bucketSize = 0.1; // 10% of edge width
          const bucketedPosition = Math.round(position / bucketSize) * bucketSize;
          const key = `${edge}-${bucketedPosition.toFixed(2)}`;

          const existing = edgeIndicators.get(key);
          if (existing) {
            existing.count++;
            existing.instanceIds.push(instance.id);
          } else {
            edgeIndicators.set(key, {
              edge,
              position: bucketedPosition,
              count: 1,
              instanceIds: [instance.id],
            });
          }
        }
      }

      // Track which indicators we're using this frame
      const activeKeys = new Set<string>();

      // Create/update indicator elements
      for (const [key, indicator] of edgeIndicators) {
        activeKeys.add(key);

        let element = indicatorElements.get(key);
        if (!element) {
          element = document.createElement('div');
          element.setAttribute('data-offscreen-indicator', key);
          element.style.cssText = `
            position: absolute;
            pointer-events: none;
            color: #3b82f6;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 50;
            font-size: 10px;
            font-weight: 600;
          `;
          container.appendChild(element);
          indicatorElements.set(key, element);
        }

        // Position the indicator
        const margin = 8;
        const size = 24;

        let x: number;
        let y: number;
        let rotation: number;

        switch (indicator.edge) {
          case 'top':
            x = indicator.position * viewportWidth - size / 2;
            y = margin;
            rotation = 0;
            break;
          case 'bottom':
            x = indicator.position * viewportWidth - size / 2;
            y = viewportHeight - size - margin;
            rotation = 180;
            break;
          case 'left':
            x = margin;
            y = indicator.position * viewportHeight - size / 2;
            rotation = -90;
            break;
          case 'right':
            x = viewportWidth - size - margin;
            y = indicator.position * viewportHeight - size / 2;
            rotation = 90;
            break;
        }

        // Clamp to viewport bounds
        x = Math.max(margin, Math.min(viewportWidth - size - margin, x));
        y = Math.max(margin, Math.min(viewportHeight - size - margin, y));

        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
        element.style.width = `${size}px`;
        element.style.height = `${size}px`;

        // Show count if multiple instances
        if (indicator.count > 1) {
          element.innerHTML = `${arrowSvg(rotation)}<span style="position:absolute;top:-4px;right:-4px;background:#3b82f6;color:white;border-radius:50%;width:14px;height:14px;display:flex;align-items:center;justify-content:center;font-size:9px;">${indicator.count}</span>`; // nosemgrep: insecure-document-method -- arrowSvg() returns hardcoded SVG with numeric rotation, indicator.count is a number
        } else {
          element.innerHTML = arrowSvg(rotation); // nosemgrep: insecure-document-method -- arrowSvg() returns hardcoded SVG with numeric rotation, no user input
        }
      }

      // Remove unused indicators
      for (const [key, element] of indicatorElements) {
        if (!activeKeys.has(key)) {
          element.remove();
          indicatorElements.delete(key);
        }
      }

      rafId = requestAnimationFrame(updateIndicators);
    };

    // Start RAF loop
    rafId = requestAnimationFrame(updateIndicators);

    return () => {
      cancelAnimationFrame(rafId);

      // Clean up all indicators
      for (const element of indicatorElements.values()) {
        element.remove();
      }
      indicatorElements.clear();
    };
  }, [enabled, overlayContainerRef, viewport, iframeLoadedCounter]);
}
