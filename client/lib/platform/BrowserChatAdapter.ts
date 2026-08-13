/**
 * SaaS chat adapter — communicates with the backend via authFetch + SSE streaming.
 */

import { authFetch } from '@/utils/authFetch';
import type { ToolName } from '../../../shared/ai-agent';
import type {
  ChatAdapter,
  ChatSession,
  ChatStreamEvent,
  DisplayMessage,
  DisplayToolResult,
} from '../../../shared/ai-chat-display';

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  id?: string;
  name?: string;
  text?: string;
  input?: Record<string, unknown>;
  content?: string;
  tool_use_id?: string;
}

/** Stable config — used to create and identify the adapter instance */
export interface BrowserChatAdapterConfig {
  projectId: string;
  projectPath: string;
  apiEndpoint?: string;
  /** Getter for values that change between sends (selection, component path, extra params) */
  getMutableContext?: () => {
    componentPath?: string | null;
    selectedElementIds?: string[];
    extraParams?: Record<string, unknown>;
  };
}

export function createBrowserChatAdapter(config: BrowserChatAdapterConfig): ChatAdapter {
  const { projectId, projectPath, apiEndpoint = '/api/ai-agent/chat' } = config;

  return {
    async listChats(): Promise<ChatSession[]> {
      const response = await authFetch(`/api/ai-agent/chats?projectId=${encodeURIComponent(projectId)}`);
      if (!response.ok) throw new Error('Failed to load chats');
      return response.json();
    },

    async createChat(title = 'New Chat'): Promise<ChatSession> {
      const response = await authFetch('/api/ai-agent/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title }),
      });
      if (!response.ok) throw new Error('Failed to create chat');
      return response.json();
    },

    async loadChat(chatId: string): Promise<{ messages: DisplayMessage[] } | null> {
      const response = await authFetch(`/api/ai-agent/chats/${chatId}/messages`);
      if (!response.ok) throw new Error('Failed to load messages');
      const data = await response.json();
      return { messages: parseServerMessages(data) };
    },

    async saveMessages(): Promise<void> {
      // Server persists messages during streaming — no-op for SaaS
    },

    async updateTitle(): Promise<void> {
      // Server auto-generates titles via SSE events — no-op for SaaS
    },

    async deleteChat(chatId: string): Promise<void> {
      const response = await authFetch(`/api/ai-agent/chats/${chatId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete chat');
    },

    async sendMessage({ chatId, messages, onEvent, signal }): Promise<void> {
      const mutable = config.getMutableContext?.() ?? {};
      const url = `${apiEndpoint}?projectId=${encodeURIComponent(projectId)}`;
      const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          projectPath,
          chatId,
          componentPath: mutable.componentPath || undefined,
          selectedElementIds: mutable.selectedElementIds?.length ? mutable.selectedElementIds : undefined,
          ...mutable.extraParams,
        }),
        signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || 'Failed to send message');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            onEvent({ type: 'done' });
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') {
              onEvent({ type: 'done' });
              continue;
            }

            try {
              const event: { type: string; data: Record<string, unknown> } = JSON.parse(data);
              const mapped = mapSSEEvent(event, chatId);
              if (mapped) onEvent(mapped);
            } catch {
              // skip unparseable lines
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },

    async respondToAskUser(toolUseId: string, response: string): Promise<void> {
      const url = projectId
        ? `/api/ai-agent/user-response?projectId=${encodeURIComponent(projectId)}`
        : '/api/ai-agent/user-response';
      const res = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolUseId, response }),
      });
      if (!res.ok) throw new Error('Failed to send response');
    },
  };
}

/** Map SSE event from backend to unified ChatStreamEvent */
function mapSSEEvent(event: { type: string; data: Record<string, unknown> }, chatId: string): ChatStreamEvent | null {
  switch (event.type) {
    case 'user_message':
      return { type: 'user_message', content: String(event.data.content ?? '') };

    case 'content_block_delta':
      return { type: 'text_delta', text: String(event.data.delta ?? '') };

    case 'tool_use_start':
      return {
        type: 'tool_use',
        toolUseId: String(event.data.toolUseId ?? ''),
        toolName: String(event.data.toolName ?? ''),
        input: (event.data.input ?? {}) as Record<string, unknown>,
      };

    case 'tool_use_result': {
      const raw = (event.data.result ?? {}) as Record<string, unknown>;
      const result: DisplayToolResult = {
        success: Boolean(raw.success),
        output: raw.output != null ? String(raw.output) : undefined,
        error: raw.error != null ? String(raw.error) : undefined,
      };
      return {
        type: 'tool_result',
        toolUseId: String(event.data.toolUseId ?? ''),
        toolName: event.data.toolName ? String(event.data.toolName) : undefined,
        result,
        filePath: event.data.filePath ? String(event.data.filePath) : undefined,
        undoSnapshotId: event.data.undoSnapshotId != null ? String(event.data.undoSnapshotId) : undefined,
        redoSnapshotId: event.data.redoSnapshotId != null ? String(event.data.redoSnapshotId) : undefined,
      };
    }

    case 'ask_user':
      return {
        type: 'ask_user',
        toolUseId: String(event.data.toolUseId ?? ''),
        question: String(event.data.question ?? ''),
        options: event.data.options as string[] | undefined,
      };

    case 'chat_title_updated':
      return {
        type: 'chat_title_updated',
        chatId,
        title: String(event.data.title ?? ''),
      };

    case 'keepalive':
      return { type: 'keepalive' };

    case 'error':
      return { type: 'error', error: String(event.data.error ?? 'Unknown error') };

    default:
      return null;
  }
}

/**
 * Parse server-stored messages (Anthropic content block format) into DisplayMessages.
 * Handles both legacy double-serialized strings and modern JSONB arrays.
 */
function parseServerMessages(
  data: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls: unknown;
  }>,
): DisplayMessage[] {
  // Build map tool_use_id -> result from tool_result blocks
  const toolResultsMap = new Map<string, DisplayToolResult>();
  for (const msg of data) {
    const blocks = parseToolCalls(msg.toolCalls);
    if (!blocks) continue;
    for (const block of blocks as AnthropicContentBlock[]) {
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

  // Process messages and match tool_use with real results
  const displayMessages: DisplayMessage[] = [];
  for (const msg of data) {
    const anthropicContent = parseToolCalls(msg.toolCalls);

    if (anthropicContent) {
      const blocks = anthropicContent as AnthropicContentBlock[];
      const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use');
      const textBlocks = blocks.filter((b) => b.type === 'text');
      const hasOnlyToolResult = blocks.every((b) => b.type === 'tool_result');

      if (hasOnlyToolResult) continue;

      if (toolUseBlocks.length > 0) {
        const textContent = textBlocks.map((b) => b.text).join('\n');
        displayMessages.push({
          id: msg.id,
          role: msg.role,
          content: textContent || msg.content,
          toolCalls: toolUseBlocks.map((b) => ({
            id: b.id ?? '',
            name: (b.name ?? '') as ToolName,
            input: b.input ?? {},
            result: toolResultsMap.get(b.id ?? '') ?? { success: true, output: '(result not found)' },
          })),
        });
      } else if (textBlocks.length > 0) {
        displayMessages.push({
          id: msg.id,
          role: msg.role,
          content: textBlocks.map((b) => b.text).join('\n'),
        });
      } else if (msg.content) {
        displayMessages.push({ id: msg.id, role: msg.role, content: msg.content });
      }
    } else if (msg.content) {
      displayMessages.push({ id: msg.id, role: msg.role, content: msg.content });
    }
  }

  return displayMessages;
}

/** Parse toolCalls — handles both legacy string and JSONB object format */
function parseToolCalls(toolCalls: unknown): unknown[] | null {
  if (!toolCalls) return null;
  if (Array.isArray(toolCalls)) return toolCalls;
  if (typeof toolCalls === 'string') {
    try {
      let parsed = JSON.parse(toolCalls);
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
  }
  return null;
}
