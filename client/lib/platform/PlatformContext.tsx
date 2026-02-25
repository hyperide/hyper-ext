/**
 * React Context for platform abstraction layer
 *
 * Provides unified API for both browser and VS Code webview environments.
 * Automatically detects platform and creates appropriate adapters.
 */

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { authFetch } from '@/utils/authFetch';
import { createBrowserAdapters } from './BrowserAdapter';
import type {
  AstOperations,
  CanvasAdapter,
  MessageOfType,
  PlatformAdapters,
  PlatformContext as PlatformContextType,
  PlatformMessage,
} from './types';
import { createVSCodeAdapters } from './VSCodeAdapter';

// ============================================================================
// Platform detection
// ============================================================================

function detectPlatform(): PlatformContextType {
  // Check if VS Code API is available
  if (typeof window !== 'undefined' && 'acquireVsCodeApi' in window) {
    return 'vscode-webview';
  }
  return 'browser';
}

// ============================================================================
// Context
// ============================================================================

const PlatformReactContext = createContext<PlatformAdapters | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface PlatformProviderProps {
  children: ReactNode;
  /**
   * Force a specific platform context (mainly for testing)
   */
  forcePlatform?: PlatformContextType;
}

export function PlatformProvider({ children, forcePlatform }: PlatformProviderProps) {
  const adapters = useMemo(() => {
    const platform = forcePlatform ?? detectPlatform();

    if (platform === 'vscode-webview') {
      return createVSCodeAdapters();
    }

    return createBrowserAdapters();
  }, [forcePlatform]);

  return <PlatformReactContext.Provider value={adapters}>{children}</PlatformReactContext.Provider>;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get all platform adapters
 */
export function usePlatform(): PlatformAdapters {
  const context = useContext(PlatformReactContext);

  if (!context) {
    throw new Error('usePlatform must be used within a PlatformProvider');
  }

  return context;
}

/**
 * Get current platform context type
 */
export function usePlatformContext(): PlatformContextType {
  return usePlatform().context;
}

/**
 * Editor operations hook
 */
export function usePlatformEditor() {
  const { editor } = usePlatform();
  return editor;
}

/**
 * Subscribe to active file changes
 */
export function useActiveFileChange(callback: (path: string | null) => void): void {
  const editor = usePlatformEditor();

  useEffect(() => {
    return editor.onActiveFileChange(callback);
  }, [editor, callback]);
}

/**
 * Canvas/message bus hook
 */
export function usePlatformCanvas() {
  const { canvas } = usePlatform();
  return canvas;
}

/**
 * Subscribe to platform events of a specific type
 */
export function usePlatformEvent<K extends PlatformMessage['type']>(
  type: K,
  callback: (message: MessageOfType<K>) => void,
): void {
  const canvas = usePlatformCanvas();

  useEffect(() => {
    return canvas.onEvent(type, callback);
  }, [canvas, type, callback]);
}

/**
 * Theme hook
 */
export function usePlatformTheme() {
  const { theme } = usePlatform();
  return theme;
}

/**
 * SSE hook
 */
export function usePlatformSSE() {
  const { sse } = usePlatform();
  return sse;
}

/**
 * Subscribe to SSE stream with automatic cleanup
 */
export function useSSESubscription(
  url: string | null,
  callbacks: {
    onMessage: (event: string, data: unknown) => void;
    onError?: (error: string) => void;
    onConnected?: () => void;
  },
): void {
  const sse = usePlatformSSE();

  // Use ref to avoid infinite rerenders when callbacks object is created inline
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!url) return;

    return sse.subscribe(url, {
      onMessage: (event, data) => callbacksRef.current.onMessage(event, data),
      onError: (error) => callbacksRef.current.onError?.(error),
      onConnected: () => callbacksRef.current.onConnected?.(),
    });
  }, [url, sse]);
}

/**
 * API hook
 */
export function usePlatformApi() {
  const { api } = usePlatform();
  return api;
}

/**
 * Convenience hook for sending platform events
 */
export function useSendPlatformEvent() {
  const canvas = usePlatformCanvas();

  return useCallback(
    <T extends PlatformMessage>(message: T) => {
      canvas.sendEvent(message);
    },
    [canvas],
  );
}

// ============================================================================
// Specific event hooks for common use cases
// ============================================================================

/**
 * Open AI Chat programmatically
 */
export function useOpenAIChat() {
  const sendEvent = useSendPlatformEvent();

  return useCallback(
    (options?: { prompt?: string; forceNewChat?: boolean }) => {
      sendEvent({
        type: 'ai:openChat',
        prompt: options?.prompt,
        forceNewChat: options?.forceNewChat,
      });
    },
    [sendEvent],
  );
}

/**
 * Go to code location
 */
export function useGoToCode() {
  const editor = usePlatformEditor();

  return useCallback(
    (path: string, line: number, column: number = 0) => {
      return editor.goToCode(path, line, column);
    },
    [editor],
  );
}

/**
 * Open file in editor
 */
export function useOpenFile() {
  const editor = usePlatformEditor();

  return useCallback(
    (path: string, line?: number, column?: number) => {
      return editor.openFile(path, line, column);
    },
    [editor],
  );
}

// ============================================================================
// canvasRPC — request/response over canvas message bus
// ============================================================================

const CANVAS_RPC_TIMEOUT = 30_000;

/**
 * Send a request message and await a response matched by requestId.
 * Used in VS Code mode where operations go through extension host.
 */
export function canvasRPC<T = unknown>(
  canvas: CanvasAdapter,
  request: PlatformMessage & { requestId: string },
  responseType: 'ast:response' | 'component:response',
): Promise<{ success: boolean; data?: T; error?: string }> {
  return new Promise((resolve, reject) => {
    const { requestId } = request;

    const unsubscribe = canvas.onEvent(responseType, (message) => {
      const msg = message as { requestId: string; success: boolean; data?: T; error?: string };
      if (msg.requestId === requestId) {
        unsubscribe();
        clearTimeout(timer);
        resolve(msg);
      }
    });

    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`canvasRPC timeout for ${request.type}`));
    }, CANVAS_RPC_TIMEOUT);

    canvas.sendEvent(request);
  });
}

// ============================================================================
// AST Operations hook
// ============================================================================

/**
 * High-level hook for AST operations.
 * Browser mode: authFetch → server routes.
 * VS Code mode: canvasRPC → extension host AstService.
 */
export function usePlatformAst(): AstOperations {
  const { canvas, context } = usePlatform();

  return useMemo((): AstOperations => {
    if (context === 'vscode-webview') {
      return createVSCodeAstOperations(canvas);
    }
    return createBrowserAstOperations();
  }, [canvas, context]);
}

/** Browser: delegates to authFetch → server HTTP endpoints */
function createBrowserAstOperations(): AstOperations {
  return {
    async updateStyles(params) {
      const response = await authFetch('/api/update-component-styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedId: params.elementId,
          filePath: params.filePath,
          styles: params.styles,
          domClasses: params.domClasses,
          instanceProps: params.instanceProps,
          instanceId: params.instanceId,
          state: params.state,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || response.statusText);
      }
    },

    async insertElement(params) {
      const response = await authFetch('/api/insert-element', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || response.statusText);
      }
      return result;
    },

    async deleteElements(params) {
      const response = await authFetch('/api/delete-elements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || response.statusText);
      }
    },

    async duplicateElement(params) {
      const response = await authFetch('/api/duplicate-element', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || response.statusText);
      }
      return result;
    },

    async updateProps(params) {
      const response = await authFetch('/api/update-component-props-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedId: params.elementId,
          filePath: params.filePath,
          props: params.props,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || response.statusText);
      }
    },

    async renameElement(params) {
      const response = await authFetch('/api/rename-component', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedId: params.elementId,
          filePath: params.filePath,
          newType: params.newType,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || response.statusText);
      }
    },

    async updateText(params) {
      const response = await authFetch('/api/update-element-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedId: params.elementId,
          filePath: params.filePath,
          text: params.text,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || response.statusText);
      }
    },
  };
}

/** VS Code: delegates to canvasRPC → extension host AstService */
function createVSCodeAstOperations(canvas: CanvasAdapter): AstOperations {
  return {
    async updateStyles(params) {
      const result = await canvasRPC(
        canvas,
        {
          type: 'ast:updateStyles',
          requestId: crypto.randomUUID(),
          filePath: params.filePath,
          elementId: params.elementId,
          styles: params.styles,
          domClasses: params.domClasses,
          instanceProps: params.instanceProps,
          instanceId: params.instanceId,
          state: params.state,
        },
        'ast:response',
      );
      if (!result.success) {
        throw new Error(result.error || 'Failed to update styles');
      }
    },

    async insertElement(params) {
      const result = await canvasRPC(
        canvas,
        {
          type: 'ast:insertElement',
          requestId: crypto.randomUUID(),
          filePath: params.filePath,
          parentId: params.parentId,
          componentType: params.componentType,
          props: params.props,
          index: params.index,
          targetId: params.targetId,
        },
        'ast:response',
      );
      if (!result.success) {
        throw new Error(result.error || 'Failed to insert element');
      }
      return result;
    },

    async deleteElements(params) {
      const result = await canvasRPC(
        canvas,
        {
          type: 'ast:deleteElements',
          requestId: crypto.randomUUID(),
          filePath: params.filePath,
          elementIds: params.elementIds,
        },
        'ast:response',
      );
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete elements');
      }
    },

    async duplicateElement(params) {
      const result = await canvasRPC(
        canvas,
        {
          type: 'ast:duplicateElement',
          requestId: crypto.randomUUID(),
          filePath: params.filePath,
          elementId: params.elementId,
        },
        'ast:response',
      );
      if (!result.success) {
        throw new Error(result.error || 'Failed to duplicate element');
      }
      return result;
    },

    async updateProps(params) {
      const result = await canvasRPC(
        canvas,
        {
          type: 'ast:updateProps',
          requestId: crypto.randomUUID(),
          filePath: params.filePath,
          elementId: params.elementId,
          props: params.props,
        },
        'ast:response',
      );
      if (!result.success) {
        throw new Error(result.error || 'Failed to update props');
      }
    },

    async renameElement(params) {
      const result = await canvasRPC(
        canvas,
        {
          type: 'ast:renameElement',
          requestId: crypto.randomUUID(),
          filePath: params.filePath,
          elementId: params.elementId,
          newType: params.newType,
        },
        'ast:response',
      );
      if (!result.success) {
        throw new Error(result.error || 'Failed to rename element');
      }
    },

    async updateText(params) {
      const result = await canvasRPC(
        canvas,
        {
          type: 'ast:updateText',
          requestId: crypto.randomUUID(),
          filePath: params.filePath,
          elementId: params.elementId,
          text: params.text,
        },
        'ast:response',
      );
      if (!result.success) {
        throw new Error(result.error || 'Failed to update text');
      }
    },
  };
}
