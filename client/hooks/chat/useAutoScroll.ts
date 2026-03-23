import { useCallback, useEffect, useRef } from 'react';

/**
 * Auto-scroll to bottom when content changes, unless user has scrolled up.
 */
export function useAutoScroll(dependencies: unknown[]) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUpRef = useRef(false);

  // Auto-scroll on content change — deps are dynamic (caller controls scroll triggers)
  useEffect(() => {
    if (isUserScrolledUpRef.current || !scrollAreaRef.current) return;
    const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, dependencies);

  const handleScroll = useCallback(() => {
    if (!scrollAreaRef.current) return;
    const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
    if (!viewport) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    isUserScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 50;
  }, []);

  const resetScrollFlag = useCallback(() => {
    isUserScrolledUpRef.current = false;
  }, []);

  return { scrollAreaRef, handleScroll, resetScrollFlag };
}
