/**
 * SharedChatPanel — the unified AI chat component for SaaS and VS Code extension.
 *
 * Platform differences are handled via:
 * - ChatAdapter (prop) — abstracts chat CRUD and streaming
 * - renderToolResult (prop) — SaaS uses Dialog+Monaco, ext uses inline overlay
 * - extraHeaderControls (prop) — SaaS adds dock/undock/close buttons
 * - onStreamEvent (prop) — SaaS dispatches canvas events
 */

import { TID } from '@shared/data-testid-map';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { ChatAdapter, ChatSession, ChatStreamEvent } from '../../../shared/ai-chat-display';
import {
  useAutoScroll,
  useChatHistory,
  useChatInput,
  useChatStream,
  useHandleStop,
  useMessagesAppend,
} from '../../hooks/chat';
import { ChatHeader } from './ChatHeader';
import { ChatInput } from './ChatInput';
import { ChatMessages } from './ChatMessages';
import { ToolResultModal } from './ToolResultModal';

export interface ChatSidebarRenderProps {
  chats: ChatSession[];
  currentChatId: string | null;
  isLoadingChats: boolean;
  isStreaming: boolean;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (chatId: string) => void;
}

export interface SharedChatPanelProps {
  chatAdapter: ChatAdapter;
  initialChatId?: string | null;
  initialPrompt?: string | null;
  forceNewChat?: boolean;
  onPromptSent?: () => void;
  onChatCreated?: (chatId: string) => void;
  onChatTitleUpdate?: (chatId: string, title: string) => void;
  /** Called for each stream event — SaaS uses this for canvas events, undo/redo, etc. */
  onStreamEvent?: (event: ChatStreamEvent) => void;
  /** Extra controls to render in the header (dock/undock/close buttons) */
  extraHeaderControls?: ReactNode;
  /** Custom tool result renderer. When provided, replaces the default ToolResultModal. */
  renderToolResult?: (props: { isOpen: boolean; toolName: string; content: string; onClose: () => void }) => ReactNode;
  /** Render a sidebar with chat history. SaaS uses this for the floating modal. */
  renderSidebar?: (props: ChatSidebarRenderProps) => ReactNode;
  /** Whether an API key is configured. null = unknown (SaaS always has it). false = show setup banner. */
  hasApiKey?: boolean | null;
  /** Called when user clicks "Configure AI Provider" in the empty state banner */
  onConfigureProvider?: () => void;
}

export function SharedChatPanel({
  chatAdapter,
  initialChatId,
  initialPrompt,
  forceNewChat = false,
  onPromptSent,
  onChatCreated,
  onChatTitleUpdate,
  onStreamEvent,
  extraHeaderControls,
  renderToolResult,
  renderSidebar,
  hasApiKey,
  onConfigureProvider,
}: SharedChatPanelProps) {
  const [toolResultModal, setToolResultModal] = useState<{
    isOpen: boolean;
    toolName: string;
    content: string;
  }>({ isOpen: false, toolName: '', content: '' });

  // --- Chat history ---
  // Destructure all fields so exhaustive-deps can track stable callbacks/setters
  // as primitives (member access on `history` would force the unstable parent
  // object into deps and invalidate every render).
  const {
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
  } = useChatHistory({
    chatAdapter,
    initialChatId,
    onChatCreated,
    onChatTitleUpdate,
  });

  // --- Streaming ---
  const onMessagesAppend = useMessagesAppend(setMessages);

  const {
    isStreaming,
    isStreamingRef,
    currentAssistantMessage,
    currentToolCalls,
    pendingAskUser,
    sendMessage,
    stopStreaming,
    respondToAskUser,
  } = useChatStream({
    chatAdapter,
    onMessagesAppend,
    onChatTitleUpdate: updateChatTitle,
    onStreamEvent,
  });

  // Detect auth errors in message history — hide input when key is invalid/expired
  const hasAuthError = messages.some(
    (m) =>
      m.role === 'assistant' &&
      m.content.startsWith('Error: ') &&
      /401|403|authentication|Unauthorized|invalid_api_key/.test(m.content),
  );

  // Keep history hook aware of streaming state
  useEffect(() => {
    setIsStreaming(isStreaming);
  }, [isStreaming, setIsStreaming]);

  // Ref to break circular dep: handleSendMessages -> input.flushQueue -> handleSendMessages
  const flushQueueRef = useRef<(() => string[]) | null>(null);

  // --- Input ---
  const handleSendMessages = useCallback(
    async (content: string[]) => {
      let chatId = currentChatId;
      if (!chatId || forceNewChat) {
        chatId = await createNewChat();
        if (!chatId) return;
      }

      // Mark streaming BEFORE sendMessage to prevent loadChat useEffect race
      setIsStreaming(true);

      // Add user messages to display
      for (const text of content) {
        onMessagesAppend([
          {
            id: `${Date.now()}-${Math.random()}`,
            role: 'user',
            content: text,
          },
        ]);
      }

      await sendMessage(chatId, content);

      // After stream finishes, flush queue
      const queued = flushQueueRef.current?.() ?? [];
      if (queued.length > 0) {
        for (const text of queued) {
          onMessagesAppend([
            {
              id: `${Date.now()}-${Math.random()}`,
              role: 'user',
              content: text,
            },
          ]);
        }
        await sendMessage(chatId, queued);
      }
    },
    [currentChatId, forceNewChat, createNewChat, setIsStreaming, sendMessage, onMessagesAppend],
  );

  const {
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
  } = useChatInput({
    messages,
    isStreaming,
    pendingAskUser,
    onSendMessage: handleSendMessages,
    onRespondToAskUser: respondToAskUser,
  });
  flushQueueRef.current = flushQueue;

  // --- Auto-scroll ---
  const { scrollAreaRef, handleScroll, resetScrollFlag } = useAutoScroll(
    messages,
    currentAssistantMessage,
    currentToolCalls,
  );

  // --- Stop streaming ---
  const handleStop = useHandleStop(stopStreaming, restoreQueueToInput);

  // --- Auto-send initial prompt ---
  const initialPromptSentRef = useRef(false);

  useEffect(() => {
    if (initialPrompt) {
      initialPromptSentRef.current = false;
    }
  }, [initialPrompt]);

  // initialPromptSentRef guards against re-firing even when the stable deps churn.
  useEffect(() => {
    if (initialPrompt && !isLoadingChats && !isStreamingRef.current && !initialPromptSentRef.current) {
      initialPromptSentRef.current = true;
      resetScrollFlag();
      handleSendMessages([initialPrompt]);
      onPromptSent?.();
    }
  }, [initialPrompt, isLoadingChats, isStreamingRef, resetScrollFlag, handleSendMessages, onPromptSent]);

  // --- Auto-save messages (for ext where server doesn't persist) ---
  const savedMessageCountRef = useRef(0);
  useEffect(() => {
    if (!currentChatId || messages.length === 0) return;
    if (messages.length <= savedMessageCountRef.current) return;
    savedMessageCountRef.current = messages.length;
    chatAdapter.saveMessages(currentChatId, messages);
  }, [currentChatId, messages, chatAdapter]);

  // Reset saved count on chat switch — currentChatId is a sentinel trigger,
  // not read in the body.
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentChatId triggers reset intentionally
  useEffect(() => {
    savedMessageCountRef.current = 0;
    resetInputState();
  }, [currentChatId, resetInputState]);

  // --- Auto-title from first user message ---
  useEffect(() => {
    if (!currentChatId || messages.length === 0) return;
    const firstUser = messages.find((m) => m.role === 'user');
    if (!firstUser) return;
    const chat = chats.find((c) => c.id === currentChatId);
    if (!chat || chat.title !== 'New Chat') return;
    const title = firstUser.content.slice(0, 60) + (firstUser.content.length > 60 ? '...' : '');
    chatAdapter.updateTitle(currentChatId, title);
    updateChatTitle(currentChatId, title);
  }, [currentChatId, messages, chats, chatAdapter, updateChatTitle]);

  // --- Render ---
  const toolResultProps = {
    isOpen: toolResultModal.isOpen,
    toolName: toolResultModal.toolName,
    content: toolResultModal.content,
    onClose: () => setToolResultModal({ isOpen: false, toolName: '', content: '' }),
  };

  const sidebarNode = renderSidebar?.({
    chats,
    currentChatId,
    isLoadingChats,
    isStreaming,
    onSelectChat: selectChat,
    onNewChat: () => {
      if (!isStreaming) {
        setCurrentChatId(null);
        setMessages([]);
      }
    },
    onDeleteChat: deleteChat,
  });

  return (
    <div data-testid={TID.aiChat.root} className="flex h-full">
      {sidebarNode}
      <div className="flex flex-col flex-1 min-w-0">
        <ChatHeader
          chats={chats}
          currentChatId={currentChatId}
          currentChatTitle={currentChat?.title}
          onSelectChat={selectChat}
          onNewChat={() => {
            if (!isStreaming) {
              setCurrentChatId(null);
              setMessages([]);
            }
          }}
          onDeleteChat={deleteChat}
          isStreaming={isStreaming}
          extraControls={extraHeaderControls}
          hideChatSwitcher={!!sidebarNode}
        />

        <ChatMessages
          messages={messages}
          isStreaming={isStreaming}
          isLoadingMessages={isLoadingMessages}
          currentAssistantMessage={currentAssistantMessage}
          currentToolCalls={currentToolCalls}
          scrollAreaRef={scrollAreaRef}
          onScroll={handleScroll}
          onViewToolResult={(name, content) => setToolResultModal({ isOpen: true, toolName: name, content })}
          hasApiKey={hasAuthError ? false : hasApiKey}
          onConfigureProvider={onConfigureProvider}
        />

        {hasApiKey !== false && !hasAuthError && (
          <ChatInput
            inputValue={inputValue}
            onInputChange={setInputValue}
            onKeyDown={handleKeyDown}
            onSend={() => handleSendMessage()}
            onStop={handleStop}
            isStreaming={isStreaming}
            pendingAskUser={pendingAskUser}
            onRespondToAskUser={respondToAskUser}
            messageQueue={messageQueue}
            onCancelQueued={cancelQueued}
            placeholder={placeholder}
          />
        )}

        {renderToolResult ? renderToolResult(toolResultProps) : <ToolResultModal {...toolResultProps} />}
      </div>
    </div>
  );
}
