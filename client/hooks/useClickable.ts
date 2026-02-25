/**
 * Hook for handling click events with drag detection and time threshold
 * Prevents click event if:
 * - Mouse moved more than maxDistance during click
 * - Click duration exceeded maxDuration
 */

import { useRef, useCallback, type MouseEvent } from 'react';

interface UseClickableOptions {
  /**
   * Maximum duration in milliseconds for a valid click
   * @default 500
   */
  maxDuration?: number;

  /**
   * Maximum distance in pixels that mouse can move during click
   * @default 5
   */
  maxDistance?: number;

  /**
   * Callback when a valid click is detected
   */
  onClick?: (e: MouseEvent) => void;

  /**
   * Callback when mousedown occurs
   */
  onMouseDown?: (e: MouseEvent) => void;

  /**
   * Callback when mouseup occurs (regardless of click validity)
   */
  onMouseUp?: (e: MouseEvent) => void;
}

interface UseClickableReturn {
  /**
   * Props to spread on the clickable element
   */
  clickableProps: {
    onMouseDown: (e: MouseEvent) => void;
    onMouseUp: (e: MouseEvent) => void;
  };
}

/**
 * Hook for handling click events with drag detection
 *
 * @example
 * ```tsx
 * const { clickableProps } = useClickable({
 *   maxDuration: 500,
 *   maxDistance: 5,
 *   onClick: (e) => console.log('Valid click!'),
 * });
 *
 * <button {...clickableProps}>Click me</button>
 * ```
 */
export function useClickable({
  maxDuration = 500,
  maxDistance = 5,
  onClick,
  onMouseDown,
  onMouseUp,
}: UseClickableOptions): UseClickableReturn {
  const clickStateRef = useRef<{
    mouseDownTime: number;
    mouseDownX: number;
    mouseDownY: number;
  }>({
    mouseDownTime: 0,
    mouseDownX: 0,
    mouseDownY: 0,
  });

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      clickStateRef.current = {
        mouseDownTime: Date.now(),
        mouseDownX: e.clientX,
        mouseDownY: e.clientY,
      };

      onMouseDown?.(e);
    },
    [onMouseDown]
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      const { mouseDownTime, mouseDownX, mouseDownY } = clickStateRef.current;

      // Check click duration
      const duration = Date.now() - mouseDownTime;
      if (duration > maxDuration) {
        onMouseUp?.(e);
        return;
      }

      // Check mouse movement distance
      const deltaX = e.clientX - mouseDownX;
      const deltaY = e.clientY - mouseDownY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      if (distance > maxDistance) {
        onMouseUp?.(e);
        return;
      }

      // Valid click detected
      onClick?.(e);
      onMouseUp?.(e);
    },
    [maxDuration, maxDistance, onClick, onMouseUp]
  );

  return {
    clickableProps: {
      onMouseDown: handleMouseDown,
      onMouseUp: handleMouseUp,
    },
  };
}
