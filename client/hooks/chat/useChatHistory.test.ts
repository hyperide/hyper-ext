/**
 * @file useChatHistory — initialChatId prop-change propagation
 *
 * Accessed via: SharedChatPanel mounts useChatHistory and may receive a new
 *   `initialChatId` prop after mount (e.g. when the host switches projects).
 * Assumptions: when `initialChatId` changes from `null` (or any value) to a
 *   non-null id post-mount, `currentChatId` MUST update to match.
 * The mount-only chat-list effect intentionally excludes `initialChatId`
 *   from its deps (reloading the chat list on every prop change is wrong);
 *   the dedicated sync effect carries that responsibility instead.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ChatAdapter, ChatSession, ChatStreamEvent, DisplayMessage } from '../../../shared/ai-chat-display';
import { useChatHistory } from './useChatHistory';

afterEach(cleanup);

function makeAdapter(overrides: Partial<ChatAdapter> = {}): ChatAdapter {
  const chats: ChatSession[] = [
    { id: 'chat-abc', title: 'Abc', createdAt: 0, updatedAt: 0 },
    { id: 'chat-def', title: 'Def', createdAt: 0, updatedAt: 0 },
  ];
  const messages: Record<string, DisplayMessage[]> = {
    'chat-abc': [{ id: 'm1', role: 'user', content: 'hi' }],
    'chat-def': [{ id: 'm2', role: 'user', content: 'yo' }],
  };
  return {
    listChats: async () => chats,
    createChat: async (title) => ({
      id: 'new',
      title: title ?? 'New',
      createdAt: 1,
      updatedAt: 1,
    }),
    loadChat: async (id) => ({ messages: messages[id] ?? [] }),
    saveMessages: async () => {},
    updateTitle: async () => {},
    deleteChat: async () => {},
    sendMessage: async (params: {
      chatId: string;
      messages: string[];
      onEvent: (event: ChatStreamEvent) => void;
      signal?: AbortSignal;
    }) => {
      void params;
    },
    respondToAskUser: async () => {},
    ...overrides,
  };
}

describe('useChatHistory — initialChatId prop changes', () => {
  test('mounts with currentChatId = initialChatId when prop is set on mount', async () => {
    const adapter = makeAdapter();
    const { result } = renderHook(({ id }) => useChatHistory({ chatAdapter: adapter, initialChatId: id }), {
      initialProps: { id: 'chat-abc' as string | null },
    });
    await waitFor(() => {
      expect(result.current.currentChatId).toBe('chat-abc');
    });
  });

  test('updates currentChatId when initialChatId prop changes from null to a real id post-mount', async () => {
    const adapter = makeAdapter();
    const { result, rerender } = renderHook(({ id }) => useChatHistory({ chatAdapter: adapter, initialChatId: id }), {
      initialProps: { id: null as string | null },
    });

    await waitFor(() => {
      expect(result.current.isLoadingChats).toBe(false);
    });
    expect(result.current.currentChatId).toBeNull();

    await act(async () => {
      rerender({ id: 'chat-abc' });
    });

    await waitFor(() => {
      expect(result.current.currentChatId).toBe('chat-abc');
    });
  });

  test('updates currentChatId when initialChatId prop switches between two non-null ids', async () => {
    const adapter = makeAdapter();
    const { result, rerender } = renderHook(({ id }) => useChatHistory({ chatAdapter: adapter, initialChatId: id }), {
      initialProps: { id: 'chat-abc' as string | null },
    });

    await waitFor(() => {
      expect(result.current.currentChatId).toBe('chat-abc');
    });

    await act(async () => {
      rerender({ id: 'chat-def' });
    });

    await waitFor(() => {
      expect(result.current.currentChatId).toBe('chat-def');
    });
  });
});
