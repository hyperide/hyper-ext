/**
 * SharedChatPanel — the unified AI chat component for SaaS and VS Code extension.
 *
 * Platform differences are handled via:
 * - ChatAdapter (prop) — abstracts chat CRUD and streaming
 * - renderToolResult (prop) — SaaS uses Dialog+Monaco, ext uses inline overlay
 * - extraHeaderControls (prop) — SaaS adds dock/undock/close buttons
 * - onStreamEvent (prop) — SaaS dispatches canvas events
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { ChatAdapter, ChatSession, ChatStreamEvent, DisplayMessage } from '../../../shared/ai-chat-display';
import { useAutoScroll, useChatHistory, useChatInput, useChatStream } from '../../hooks/chat';
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
  const history = useChatHistory({
    chatAdapter,
    initialChatId,
    onChatCreated,
    onChatTitleUpdate,
  });

  // --- Streaming ---
  const onMessagesAppend = useCallback(
    (newMessages: DisplayMessage[]) => {
      history.setMessages((prev) => [...prev, ...newMessages]);
    },
    [history.setMessages],
  );

  const stream = useChatStream({
    chatAdapter,
    onMessagesAppend,
    onChatTitleUpdate: history.updateChatTitle,
    onStreamEvent,
  });

  // Keep history hook aware of streaming state
  useEffect(() => {
    history.setIsStreaming(stream.isStreaming);
  }, [stream.isStreaming, history.setIsStreaming]);

  // Ref to break circular dep: handleSendMessages -> input.flushQueue -> handleSendMessages
  const flushQueueRef = useRef<(() => string[]) | null>(null);

  // --- Input ---
  const handleSendMessages = useCallback(
    async (content: string[]) => {
      let chatId = history.currentChatId;
      if (!chatId || forceNewChat) {
        chatId = await history.createNewChat();
        if (!chatId) return;
      }

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

      await stream.sendMessage(chatId, content);

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
        await stream.sendMessage(chatId, queued);
      }
    },
    [history.currentChatId, forceNewChat, history.createNewChat, stream.sendMessage, onMessagesAppend],
  );

  const input = useChatInput({
    messages: history.messages,
    isStreaming: stream.isStreaming,
    pendingAskUser: stream.pendingAskUser,
    onSendMessage: handleSendMessages,
    onRespondToAskUser: stream.respondToAskUser,
  });
  flushQueueRef.current = input.flushQueue;

  // --- Auto-scroll ---
  const { scrollAreaRef, handleScroll, resetScrollFlag } = useAutoScroll([
    history.messages,
    stream.currentAssistantMessage,
    stream.currentToolCalls,
  ]);

  // --- Stop streaming ---
  const handleStop = useCallback(() => {
    stream.stopStreaming();
    input.restoreQueueToInput();
  }, [stream.stopStreaming, input.restoreQueueToInput]);

  // --- Auto-send initial prompt ---
  const initialPromptSentRef = useRef(false);

  useEffect(() => {
    if (initialPrompt) {
      initialPromptSentRef.current = false;
    }
  }, [initialPrompt]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handleSendMessages is stable
  useEffect(() => {
    if (initialPrompt && !history.isLoadingChats && !stream.isStreamingRef.current && !initialPromptSentRef.current) {
      initialPromptSentRef.current = true;
      resetScrollFlag();
      handleSendMessages([initialPrompt]);
      onPromptSent?.();
    }
  }, [initialPrompt, history.isLoadingChats]);

  // --- Auto-save messages (for ext where server doesn't persist) ---
  const savedMessageCountRef = useRef(0);
  useEffect(() => {
    if (!history.currentChatId || history.messages.length === 0) return;
    if (history.messages.length <= savedMessageCountRef.current) return;
    savedMessageCountRef.current = history.messages.length;
    chatAdapter.saveMessages(history.currentChatId, history.messages);
  }, [history.currentChatId, history.messages, chatAdapter]);

  // Reset saved count on chat switch
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentChatId triggers reset intentionally
  useEffect(() => {
    savedMessageCountRef.current = 0;
    input.resetInputState();
  }, [history.currentChatId, input.resetInputState]);

  // --- Auto-title from first user message ---
  useEffect(() => {
    if (!history.currentChatId || history.messages.length === 0) return;
    const firstUser = history.messages.find((m) => m.role === 'user');
    if (!firstUser) return;
    const chat = history.chats.find((c) => c.id === history.currentChatId);
    if (!chat || chat.title !== 'New Chat') return;
    const title = firstUser.content.slice(0, 60) + (firstUser.content.length > 60 ? '...' : '');
    chatAdapter.updateTitle(history.currentChatId, title);
    history.updateChatTitle(history.currentChatId, title);
  }, [history.currentChatId, history.messages, history.chats, chatAdapter, history.updateChatTitle]);

  // --- Render ---
  const toolResultProps = {
    isOpen: toolResultModal.isOpen,
    toolName: toolResultModal.toolName,
    content: toolResultModal.content,
    onClose: () => setToolResultModal({ isOpen: false, toolName: '', content: '' }),
  };

  const sidebarNode = renderSidebar?.({
    chats: history.chats,
    currentChatId: history.currentChatId,
    isLoadingChats: history.isLoadingChats,
    isStreaming: stream.isStreaming,
    onSelectChat: history.selectChat,
    onNewChat: () => {
      if (!stream.isStreaming) {
        history.setCurrentChatId(null);
        history.setMessages([]);
      }
    },
    onDeleteChat: history.deleteChat,
  });

  return (
    <div className="flex h-full">
      {sidebarNode}
      <div className="flex flex-col flex-1 min-w-0">
        <ChatHeader
          chats={history.chats}
          currentChatId={history.currentChatId}
          currentChatTitle={history.currentChat?.title}
          onSelectChat={history.selectChat}
          onNewChat={() => {
            if (!stream.isStreaming) {
              history.setCurrentChatId(null);
              history.setMessages([]);
            }
          }}
          onDeleteChat={history.deleteChat}
          isStreaming={stream.isStreaming}
          extraControls={extraHeaderControls}
          hideChatSwitcher={!!sidebarNode}
        />

        <ChatMessages
          messages={history.messages}
          isStreaming={stream.isStreaming}
          isLoadingMessages={history.isLoadingMessages}
          currentAssistantMessage={stream.currentAssistantMessage}
          currentToolCalls={stream.currentToolCalls}
          scrollAreaRef={scrollAreaRef}
          onScroll={handleScroll}
          onViewToolResult={(name, content) => setToolResultModal({ isOpen: true, toolName: name, content })}
          hasApiKey={hasApiKey}
          onConfigureProvider={onConfigureProvider}
        />

        <ChatInput
          inputValue={input.inputValue}
          onInputChange={input.setInputValue}
          onKeyDown={input.handleKeyDown}
          onSend={() => input.handleSendMessage()}
          onStop={handleStop}
          isStreaming={stream.isStreaming}
          pendingAskUser={stream.pendingAskUser}
          onRespondToAskUser={stream.respondToAskUser}
          messageQueue={input.messageQueue}
          onCancelQueued={input.cancelQueued}
          placeholder={input.placeholder}
          disabled={hasApiKey === false}
        />

        {renderToolResult ? renderToolResult(toolResultProps) : <ToolResultModal {...toolResultProps} />}
      </div>
    </div>
  );
}
