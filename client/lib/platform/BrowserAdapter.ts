/**
 * Browser (SaaS) implementation of platform adapters
 *
 * Uses:
 * - postMessage for code-server iframe communication
 * - CustomEvent for internal component communication
 * - Native EventSource for SSE
 * - Native fetch for API calls
 */

import type {
  ApiAdapter,
  CanvasAdapter,
  EditorAdapter,
  MessageOfType,
  PlatformMessage,
  SSEAdapter,
  ThemeAdapter,
} from './types';

// ============================================================================
// Internal event name for platform messages
// ============================================================================

const PLATFORM_EVENT = 'platform:message';

// ============================================================================
// Browser Editor Adapter
// ============================================================================

export function createBrowserEditorAdapter(): EditorAdapter {
  let activeFileChangeListeners: Array<(path: string | null) => void> = [];
  let isListening = false;
  let messageHandler: ((event: MessageEvent) => void) | null = null;

  const startListening = () => {
    if (isListening) return;
    isListening = true;

    messageHandler = (event: MessageEvent) => {
      if (event.data?.type === 'hypercanvas:activeFileChange') {
        const path = event.data.path as string | null;
        for (const cb of activeFileChangeListeners) {
          cb(path);
        }
      }
    };

    // nosemgrep: insufficient-postmessage-origin-validation -- message type is validated; origin varies between SaaS and VS Code webview contexts
    window.addEventListener('message', messageHandler);
  };

  const stopListening = () => {
    if (!isListening || !messageHandler) return;
    window.removeEventListener('message', messageHandler);
    isListening = false;
    messageHandler = null;
  };

  return {
    async openFile(path: string, line?: number, column?: number): Promise<void> {
      // Find code-server iframe
      const iframe = document.querySelector('iframe[data-code-server]') as HTMLIFrameElement | null;

      if (!iframe?.contentWindow) {
        console.warn('[BrowserAdapter] code-server iframe not found');
        return;
      }

      // Send message to code-server
      // nosemgrep: wildcard-postmessage-configuration -- iframe communication, origin varies between SaaS and VS Code webview
      iframe.contentWindow.postMessage(
        {
          type: 'hypercanvas:openFile',
          path,
          line,
          column,
        },
        '*',
      );
    },

    async getActiveFile(): Promise<string | null> {
      // This would require a request/response pattern with postMessage
      // For now, we rely on onActiveFileChange to track state
      return null;
    },

    onActiveFileChange(callback: (path: string | null) => void): () => void {
      startListening();
      activeFileChangeListeners.push(callback);

      return () => {
        activeFileChangeListeners = activeFileChangeListeners.filter((cb) => cb !== callback);
        // Clean up listener when no more subscribers
        if (activeFileChangeListeners.length === 0) {
          stopListening();
        }
      };
    },

    async goToCode(path: string, line: number, column: number): Promise<void> {
      // Dispatch event for MonacoEditor (in SaaS, we use code-server's Monaco)
      window.dispatchEvent(
        new CustomEvent('monaco-goto-position', {
          detail: { filePath: path, line, column },
        }),
      );
    },
  };
}

// ============================================================================
// Browser Canvas Adapter
// ============================================================================

export function createBrowserCanvasAdapter(): CanvasAdapter {
  return {
    sendEvent<T extends PlatformMessage>(message: T): void {
      window.dispatchEvent(new CustomEvent(PLATFORM_EVENT, { detail: message }));

      // Also dispatch legacy events for backwards compatibility during migration
      dispatchLegacyEvent(message);
    },

    onEvent<K extends PlatformMessage['type']>(type: K, callback: (message: MessageOfType<K>) => void): () => void {
      const handler = (event: Event) => {
        const customEvent = event as CustomEvent<PlatformMessage>;
        if (customEvent.detail?.type === type) {
          callback(customEvent.detail as MessageOfType<K>);
        }
      };

      window.addEventListener(PLATFORM_EVENT, handler);

      // Also listen to legacy events during migration
      const legacyCleanup = listenLegacyEvent(type, callback);

      return () => {
        window.removeEventListener(PLATFORM_EVENT, handler);
        legacyCleanup?.();
      };
    },
  };
}

// ============================================================================
// Legacy event bridge (for gradual migration)
// ============================================================================

function dispatchLegacyEvent(message: PlatformMessage): void {
  switch (message.type) {
    case 'ai:openChat':
      window.dispatchEvent(
        new CustomEvent('openAIChat', {
          detail: {
            prompt: message.prompt,
            forceNewChat: message.forceNewChat,
          },
        }),
      );
      break;

    case 'editor:goToCode':
      window.dispatchEvent(
        new CustomEvent('monaco-goto-position', {
          detail: {
            filePath: message.path,
            line: message.line,
            column: message.column,
          },
        }),
      );
      break;

    case 'editor:goToVisual':
      // goToVisual is handled via SSE in SaaS, not direct event
      break;
  }
}

function listenLegacyEvent<K extends PlatformMessage['type']>(
  type: K,
  callback: (message: MessageOfType<K>) => void,
): (() => void) | undefined {
  switch (type) {
    case 'ai:openChat': {
      const handler = (event: Event) => {
        const customEvent = event as CustomEvent<{
          prompt?: string;
          forceNewChat?: boolean;
        }>;
        callback({
          type: 'ai:openChat',
          prompt: customEvent.detail?.prompt,
          forceNewChat: customEvent.detail?.forceNewChat,
        } as MessageOfType<K>);
      };
      window.addEventListener('openAIChat', handler);
      return () => window.removeEventListener('openAIChat', handler);
    }

    default:
      return undefined;
  }
}

// ============================================================================
// Browser Theme Adapter
// ============================================================================

export function createBrowserThemeAdapter(): ThemeAdapter {
  return {
    getTheme(): 'light' | 'dark' {
      // Check document class (set by ThemeProvider)
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    },

    onThemeChange(callback: (theme: 'light' | 'dark') => void): () => void {
      const observer = new MutationObserver(() => {
        const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        callback(theme);
      });

      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });

      return () => observer.disconnect();
    },
  };
}

// ============================================================================
// Browser SSE Adapter
// ============================================================================

export function createBrowserSSEAdapter(): SSEAdapter {
  return {
    subscribe(
      url: string,
      callbacks: {
        onMessage: (event: string, data: unknown) => void;
        onError?: (error: string) => void;
        onConnected?: () => void;
      },
    ): () => void {
      const eventSource = new EventSource(url, { withCredentials: true });

      eventSource.onopen = () => {
        callbacks.onConnected?.();
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          callbacks.onMessage('message', data);
        } catch {
          callbacks.onMessage('message', event.data);
        }
      };

      eventSource.onerror = () => {
        callbacks.onError?.('SSE connection error');
      };

      return () => {
        eventSource.close();
      };
    },
  };
}

// ============================================================================
// Browser API Adapter
// ============================================================================

export function createBrowserApiAdapter(): ApiAdapter {
  return {
    async fetch(url: string, options?: RequestInit): Promise<Response> {
      // Use native fetch in browser (no CORS issues)
      return fetch(url, {
        ...options,
        credentials: 'include',
      });
    },
  };
}

// ============================================================================
// VS Code Webview Iframe Detection
// ============================================================================

/**
 * Detect if we're running inside an iframe within VS Code webview.
 * In this case, we need to use postMessage to parent (webview),
 * which will proxy messages to the extension.
 *
 * Detection method:
 * - We're in an iframe (window.parent !== window)
 * - Parent window has VS Code-specific markers
 */
function isInVSCodeWebviewIframe(): boolean {
  try {
    // Check if we're in an iframe
    if (window.parent === window) return false;

    // Try to access parent - if cross-origin, this throws
    // VS Code webview iframe should be same-origin
    const parentDoc = window.parent.document;

    // Check for VS Code webview markers
    // VS Code adds vscode-body class or data-vscode attributes
    const parentBody = parentDoc.body;
    if (!parentBody) return false;

    return (
      parentBody.classList.contains('vscode-body') ||
      parentBody.hasAttribute('data-vscode-theme-kind') ||
      // Check if parent has acquireVsCodeApi (webview context)
      'acquireVsCodeApi' in window.parent
    );
  } catch {
    // Cross-origin error means parent is not accessible
    // This is NOT a VS Code webview iframe
    return false;
  }
}

// ============================================================================
// VS Code Iframe Adapters (for iframe inside VS Code webview)
// ============================================================================

/**
 * Pending request handlers for iframe ↔ webview communication
 */
const pendingIframeRequests = new Map<
  string,
  {
    resolve: (data: unknown) => void;
    reject: (error: Error) => void;
  }
>();

let iframeMessageListenerAttached = false;

function attachIframeMessageListener() {
  if (iframeMessageListenerAttached) return;
  iframeMessageListenerAttached = true;

  // nosemgrep: insufficient-postmessage-origin-validation -- message type is validated; origin varies between SaaS and VS Code webview contexts
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg?.type) return;

    // Handle responses from webview/extension
    if (msg.type === 'api:response' || msg.type === 'api:error') {
      const pending = pendingIframeRequests.get(msg.requestId);
      if (pending) {
        pendingIframeRequests.delete(msg.requestId);
        if (msg.type === 'api:response') {
          pending.resolve(msg);
        } else {
          pending.reject(new Error(msg.error));
        }
      }
    }

    // Handle editor:activeFileChanged from extension
    if (msg.type === 'editor:activeFileChanged') {
      // Dispatch as platform event for subscribers
      window.dispatchEvent(new CustomEvent(PLATFORM_EVENT, { detail: msg }));
    }

    // Handle SSE messages from extension
    if (msg.type === 'sse:message' || msg.type === 'sse:error' || msg.type === 'sse:connected') {
      window.dispatchEvent(new CustomEvent(PLATFORM_EVENT, { detail: msg }));
    }
  });
}

/**
 * Editor adapter for iframe inside VS Code webview.
 * Sends messages to parent (webview), which proxies to extension.
 */
function createVSCodeIframeEditorAdapter(): EditorAdapter {
  return {
    async openFile(path: string, line?: number, column?: number): Promise<void> {
      // nosemgrep: wildcard-postmessage-configuration -- VS Code webview iframe, origin is dynamic vscode-webview://
      window.parent.postMessage(
        {
          type: 'editor:openFile',
          path,
          line,
          column,
        },
        '*',
      );
    },

    async getActiveFile(): Promise<string | null> {
      return new Promise((resolve) => {
        const requestId = crypto.randomUUID();

        // Listen for response
        const handler = (event: MessageEvent) => {
          if (event.data?.type === 'editor:activeFileChanged') {
            window.removeEventListener('message', handler);
            resolve(event.data.path);
          }
        };

        // nosemgrep: insufficient-postmessage-origin-validation -- message type is validated; origin varies between SaaS and VS Code webview contexts
        window.addEventListener('message', handler);

        // Request active file
        // nosemgrep: wildcard-postmessage-configuration -- VS Code webview iframe, origin is dynamic vscode-webview://
        window.parent.postMessage(
          {
            type: 'editor:getActiveFile',
            requestId,
          },
          '*',
        );

        // Timeout
        setTimeout(() => {
          window.removeEventListener('message', handler);
          resolve(null);
        }, 1000);
      });
    },

    onActiveFileChange(callback: (path: string | null) => void): () => void {
      attachIframeMessageListener();

      const handler = (event: Event) => {
        const customEvent = event as CustomEvent<{
          type: string;
          path: string | null;
        }>;
        if (customEvent.detail?.type === 'editor:activeFileChanged') {
          callback(customEvent.detail.path);
        }
      };

      window.addEventListener(PLATFORM_EVENT, handler);

      return () => {
        window.removeEventListener(PLATFORM_EVENT, handler);
      };
    },

    async goToCode(path: string, line: number, column: number): Promise<void> {
      // nosemgrep: wildcard-postmessage-configuration -- VS Code webview iframe, origin is dynamic vscode-webview://
      window.parent.postMessage(
        {
          type: 'editor:goToCode',
          path,
          line,
          column,
        },
        '*',
      );
    },
  };
}

/**
 * SSE adapter for iframe inside VS Code webview.
 * Proxies SSE through extension (CORS workaround).
 */
function createVSCodeIframeSSEAdapter(): SSEAdapter {
  return {
    subscribe(
      url: string,
      callbacks: {
        onMessage: (event: string, data: unknown) => void;
        onError?: (error: string) => void;
        onConnected?: () => void;
      },
    ): () => void {
      const subscriptionId = crypto.randomUUID();

      attachIframeMessageListener();

      const handler = (event: Event) => {
        const customEvent = event as CustomEvent<{
          type: string;
          subscriptionId: string;
          event?: string;
          data?: unknown;
          error?: string;
        }>;
        const msg = customEvent.detail;

        if (msg?.subscriptionId !== subscriptionId) return;

        if (msg.type === 'sse:message') {
          callbacks.onMessage(msg.event || 'message', msg.data);
        } else if (msg.type === 'sse:error') {
          callbacks.onError?.(msg.error || 'SSE error');
        } else if (msg.type === 'sse:connected') {
          callbacks.onConnected?.();
        }
      };

      window.addEventListener(PLATFORM_EVENT, handler);

      // Request SSE subscription via parent
      // nosemgrep: wildcard-postmessage-configuration -- VS Code webview iframe, origin is dynamic vscode-webview://
      window.parent.postMessage(
        {
          type: 'sse:subscribe',
          url,
          subscriptionId,
        },
        '*',
      );

      return () => {
        window.removeEventListener(PLATFORM_EVENT, handler);
        // Unsubscribe
        // nosemgrep: wildcard-postmessage-configuration -- VS Code webview iframe, origin is dynamic vscode-webview://
        window.parent.postMessage(
          {
            type: 'sse:unsubscribe',
            subscriptionId,
          },
          '*',
        );
      };
    },
  };
}

/**
 * API adapter for iframe inside VS Code webview.
 * Proxies fetch through extension (CORS workaround).
 */
function createVSCodeIframeApiAdapter(): ApiAdapter {
  return {
    async fetch(url: string, options?: RequestInit): Promise<Response> {
      return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();

        attachIframeMessageListener();

        pendingIframeRequests.set(requestId, {
          resolve: (data) => {
            const msg = data as {
              ok: boolean;
              status: number;
              statusText: string;
              headers: Record<string, string>;
              body: unknown;
            };

            const response = new Response(JSON.stringify(msg.body), {
              status: msg.status,
              statusText: msg.statusText,
              headers: new Headers(msg.headers),
            });

            Object.defineProperty(response, 'ok', {
              get: () => msg.ok,
            });

            resolve(response);
          },
          reject,
        });

        // Send fetch request to parent
        // nosemgrep: wildcard-postmessage-configuration -- VS Code webview iframe, origin is dynamic vscode-webview://
        window.parent.postMessage(
          {
            type: 'api:fetch',
            requestId,
            url,
            options: options
              ? {
                  method: options.method,
                  headers: options.headers ? Object.fromEntries(new Headers(options.headers).entries()) : undefined,
                  body: typeof options.body === 'string' ? options.body : undefined,
                }
              : undefined,
          },
          '*',
        );

        // Timeout
        setTimeout(() => {
          if (pendingIframeRequests.has(requestId)) {
            pendingIframeRequests.delete(requestId);
            reject(new Error('API request timeout'));
          }
        }, 30000);
      });
    },
  };
}

// ============================================================================
// Combined Browser Adapters
// ============================================================================

export function createBrowserAdapters() {
  const isVSCodeIframe = isInVSCodeWebviewIframe();

  if (isVSCodeIframe) {
    console.log('[BrowserAdapter] Detected VS Code webview iframe mode');
    return {
      context: 'vscode-webview' as const,
      editor: createVSCodeIframeEditorAdapter(),
      canvas: createBrowserCanvasAdapter(), // Canvas works the same way
      theme: createBrowserThemeAdapter(), // Theme detection works the same
      sse: createVSCodeIframeSSEAdapter(),
      api: createVSCodeIframeApiAdapter(),
    };
  }

  return {
    context: 'browser' as const,
    editor: createBrowserEditorAdapter(),
    canvas: createBrowserCanvasAdapter(),
    theme: createBrowserThemeAdapter(),
    sse: createBrowserSSEAdapter(),
    api: createBrowserApiAdapter(),
  };
}
