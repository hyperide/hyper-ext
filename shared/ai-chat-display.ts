/**
 * Shared display types for AI Chat UI.
 * Used by both SaaS (AIAgentChat) and VS Code extension (AIChat).
 */

import type { ToolName } from './ai-agent';

export interface DisplayToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface DisplayToolCall {
  id: string;
  name: ToolName | (string & {});
  input: Record<string, unknown>;
  result?: DisplayToolResult;
}

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: DisplayToolCall[];
}

/** Chat session metadata (used for history list / dropdown) */
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/** Full chat session with messages (persisted to disk) */
export interface ChatSessionData extends ChatSession {
  messages: DisplayMessage[];
}

/**
 * Unified stream event for AI Chat.
 * Both SSE (SaaS) and postMessage (VS Code) events are normalized to this shape.
 */
export type ChatStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'user_message'; content: string }
  | {
      type: 'tool_use';
      toolUseId: string;
      toolName: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      toolUseId: string;
      toolName?: string;
      result: DisplayToolResult;
      filePath?: string;
      undoSnapshotId?: string;
      redoSnapshotId?: string;
    }
  | {
      type: 'ask_user';
      toolUseId: string;
      question: string;
      options?: string[];
    }
  | { type: 'chat_title_updated'; chatId: string; title: string }
  | { type: 'error'; error: string }
  | { type: 'done' }
  | { type: 'keepalive' };

/**
 * Chat adapter interface — abstracts platform-specific chat operations.
 * SaaS: REST API via authFetch + SSE streaming.
 * VS Code ext: postMessage to extension host.
 */
export interface ChatAdapter {
  listChats(): Promise<ChatSession[]>;
  createChat(title?: string): Promise<ChatSession>;
  loadChat(chatId: string): Promise<{ messages: DisplayMessage[] } | null>;
  saveMessages(chatId: string, messages: DisplayMessage[]): Promise<void>;
  updateTitle(chatId: string, title: string): Promise<void>;
  deleteChat(chatId: string): Promise<void>;

  /**
   * Send messages and stream responses.
   * Calls onEvent for each ChatStreamEvent.
   * Returns when the stream is done or aborted.
   */
  sendMessage(params: {
    chatId: string;
    messages: string[];
    onEvent: (event: ChatStreamEvent) => void;
    signal?: AbortSignal;
  }): Promise<void>;

  /** Respond to an ask_user prompt */
  respondToAskUser(toolUseId: string, response: string): Promise<void>;

  /** Cleanup resources (e.g. remove event listeners) */
  dispose?(): void;
}
