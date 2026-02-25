import { useCallback, useRef, useState } from 'react';

type ResizeDirection = 'horizontal' | 'vertical';

interface UseResizeHandleOptions {
  direction: ResizeDirection;
  value: number;
  onChange: (value: number) => void;
  minValue: number;
  maxValue: number;
  /** If true, dragging "up" or "left" increases value (default: false) */
  inverted?: boolean;
}

/**
 * Hook for handling resize drag operations.
 * Returns isDragging so the consumer can render a React overlay (portal)
 * that prevents iframe from stealing events during drag.
 */
export function useResizeHandle({
  direction,
  value,
  onChange,
  minValue,
  maxValue,
  inverted = false,
}: UseResizeHandleOptions) {
  const startRef = useRef<{ pos: number; value: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startPos = direction === 'horizontal' ? e.clientX : e.clientY;
      startRef.current = { pos: startPos, value };
      setIsDragging(true);

      // Body cursor + user-select — applied immediately for visual consistency
      const cursorStyle = direction === 'horizontal' ? 'ew-resize' : 'ns-resize';
      document.body.style.cursor = cursorStyle;
      document.body.style.userSelect = 'none';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!startRef.current) return;
        const currentPos = direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY;
        const rawDelta = currentPos - startRef.current.pos;
        const delta = inverted ? -rawDelta : rawDelta;
        const newValue = Math.max(minValue, Math.min(maxValue, startRef.current.value + delta));
        onChange(newValue);
      };

      const handleMouseUp = () => {
        startRef.current = null;
        setIsDragging(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [direction, value, onChange, minValue, maxValue, inverted],
  );

  return { handleMouseDown, isDragging };
}
