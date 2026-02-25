import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  IconArrowsMaximize,
  IconChevronDown,
  IconEye,
  IconLayoutSidebarRight,
  IconLoader2,
  IconPlus,
  IconSend,
  IconSquare,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import cn from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Dialog, DialogHeader, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { authFetch } from '@/utils/authFetch';
import type { QueuedMessage, ToolName } from '../../shared/ai-agent';
import { AskUserPrompt } from './AskUserPrompt';
import { EditFileDiff } from './EditFileDiff';
import { LazyEditor } from './LazyMonaco';

// Detect language from content for syntax highlighting
function detectLanguageFromContent(content: string): string {
  const trimmed = content.trim();

  // JSON detection
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // not valid JSON
    }
  }

  // TypeScript/JavaScript detection
  if (
    /^(import|export|const|let|var|function|class|interface|type)\s/.test(trimmed) ||
    /=>\s*\{/.test(trimmed) ||
    /<[A-Z][a-zA-Z]*/.test(trimmed) // JSX
  ) {
    return 'typescript';
  }

  // HTML detection
  if (/^<(!DOCTYPE|html|head|body|div|span|p)\b/i.test(trimmed)) {
    return 'html';
  }

  // CSS detection
  if (/^[.#@]?[a-zA-Z-]+\s*\{/.test(trimmed) || /@media|@keyframes/.test(trimmed)) {
    return 'css';
  }

  // Shell/Bash detection
  if (/^(#!\/bin\/(ba)?sh|npm |yarn |bun |git |cd |ls |mkdir |rm )/.test(trimmed)) {
    return 'shell';
  }

  // Markdown detection
  if (/^#+\s/.test(trimmed) || /^\*{1,2}[^*]+\*{1,2}/.test(trimmed)) {
    return 'markdown';
  }

  return 'plaintext';
}

// Generate unique ID with counter to avoid collisions
let messageIdCounter = 0;
function generateMessageId(): string {
  return `${Date.now()}-${messageIdCounter++}`;
}

interface AIAgentChatProps {
  projectPath: string;
  initialChatId?: string | null;
  hideSidebar?: boolean;
  initialPrompt?: string;
  forceNewChat?: boolean;
  onPromptSent?: () => void;
  onChatTitleUpdate?: (chatId: string, newTitle: string) => void;
  onChatCreated?: (chatId: string) => void;
  // Auto-fix props
  projectId?: string;
  componentPath?: string | null;
  // Selected elements from canvas editor
  selectedElementIds?: string[];
  // Custom API endpoint (default: '/api/ai-agent/chat')
  apiEndpoint?: string;
  // Extra params to pass in request body
  extraParams?: Record<string, unknown>;
  // Dock mode props
  isDocked?: boolean;
  onDock?: () => void;
  onUndock?: () => void;
  onClose?: () => void;
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  id?: string;
  name?: string;
  text?: string;
  input?: Record<string, unknown>;
}

interface DisplayToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

interface DisplayToolCall {
  id: string;
  name: ToolName;
  input: Record<string, unknown>;
  result?: DisplayToolResult;
}

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: DisplayToolCall[];
}

interface Chat {
  id: string;
  projectPath: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

const DRAFT_STORAGE_KEY = 'ai-chat-input-draft';

export default function AIAgentChat({
  projectPath,
  initialChatId,
  hideSidebar = false,
  initialPrompt,
  forceNewChat = false,
  onPromptSent,
  onChatTitleUpdate,
  onChatCreated,
  projectId,
  componentPath,
  selectedElementIds,
  apiEndpoint = '/api/ai-agent/chat',
  extraParams,
  isDocked = false,
  onDock,
  onUndock,
  onClose,
}: AIAgentChatProps) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(initialChatId || null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [inputValue, setInputValue] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState('');
  const [currentToolCalls, setCurrentToolCalls] = useState<Map<string, DisplayToolCall>>(new Map());
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const messageQueueRef = useRef<QueuedMessage[]>([]);
  const [pendingAskUser, setPendingAskUser] = useState<{
    toolUseId: string;
    question: string;
    options?: string[];
  } | null>(null);
  // Message history navigation (like terminal)
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState('');
  // Tool result modal state
  const [toolResultModal, setToolResultModal] = useState<{
    isOpen: boolean;
    toolName: string;
    content: string;
  }>({ isOpen: false, toolName: '', content: '' });
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const isStreamingRef = useRef(isStreaming);
  // Track if user has scrolled up from bottom
  const isUserScrolledUpRef = useRef(false);

  const currentChat = useMemo(() => chats.find((c) => c.id === currentChatId), [chats, currentChatId]);

  // Debounced save of input draft to localStorage
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

  // User message history for ArrowUp navigation (newest first)
  const userMessageHistory = useMemo(
    () =>
      messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .reverse(),
    [messages],
  );

  // Keep refs in sync with state
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    messageQueueRef.current = messageQueue;
  }, [messageQueue]);

  // DEBUG: Log isStreaming changes
  useEffect(() => {
    console.log('[DEBUG] isStreaming changed to:', isStreaming);
  }, [isStreaming]);

  // Load chats on mount
  useEffect(() => {
    loadChats();
  }, [projectPath]);

  // Sync initialChatId prop with currentChatId state
  useEffect(() => {
    // Only sync if initialChatId is explicitly set (not null/undefined)
    // This prevents canceling streams when creating new chats (currentChatId changes from null to new ID)
    if (initialChatId && initialChatId !== currentChatId) {
      console.log('[Client] Syncing chatId from prop:', {
        initialChatId,
        currentChatId,
      });
      // Cancel any ongoing stream when switching chats (use ref to avoid stale closure)
      if (isStreamingRef.current) {
        console.log('[Client] Stopping stream due to chat switch');
        handleStopStreaming();
      }
      setCurrentChatId(initialChatId);
    }
  }, [initialChatId, currentChatId]);

  // Load messages when chat changes (but not during streaming)
  useEffect(() => {
    // Don't reload messages during streaming - it will clear the UI
    if (isStreamingRef.current) return;

    // Reset history navigation on chat change
    setHistoryIndex(-1);
    setSavedInput('');

    if (currentChatId) {
      loadMessages(currentChatId);
    } else {
      setMessages([]);
    }
  }, [currentChatId]);

  // Track user scroll position to avoid jumping when scrolled up
  useEffect(() => {
    const scrollContainer = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (!scrollContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      // Consider "at bottom" if within 50px of the bottom
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      isUserScrolledUpRef.current = !isAtBottom;
    };

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll to bottom when messages change, but only if user hasn't scrolled up
  useEffect(() => {
    // Skip if user has scrolled up
    if (isUserScrolledUpRef.current) return;

    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages, currentAssistantMessage]);

  // Track if initial prompt was already sent to prevent duplicate sends
  const initialPromptSentRef = useRef(false);

  // Reset ref when initialPrompt changes to allow sending new prompts
  useEffect(() => {
    if (initialPrompt) {
      initialPromptSentRef.current = false;
    }
  }, [initialPrompt]);

  // Auto-send initial prompt
  useEffect(() => {
    if (initialPrompt && !isLoadingChats && !isStreamingRef.current && !initialPromptSentRef.current) {
      initialPromptSentRef.current = true;

      const sendPrompt = async () => {
        let chatId = currentChatId;

        // Create new chat if forceNewChat is true or no chat exists
        if (forceNewChat || !chatId) {
          chatId = await createNewChat();
          if (!chatId) return;
        }

        // Pass prompt and chatId directly to avoid stale closure issues
        handleSendMessage(initialPrompt, chatId);
        onPromptSent?.();
      };

      sendPrompt();
    }
  }, [initialPrompt, forceNewChat, isLoadingChats, currentChatId, projectId]);

  const loadChats = async () => {
    if (!projectId) {
      console.warn('[AIAgentChat] Cannot load chats: projectId is required');
      setIsLoadingChats(false);
      return;
    }

    try {
      setIsLoadingChats(true);
      const response = await authFetch(`/api/ai-agent/chats?projectId=${encodeURIComponent(projectId)}`);
      if (!response.ok) throw new Error('Failed to load chats');

      const data = await response.json();
      setChats(data);

      // If initialChatId is provided, use it
      if (initialChatId) {
        setCurrentChatId(initialChatId);
      } else if (!hideSidebar && data.length > 0 && !currentChatId) {
        // Only auto-select first chat when sidebar is visible (not controlled externally)
        setCurrentChatId(data[0].id);
      }
    } catch (error) {
      console.error('Failed to load chats:', error);
    } finally {
      setIsLoadingChats(false);
    }
  };

  const loadMessages = async (chatId: string) => {
    try {
      setIsLoadingMessages(true);
      const response = await authFetch(`/api/ai-agent/chats/${chatId}/messages`);
      if (!response.ok) throw new Error('Failed to load messages');

      const data = await response.json();

      // Helper to parse toolCalls - handles both legacy string and new object format
      const parseToolCalls = (toolCalls: unknown): unknown[] | null => {
        if (!toolCalls) return null;

        // New format: already an array (JSONB returns parsed object)
        if (Array.isArray(toolCalls)) {
          return toolCalls;
        }

        // Legacy format: double-serialized string
        if (typeof toolCalls === 'string') {
          try {
            let parsed = JSON.parse(toolCalls);
            // Handle double-serialization (string inside JSON)
            if (typeof parsed === 'string') {
              parsed = JSON.parse(parsed);
            }
            if (Array.isArray(parsed)) {
              return parsed;
            }
          } catch {
            // ignore parse errors
          }
        }

        return null;
      };

      // STEP 1: Build map tool_use_id -> result from tool_result blocks
      const toolResultsMap = new Map<string, { success: boolean; output?: string; error?: string }>();
      for (const msg of data) {
        const blocks = parseToolCalls(msg.toolCalls);
        if (!blocks) continue;

        for (const block of blocks as { type: string; content?: string; tool_use_id?: string }[]) {
          if (block.type === 'tool_result') {
            const content = block.content || '';
            const isError = content.startsWith('Error:');
            toolResultsMap.set(block.tool_use_id || '', {
              success: !isError,
              output: isError ? undefined : content,
              error: isError ? content.replace('Error: ', '') : undefined,
            });
          }
        }
      }

      // STEP 2: Process messages and match tool_use with real results
      const displayMessages: DisplayMessage[] = [];
      for (const msg of data) {
        const anthropicContent = parseToolCalls(msg.toolCalls);

        if (anthropicContent) {
          const toolUseBlocks = anthropicContent.filter((b: AnthropicContentBlock) => b.type === 'tool_use');
          const textBlocks = anthropicContent.filter((b: AnthropicContentBlock) => b.type === 'text');
          const hasOnlyToolResult = anthropicContent.every((b: AnthropicContentBlock) => b.type === 'tool_result');

          // Skip tool_result only messages - their content is merged into tool_use
          if (hasOnlyToolResult) {
            continue;
          }

          if (toolUseBlocks.length > 0) {
            const textContent = textBlocks.map((b: AnthropicContentBlock) => b.text).join('\n');
            displayMessages.push({
              id: msg.id,
              role: msg.role,
              content: textContent || msg.content,
              toolCalls: toolUseBlocks.map((b: AnthropicContentBlock) => ({
                id: b.id ?? '',
                name: (b.name ?? '') as ToolName,
                input: b.input ?? {},
                result: toolResultsMap.get(b.id ?? '') ?? {
                  success: true,
                  output: '(result not found)',
                },
              })),
            });
          } else if (textBlocks.length > 0) {
            displayMessages.push({
              id: msg.id,
              role: msg.role,
              content: textBlocks.map((b: AnthropicContentBlock) => b.text).join('\n'),
            });
          } else if (msg.content) {
            displayMessages.push({
              id: msg.id,
              role: msg.role,
              content: msg.content,
            });
          }
        } else if (msg.content) {
          displayMessages.push({
            id: msg.id,
            role: msg.role,
            content: msg.content,
          });
        }
      }

      setMessages(displayMessages);
    } catch (error) {
      console.error('Failed to load messages:', error);
      setMessages([]);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const createNewChat = async () => {
    if (!projectId) {
      console.warn('[AIAgentChat] Cannot create chat: projectId is required');
      return null;
    }

    try {
      const response = await authFetch('/api/ai-agent/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          title: 'New Chat',
        }),
      });

      if (!response.ok) throw new Error('Failed to create chat');

      const newChat = await response.json();
      setChats((prev) => [newChat, ...prev]);
      setCurrentChatId(newChat.id);
      setMessages([]);
      onChatCreated?.(newChat.id);
      return newChat.id;
    } catch (error) {
      console.error('Failed to create chat:', error);
      return null;
    }
  };

  const deleteChat = async (chatId: string) => {
    try {
      const response = await authFetch(`/api/ai-agent/chats/${chatId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete chat');

      setChats((prev) => prev.filter((c) => c.id !== chatId));

      // Switch to another chat or create new one
      if (currentChatId === chatId) {
        const remainingChats = chats.filter((c) => c.id !== chatId);
        if (remainingChats.length > 0) {
          setCurrentChatId(remainingChats[0].id);
        } else {
          setCurrentChatId(null);
          setMessages([]);
        }
      }
    } catch (error) {
      console.error('Failed to delete chat:', error);
    }
  };

  const handleSendMessage = async (messageContent?: string | string[], overrideChatId?: string | null) => {
    // Support both single message and array of messages
    const messagesToSend: string[] = Array.isArray(messageContent)
      ? messageContent
      : messageContent
        ? [messageContent]
        : inputValue.trim()
          ? [inputValue]
          : [];

    if (messagesToSend.length === 0) return;

    // If streaming and no direct message provided — add to queue instead of sending
    if (isStreaming && !messageContent) {
      // Max queue size check
      if (messageQueue.length >= 10) {
        console.warn('[Client] Queue is full, cannot add more messages');
        return;
      }
      const queuedMsg: QueuedMessage = {
        id: generateMessageId(),
        content: inputValue,
        status: 'pending',
        createdAt: Date.now(),
      };
      setMessageQueue((prev) => [...prev, queuedMsg]);
      setInputValue('');
      try {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return;
    }

    // Create new chat if needed (use overrideChatId to avoid stale closure)
    let chatId = overrideChatId ?? currentChatId;
    if (!chatId) {
      chatId = await createNewChat();
      if (!chatId) return;
    }

    // Clear input before sending (user message will be shown via SSE event)
    if (!messageContent) {
      setInputValue('');
      try {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    // Reset scroll-up flag so we auto-scroll to show user's message
    isUserScrolledUpRef.current = false;

    console.log('[Client] Setting isStreaming to true');
    setIsStreaming(true);
    setCurrentAssistantMessage('');
    setCurrentToolCalls(new Map());

    // Create abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    console.log('[Client] Abort controller created');

    try {
      // Add projectId to query params for requireEditor middleware
      const url = projectId ? `${apiEndpoint}?projectId=${encodeURIComponent(projectId)}` : apiEndpoint;
      const response = await authFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messagesToSend,
          projectPath,
          chatId,
          componentPath: componentPath || undefined,
          selectedElementIds: selectedElementIds?.length ? selectedElementIds : undefined,
          // conversationHistory is loaded by server from DB when chatId is provided
          ...extraParams,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[AIAgentChat] API error:', response.status, errorData);
        throw new Error(errorData.error || errorData.message || 'Failed to send message');
      }

      // Handle SSE stream - process chunks synchronously for immediate rendering
      const reader = response.body?.getReader();
      readerRef.current = reader || null;
      const decoder = new TextDecoder();

      if (!reader) {
        console.error('[Client] No reader available');
        throw new Error('No response body');
      }

      console.log('[Client] Starting to process stream');
      let buffer = '';
      let assistantContent = '';

      // Helper to save accumulated text
      const saveAccumulatedText = () => {
        if (assistantContent.trim()) {
          const msg: DisplayMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: assistantContent,
          };
          setMessages((prev) => [...prev, msg]);
          assistantContent = '';
          setCurrentAssistantMessage('');
        }
      };

      // Process stream in a loop
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('[Client] Stream done');
          saveAccumulatedText();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              saveAccumulatedText();
              continue;
            }

            try {
              const event: { type: string; data: Record<string, unknown> } = JSON.parse(data);

              switch (event.type) {
                case 'user_message':
                  // User message from server - add to messages list
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: generateMessageId(),
                      role: 'user',
                      content: String(event.data.content ?? ''),
                    },
                  ]);
                  break;

                case 'content_block_delta': {
                  const delta = String(event.data.delta ?? '');
                  console.log('[Client] Received delta:', delta);
                  assistantContent += delta;
                  // Use flushSync to force immediate render
                  flushSync(() => {
                    setCurrentAssistantMessage((prev) => {
                      const updated = prev + delta;
                      console.log('[Client] Updated currentAssistantMessage to:', updated);
                      return updated;
                    });
                  });
                  break;
                }

                case 'tool_use_start': {
                  const toolUseId = String(event.data.toolUseId ?? '');
                  const toolName = String(event.data.toolName ?? '') as ToolName;
                  const toolInput = (event.data.input ?? {}) as Record<string, unknown>;
                  console.log('[Client] Tool use start received:', {
                    toolName,
                    toolUseId,
                    input: toolInput,
                  });
                  saveAccumulatedText();
                  setCurrentToolCalls((prev) => {
                    const updated = new Map(prev);
                    updated.set(toolUseId, {
                      id: toolUseId,
                      name: toolName,
                      input: toolInput,
                    });
                    return updated;
                  });
                  break;
                }

                case 'tool_use_result': {
                  const resultToolUseId = String(event.data.toolUseId ?? '');
                  const toolResultRaw = (event.data.result ?? {}) as Record<string, unknown>;
                  const toolResult: DisplayToolResult = {
                    success: Boolean(toolResultRaw.success),
                    output: toolResultRaw.output != null ? String(toolResultRaw.output) : undefined,
                    error: toolResultRaw.error != null ? String(toolResultRaw.error) : undefined,
                  };
                  console.log('[Client] Tool use result received:', {
                    toolUseId: resultToolUseId,
                    result: toolResult,
                  });
                  setCurrentToolCalls((prev) => {
                    const updated = new Map(prev);
                    const toolCall = updated.get(resultToolUseId);
                    if (toolCall) {
                      console.log('[Client] Tool call before result:', toolCall);
                      toolCall.result = toolResult;

                      // Dispatch CustomEvent for canvas tools to trigger UI refresh
                      const canvasTools = [
                        'canvas_create_instance',
                        'canvas_update_instance',
                        'canvas_delete_instance',
                        'canvas_connect_instances',
                        'canvas_add_annotation',
                      ];
                      if (canvasTools.includes(toolCall.name) && toolResult.success) {
                        window.dispatchEvent(new CustomEvent('canvasCompositionChanged'));
                      }

                      // Record AI file changes for undo/redo (either snapshot is enough — delete_file has no redo)
                      if (
                        (event.data.redoSnapshotId !== undefined || event.data.undoSnapshotId !== undefined) &&
                        event.data.filePath
                      ) {
                        window.dispatchEvent(
                          new CustomEvent('hypercanvas:externalFileChange', {
                            detail: {
                              filePath: String(event.data.filePath),
                              undoSnapshotId: event.data.undoSnapshotId,
                              redoSnapshotId: event.data.redoSnapshotId,
                              source: 'ai-agent' as const,
                              description: `AI: ${toolCall.name} ${String(event.data.filePath)}`,
                            },
                          }),
                        );
                      }

                      const msg: DisplayMessage = {
                        id: generateMessageId(),
                        role: 'assistant',
                        content: '',
                        toolCalls: [toolCall],
                      };
                      setMessages((prevMsgs) => [...prevMsgs, msg]);
                      updated.delete(resultToolUseId);
                    }
                    return updated;
                  });
                  break;
                }

                case 'chat_title_updated': {
                  const title = String(event.data.title ?? '');
                  if (chatId) {
                    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title } : c)));
                    onChatTitleUpdate?.(chatId, title);
                  }
                  break;
                }

                case 'ask_user':
                  console.log('[Client] ask_user received:', event.data);
                  setPendingAskUser({
                    toolUseId: String(event.data.toolUseId ?? ''),
                    question: String(event.data.question ?? ''),
                    options: event.data.options as string[] | undefined,
                  });
                  break;

                case 'keepalive':
                  // Ignore keepalive events - they just prevent SSE timeout
                  console.log('[Client] Keepalive received');
                  break;

                case 'error':
                  console.error('Stream error:', event.data.error);
                  // Show error to user as assistant message
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: generateMessageId(),
                      role: 'assistant',
                      content: `Error: ${String(event.data.error ?? 'Unknown error')}`,
                    },
                  ]);
                  break;
              }
            } catch (error) {
              console.error('Failed to parse SSE event:', error, 'data:', data);
            }
          }
        }
      }

      console.log('[Client] Stream processing completed');
    } catch (error) {
      // Don't show error if request was aborted by user
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Stream aborted by user');
        return;
      }

      console.error('Failed to send message:', error);

      // Format user-friendly error message
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        // Handle network errors (fetch failed, connection refused, etc.)
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
          errorMessage = 'Network error: Unable to connect to the server. Please check your connection and try again.';
        } else if (error.message.includes('network') || error.message.includes('Network')) {
          errorMessage = `Network error: ${error.message}`;
        } else if (error.message.includes('quota exceeded') || error.message.includes('Resource quota')) {
          errorMessage = error.message; // Already formatted by server
        } else if (error.message.includes('Failed to')) {
          errorMessage = error.message; // Server error with details
        } else {
          errorMessage = error.message;
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'assistant',
          content: `Error: ${errorMessage}`,
        },
      ]);
    } finally {
      console.log('[Client] Entering finally block, setting isStreaming to false');
      setIsStreaming(false);
      setCurrentAssistantMessage('');
      setCurrentToolCalls(new Map());
      abortControllerRef.current = null;
      readerRef.current = null;

      // Process all queued messages at once
      const pendingMessages = messageQueueRef.current.filter((m) => m.status === 'pending').map((m) => m.content);

      if (pendingMessages.length > 0) {
        // Clear queue and send all messages as batch
        setMessageQueue([]);
        handleSendMessage(pendingMessages);
      }
    }
  };

  const handleStopStreaming = () => {
    console.log('[Client] Stop button clicked');

    // Prevent multiple calls
    if (!isStreaming && !abortControllerRef.current) {
      console.log('[Client] Already stopped, ignoring');
      return;
    }

    if (abortControllerRef.current) {
      console.log('[Client] Aborting request');
      abortControllerRef.current.abort();
    }
    if (readerRef.current) {
      console.log('[Client] Canceling reader');
      // Wrap in try-catch to prevent unhandled AbortError
      readerRef.current.cancel().catch(() => {
        // Expected when aborting an active stream
      });
    }
    console.log('[Client] Setting isStreaming to false');
    setIsStreaming(false);
    setCurrentAssistantMessage('');
    setCurrentToolCalls(new Map());
    abortControllerRef.current = null;
    readerRef.current = null;

    // Collect queued messages and put in input for user to decide
    const pendingMessages = messageQueueRef.current.filter((m) => m.status === 'pending').map((m) => m.content);

    if (pendingMessages.length > 0) {
      const combined = pendingMessages.join('\n\n');
      setInputValue((prev) => (prev ? `${prev}\n\n${combined}` : combined));
    }
    setMessageQueue([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Allow global hotkeys (Cmd/Ctrl+K, Cmd/Ctrl+Z, etc.) to work even when textarea is focused
    if (e.metaKey || e.ctrlKey) {
      // Don't intercept - let global handlers process this
      return;
    }

    const textarea = e.currentTarget;
    const cursorAtStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0;

    // ArrowUp at start - show previous user message (like terminal)
    if (e.key === 'ArrowUp' && cursorAtStart && userMessageHistory.length > 0) {
      e.preventDefault();
      if (historyIndex === -1) {
        setSavedInput(inputValue);
      }
      const newIndex = Math.min(historyIndex + 1, userMessageHistory.length - 1);
      setHistoryIndex(newIndex);
      setInputValue(userMessageHistory[newIndex]);
      return;
    }

    // ArrowDown - return to newer message or saved input
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

    // Shift+Enter or Alt+Enter - insert newline manually
    if (e.key === 'Enter' && (e.shiftKey || e.altKey)) {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = `${inputValue.substring(0, start)}\n${inputValue.substring(end)}`;
      setInputValue(newValue);
      // Restore cursor position after state update
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 1;
      });
      return;
    }

    // Enter without modifiers - send message or answer ask_user
    if (e.key === 'Enter') {
      e.preventDefault();
      setHistoryIndex(-1);
      setSavedInput('');

      // If there's a pending ask_user question, send as answer
      if (pendingAskUser && inputValue.trim()) {
        handleAskUserResponse(inputValue.trim());
        setInputValue('');
        try {
          localStorage.removeItem(DRAFT_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        return;
      }

      handleSendMessage();
    }
  };

  const handleCancelQueued = (id: string) => {
    setMessageQueue((prev) => prev.filter((m) => m.id !== id));
  };

  const handleAskUserResponse = async (userResponse: string) => {
    if (!pendingAskUser) return;

    try {
      // Add projectId to query params for requireEditor middleware
      const url = projectId
        ? `/api/ai-agent/user-response?projectId=${encodeURIComponent(projectId)}`
        : '/api/ai-agent/user-response';

      const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolUseId: pendingAskUser.toolUseId,
          response: userResponse,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send response');
      }

      setPendingAskUser(null);
    } catch (error) {
      console.error('Failed to send user response:', error);
    }
  };

  // Clear queue when switching chats
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally clear on chat switch
  useEffect(() => {
    setMessageQueue([]);
  }, [currentChatId]);

  return (
    <TooltipProvider>
      <div className="ai-agent-chat flex h-full">
        {/* Sidebar with chats list - hidden when hideSidebar is true */}
        {!hideSidebar && (
          <div className="w-48 shrink-0 border-r flex flex-col">
            <div className="p-2 border-b flex gap-1">
              <Button onClick={createNewChat} size="sm" className="flex-1" variant="outline">
                <IconPlus className="w-4 h-4 mr-1" />
                New Chat
              </Button>
            </div>

            <ScrollArea className="flex-1">
              {isLoadingChats ? (
                <div className="p-4 text-center text-xs text-muted-foreground">Loading...</div>
              ) : chats.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">No chats yet</div>
              ) : (
                <div className="p-2 space-y-1">
                  {chats.map((chat) => {
                    const shouldShowTooltip = chat.title.length > 20;
                    const chatButton = (
                      // biome-ignore lint/correctness/useJsxKeyInIterable: linter mistake
                      <button
                        type="button"
                        className={`group flex items-center gap-1 p-2 rounded cursor-pointer text-xs w-full text-left ${
                          currentChatId === chat.id ? 'bg-blue-100 dark:bg-blue-900/30' : 'hover:bg-muted'
                        }`}
                        onClick={() => setCurrentChatId(chat.id)}
                      >
                        <span className="flex-1 truncate">{chat.title}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteChat(chat.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                        >
                          <IconTrash className="w-3 h-3 text-red-600 dark:text-red-400" />
                        </button>
                      </button>
                    );

                    return shouldShowTooltip ? (
                      <Tooltip key={chat.id}>
                        <TooltipTrigger asChild>{chatButton}</TooltipTrigger>
                        <TooltipContent>
                          <p>{chat.title}</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <div key={chat.id}>{chatButton}</div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        )}

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="p-4 border-b flex items-start justify-between gap-2">
            <div className="min-w-0">
              {hideSidebar ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 font-semibold hover:text-muted-foreground transition-colors text-left max-w-full"
                    >
                      <span className="truncate">{currentChat?.title || 'AI Code Assistant'}</span>
                      <IconChevronDown className="w-3.5 h-3.5 shrink-0" stroke={1.5} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuItem onClick={createNewChat}>
                      <IconPlus className="w-4 h-4 mr-2" />
                      New Chat
                    </DropdownMenuItem>
                    {chats.length > 0 && <DropdownMenuSeparator />}
                    {chats.map((chat) => (
                      <DropdownMenuItem
                        key={chat.id}
                        className={cn('flex items-center justify-between gap-2', {
                          'bg-accent': currentChatId === chat.id,
                        })}
                        onClick={() => setCurrentChatId(chat.id)}
                      >
                        <span className="truncate flex-1">{chat.title}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteChat(chat.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded shrink-0"
                        >
                          <IconTrash className="w-3 h-3 text-red-600 dark:text-red-400" />
                        </button>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <h3 className="font-semibold">AI Code Assistant</h3>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {currentChatId ? 'Ask questions or make code changes' : 'Start a new chat'}
              </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {isDocked
                ? onUndock && (
                    <button
                      type="button"
                      onClick={onUndock}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Undock to window"
                    >
                      <IconArrowsMaximize className="w-4 h-4" stroke={1.5} />
                    </button>
                  )
                : onDock && (
                    <button
                      type="button"
                      onClick={onDock}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Dock to sidebar"
                    >
                      <IconLayoutSidebarRight className="w-4 h-4" stroke={1.5} />
                    </button>
                  )}
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="Close"
                >
                  <IconX className="w-4 h-4" stroke={1.5} />
                </button>
              )}
            </div>
          </div>

          <ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
            {isLoadingMessages ? (
              <div className="flex items-center justify-center h-full">
                <IconLoader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div key={message.id} className="space-y-2">
                    <div
                      className={`rounded-lg p-3 ${
                        message.role === 'user' ? 'bg-blue-100 dark:bg-blue-900/30 ml-8' : 'bg-muted mr-8'
                      }`}
                    >
                      <div className="text-xs font-semibold mb-1 text-muted-foreground">
                        {message.role === 'user' ? 'You' : 'Assistant'}
                      </div>
                      {message.role === 'assistant' ? (
                        <div className="text-sm prose prose-sm dark:prose-invert max-w-none">
                          <ReactMarkdown>{message.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <div className="text-sm whitespace-pre-wrap break-words text-foreground">{message.content}</div>
                      )}
                    </div>

                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <div className="ml-4 space-y-2">
                        {message.toolCalls.map((toolCall) => (
                          <div
                            key={toolCall.id}
                            className="text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-2 overflow-x-auto w-full"
                          >
                            <div className="font-semibold text-amber-800 dark:text-amber-400">🔧 {toolCall.name}</div>
                            {toolCall.name === 'edit_file' && toolCall.input?.path ? (
                              <div className="mt-1">
                                <EditFileDiff
                                  path={String(toolCall.input.path)}
                                  oldContent={String(toolCall.input.oldContent || '')}
                                  newContent={String(toolCall.input.newContent || '')}
                                />
                              </div>
                            ) : (
                              <pre className="mt-1 text-muted-foreground whitespace-pre">
                                {JSON.stringify(toolCall.input, null, 2)}
                              </pre>
                            )}
                            {toolCall.result && (
                              <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
                                <div className="font-semibold text-green-700 dark:text-green-400">
                                  {toolCall.result.success ? '✓ Success' : '✗ Failed'}
                                </div>
                                {toolCall.result.output &&
                                  (() => {
                                    const output = toolCall.result.output;
                                    const lines = output.split('\n');
                                    const truncated = lines.slice(0, 5).join('\n');
                                    const hasMore = lines.length > 5;
                                    return (
                                      <div className="mt-1">
                                        <pre className="text-foreground font-mono text-xs whitespace-pre overflow-hidden">
                                          {truncated}
                                          {hasMore && '...'}
                                        </pre>
                                        {hasMore && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setToolResultModal({
                                                isOpen: true,
                                                toolName: toolCall.name,
                                                content: output,
                                              })
                                            }
                                            className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300 font-medium"
                                          >
                                            <IconEye className="w-3 h-3" stroke={1.5} />
                                            View full output ({lines.length} lines)
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })()}
                                {toolCall.result.error && (
                                  <div className="mt-1 text-red-600 dark:text-red-400 break-words">
                                    {toolCall.result.error}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* Current streaming message */}
                {(currentAssistantMessage || currentToolCalls.size > 0) && (
                  <div className="space-y-2">
                    {currentAssistantMessage && (
                      <div className="rounded-lg p-3 bg-muted mr-8">
                        <div className="text-xs font-semibold mb-1 text-muted-foreground">Assistant</div>
                        <div className="text-sm prose prose-sm dark:prose-invert max-w-none">
                          <ReactMarkdown>{currentAssistantMessage}</ReactMarkdown>
                        </div>
                      </div>
                    )}

                    {currentToolCalls.size > 0 && (
                      <div className="ml-4 space-y-2">
                        {Array.from(currentToolCalls.values()).map((toolCall) => (
                          <div
                            key={toolCall.id}
                            className="text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-2 overflow-x-auto w-full"
                          >
                            <div className="font-semibold text-amber-800 dark:text-amber-400">🔧 {toolCall.name}</div>
                            {toolCall.name === 'edit_file' && toolCall.input?.path ? (
                              <div className="mt-1">
                                <EditFileDiff
                                  path={String(toolCall.input.path)}
                                  oldContent={String(toolCall.input.oldContent || '')}
                                  newContent={String(toolCall.input.newContent || '')}
                                />
                              </div>
                            ) : (
                              <pre className="mt-1 text-muted-foreground whitespace-pre">
                                {JSON.stringify(toolCall.input, null, 2)}
                              </pre>
                            )}
                            {toolCall.result && (
                              <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
                                <div className="font-semibold text-green-700 dark:text-green-400">
                                  {toolCall.result.success ? '✓ Success' : '✗ Failed'}
                                </div>
                                {toolCall.result.output && (
                                  <pre className="mt-1 text-foreground font-mono text-xs whitespace-pre">
                                    {toolCall.result.output}
                                  </pre>
                                )}
                                {toolCall.result.error && (
                                  <div className="mt-1 text-red-600 dark:text-red-400 break-words">
                                    {toolCall.result.error}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {messages.length === 0 && !isStreaming && !isLoadingMessages && (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    <p>Ask me anything about your code!</p>
                    <p className="text-xs mt-2">I can read files, edit code, search, and run git commands.</p>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          <div className="p-4 border-t">
            {/* Queued messages indicator */}
            {messageQueue.length > 0 && (
              <div className="mb-2 p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded text-xs">
                <div className="font-semibold text-amber-800 dark:text-amber-400 mb-1">
                  Queued ({messageQueue.length}):
                </div>
                {messageQueue.map((msg, idx) => (
                  <div key={msg.id} className="flex items-center gap-2 py-1">
                    <span className="text-muted-foreground">[{idx + 1}]</span>
                    <span className="flex-1 truncate text-foreground">{msg.content}</span>
                    <button
                      type="button"
                      onClick={() => handleCancelQueued(msg.id)}
                      className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* AI is asking user for input */}
            {pendingAskUser && (
              <AskUserPrompt
                question={pendingAskUser.question}
                options={pendingAskUser.options}
                onSubmit={handleAskUserResponse}
              />
            )}
            {isStreaming && !pendingAskUser && (
              <div className="mb-2 text-xs text-muted-foreground flex items-center gap-2">
                <IconLoader2 className="w-3 h-3 animate-spin" />
                <span>AI is thinking...</span>
              </div>
            )}
            <div className="flex gap-2">
              <Textarea
                autoResize
                autoFocus
                maxRows={5}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  pendingAskUser
                    ? 'Type your answer...'
                    : isStreaming
                      ? 'Type to queue message...'
                      : 'Ask about your code...'
                }
                className="flex-1 min-h-[40px]"
              />
              {isStreaming && !pendingAskUser ? (
                <Button onClick={handleStopStreaming} size="icon" variant="destructive" title="Stop generation">
                  <IconSquare className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    if (pendingAskUser && inputValue.trim()) {
                      handleAskUserResponse(inputValue.trim());
                      setInputValue('');
                      try {
                        localStorage.removeItem(DRAFT_STORAGE_KEY);
                      } catch {
                        /* ignore */
                      }
                      return;
                    }
                    handleSendMessage();
                  }}
                  disabled={!inputValue.trim()}
                  size="icon"
                  title={pendingAskUser ? 'Send answer' : 'Send message'}
                >
                  <IconSend className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tool result full output modal - z-[1100] to be above AI chat (z-[1000]) */}
      <Dialog
        open={toolResultModal.isOpen}
        onOpenChange={(open) => setToolResultModal((prev) => ({ ...prev, isOpen: open }))}
      >
        <DialogPortal>
          <DialogOverlay className="!z-[1100]" />
          <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-[1100] translate-x-[-50%] translate-y-[-50%] max-w-4xl w-[90vw] h-[80vh] flex flex-col gap-4 border bg-background p-6 shadow-lg rounded-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <DialogHeader>
              <DialogTitle>🔧 {toolResultModal.toolName} - Output</DialogTitle>
            </DialogHeader>
            <div className="flex-1 min-h-0 border rounded overflow-hidden">
              <LazyEditor
                value={toolResultModal.content}
                language={detectLanguageFromContent(toolResultModal.content)}
                theme="vs-light"
                beforeMount={(monaco) => {
                  // Disable all validation/diagnostics
                  monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
                    noSemanticValidation: true,
                    noSyntaxValidation: true,
                  });
                  monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
                    noSemanticValidation: true,
                    noSyntaxValidation: true,
                  });
                  monaco.json.jsonDefaults.setDiagnosticsOptions({
                    validate: false,
                  });
                }}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  fontSize: 12,
                  folding: false,
                  renderLineHighlight: 'none',
                  selectionHighlight: false,
                  occurrencesHighlight: 'off',
                  renderValidationDecorations: 'off',
                }}
              />
            </div>
            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
              <IconX className="h-4 w-4" stroke={1.5} />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </TooltipProvider>
  );
}
