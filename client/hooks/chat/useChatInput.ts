import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QueuedMessage } from '../../../shared/ai-agent';
import type { DisplayMessage } from '../../../shared/ai-chat-display';

let queueIdCounter = 0;
function generateQueueId(): string {
  return `q-${Date.now()}-${queueIdCounter++}`;
}

const DRAFT_STORAGE_KEY = 'ai-chat-input-draft';

export interface UseChatInputOptions {
  messages: DisplayMessage[];
  isStreaming: boolean;
  pendingAskUser: { toolUseId: string; question: string; options?: string[] } | null;
  onSendMessage: (content: string[]) => void;
  onRespondToAskUser: (response: string) => void;
}

export function useChatInput({
  messages,
  isStreaming,
  pendingAskUser,
  onSendMessage,
  onRespondToAskUser,
}: UseChatInputOptions) {
  const [inputValue, setInputValue] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState('');
  const messageQueueRef = useRef<QueuedMessage[]>([]);

  // Keep ref in sync
  useEffect(() => {
    messageQueueRef.current = messageQueue;
  }, [messageQueue]);

  // Debounced draft save
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (inputValue) localStorage.setItem(DRAFT_STORAGE_KEY, inputValue);
        else localStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue]);

  // User message history for ArrowUp navigation
  const userMessageHistory = useMemo(
    () =>
      messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .reverse(),
    [messages],
  );

  const clearDraft = useCallback(() => {
    setInputValue('');
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const handleSendMessage = useCallback(
    (messageContent?: string) => {
      const text = messageContent ?? inputValue.trim();
      if (!text) return;

      // If streaming and no explicit message — queue
      if (isStreaming && !messageContent) {
        if (messageQueue.length >= 10) return;
        setMessageQueue((prev) => [
          ...prev,
          {
            id: generateQueueId(),
            content: inputValue,
            status: 'pending',
            createdAt: Date.now(),
          },
        ]);
        clearDraft();
        return;
      }

      clearDraft();
      setHistoryIndex(-1);
      setSavedInput('');
      onSendMessage([text]);
    },
    [inputValue, isStreaming, messageQueue.length, onSendMessage, clearDraft],
  );

  /** Flush queued messages — call after stream finishes */
  const flushQueue = useCallback((): string[] => {
    const pending = messageQueueRef.current.filter((m) => m.status === 'pending').map((m) => m.content);
    setMessageQueue([]);
    return pending;
  }, []);

  /** Move queued messages back to input on stop — call after user stops streaming */
  const restoreQueueToInput = useCallback(() => {
    const pending = messageQueueRef.current.filter((m) => m.status === 'pending').map((m) => m.content);
    if (pending.length > 0) {
      const combined = pending.join('\n\n');
      setInputValue((prev) => (prev ? `${prev}\n\n${combined}` : combined));
    }
    setMessageQueue([]);
  }, []);

  const cancelQueued = useCallback((id: string) => {
    setMessageQueue((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Allow global hotkeys
      if (e.metaKey || e.ctrlKey) return;

      const textarea = e.currentTarget;
      const cursorAtStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0;

      // ArrowUp at start — previous user message
      if (e.key === 'ArrowUp' && cursorAtStart && userMessageHistory.length > 0) {
        e.preventDefault();
        if (historyIndex === -1) setSavedInput(inputValue);
        const newIndex = Math.min(historyIndex + 1, userMessageHistory.length - 1);
        setHistoryIndex(newIndex);
        setInputValue(userMessageHistory[newIndex]);
        return;
      }

      // ArrowDown — newer message or saved input
      if (e.key === 'ArrowDown' && historyIndex >= 0) {
        e.preventDefault();
        if (historyIndex === 0) {
          setHistoryIndex(-1);
          setInputValue(savedInput);
        } else {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          setInputValue(userMessageHistory[newIndex]);
        }
        return;
      }

      // Shift+Enter or Alt+Enter — newline
      if (e.key === 'Enter' && (e.shiftKey || e.altKey)) {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newValue = `${inputValue.substring(0, start)}\n${inputValue.substring(end)}`;
        setInputValue(newValue);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 1;
        });
        return;
      }

      // Enter — send message or answer ask_user
      if (e.key === 'Enter') {
        e.preventDefault();
        setHistoryIndex(-1);
        setSavedInput('');

        if (pendingAskUser && inputValue.trim()) {
          onRespondToAskUser(inputValue.trim());
          clearDraft();
          return;
        }

        handleSendMessage();
      }
    },
    [
      inputValue,
      historyIndex,
      savedInput,
      userMessageHistory,
      pendingAskUser,
      onRespondToAskUser,
      handleSendMessage,
      clearDraft,
    ],
  );

  const placeholder = useMemo(() => {
    if (pendingAskUser) return 'Type your answer...';
    if (isStreaming) return 'Type to queue message...';
    return 'Ask about your code...';
  }, [pendingAskUser, isStreaming]);

  // Reset history on chat switch — caller resets messages
  const resetInputState = useCallback(() => {
    setHistoryIndex(-1);
    setSavedInput('');
    setMessageQueue([]);
  }, []);

  return {
    inputValue,
    setInputValue,
    handleKeyDown,
    handleSendMessage,
    messageQueue,
    cancelQueued,
    flushQueue,
    restoreQueueToInput,
    placeholder,
    resetInputState,
  };
}
