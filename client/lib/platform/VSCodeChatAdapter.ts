/**
 * VS Code extension chat adapter — communicates via postMessage to extension host.
 */

import type { ChatAdapter, ChatSession, ChatStreamEvent, DisplayMessage } from '../../../shared/ai-chat-display';

interface VsCodeApi {
  postMessage(message: unknown): void;
}

/**
 * Create a chat adapter that communicates with the VS Code extension host
 * via postMessage. Uses request/response pattern for CRUD, event stream for chat.
 */
export function createVSCodeChatAdapter(vsCodeApi: VsCodeApi): ChatAdapter {
  /** Wait for a specific message type from the extension host, optionally matching extra fields */
  function waitForMessage<T>(type: string, match?: Record<string, unknown>, timeout = 10000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error(`Timeout waiting for ${type}`));
      }, timeout);

      function handler(event: MessageEvent) {
        const data = event.data;
        if (data?.type !== type) return;
        if (match) {
          for (const key in match) {
            if (data[key] !== match[key]) return;
          }
        }
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        resolve(data as T);
      }

      window.addEventListener('message', handler); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, extension-controlled messages only
    });
  }

  return {
    async listChats(): Promise<ChatSession[]> {
      vsCodeApi.postMessage({ type: 'chat:list' });
      const response = await waitForMessage<{ chats: ChatSession[] }>('chat:list');
      return response.chats;
    },

    async createChat(title?: string): Promise<ChatSession> {
      vsCodeApi.postMessage({ type: 'chat:create', title });
      const response = await waitForMessage<{ session: ChatSession }>('chat:created');
      return response.session;
    },

    async loadChat(chatId: string): Promise<{ messages: DisplayMessage[] } | null> {
      vsCodeApi.postMessage({ type: 'chat:load', chatId });
      const response = await waitForMessage<{ data: { messages: DisplayMessage[] } | null }>('chat:loaded', { chatId });
      return response.data;
    },

    async saveMessages(chatId: string, messages: DisplayMessage[]): Promise<void> {
      vsCodeApi.postMessage({ type: 'chat:save', chatId, messages });
    },

    async updateTitle(chatId: string, title: string): Promise<void> {
      vsCodeApi.postMessage({ type: 'chat:updateTitle', chatId, title });
    },

    async deleteChat(chatId: string): Promise<void> {
      vsCodeApi.postMessage({ type: 'chat:delete', chatId });
      await waitForMessage<{ chatId: string }>('chat:deleted', { chatId });
    },

    async sendMessage({ chatId, messages, onEvent, signal }): Promise<void> {
      const requestId = `req-${Date.now()}`;

      vsCodeApi.postMessage({
        type: 'ai:chat',
        requestId,
        chatId,
        messages: messages.map((content) => ({ role: 'user' as const, content })),
      });

      return new Promise<void>((resolve) => {
        function handler(event: MessageEvent) {
          const msg = event.data;
          if (!msg?.type || msg.requestId !== requestId) return;

          const mapped = mapExtensionEvent(msg, chatId);
          if (mapped) onEvent(mapped);

          if (msg.type === 'ai:done' || msg.type === 'ai:error') {
            window.removeEventListener('message', handler);
            resolve();
          }
        }

        // Abort handler
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              vsCodeApi.postMessage({ type: 'ai:abort', requestId });
              window.removeEventListener('message', handler);
              resolve();
            },
            { once: true },
          );
        }

        window.addEventListener('message', handler); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, extension-controlled messages only
      });
    },

    async respondToAskUser(toolUseId: string, response: string): Promise<void> {
      vsCodeApi.postMessage({ type: 'ai:askUserResponse', toolUseId, response });
    },
  };
}

/** Map extension postMessage events to unified ChatStreamEvent */
function mapExtensionEvent(msg: { type: string; [key: string]: unknown }, chatId: string): ChatStreamEvent | null {
  switch (msg.type) {
    case 'ai:delta':
      return { type: 'text_delta', text: String(msg.text ?? '') };

    case 'ai:toolUse':
      return {
        type: 'tool_use',
        toolUseId: String(msg.toolUseId ?? ''),
        toolName: String(msg.toolName ?? ''),
        input: (msg.input ?? {}) as Record<string, unknown>,
      };

    case 'ai:toolResult': {
      const result = (msg.result ?? {}) as { success?: boolean; output?: string; error?: string };
      return {
        type: 'tool_result',
        toolUseId: String(msg.toolUseId ?? ''),
        toolName: msg.toolName ? String(msg.toolName) : undefined,
        result: {
          success: Boolean(result.success),
          output: result.output,
          error: result.error,
        },
      };
    }

    case 'ai:askUser':
      return {
        type: 'ask_user',
        toolUseId: String(msg.toolUseId ?? ''),
        question: String(msg.question ?? ''),
        options: msg.options as string[] | undefined,
      };

    case 'ai:done':
      return { type: 'done' };

    case 'ai:error':
      return { type: 'error', error: String(msg.error ?? 'Unknown error') };

    case 'chat:titleUpdated':
      return {
        type: 'chat_title_updated',
        chatId,
        title: String(msg.title ?? ''),
      };

    default:
      return null;
  }
}
