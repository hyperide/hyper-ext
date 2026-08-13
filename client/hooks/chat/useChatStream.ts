import { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ChatAdapter, ChatStreamEvent, DisplayMessage, DisplayToolCall } from '../../../shared/ai-chat-display';

let messageIdCounter = 0;
function generateMessageId(): string {
  return `${Date.now()}-${messageIdCounter++}`;
}

const MAX_NETWORK_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

function isNetworkError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TypeError' && error.message.includes('fetch');
}

export interface PendingAskUser {
  toolUseId: string;
  question: string;
  options?: string[];
}

export interface UseChatStreamOptions {
  chatAdapter: ChatAdapter;
  onMessagesAppend: (newMessages: DisplayMessage[]) => void;
  onChatTitleUpdate?: (chatId: string, title: string) => void;
  onStreamEvent?: (event: ChatStreamEvent) => void;
}

export function useChatStream({
  chatAdapter,
  onMessagesAppend,
  onChatTitleUpdate,
  onStreamEvent,
}: UseChatStreamOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState('');
  const [currentToolCalls, setCurrentToolCalls] = useState<Map<string, DisplayToolCall>>(new Map());
  const [pendingAskUser, setPendingAskUser] = useState<PendingAskUser | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false);
  const currentToolCallsRef = useRef<Map<string, DisplayToolCall>>(new Map());

  const sendMessage = useCallback(
    async (chatId: string, messagesToSend: string[]): Promise<void> => {
      if (messagesToSend.length === 0 || isStreamingRef.current) return;

      setIsStreaming(true);
      isStreamingRef.current = true;
      setCurrentAssistantMessage('');
      setCurrentToolCalls(new Map());
      currentToolCallsRef.current = new Map();

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      let assistantContent = '';

      const saveAccumulatedText = () => {
        if (assistantContent.trim()) {
          onMessagesAppend([
            {
              id: generateMessageId(),
              role: 'assistant',
              content: assistantContent,
            },
          ]);
          assistantContent = '';
          setCurrentAssistantMessage('');
        }
      };

      const onEvent = (event: ChatStreamEvent) => {
        // Enrich tool_result with toolName from pending map when not provided by adapter
        if (event.type === 'tool_result' && !event.toolName) {
          const pending = currentToolCallsRef.current.get(event.toolUseId);
          if (pending) {
            (event as { toolName?: string }).toolName = pending.name;
          }
        }

        onStreamEvent?.(event);

        switch (event.type) {
          case 'text_delta':
            assistantContent += event.text;
            flushSync(() => {
              setCurrentAssistantMessage((prev) => prev + event.text);
            });
            break;

          case 'user_message':
            // User messages are added by SharedChatPanel before calling sendMessage.
            // This event is only emitted by SaaS SSE for server-injected messages.
            // Skip to avoid duplicates — the caller is responsible for adding user messages.
            break;

          case 'tool_use':
            saveAccumulatedText();
            currentToolCallsRef.current.set(event.toolUseId, {
              id: event.toolUseId,
              name: event.toolName,
              input: event.input,
            });
            setCurrentToolCalls(new Map(currentToolCallsRef.current));
            break;

          case 'tool_result':
            {
              const toolCall = currentToolCallsRef.current.get(event.toolUseId);
              if (toolCall) {
                toolCall.result = event.result;
                onMessagesAppend([
                  {
                    id: generateMessageId(),
                    role: 'assistant',
                    content: '',
                    toolCalls: [{ ...toolCall }],
                  },
                ]);
                currentToolCallsRef.current.delete(event.toolUseId);
                setCurrentToolCalls(new Map(currentToolCallsRef.current));
              }
            }
            break;

          case 'ask_user':
            setPendingAskUser({
              toolUseId: event.toolUseId,
              question: event.question,
              options: event.options,
            });
            break;

          case 'chat_title_updated':
            onChatTitleUpdate?.(event.chatId, event.title);
            break;

          case 'error':
            onMessagesAppend([
              {
                id: generateMessageId(),
                role: 'assistant',
                content: `Error: ${event.error}`,
              },
            ]);
            break;

          case 'done':
            saveAccumulatedText();
            break;

          case 'keepalive':
            break;
        }
      };

      try {
        let lastError: unknown = null;

        for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt++) {
          if (attempt > 0) {
            setCurrentAssistantMessage(`Network error. Retrying (${attempt}/${MAX_NETWORK_RETRIES})...`);
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
            if (abortController.signal.aborted) return;
            assistantContent = '';
            setCurrentAssistantMessage('');
            currentToolCallsRef.current = new Map();
            setCurrentToolCalls(new Map());
          }

          try {
            await chatAdapter.sendMessage({
              chatId,
              messages: messagesToSend,
              signal: abortController.signal,
              onEvent,
            });
            lastError = null;
            break;
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') return;

            if (isNetworkError(error) && attempt < MAX_NETWORK_RETRIES) {
              lastError = error;
              continue;
            }

            lastError = error;
            break;
          }
        }

        if (lastError) {
          const errorMessage = isNetworkError(lastError)
            ? `Network error: Unable to connect after ${MAX_NETWORK_RETRIES} retries.`
            : lastError instanceof Error
              ? lastError.message
              : 'Unknown error';

          onMessagesAppend([
            {
              id: generateMessageId(),
              role: 'assistant',
              content: `Error: ${errorMessage}`,
            },
          ]);
        }
      } finally {
        saveAccumulatedText();
        setIsStreaming(false);
        isStreamingRef.current = false;
        setCurrentAssistantMessage('');
        setCurrentToolCalls(new Map());
        currentToolCallsRef.current = new Map();
        abortControllerRef.current = null;
      }
    },
    [chatAdapter, onMessagesAppend, onChatTitleUpdate, onStreamEvent],
  );

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsStreaming(false);
    isStreamingRef.current = false;
    setCurrentAssistantMessage('');
    setCurrentToolCalls(new Map());
    currentToolCallsRef.current = new Map();
    abortControllerRef.current = null;
  }, []);

  const respondToAskUser = useCallback(
    async (response: string) => {
      if (!pendingAskUser) return;
      try {
        await chatAdapter.respondToAskUser(pendingAskUser.toolUseId, response);
        setPendingAskUser(null);
      } catch (error) {
        console.error('Failed to send user response:', error);
      }
    },
    [chatAdapter, pendingAskUser],
  );

  return {
    isStreaming,
    isStreamingRef,
    currentAssistantMessage,
    currentToolCalls,
    pendingAskUser,
    sendMessage,
    stopStreaming,
    respondToAskUser,
  };
}
