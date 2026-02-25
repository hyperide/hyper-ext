/**
 * Platform abstraction layer for HyperCanvas
 *
 * Enables the same React code to work in:
 * 1. SaaS (browser) - with code-server iframe
 * 2. VS Code Extension - with native VS Code editor via webview
 */

import type { SharedEditorState } from '../../../lib/types';

// ============================================================================
// Message Types (Discriminated Union)
// ============================================================================

export type PlatformMessage =
  // Editor operations
  | { type: 'editor:openFile'; path: string; line?: number; column?: number }
  | { type: 'editor:activeFileChanged'; path: string | null }
  | { type: 'editor:goToCode'; path: string; line: number; column: number }
  | { type: 'editor:getActiveFile'; requestId: string }
  | {
      type: 'editor:goToVisual';
      filePath: string;
      line: number;
      column: number;
    }

  // Canvas events
  | { type: 'canvas:componentLoaded'; data: unknown }
  | { type: 'canvas:selectionChanged'; elementIds: string[] }
  | { type: 'canvas:refresh' }

  // Theme
  | { type: 'theme:changed'; theme: 'light' | 'dark' | 'system' }
  | { type: 'theme:get'; requestId: string }
  | { type: 'theme:response'; requestId: string; theme: 'light' | 'dark' }

  // AI Chat
  | { type: 'ai:openChat'; prompt?: string; forceNewChat?: boolean }

  // SSE (for VS Code proxy)
  | { type: 'sse:subscribe'; url: string; subscriptionId: string }
  | { type: 'sse:unsubscribe'; subscriptionId: string }
  | {
      type: 'sse:message';
      subscriptionId: string;
      event: string;
      data: unknown;
    }
  | { type: 'sse:error'; subscriptionId: string; error: string }
  | { type: 'sse:connected'; subscriptionId: string }

  // API Proxy (for VS Code CORS workaround)
  | {
      type: 'api:fetch';
      requestId: string;
      url: string;
      options?: RequestInit;
    }
  | {
      type: 'api:response';
      requestId: string;
      ok: boolean;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: unknown;
    }
  | { type: 'api:error'; requestId: string; error: string }

  // AST operations (visual editor ↔ extension host)
  | {
      type: 'ast:updateStyles';
      requestId: string;
      filePath: string;
      elementId: string;
      styles: Record<string, string>;
      domClasses?: string;
      instanceProps?: Record<string, unknown>;
      instanceId?: string;
      state?: string;
    }
  | {
      type: 'ast:insertElement';
      requestId: string;
      filePath: string;
      parentId: string | null;
      componentType: string;
      props: Record<string, unknown>;
      index?: number;
      targetId?: string;
    }
  | {
      type: 'ast:deleteElements';
      requestId: string;
      filePath: string;
      elementIds: string[];
    }
  | {
      type: 'ast:duplicateElement';
      requestId: string;
      filePath: string;
      elementId: string;
    }
  | {
      type: 'ast:updateProps';
      requestId: string;
      filePath: string;
      elementId: string;
      props: Record<string, unknown>;
    }
  | {
      type: 'ast:renameElement';
      requestId: string;
      filePath: string;
      elementId: string;
      newType: string;
    }
  | {
      type: 'ast:wrapElement';
      requestId: string;
      filePath: string;
      elementId: string;
      wrapperType: string;
      wrapperProps?: Record<string, unknown>;
    }
  | {
      type: 'ast:updateText';
      requestId: string;
      filePath: string;
      elementId: string;
      text: string;
    }
  | {
      type: 'ast:response';
      requestId: string;
      success: boolean;
      data?: unknown;
      error?: string;
    }

  // Style reading (right panel ↔ extension host)
  | {
      type: 'styles:readClassName';
      requestId: string;
      elementId: string;
      componentPath: string;
    }
  | {
      type: 'styles:response';
      requestId: string;
      success: boolean;
      className?: string;
      childrenType?: 'text' | 'expression' | 'expression-complex' | 'jsx';
      textContent?: string;
      tagType?: string;
      childrenLocation?: { line: number; column: number };
      error?: string;
    }

  // Component operations (visual editor ↔ extension host)
  | { type: 'component:list'; requestId: string }
  | { type: 'component:listGroups'; requestId: string }
  | { type: 'component:tests'; requestId: string; componentPath: string }
  | {
      type: 'component:parse';
      requestId: string;
      componentPath: string;
    }
  | {
      type: 'component:parseStructure';
      requestId: string;
      componentPath: string;
    }
  | {
      type: 'component:response';
      requestId: string;
      success: boolean;
      data?: unknown;
      error?: string;
    }

  // State sync (cross-panel coordination in VS Code)
  | { type: 'state:update'; patch: Partial<SharedEditorState> }
  | { type: 'state:init'; state: SharedEditorState }

  // Webview lifecycle (VS Code: webview signals it's ready to receive state)
  | { type: 'webview:ready' };

// Helper type to extract message by type
export type MessageOfType<T extends PlatformMessage['type']> = Extract<PlatformMessage, { type: T }>;

// ============================================================================
// Adapter Interfaces
// ============================================================================

/**
 * Editor operations - opening files, navigation, active file tracking
 */
export interface EditorAdapter {
  /** Open a file in the editor, optionally at specific line/column */
  openFile(path: string, line?: number, column?: number): Promise<void>;

  /** Get currently active file path */
  getActiveFile(): Promise<string | null>;

  /** Subscribe to active file changes. Returns unsubscribe function */
  onActiveFileChange(callback: (path: string | null) => void): () => void;

  /** Navigate to specific code location (for "Go to Code" feature) */
  goToCode(path: string, line: number, column: number): Promise<void>;
}

/**
 * Canvas/message bus operations - sending and receiving platform messages
 */
export interface CanvasAdapter {
  /** Send a message through the platform bus */
  sendEvent<T extends PlatformMessage>(message: T): void;

  /** Subscribe to messages of specific type. Returns unsubscribe function */
  onEvent<K extends PlatformMessage['type']>(type: K, callback: (message: MessageOfType<K>) => void): () => void;
}

/**
 * Theme operations
 */
export interface ThemeAdapter {
  /** Get current theme */
  getTheme(): 'light' | 'dark';

  /** Subscribe to theme changes. Returns unsubscribe function */
  onThemeChange(callback: (theme: 'light' | 'dark') => void): () => void;
}

/**
 * SSE (Server-Sent Events) adapter
 * In browser: uses native EventSource
 * In VS Code webview: proxies through extension host (CORS workaround)
 */
export interface SSEAdapter {
  /** Subscribe to SSE stream. Returns unsubscribe function */
  subscribe(
    url: string,
    callbacks: {
      onMessage: (event: string, data: unknown) => void;
      onError?: (error: string) => void;
      onConnected?: () => void;
    },
  ): () => void;
}

/**
 * API adapter for HTTP requests
 * In browser: uses native fetch
 * In VS Code webview: proxies through extension host (CORS workaround)
 */
export interface ApiAdapter {
  /** Make an HTTP request */
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

// ============================================================================
// Platform Context Type
// ============================================================================

export type PlatformContext = 'browser' | 'vscode-webview';

// ============================================================================
// AST Operations Interface
// ============================================================================

/**
 * High-level interface for AST operations.
 * In browser: delegates to authFetch → server routes.
 * In VS Code: delegates to canvasRPC → extension host AstService.
 */
export interface AstOperations {
  /** Update Tailwind/style classes on an element */
  updateStyles(params: {
    elementId: string;
    filePath: string;
    styles: Record<string, string>;
    domClasses?: string;
    instanceProps?: Record<string, unknown>;
    instanceId?: string;
    state?: string;
  }): Promise<void>;

  /** Insert a new JSX element */
  insertElement(params: {
    filePath: string;
    parentId: string | null;
    componentType: string;
    props: Record<string, unknown>;
    index?: number;
    targetId?: string;
  }): Promise<{ success: boolean; data?: unknown; error?: string }>;

  /** Delete JSX elements by ID */
  deleteElements(params: { filePath: string; elementIds: string[] }): Promise<void>;

  /** Duplicate a JSX element */
  duplicateElement(params: {
    filePath: string;
    elementId: string;
  }): Promise<{ success: boolean; data?: unknown; error?: string }>;

  /** Update component props (for Tamagui/RN-style adapters) */
  updateProps(params: { elementId: string; filePath: string; props: Record<string, unknown> }): Promise<void>;

  /** Rename/change element type (e.g. Stack → YStack) */
  renameElement(params: { elementId: string; filePath: string; newType: string }): Promise<void>;

  /** Update text/expression children of a JSX element */
  updateText(params: { elementId: string; filePath: string; text: string }): Promise<void>;
}

// ============================================================================
// Platform Context Type
// ============================================================================

export interface PlatformAdapters {
  context: PlatformContext;
  editor: EditorAdapter;
  canvas: CanvasAdapter;
  theme: ThemeAdapter;
  sse: SSEAdapter;
  api: ApiAdapter;
}
