/**
 * Hook for rendering instance overlays (frames and badges) in multi-instance mode
 * Overlays are rendered outside iframe using RAF loop for performance
 * Implements drag & drop with 16px grid snap
 */

import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { GRID_SIZE, type ViewportState } from '@/../../shared/types/canvas';
import { IPHONE_SIZES } from '@/components/RightSidebar/constants';
import { getPreviewIframe } from '@/lib/dom-utils';
import { authFetch } from '@/utils/authFetch';

interface UseInstanceOverlaysProps {
  boardModeActive: boolean; // Show overlays only in board mode
  activeInstanceId: string | null; // Currently active instance in design mode
  selectedInstancesInBoard: string[]; // Selected instances in board mode (for visual highlighting)
  mode: 'design' | 'interact' | 'code'; // Engine mode to determine overlay behavior
  overlayContainerRef: RefObject<HTMLDivElement>;
  iframeLoadedCounter: number;
  projectId: string | undefined;
  componentPath: string | undefined;
  onSingleClick?: (instanceId: string) => void; // Called when instance frame is single-clicked
  onDoubleClick: (instanceId: string) => void; // Called when instance frame is double-clicked
  onBadgeClick?: (instanceId: string) => void; // Called when badge is clicked (not dragged)
  onInstanceMove?: (instanceId: string, x: number, y: number) => void; // Called when instance position changes
  onInstanceDragging?: (instanceId: string | null, deltaX: number, deltaY: number) => void; // Called during drag with current delta
  onInstanceDragEnd?: (instanceId: string, deltaX: number, deltaY: number) => void; // Called when drag ends with position delta
  viewport: ViewportState; // Viewport state for coordinate transformations
  instanceSizes?: Record<string, { width?: number; height?: number }>; // Instance sizes for bezel offset
  iframeScrollRef?: RefObject<{ x: number; y: number }>; // Iframe scroll offset for overlay positioning
  isReadonly?: boolean; // Block drag operations in readonly mode
}

/**
 * Renders instance frames and badges as overlays outside iframe
 * Shows in board mode and design mode (with different styles)
 * Implements drag & drop with grid snap and saves to canvas.json
 */
export function useInstanceOverlays({
  boardModeActive,
  activeInstanceId,
  selectedInstancesInBoard,
  mode,
  overlayContainerRef,
  iframeLoadedCounter,
  projectId,
  componentPath,
  onSingleClick,
  onDoubleClick,
  onBadgeClick,
  onInstanceMove,
  onInstanceDragging,
  onInstanceDragEnd,
  viewport,
  instanceSizes,
  iframeScrollRef,
  isReadonly = false,
}: UseInstanceOverlaysProps) {
  // Drag state stored in ref to avoid re-creating RAF loop
  const dragStateRef = useRef<{
    isDragging: boolean;
    instanceId: string | null;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  }>({
    isDragging: false,
    instanceId: null,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });

  // Double click detection state stored in ref to persist across effect re-runs
  // This fixes the issue where double clicks weren't detected when dependencies changed
  // between first and second click (e.g., viewport scroll, selection change)
  const doubleClickStateRef = useRef<{
    lastClickTime: number;
    lastClickInstanceId: string | null;
    singleClickTimer: NodeJS.Timeout | null;
  }>({
    lastClickTime: 0,
    lastClickInstanceId: null,
    singleClickTimer: null,
  });

  // Stable refs for drag handlers to prevent cleanup issues
  const handleDragMoveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const handleDragEndRef = useRef<(() => void) | null>(null);
  const listenersAttachedRef = useRef(false);

  // Persistent refs for data accessed by drag handlers
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const iframeDocRef = useRef<Document | null>(null);

  // Stable wrapper functions that always call the latest handlers from refs
  const stableHandleDragMove = useCallback((e: MouseEvent) => {
    handleDragMoveRef.current?.(e);
  }, []);

  const stableHandleDragEnd = useCallback(() => {
    handleDragEndRef.current?.();
  }, []);

  // Attach window listeners ONCE on mount, cleanup only on unmount
  useEffect(() => {
    window.addEventListener('mousemove', stableHandleDragMove);
    window.addEventListener('mouseup', stableHandleDragEnd);
    listenersAttachedRef.current = true;

    return () => {
      // Only cleanup on unmount
      window.removeEventListener('mousemove', stableHandleDragMove);
      window.removeEventListener('mouseup', stableHandleDragEnd);
      listenersAttachedRef.current = false;
    };
  }, [stableHandleDragMove, stableHandleDragEnd]);

  useEffect(() => {
    // Render overlays in both board mode and design mode (with different styles)
    // In single mode, activeInstanceId is null - this is expected, skip silently
    if (!boardModeActive && !activeInstanceId) {
      return;
    }
    if (!projectId || !componentPath) {
      return;
    }

    // console.log("[useInstanceOverlays] Effect triggered:", {
    //   boardModeActive,
    //   activeInstanceId,
    //   projectId,
    //   componentPath,
    // });

    const container = overlayContainerRef.current;
    if (!container) return;

    const iframe = getPreviewIframe();
    if (!iframe || !iframe.contentDocument) return;

    const iframeDoc = iframe.contentDocument;

    // Store iframe ref for drag handlers
    iframeRef.current = iframe;
    iframeDocRef.current = iframeDoc;

    let rafId: number;
    const overlayElements = new Map<string, { frame: HTMLDivElement; badge: HTMLDivElement }>();

    /**
     * Save instance position via PUT. Fires immediately (no debounce — called once per drag end).
     * Backend handles comment moving; dispatches canvas:comments-updated if comments were moved.
     */
    const savePosition = (instanceId: string, x: number, y: number) => {
      // Update React state immediately for responsive UI
      onInstanceMove?.(instanceId, x, y);

      authFetch(`/api/canvas-composition/${projectId}/instance/${encodeURIComponent(instanceId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentPath, updates: { x, y } }),
      })
        .then(async (response) => {
          if (!response.ok) {
            console.error('[DragDrop] Save failed:', response.statusText);
            return;
          }
          const data = await response.json();
          console.log('[DragDrop] Position saved:', { instanceId, x, y });
          if (data.commentsUpdated > 0) {
            window.dispatchEvent(new CustomEvent('canvas:comments-updated'));
          }
        })
        .catch((error) => {
          console.error('[DragDrop] Save error:', error);
        });
    };

    /**
     * Handle drag start on badge or frame
     */
    const handleDragStart = (instanceId: string, e: MouseEvent) => {
      // Block drag in readonly mode
      if (isReadonly) return;

      // Only left mouse button
      if (e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      // Get current position from iframe element
      const instanceElement = iframeDoc.querySelector(`[data-canvas-instance-id="${instanceId}"]`) as HTMLElement;

      if (!instanceElement) return;

      const rect = instanceElement.getBoundingClientRect();
      const style = instanceElement.style;

      // Parse current position (fallback to rect if not set)
      const currentX = style.left ? Number.parseInt(style.left, 10) : rect.left;
      const currentY = style.top ? Number.parseInt(style.top, 10) : rect.top;

      // Save initial state but DON'T set isDragging yet - wait for mouse movement
      dragStateRef.current = {
        isDragging: false, // Will be set to true in handleDragMove when mouse moves > 5px
        instanceId,
        startX: e.clientX,
        startY: e.clientY,
        initialX: currentX,
        initialY: currentY,
      };

      // Note: pointer-events will be disabled in handleDragMove after 5px threshold
      // to allow Playwright/browser to deliver initial mousemove events
      // Note: window listeners are already attached globally in separate useEffect
    };

    /**
     * Handle drag move
     */
    const handleDragMove = (e: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState.instanceId) {
        return;
      }

      const deltaX = e.clientX - dragState.startX;
      const deltaY = e.clientY - dragState.startY;

      // If not dragging yet, check if mouse moved enough to start drag (5px threshold)
      if (!dragState.isDragging) {
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (distance < 5) return; // Not enough movement yet

        // Start dragging
        dragStateRef.current.isDragging = true;

        // Disable pointer-events on iframe to prevent it from intercepting mouse events
        // This allows window mousemove listeners to work even when cursor is over iframe
        if (iframeRef.current) {
          iframeRef.current.style.pointerEvents = 'none';
        }

        // Disable text selection during drag
        document.body.style.userSelect = 'none';

        // Highlight frame during drag and set cursor to grabbing
        const overlay = overlayElements.get(dragState.instanceId);
        if (overlay) {
          overlay.frame.style.borderColor = '#60a5fa';
          overlay.badge.style.background = '#60a5fa';
          overlay.frame.style.cursor = 'grabbing';
          overlay.badge.style.cursor = 'grabbing';
        }
      }

      e.preventDefault();

      // Transform mouse delta from viewport space to iframe space
      // viewport.zoom is applied via CSS transform, so we need to divide by zoom
      const deltaXIframe = deltaX / viewport.zoom;
      const deltaYIframe = deltaY / viewport.zoom;

      let newX = dragState.initialX + deltaXIframe;
      let newY = dragState.initialY + deltaYIframe;

      // Grid snap (16px in iframe space)
      newX = Math.round(newX / GRID_SIZE) * GRID_SIZE;
      newY = Math.round(newY / GRID_SIZE) * GRID_SIZE;

      // Clamp to viewport (minimum 0)
      newX = Math.max(0, newX);
      newY = Math.max(0, newY);

      // Update iframe element position (iframe coordinates, before transform)
      const instanceElement = iframeDoc.querySelector(
        `[data-canvas-instance-id="${dragState.instanceId}"]`,
      ) as HTMLElement;

      if (instanceElement) {
        instanceElement.style.left = `${newX}px`;
        instanceElement.style.top = `${newY}px`;

        // Notify about current drag delta for real-time sticker movement
        const currentDeltaX = newX - dragState.initialX;
        const currentDeltaY = newY - dragState.initialY;
        onInstanceDragging?.(dragState.instanceId, currentDeltaX, currentDeltaY);
      }
    };

    /**
     * Handle drag end
     */
    const handleDragEnd = () => {
      const dragState = dragStateRef.current;

      // Note: window listeners stay attached globally, just clear drag state
      if (!dragState.instanceId) return; // No pending drag at all

      // Only save position if actual dragging happened
      if (dragState.isDragging) {
        // Re-enable text selection
        document.body.style.userSelect = '';

        const instanceElement = iframeDoc.querySelector(
          `[data-canvas-instance-id="${dragState.instanceId}"]`,
        ) as HTMLElement;

        if (instanceElement) {
          const style = instanceElement.style;
          const finalX = Number.parseInt(style.left || '0', 10);
          const finalY = Number.parseInt(style.top || '0', 10);

          // Save position to canvas.json
          savePosition(dragState.instanceId, finalX, finalY);

          // Notify about drag end with delta for moving comments
          const deltaX = finalX - dragState.initialX;
          const deltaY = finalY - dragState.initialY;
          console.log('[useInstanceOverlays] Drag ended:', {
            instanceId: dragState.instanceId,
            initialX: dragState.initialX,
            initialY: dragState.initialY,
            finalX,
            finalY,
            deltaX,
            deltaY,
            hasCallback: !!onInstanceDragEnd,
          });
          if ((deltaX !== 0 || deltaY !== 0) && onInstanceDragEnd) {
            onInstanceDragEnd(dragState.instanceId, deltaX, deltaY);
          }
        }

        // Clear drag state for real-time sticker movement
        onInstanceDragging?.(null, 0, 0);

        // Reset frame highlight and cursor
        const overlay = overlayElements.get(dragState.instanceId);
        if (overlay) {
          overlay.frame.style.borderColor = '#3b82f6';
          overlay.badge.style.background = '#3b82f6';
          overlay.frame.style.cursor = 'grab';
          overlay.badge.style.cursor = 'grab';
        }
        // Don't restore pointer-events here - RAF loop will do it on next frame
        // when isDragging is false
      }

      // Always clear drag state (even if drag didn't start)
      dragStateRef.current = {
        isDragging: false,
        instanceId: null,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
      };
    };

    // Assign handlers to refs so stable wrappers can call them
    handleDragMoveRef.current = handleDragMove;
    handleDragEndRef.current = handleDragEnd;

    const updateInstanceOverlays = () => {
      // Find all instance elements in iframe
      const instanceElements = iframeDoc.querySelectorAll('[data-canvas-instance-id]');
      const activeInstances = new Set<string>();

      // Update or create overlays for each instance
      for (const element of instanceElements) {
        const instanceId = (element as HTMLElement).dataset.canvasInstanceId;
        if (!instanceId) continue;

        activeInstances.add(instanceId);

        // Get element's position within iframe (in iframe coordinates)
        const style = (element as HTMLElement).style;
        const left = Number.parseInt(style.left || '0', 10);
        const top = Number.parseInt(style.top || '0', 10);

        // Get element's dimensions
        const rect = element.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;

        let overlay = overlayElements.get(instanceId);

        // Create overlay if doesn't exist
        if (!overlay) {
          // Create frame
          const frame = document.createElement('div');
          frame.setAttribute('data-instance-frame', instanceId);
          frame.style.cssText = `
            position: absolute;
            pointer-events: auto;
            box-shadow: 0 0 0 1px #3b82f6;
            z-index: 40;
            cursor: grab;
          `;
          container.appendChild(frame);

          // Create badge
          const badge = document.createElement('div');
          badge.setAttribute('data-instance-badge', instanceId);
          badge.style.cssText = `
            position: absolute;
            pointer-events: auto;
            background: #3b82f6;
            color: white;
            padding: 0px 4px;
            font-size: 10px;
            font-weight: 600;
            border-radius: 4px;
            cursor: grab;
            user-select: none;
            z-index: 41;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: background 0.15s ease-in-out;
            margin: 6px 0 0 -1px;
          `;
          // Show chevron only for active instance in design mode, or always in board mode
          const showChevron = boardModeActive || (mode === 'design' && instanceId === activeInstanceId);
          const chevronSvg = showChevron
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; opacity: 0.9;">
              <path d="M6 9l6 6l6 -6"></path>
            </svg>`
            : '';
          // VULN-002: Fixed XSS - use textContent instead of innerHTML for user data
          const instanceSpan = document.createElement('span');
          instanceSpan.textContent = instanceId;
          badge.innerHTML = ''; // nosemgrep: insecure-document-method -- clearing element, no user data
          badge.appendChild(instanceSpan);
          if (chevronSvg) {
            badge.insertAdjacentHTML('beforeend', chevronSvg);
          }
          badge.title = 'Drag to move, click to edit';
          container.appendChild(badge);

          // Add hover effect
          badge.addEventListener('mouseenter', () => {
            if (!dragStateRef.current.isDragging) {
              badge.style.background = '#2563eb'; // darker blue on hover
            }
          });
          badge.addEventListener('mouseleave', () => {
            if (!dragStateRef.current.isDragging) {
              badge.style.background = '#3b82f6';
            }
          });

          overlay = { frame, badge };
          overlayElements.set(instanceId, overlay);

          // Handle badge interactions (single click only, no design mode switch)
          let badgeMouseDownTime = 0;
          let badgeMouseDownX = 0;
          let badgeMouseDownY = 0;

          const handleBadgeMouseDown = (e: MouseEvent) => {
            badgeMouseDownTime = Date.now();
            badgeMouseDownX = e.clientX;
            badgeMouseDownY = e.clientY;
            // Only allow drag in board mode
            if (boardModeActive) {
              e.preventDefault();
              e.stopPropagation();
              handleDragStart(instanceId, e);
            }
          };

          const handleBadgeMouseUp = (e: MouseEvent) => {
            // If dragging happened, ignore clicks
            if (dragStateRef.current.isDragging) return;

            // Check click duration (max 500ms)
            const clickDuration = Date.now() - badgeMouseDownTime;
            if (clickDuration > 500) return;

            // Check mouse movement (max 5px)
            const deltaX = e.clientX - badgeMouseDownX;
            const deltaY = e.clientY - badgeMouseDownY;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            if (distance > 5) return;

            // Valid click - handle in both board mode and design mode
            if (onBadgeClick) {
              if (boardModeActive) {
                // In board mode: always open edit popup
                onBadgeClick(instanceId);
              } else if (mode === 'design') {
                // In design mode: click behavior handled by parent
                // Parent should check if this is active instance or not
                onBadgeClick(instanceId);
              }
            }
          };

          badge.addEventListener('mousedown', handleBadgeMouseDown);
          badge.addEventListener('mouseup', handleBadgeMouseUp);

          // Handle frame interactions (single click to select, double click to enter design mode)
          let frameMouseDownTime = 0;
          let frameMouseDownX = 0;
          let frameMouseDownY = 0;

          const handleFrameMouseDown = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            frameMouseDownTime = Date.now();
            frameMouseDownX = e.clientX;
            frameMouseDownY = e.clientY;
            // Only allow drag in board mode
            if (boardModeActive) {
              handleDragStart(instanceId, e);
            }
          };

          const handleFrameMouseUp = (e: MouseEvent) => {
            // If dragging happened, ignore clicks
            if (dragStateRef.current.isDragging) return;

            // Check click duration (max 500ms)
            const clickDuration = Date.now() - frameMouseDownTime;
            if (clickDuration > 500) return;

            // Check mouse movement (max 5px)
            const deltaX = e.clientX - frameMouseDownX;
            const deltaY = e.clientY - frameMouseDownY;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            if (distance > 5) return;

            // Valid click - check for double click (only in board mode)
            if (boardModeActive) {
              const now = Date.now();
              const dblClickState = doubleClickStateRef.current;
              // Only count as double click if it's on the same instance
              const isSameInstance = dblClickState.lastClickInstanceId === instanceId;
              const timeSinceLastClick = isSameInstance ? now - dblClickState.lastClickTime : Number.POSITIVE_INFINITY;

              if (timeSinceLastClick < 300) {
                // Double click detected
                if (dblClickState.singleClickTimer) {
                  clearTimeout(dblClickState.singleClickTimer);
                  dblClickState.singleClickTimer = null;
                }
                dblClickState.lastClickTime = 0; // Reset to prevent triple-click
                dblClickState.lastClickInstanceId = null;
                onDoubleClick(instanceId);
              } else {
                // Single click - wait to see if double click follows
                dblClickState.lastClickTime = now;
                dblClickState.lastClickInstanceId = instanceId;
                if (dblClickState.singleClickTimer) {
                  clearTimeout(dblClickState.singleClickTimer);
                }
                dblClickState.singleClickTimer = setTimeout(() => {
                  // No double click - execute single click
                  if (onSingleClick) {
                    onSingleClick(instanceId);
                  }
                  dblClickState.singleClickTimer = null;
                }, 300);
              }
            }
          };

          frame.addEventListener('mousedown', handleFrameMouseDown);
          frame.addEventListener('mouseup', handleFrameMouseUp);
        }

        // Update positions (subtract scroll offset for safety)
        const scroll = iframeScrollRef?.current ?? { x: 0, y: 0 };
        overlay.frame.style.left = `${left - scroll.x}px`;
        overlay.frame.style.top = `${top - scroll.y}px`;
        overlay.frame.style.width = `${width}px`;
        overlay.frame.style.height = `${height}px`;

        // Check if instance has bezel (iPhone 17) or statusbar (iPhone 17 Safe)
        const size = instanceSizes?.[instanceId];
        const hasFullBezel = size?.width === IPHONE_SIZES.bezel.width && size?.height === IPHONE_SIZES.bezel.height;
        const hasStatusbar = size?.width === IPHONE_SIZES.safe.width && size?.height === IPHONE_SIZES.safe.height;
        // Add border-radius when bezel/statusbar is present (matches iPhone rounded corners)
        // For statusbar: only bottom corners are rounded (top is cut off at safe area)
        if (hasFullBezel) {
          overlay.frame.style.borderRadius = IPHONE_SIZES.bezel.borderRadius;
        } else if (hasStatusbar) {
          overlay.frame.style.borderRadius = IPHONE_SIZES.safe.borderRadius;
        } else {
          overlay.frame.style.borderRadius = '0';
        }
        // Position badge above frame (26px = badge height with padding + 6px gap)
        // Add extra offset when bezel/statusbar is present (extends above content)
        // Full bezel: 24px above, Statusbar: 62px above (statusbar height)
        const badgeOffset = hasFullBezel ? 50 : hasStatusbar ? 88 : 26;
        overlay.badge.style.left = `${left - scroll.x}px`;
        overlay.badge.style.top = `${top - badgeOffset - scroll.y}px`;

        // Opacity: in board mode - selected instance is highlighted, in design/interact mode - active instance is highlighted
        const isActive = instanceId === activeInstanceId;
        const isSelectedInBoard = selectedInstancesInBoard.includes(instanceId);
        const opacity = boardModeActive
          ? isSelectedInBoard
            ? '1'
            : '0.5' // Board mode: highlight selected
          : isActive
            ? '1'
            : '0.5'; // Design/interact mode: highlight active
        overlay.frame.style.opacity = opacity;
        overlay.badge.style.opacity = opacity;

        // Pointer events: in board mode - frame handles interaction, in design/interact - frame transparent for clicks
        // IMPORTANT: Don't change pointer-events during drag - handleDragStart sets them to 'none'
        // Check both isDragging AND instanceId (pointer-events disabled on mousedown, before drag starts)
        if (!dragStateRef.current.instanceId) {
          overlay.frame.style.pointerEvents = boardModeActive ? 'auto' : 'none';
          overlay.badge.style.pointerEvents = 'auto';
        }
      }

      // Restore iframe pointer-events after drag ends
      // In board mode: iframe should have pointer-events: none for click passthrough to Excalidraw
      if (!dragStateRef.current.instanceId && iframeRef.current) {
        iframeRef.current.style.pointerEvents = boardModeActive ? 'none' : 'auto';
      }

      // Remove unused overlays
      for (const [instanceId, overlay] of overlayElements.entries()) {
        if (!activeInstances.has(instanceId)) {
          overlay.frame.remove();
          overlay.badge.remove();
          overlayElements.delete(instanceId);
        }
      }

      rafId = requestAnimationFrame(updateInstanceOverlays);
    };

    // Start RAF loop
    rafId = requestAnimationFrame(updateInstanceOverlays);

    return () => {
      cancelAnimationFrame(rafId);

      // Note: window listeners are managed by separate useEffect with empty deps

      // Reset cursor and user-select
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      // Clean up all overlays
      for (const overlay of overlayElements.values()) {
        overlay.frame.remove();
        overlay.badge.remove();
      }
      overlayElements.clear();
    };
    // iframeLoadedCounter is intentionally included to restart when iframe reloads
    // stableHandleDragMove and stableHandleDragEnd are intentionally excluded - they're stable
    // viewport is included for zoom-aware drag & drop
    // isReadonly is included to update drag behavior when role changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    boardModeActive,
    activeInstanceId,
    selectedInstancesInBoard,
    mode,
    overlayContainerRef,
    iframeLoadedCounter,
    projectId,
    componentPath,
    onSingleClick,
    onDoubleClick,
    onBadgeClick,
    onInstanceMove,
    onInstanceDragging,
    onInstanceDragEnd,
    viewport,
    instanceSizes,
    isReadonly,
  ]);
}
