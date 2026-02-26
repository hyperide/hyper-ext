import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatAdapter, ChatSession, DisplayMessage } from '../../../shared/ai-chat-display';

export interface UseChatHistoryOptions {
  chatAdapter: ChatAdapter;
  initialChatId?: string | null;
  onChatCreated?: (chatId: string) => void;
  onChatTitleUpdate?: (chatId: string, title: string) => void;
}

export function useChatHistory({
  chatAdapter,
  initialChatId,
  onChatCreated,
  onChatTitleUpdate,
}: UseChatHistoryOptions) {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(initialChatId ?? null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const isStreamingRef = useRef(false);

  const currentChat = useMemo(() => chats.find((c) => c.id === currentChatId), [chats, currentChatId]);

  // Load chats on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only, chatAdapter is stable
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoadingChats(true);
        const loaded = await chatAdapter.listChats();
        if (cancelled) return;
        setChats(loaded);
        if (initialChatId) {
          setCurrentChatId(initialChatId);
        } else if (loaded.length > 0 && !currentChatId) {
          setCurrentChatId(loaded[0].id);
        }
      } catch (error) {
        console.error('Failed to load chats:', error);
      } finally {
        if (!cancelled) setIsLoadingChats(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatAdapter]);

  // Load messages when currentChatId changes
  useEffect(() => {
    if (isStreamingRef.current) return;
    if (!currentChatId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setIsLoadingMessages(true);
        const data = await chatAdapter.loadChat(currentChatId);
        if (cancelled) return;
        setMessages(data?.messages ?? []);
      } catch (error) {
        console.error('Failed to load messages:', error);
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setIsLoadingMessages(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentChatId, chatAdapter]);

  // Sync initialChatId prop changes
  useEffect(() => {
    if (initialChatId && initialChatId !== currentChatId) {
      setCurrentChatId(initialChatId);
    }
  }, [initialChatId, currentChatId]);

  const createNewChat = useCallback(async (): Promise<string | null> => {
    try {
      const session = await chatAdapter.createChat();
      setChats((prev) => [session, ...prev]);
      setCurrentChatId(session.id);
      setMessages([]);
      onChatCreated?.(session.id);
      return session.id;
    } catch (error) {
      console.error('Failed to create chat:', error);
      return null;
    }
  }, [chatAdapter, onChatCreated]);

  const selectChat = useCallback((chatId: string) => {
    setCurrentChatId(chatId);
  }, []);

  const deleteChat = useCallback(
    async (chatId: string) => {
      try {
        await chatAdapter.deleteChat(chatId);
        setChats((prev) => prev.filter((c) => c.id !== chatId));
        if (currentChatId === chatId) {
          setCurrentChatId(null);
          setMessages([]);
        }
      } catch (error) {
        console.error('Failed to delete chat:', error);
      }
    },
    [chatAdapter, currentChatId],
  );

  const updateChatTitle = useCallback(
    (chatId: string, title: string) => {
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title } : c)));
      onChatTitleUpdate?.(chatId, title);
    },
    [onChatTitleUpdate],
  );

  /** Let streaming hook tell us not to reload messages during a stream */
  const setIsStreaming = useCallback((value: boolean) => {
    isStreamingRef.current = value;
  }, []);

  return {
    chats,
    currentChatId,
    currentChat,
    isLoadingChats,
    isLoadingMessages,
    messages,
    setMessages,
    createNewChat,
    selectChat,
    deleteChat,
    setCurrentChatId,
    updateChatTitle,
    setIsStreaming,
  };
}
