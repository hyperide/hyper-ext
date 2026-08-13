/**
 * @file useHandleStop — stop-streaming callback that also restores queued messages
 *
 * Accessed via: SharedChatPanel calls
 *   `useHandleStop(stream.stopStreaming, input.restoreQueueToInput)` and
 *   passes the result to <ChatInput onStop={...} />.
 * Assumptions: both inputs are stable `useCallback`-wrapped functions whose
 *   identity is preserved across renders. The returned callback MUST invoke
 *   stopStreaming first, then restoreQueueToInput, and its reference MUST stay
 *   stable as long as both inputs are stable — ChatInput's onStop is wired to
 *   a DOM button so a churning identity wouldn't break anything visible, but
 *   we promise the same shape as the other extracted chat hooks for
 *   consistency.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, renderHook } from '@testing-library/react';
import { useHandleStop } from './useHandleStop';

afterEach(cleanup);

describe('useHandleStop', () => {
  test('calls stopStreaming then restoreQueueToInput in that order', () => {
    const calls: string[] = [];
    const stopStreaming = mock(() => {
      calls.push('stop');
    });
    const restoreQueueToInput = mock(() => {
      calls.push('restore');
    });

    const { result } = renderHook(() => useHandleStop(stopStreaming, restoreQueueToInput));

    result.current();

    expect(stopStreaming).toHaveBeenCalledTimes(1);
    expect(restoreQueueToInput).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['stop', 'restore']);
  });

  test('returns a stable callback reference across re-renders when inputs are stable', () => {
    const stopStreaming = mock(() => {});
    const restoreQueueToInput = mock(() => {});

    const { result, rerender } = renderHook(() => useHandleStop(stopStreaming, restoreQueueToInput));

    const firstHandle = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(firstHandle);
  });

  test('returns a new callback reference when stopStreaming identity changes', () => {
    const restoreQueueToInput = mock(() => {});
    let stopStreaming = mock(() => {});

    const { result, rerender } = renderHook(() => useHandleStop(stopStreaming, restoreQueueToInput));

    const firstHandle = result.current;
    stopStreaming = mock(() => {});
    rerender();
    expect(result.current).not.toBe(firstHandle);
  });

  test('safe with no-op functions', () => {
    const stopStreaming = mock(() => {});
    const restoreQueueToInput = mock(() => {});

    const { result } = renderHook(() => useHandleStop(stopStreaming, restoreQueueToInput));

    expect(() => result.current()).not.toThrow();
    expect(stopStreaming).toHaveBeenCalledTimes(1);
    expect(restoreQueueToInput).toHaveBeenCalledTimes(1);
  });
});
