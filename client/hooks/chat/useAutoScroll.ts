import { useCallback, useEffect, useRef } from 'react';

/**
 * Auto-scroll to bottom when any trigger value changes, unless the user has
 * scrolled up.
 *
 * Triggers are positional so the deps array is statically analyzable by
 * exhaustive-deps. The call site at SharedChatPanel passes three values
 * (history.messages, stream.currentAssistantMessage, stream.currentToolCalls);
 * unused trigger slots can be left as undefined.
 */
export function useAutoScroll(triggerA?: unknown, triggerB?: unknown, triggerC?: unknown) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUpRef = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: triggers are sentinel deps — the effect fires when any of them changes to scroll the viewport; the body intentionally does not read them.
  useEffect(() => {
    if (isUserScrolledUpRef.current || !scrollAreaRef.current) return;
    const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [triggerA, triggerB, triggerC]);

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
