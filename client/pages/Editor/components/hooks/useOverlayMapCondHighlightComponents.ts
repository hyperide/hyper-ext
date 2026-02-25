import { type MutableRefObject, useEffect } from 'react';
import type { ViewportState } from '@/../../shared/types/canvas';
import type { CondBoundary } from '@/components/CondOverlay';
import type { MapBoundary } from '@/components/MapOverlay';
import type { useComponentMeta } from '@/contexts/ComponentMetaContext';
import type { CanvasEngine } from '@/lib/canvas-engine';
import type { ASTNode } from '@/lib/canvas-engine/types/ast';
import { getPreviewIframe } from '@/lib/dom-utils';
import type { ProjectData } from './useProjectControl';

/** Direct DOM rendering of overlays with requestAnimationFrame */
export function useOverlayMapCondHighlightComponents(
  activeProject: ProjectData | null,
  mode: string,
  overlayContainerRef: MutableRefObject<HTMLDivElement>,
  engine: CanvasEngine,
  setEditingMapBoundary: React.Dispatch<React.SetStateAction<MapBoundary>>,
  setEditingCondBoundary: React.Dispatch<React.SetStateAction<CondBoundary>>,
  meta: ReturnType<typeof useComponentMeta>['meta'],
  iframeLoadedCounter: number,
  storeUpdateCounter: number,
  viewport: ViewportState,
) {
  useEffect(() => {
    if (!activeProject || activeProject.status !== 'running' || mode !== 'design') {
      // Clear overlays when not in design mode
      if (overlayContainerRef.current) {
        overlayContainerRef.current.innerHTML = ''; // nosemgrep: insecure-document-method -- clearing container, no user data
      }
      return;
    }

    const iframe = getPreviewIframe();
    if (!iframe || !iframe.contentDocument || !iframe.contentWindow) {
      console.log('[CondMapOverlay] iframe not ready:', {
        iframe: !!iframe,
        contentDocument: !!iframe?.contentDocument,
        contentWindow: !!iframe?.contentWindow,
      });
      return;
    }

    const root = engine.getRoot();
    if (!Array.isArray(root.metadata?.astStructure)) {
      console.log('[CondMapOverlay] astStructure not ready');
      return;
    }
    const astStructure = root.metadata.astStructure as ASTNode[];

    const container = overlayContainerRef.current;
    if (!container) {
      console.log('[CondMapOverlay] container not ready');
      return;
    }

    // console.log("[CondMapOverlay] Starting RAF loop, astStructure has", root.metadata.astStructure.length, "nodes");

    let rafId: number | null = null;
    let isRunning = true;
    const overlayElements = new Map<string, { border: HTMLDivElement; label: HTMLDivElement }>();

    const updateOverlays = () => {
      if (!isRunning) return;

      const doc = iframe.contentDocument;
      if (!doc) return;
      const iframeRect = iframe.getBoundingClientRect();
      const zoom = viewport.zoom;

      const currentKeys = new Set<string>();
      const processedMapIds = new Set<string>();

      // Helper to find canvas instance container (closest parent with data-canvas-instance-id)
      const getCanvasInstanceId = (el: Element): string => {
        let current: Element | null = el;
        while (current) {
          const instanceId = current.getAttribute('data-canvas-instance-id');
          if (instanceId) {
            return instanceId;
          }
          current = current.parentElement;
        }
        return 'root'; // No canvas instance found
      };

      // Find and render map boundaries (grouped by instance container)
      const findMapItems = (nodes: ASTNode[], depth: number = 0) => {
        for (const node of nodes) {
          if (node.mapItem && node.id) {
            const mapId = node.id;
            if (processedMapIds.has(mapId)) {
              continue;
            }

            const mapElements = doc.querySelectorAll(`[data-uniq-id="${mapId}"]`);
            if (mapElements.length > 0) {
              // Group elements by their instance container
              const instanceGroups = new Map<string, HTMLElement[]>();

              mapElements.forEach((el) => {
                const canvasInstanceId = getCanvasInstanceId(el);
                const group = instanceGroups.get(canvasInstanceId) ?? [];
                group.push(el as HTMLElement);
                instanceGroups.set(canvasInstanceId, group);
              });

              // Create overlay for each instance group
              let groupIndex = 0;
              for (const [instanceId, groupElements] of instanceGroups) {
                let minLeft = Infinity;
                let minTop = Infinity;
                let maxRight = -Infinity;
                let maxBottom = -Infinity;

                groupElements.forEach((el) => {
                  const rect = el.getBoundingClientRect();
                  minLeft = Math.min(minLeft, rect.left);
                  minTop = Math.min(minTop, rect.top);
                  maxRight = Math.max(maxRight, rect.right);
                  maxBottom = Math.max(maxBottom, rect.bottom);
                });

                const borderOpacity = Math.max(0.3, 1 - depth * 0.2);
                const key = `map-${mapId}-${instanceId}-${groupIndex}`;
                currentKeys.add(key);

                let elements = overlayElements.get(key);
                if (!elements) {
                  // Create new elements
                  const border = document.createElement('div');
                  border.style.position = 'absolute';
                  border.style.border = '1px dashed rgb(168, 85, 247)';
                  border.style.pointerEvents = 'none';
                  container.appendChild(border);

                  const label = document.createElement('div');
                  label.style.position = 'absolute';
                  label.style.padding = '0 4px';
                  label.style.height = '10px';
                  label.style.background = 'rgb(243, 232, 255)';
                  label.style.borderRadius = '0 0 4px 0';
                  label.style.boxShadow = 'inset -1px -1px 4px rgba(0,0,0,0.1), inset 1px 1px 4px #fff';
                  label.style.color = 'rgb(17, 24, 39)';
                  label.style.fontSize = '8px';
                  label.style.lineHeight = '10px';
                  label.style.display = 'flex';
                  label.style.alignItems = 'center';
                  label.style.cursor = 'pointer';
                  label.style.pointerEvents = 'auto';
                  label.textContent = 'map';
                  label.addEventListener('click', () => {
                    setEditingMapBoundary({
                      parentMapId: node.mapItem.parentMapId,
                      depth,
                      rect: new DOMRect(
                        iframeRect.left + minLeft,
                        iframeRect.top + minTop,
                        maxRight - minLeft,
                        maxBottom - minTop,
                      ),
                      expression: node.mapItem.expression || '',
                      elementId: node.id,
                    });
                  });
                  container.appendChild(label);

                  elements = { border, label };
                  overlayElements.set(key, elements);
                }

                // Update positions (multiply iframe-internal coordinates by zoom)
                elements.border.style.left = `${iframeRect.left + minLeft * zoom}px`;
                elements.border.style.top = `${iframeRect.top + minTop * zoom}px`;
                elements.border.style.width = `${(maxRight - minLeft) * zoom}px`;
                elements.border.style.height = `${(maxBottom - minTop) * zoom}px`;
                elements.border.style.opacity = `${borderOpacity}`;

                elements.label.style.left = `${iframeRect.left + minLeft * zoom}px`;
                elements.label.style.top = `${iframeRect.top + minTop * zoom}px`;

                groupIndex++;
              }

              processedMapIds.add(mapId);
            }
            continue;
          }

          if (node.children) {
            findMapItems(node.children, depth);
          }
        }
      };

      // Find and render cond boundaries (each element separately)
      const findCondItems = (nodes: ASTNode[]) => {
        for (const node of nodes) {
          if (node.condItem && node.id) {
            const condElements = doc.querySelectorAll(`[data-uniq-id="${node.id}"]`);

            condElements.forEach((el, index) => {
              const rect = (el as HTMLElement).getBoundingClientRect();
              const labelText =
                node.condItem.branch === 'case' && node.condItem.index !== undefined
                  ? `case ${node.condItem.index}`
                  : node.condItem.branch;

              const key = `cond-${node.id}-${index}`;
              currentKeys.add(key);

              let elements = overlayElements.get(key);
              if (!elements) {
                // Create new elements
                const border = document.createElement('div');
                border.style.position = 'absolute';
                border.style.border = '1px dashed rgb(249, 115, 22)';
                border.style.opacity = '0.6';
                border.style.pointerEvents = 'none';
                container.appendChild(border);

                const label = document.createElement('div');
                label.style.position = 'absolute';
                label.style.padding = '0 4px';
                label.style.height = '10px';
                label.style.background = 'rgb(254, 243, 199)';
                label.style.borderRadius = '0 0 4px 0';
                label.style.boxShadow = 'inset -1px -1px 4px rgba(0,0,0,0.1), inset 1px 1px 4px #fff';
                label.style.color = 'rgb(17, 24, 39)';
                label.style.fontSize = '8px';
                label.style.lineHeight = '10px';
                label.style.display = 'flex';
                label.style.alignItems = 'center';
                label.style.cursor = 'pointer';
                label.style.pointerEvents = 'auto';
                label.textContent = labelText;
                label.addEventListener('click', () => {
                  setEditingCondBoundary({
                    condId: node.condItem.condId,
                    type: node.condItem.type,
                    branch: node.condItem.branch,
                    index: node.condItem.index,
                    expression: node.condItem.expression,
                    elementId: node.id,
                    rect: new DOMRect(iframeRect.left + rect.left, iframeRect.top + rect.top, rect.width, rect.height),
                  });
                });
                container.appendChild(label);

                elements = { border, label };
                overlayElements.set(key, elements);
              }

              // Update positions (multiply iframe-internal coordinates by zoom)
              elements.border.style.left = `${iframeRect.left + rect.left * zoom}px`;
              elements.border.style.top = `${iframeRect.top + rect.top * zoom}px`;
              elements.border.style.width = `${rect.width * zoom}px`;
              elements.border.style.height = `${rect.height * zoom}px`;

              elements.label.style.left = `${iframeRect.left + rect.left * zoom}px`;
              elements.label.style.top = `${iframeRect.top + rect.top * zoom}px`;
            });

            if (node.children) {
              findCondItems(node.children);
            }
            continue;
          }

          if (node.children) {
            findCondItems(node.children);
          }
        }
      };

      findMapItems(astStructure);
      findCondItems(astStructure);

      // Remove elements that are no longer needed
      for (const [key, elements] of overlayElements.entries()) {
        if (!currentKeys.has(key)) {
          elements.border.remove();
          elements.label.remove();
          overlayElements.delete(key);
        }
      }

      rafId = requestAnimationFrame(updateOverlays);
    };

    // Start animation loop
    rafId = requestAnimationFrame(updateOverlays);

    return () => {
      isRunning = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (container) {
        container.innerHTML = ''; // nosemgrep: insecure-document-method -- clearing container, no user data
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- meta?.componentName, iframeLoadedCounter, storeUpdateCounter are triggers to re-run effect when AST structure updates
  }, [
    activeProject,
    engine,
    meta?.componentName,
    iframeLoadedCounter,
    storeUpdateCounter,
    mode,
    setEditingMapBoundary,
    setEditingCondBoundary,
    viewport.zoom,
  ]);
}
