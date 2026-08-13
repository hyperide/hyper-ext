import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  containerRef: React.RefObject<HTMLDivElement>;
  children: React.ReactNode;
}

/** Portal component that renders annotations layer with fixed positioning relative to canvas container bounds */
export function AnnotationsLayerPortal({ containerRef, children }: Props) {
  const [bounds, setBounds] = useState({ top: 0, left: 0, width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateBounds = () => {
      const rect = container.getBoundingClientRect();
      setBounds({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };

    updateBounds();
    // codeql[js/superfluous-trailing-arguments] -- ResizeObserver passes (entries, observer) but updateBounds takes 0 params; harmless JS coercion
    const resizeObserver = new ResizeObserver(updateBounds);
    resizeObserver.observe(container);
    window.addEventListener('scroll', updateBounds, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', updateBounds, true);
    };
  }, [containerRef]);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: bounds.top,
        left: bounds.left,
        width: bounds.width,
        height: bounds.height,
        zIndex: 45,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
