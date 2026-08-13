/**
 * @file useMessagesAppend — appender callback bound to a stable state setter
 *
 * Accessed via: SharedChatPanel calls `useMessagesAppend(history.setMessages)`
 *   to obtain the `onMessagesAppend` callback that gets passed to useChatStream
 *   and also used locally when the user submits a new message batch.
 * Assumptions: the callback MUST append messages to whatever the previous
 *   state is (functional setter form), and the returned reference MUST stay
 *   stable as long as `setMessages` is stable — useChatStream uses it as an
 *   effect dep and any churn would re-subscribe its stream listeners.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import type { DisplayMessage } from '../../../shared/ai-chat-display';
import { useMessagesAppend } from './useMessagesAppend';

afterEach(cleanup);

function msg(id: string, content: string): DisplayMessage {
  return { id, role: 'user', content };
}

describe('useMessagesAppend', () => {
  test('appends messages to previous state via functional setter', () => {
    const { result } = renderHook(() => {
      const [messages, setMessages] = useState<DisplayMessage[]>([msg('a', 'hello')]);
      const append = useMessagesAppend(setMessages);
      return { messages, append };
    });

    expect(result.current.messages).toEqual([msg('a', 'hello')]);

    act(() => {
      result.current.append([msg('b', 'world'), msg('c', '!')]);
    });

    expect(result.current.messages).toEqual([msg('a', 'hello'), msg('b', 'world'), msg('c', '!')]);
  });

  test('appends correctly across multiple successive calls (functional form, not stale-closure)', () => {
    const { result } = renderHook(() => {
      const [messages, setMessages] = useState<DisplayMessage[]>([]);
      const append = useMessagesAppend(setMessages);
      return { messages, append };
    });

    act(() => {
      result.current.append([msg('1', 'a')]);
      result.current.append([msg('2', 'b')]);
      result.current.append([msg('3', 'c')]);
    });

    expect(result.current.messages).toEqual([msg('1', 'a'), msg('2', 'b'), msg('3', 'c')]);
  });

  test('returns a stable callback reference across re-renders when setMessages is stable', () => {
    const { result, rerender } = renderHook(() => {
      const [messages, setMessages] = useState<DisplayMessage[]>([]);
      const append = useMessagesAppend(setMessages);
      return { messages, append };
    });

    const firstAppend = result.current.append;
    rerender();
    rerender();
    expect(result.current.append).toBe(firstAppend);
  });

  test('no-op safe with empty array', () => {
    const { result } = renderHook(() => {
      const [messages, setMessages] = useState<DisplayMessage[]>([msg('a', 'hi')]);
      const append = useMessagesAppend(setMessages);
      return { messages, append };
    });

    act(() => {
      result.current.append([]);
    });

    expect(result.current.messages).toEqual([msg('a', 'hi')]);
  });
});
