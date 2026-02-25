/**
 * Hook for rendering iPhone bezel overlays on instances with matching size
 * Bezels are rendered outside iframe using RAF loop for performance
 */

import { useEffect, type RefObject } from "react";
import { getPreviewIframe } from "@/lib/dom-utils";

const IPHONE17_WIDTH = 402;
const IPHONE17_HEIGHT = 874;
const IPHONE17_SAFE_HEIGHT = 874 - 62 - 34; // 778

interface UseBezelOverlaysProps {
  overlayContainerRef: RefObject<HTMLDivElement>;
  iframeLoadedCounter: number;
  instanceSizes: Record<string, { width?: number; height?: number }>;
}

/**
 * Renders iPhone bezel images as overlays for instances with matching dimensions
 */
export function useBezelOverlays({
  overlayContainerRef,
  iframeLoadedCounter,
  instanceSizes,
}: UseBezelOverlaysProps) {
  useEffect(() => {
    const container = overlayContainerRef.current;
    if (!container) return;

    const iframe = getPreviewIframe();
    if (!iframe || !iframe.contentDocument) return;

    const iframeDoc = iframe.contentDocument;

    let rafId: number;
    const bezelElements = new Map<string, HTMLImageElement>();
    const statusbarElements = new Map<
      string,
      { container: HTMLDivElement; clock: HTMLDivElement }
    >();

    // Update clock every second
    const updateClocks = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes().toString().padStart(2, "0");
      const timeStr = `${hours}:${minutes}`;

      for (const { clock } of statusbarElements.values()) {
        clock.textContent = timeStr;
      }
    };

    const clockInterval = setInterval(updateClocks, 1000);

    const updateBezelOverlays = () => {
      const instanceElements = iframeDoc.querySelectorAll(
        "[data-canvas-instance-id]",
      );
      const activeBezelInstances = new Set<string>();
      const activeStatusbarInstances = new Set<string>();

      for (const element of instanceElements) {
        const instanceId = (element as HTMLElement).dataset.canvasInstanceId;
        if (!instanceId) continue;

        const size = instanceSizes[instanceId];
        const isIPhone17 =
          size?.width === IPHONE17_WIDTH && size?.height === IPHONE17_HEIGHT;
        const isIPhone17Safe =
          size?.width === IPHONE17_WIDTH &&
          size?.height === IPHONE17_SAFE_HEIGHT;

        // Handle full iPhone 17 bezel
        if (!isIPhone17) {
          const existing = bezelElements.get(instanceId);
          if (existing) {
            existing.remove();
            bezelElements.delete(instanceId);
          }
        }

        // Handle iPhone 17 Safe statusbar
        if (!isIPhone17Safe) {
          const existing = statusbarElements.get(instanceId);
          if (existing) {
            existing.container.remove();
            statusbarElements.delete(instanceId);
          }
        }

        if (!isIPhone17 && !isIPhone17Safe) {
          continue;
        }

        if (isIPhone17) {
          activeBezelInstances.add(instanceId);
        }
        if (isIPhone17Safe) {
          activeStatusbarInstances.add(instanceId);
        }

        // Get element's position within iframe
        const style = (element as HTMLElement).style;
        const left = Number.parseInt(style.left || "0", 10);
        const top = Number.parseInt(style.top || "0", 10);

        // Handle full iPhone 17 bezel
        if (isIPhone17) {
          let bezel = bezelElements.get(instanceId);

          if (!bezel) {
            bezel = document.createElement("img");
            bezel.src = "/iphone17.png";
            bezel.alt = "iPhone 17 Bezel";
            bezel.setAttribute("data-bezel-overlay", instanceId);
            bezel.style.cssText = `
							position: absolute;
							pointer-events: none;
							z-index: 30;
							width: 450px;
							height: 920px;
						`;
            container.appendChild(bezel);
            bezelElements.set(instanceId, bezel);
          }

          bezel.style.left = `${left - 24}px`;
          bezel.style.top = `${top - 24}px`;
        }

        // Handle iPhone 17 Safe statusbar
        if (isIPhone17Safe) {
          let statusbar = statusbarElements.get(instanceId);

          if (!statusbar) {
            // Create container for image + clock overlay
            const statusbarContainer = document.createElement("div");
            statusbarContainer.setAttribute(
              "data-statusbar-overlay",
              instanceId,
            );
            statusbarContainer.style.cssText = `
							position: absolute;
							pointer-events: none;
							z-index: 30;
							width: 450px;
							height: 886px;
						`;

            // Add bezel image
            const img = document.createElement("img");
            img.src = "/iphone17-statusbar.png";
            img.alt = "iPhone 17 Statusbar";
            img.style.cssText = `
							width: 100%;
							height: 100%;
						`;
            statusbarContainer.appendChild(img);

            // Add clock overlay
            const clock = document.createElement("div");
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes().toString().padStart(2, "0");
            clock.textContent = `${hours}:${minutes}`;
            clock.style.cssText = `
							position: absolute;
							top: 40px;
							left: 56px;
							font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
							font-size: 17px;
							font-weight: 600;
							color: #000;
							letter-spacing: 0px;
						`;
            statusbarContainer.appendChild(clock);

            container.appendChild(statusbarContainer);
            statusbar = { container: statusbarContainer, clock };
            statusbarElements.set(instanceId, statusbar);
          }

          // Position statusbar: shift up by 62px (statusbar height) + 24px (bezel padding)
          // so that safe area content aligns with the safe area in the image
          statusbar.container.style.left = `${left - 24}px`;
          statusbar.container.style.top = `${top - 24 - 62}px`;
        }
      }

      // Remove unused bezels
      for (const [instanceId, bezel] of bezelElements.entries()) {
        if (!activeBezelInstances.has(instanceId)) {
          bezel.remove();
          bezelElements.delete(instanceId);
        }
      }

      // Remove unused statusbars
      for (const [instanceId, statusbar] of statusbarElements.entries()) {
        if (!activeStatusbarInstances.has(instanceId)) {
          statusbar.container.remove();
          statusbarElements.delete(instanceId);
        }
      }

      rafId = requestAnimationFrame(updateBezelOverlays);
    };

    rafId = requestAnimationFrame(updateBezelOverlays);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(clockInterval);
      for (const bezel of bezelElements.values()) {
        bezel.remove();
      }
      bezelElements.clear();
      for (const statusbar of statusbarElements.values()) {
        statusbar.container.remove();
      }
      statusbarElements.clear();
    };
  }, [overlayContainerRef, iframeLoadedCounter, instanceSizes]);
}
