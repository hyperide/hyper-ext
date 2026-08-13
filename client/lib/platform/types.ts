/**
 * Platform abstraction layer for HyperCanvas
 *
 * Enables the same React code to work in:
 * 1. SaaS (browser) - with code-server iframe
 * 2. VS Code Extension - with native VS Code editor via webview
 */

import type { StyleReadResult } from '../../../lib/style-read/types';
import type { SharedEditorState } from '../../../lib/types';
import type { ConsoleLevel, DiagnosticLogEntry, DiagnosticState } from '../../../shared/diagnostic-types';
import type { I18nBindingResult, I18nLibrary } from '../../../shared/i18n-text/types';
import type { RuntimeError } from '../../../shared/runtime-error';

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

  // Inspector → extension host: "Go to main component" (HYP-563). Resolves the
  // selected element's component reference to its master definition and opens it.
  // Handled by PanelRouter (shared across inspector + preview panel webviews).
  | {
      type: 'master:goToComponent';
      elementId: string;
      nodeRef?: string;
      componentPath: string;
      componentName?: string;
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
      selectedSourceTabId?: string;
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
      componentFilePath?: string;
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
      /**
       * Move a JSX element from any place to any place. Source and target need
       * NOT share a JSX parent — same-file, cross-file, cross-component, and
       * leaf-target moves are all supported by the extension's
       * `AstService.moveElement`. SaaS has no handler yet (Task 7 wires the
       * extension only); type lives here for `CanvasAdapter.sendEvent` typing.
       */
      type: 'ast:moveElement';
      requestId: string;
      filePath: string;
      sourceId: string;
      targetId: string;
      position: 'before' | 'after';
    }
  | {
      type: 'ast:writeI18nResource';
      requestId: string;
      library: I18nLibrary;
      key: string;
      namespace?: string;
      activeLocale: string;
      newText: string;
      previousKey?: string;
      filePath?: string;
      elementId?: string;
      skipResourceWrite?: boolean;
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
      domTextContent?: string;
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
      styleReadResult?: StyleReadResult;
      i18nText?: I18nBindingResult;
      error?: string;
    }
  | {
      type: 'styles:fetchI18nKeys';
      requestId: string;
      library?: I18nLibrary;
      namespace?: string;
      activeLocale: string;
    }
  | {
      type: 'styles:i18nKeysResponse';
      requestId: string;
      success: boolean;
      keys: string[];
      error?: string;
    }

  // Component operations (visual editor ↔ extension host)
  | { type: 'component:open'; name: string; path: string }
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
  // Typed props schema for a component (HYP-709 — PropsEditor parity in the ext).
  // Browser uses authFetch('/api/component-props-types'); the ext host extracts via the TS
  // Compiler API directly off disk and answers on `component:response`.
  | {
      type: 'component:propsTypes';
      requestId: string;
      filePath: string;
      componentName?: string;
    }
  // Tamagui design tokens for the active project (HYP-709). Browser uses
  // authFetch('/api/tamagui/tokens'); the ext host runs the shared static extraction core
  // (lib/tamagui/extract-tokens) and answers on `component:response`.
  | {
      type: 'tamagui:getTokens';
      requestId: string;
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

  // Keyboard operations (visual editor → extension host)
  | { type: 'keyboard:delete'; elementIds: string[] }
  | { type: 'keyboard:duplicate'; elementId: string }
  | { type: 'canvas:undo' }
  | { type: 'canvas:redo' }

  // Preview lifecycle (preview webview → extension host)
  | { type: 'previewLoaded' }
  | { type: 'previewError'; error: string }
  | { type: 'preview:setScope'; scope: 'full-app' | 'component-only' }

  // Diagnostics (cross-webview sync in ext, local in SaaS)
  | { type: 'diagnostic:log'; entries: DiagnosticLogEntry[] }
  | { type: 'diagnostic:runtimeError'; error: RuntimeError | null }
  | { type: 'diagnostic:buildStatus'; status: DiagnosticState['buildStatus'] }
  | { type: 'diagnostic:clear' }
  | { type: 'diagnostic:state'; state: DiagnosticState }
  | { type: 'diagnostic:requestState' }
  | { type: 'diagnostic:console'; level: ConsoleLevel; args: string[] }
  // Webview lifecycle (VS Code: webview signals it's ready to receive state)
  | { type: 'webview:ready' }

  // VS Code commands triggered from preview webview
  | { type: 'command:fixUnsupportedProject' }
  | { type: 'command:execute'; command: string; args?: string[] }

  // Scroll iframe to element (tree click → canvas scroll, no selection change)
  | { type: 'iframe:scrollToElement'; elementId: string }

  // Selection-freeze coordination during i18n writes
  // Sidebar dispatches `start` before the JSX rewrite and `done` in `finally`
  // so the preview iframe can retain the last-known selection rect during the
  // HMR window — see docs/plans/2026-05-06-selection-survives-i18n-write.md.
  | { type: 'iframe:writeI18nResource'; phase: 'start' | 'done' }

  // Right panel input focus guard (sidebar webview → extension host)
  // Used to set `hypercanvas.rightPanelInputFocused` context variable so
  // canvas keybindings don't fire while the user types in inspector fields.
  | { type: 'panel:inputFocus'; active: boolean }

  // Component-error overlay actions (preview webview → extension host).
  // Emitted by the shared ComponentErrorOverlay when the user creates a sample
  // from filled props, asks to configure an AI key, asks to scaffold the
  // isolation wrapper for a provider-context error (HYP-880), or when the
  // overlay needs the component's prop schema to render typed fields (HYP-648).
  | {
      type: 'errorBoundary:createSample';
      componentPath: string;
      sampleName: string;
      propValues?: Record<string, unknown>;
    }
  | { type: 'errorBoundary:configureAIKey' }
  | { type: 'errorBoundary:generatePreviewWrapper' }
  | { type: 'errorBoundary:getPropsSchema'; componentPath: string };

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
    selectedSourceTabId?: string;
  }): Promise<void>;

  /** Insert a new JSX element */
  insertElement(params: {
    filePath: string;
    parentId: string | null;
    componentType: string;
    props: Record<string, unknown>;
    index?: number;
    targetId?: string;
    componentFilePath?: string;
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

  /**
   * Write a translated value for an i18n key in the active locale JSON file.
   * When `previousKey` triggers a JSX rewrite, the implementation may return
   * `newElementId` — the canonical `${fileName}:${line}:${column}` ID of the
   * rewritten JSX element after the write. Callers (e.g. handleI18nKeyChange)
   * use it to re-broadcast selection in a single dispatch without timeout-spam
   * kostyls. Browser/SaaS path doesn't rewrite JSX → returns undefined.
   */
  writeI18nResource(params: {
    library: I18nLibrary;
    key: string;
    namespace?: string;
    activeLocale: string;
    newText: string;
    /** Previous key when the user switches to a different key from the combobox. */
    previousKey?: string;
    /** Source file of the element — required when previousKey is provided for JSX update. */
    filePath?: string;
    /** Element nodeRef — required when previousKey is provided for JSX update. */
    elementId?: string;
    /** Skip writing to the locale dictionary; only update the JSX expression. */
    skipResourceWrite?: boolean;
    /**
     * Create the key if it does not yet exist (HYP-746 new-key create). When set, an existing-key
     * retarget whose newKey is absent from the dictionary writes the locale entry first (default
     * locale, locale-JSON-first) THEN rewrites the JSX. Ignored by the VS Code RPC path.
     */
    createIfMissing?: boolean;
    /**
     * The t(...) call's source location (Babel: 1-based line, 0-based column). Browser-mode
     * existing-key retarget needs it to drive the server's deterministic locate (HYP-372). The
     * VS Code RPC path IGNORES it — the extension host locates by elementId itself — so passing
     * it keeps the canvas wire message byte-identical.
     */
    bindingLoc?: { line: number; column: number };
  }): Promise<{ newElementId?: string }>;
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
