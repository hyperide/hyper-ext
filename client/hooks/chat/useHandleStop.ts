import { useCallback } from 'react';

/**
 * Returns a stable callback that stops the active stream and restores any
 * queued (unsent) messages back into the input field. Used by the Stop button
 * in ChatInput.
 *
 * Extracted from SharedChatPanel so the deps array stays a short list of
 * stable function references rather than referencing through hook-result
 * objects (which violate exhaustive-deps).
 */
export function useHandleStop(stopStreaming: () => void, restoreQueueToInput: () => void) {
  return useCallback(() => {
    stopStreaming();
    restoreQueueToInput();
  }, [stopStreaming, restoreQueueToInput]);
}
