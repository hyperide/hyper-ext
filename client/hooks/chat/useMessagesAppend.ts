import { type Dispatch, type SetStateAction, useCallback } from 'react';
import type { DisplayMessage } from '../../../shared/ai-chat-display';

/**
 * Returns a stable callback that appends `newMessages` to the previous state
 * via the functional setter form. The callback identity only changes when
 * `setMessages` itself changes — which, for a `useState` setter, never happens.
 *
 * Extracted from SharedChatPanel so the deps array for useChatStream stays
 * clean (a single stable function rather than an inline `useCallback`
 * referencing `history.setMessages` through a hook-result object).
 */
export function useMessagesAppend(setMessages: Dispatch<SetStateAction<DisplayMessage[]>>) {
  return useCallback(
    (newMessages: DisplayMessage[]) => {
      setMessages((prev) => [...prev, ...newMessages]);
    },
    [setMessages],
  );
}
