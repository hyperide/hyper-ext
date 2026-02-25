/**
 * Types for HyperCanvas VS Code Extension
 * Defines messages, project types, and shared interfaces
 */

// ============================================
// Project Detection
// ============================================

export type ProjectType = 'vite' | 'nextjs' | 'cra' | 'remix' | 'unknown';

export interface ProjectInfo {
  type: ProjectType;
  devCommand: string;
  defaultPort: number;
  hasTypeScript: boolean;
}

// ============================================
// Dev Server
// ============================================

export type DevServerStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface DevServerState {
  status: DevServerStatus;
  port?: number;
  url?: string;
  error?: string;
}

// ============================================
// Platform Messages (webview <-> extension)
// ============================================

// Editor operations (already exist in EditorBridge.ts)
export type EditorMessage =
  | { type: 'editor:openFile'; path: string; line?: number; column?: number }
  | { type: 'editor:goToCode'; path: string; line: number; column: number }
  | { type: 'editor:getActiveFile'; requestId: string };

// AST operations (local)
export type AstMessage =
  | {
      type: 'ast:updateStyles';
      requestId: string;
      filePath: string;
      elementId: string;
      styles: Record<string, string>;
      state?: string; // hover, focus, etc.
    }
  | {
      type: 'ast:updateProps';
      requestId: string;
      filePath: string;
      elementId: string;
      props: Record<string, unknown>;
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
      type: 'ast:updateText';
      requestId: string;
      filePath: string;
      elementId: string;
      text: string;
    }
  | {
      type: 'ast:wrapElement';
      requestId: string;
      filePath: string;
      elementId: string;
      wrapperType: string;
      wrapperProps?: Record<string, unknown>;
    };

// AST response
export interface AstResponse {
  type: 'ast:response';
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// Component operations (local)
export type ComponentMessage =
  | { type: 'component:list'; requestId: string }
  | { type: 'component:listGroups'; requestId: string }
  | { type: 'component:tests'; requestId: string; componentPath: string }
  | { type: 'component:parse'; requestId: string; componentPath: string }
  | { type: 'component:getDefinitions'; requestId: string; componentPath: string };

export interface ComponentResponse {
  type: 'component:response';
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// File operations (local)
export type FileMessage =
  | { type: 'file:read'; requestId: string; filePath: string }
  | { type: 'file:write'; requestId: string; filePath: string; content: string }
  | { type: 'file:getTree'; requestId: string; directory?: string };

export interface FileResponse {
  type: 'file:response';
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// Dev server operations
export type DevServerMessage =
  | { type: 'devServer:start'; requestId: string }
  | { type: 'devServer:stop'; requestId: string }
  | { type: 'devServer:status'; requestId: string };

export interface DevServerResponse {
  type: 'devServer:response';
  requestId: string;
  success: boolean;
  status?: DevServerStatus;
  port?: number;
  url?: string;
  error?: string;
}

// AI operations (local with user's API key)
export type AIMessage =
  | {
      type: 'ai:chat';
      requestId: string;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      chatId?: string;
    }
  | { type: 'ai:abort'; requestId: string }
  | { type: 'ai:listChats'; requestId: string }
  | { type: 'ai:getChat'; requestId: string; chatId: string }
  | { type: 'ai:deleteChat'; requestId: string; chatId: string };

export interface AIResponse {
  type: 'ai:response';
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface AIDelta {
  type: 'ai:delta';
  requestId: string;
  text: string;
}

export interface AIToolUse {
  type: 'ai:toolUse';
  requestId: string;
  toolName: string;
  input: unknown;
}

export interface AIToolResult {
  type: 'ai:toolResult';
  requestId: string;
  toolName: string;
  result: unknown;
}

// Canvas Composition (local storage)
export type CompositionMessage =
  | { type: 'composition:get'; requestId: string; componentPath: string }
  | {
      type: 'composition:save';
      requestId: string;
      componentPath: string;
      data: CanvasComposition;
    }
  | { type: 'composition:list'; requestId: string };

export interface CompositionResponse {
  type: 'composition:response';
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// Dev server logs (Logs & AI panel webview <-> extension)
export type DevServerLogsMessage =
  | { type: 'devserver:requestLogs' }
  | { type: 'devserver:clearLogs' }
  | { type: 'runtime:error'; error: DevServerRuntimeError | null };

// Runtime error detected from iframe preview (via PreviewProxy script injection)
export interface DevServerRuntimeError {
  framework: 'nextjs' | 'vite' | 'bun' | 'unknown';
  type: string;
  message: string;
  file?: string;
  line?: number;
  codeframe?: string;
  fullText: string;
}

// Runtime error pushed from extension to Logs & AI panel webview
export interface DevServerRuntimeErrorEvent {
  type: 'devserver:runtimeError';
  error: DevServerRuntimeError | null;
}

export interface DevServerLogsResponse {
  type: 'devserver:logs';
  logs: Array<{ line: string; timestamp: number; isError: boolean }>;
  hasErrors: boolean;
}

export interface DevServerLogAppend {
  type: 'devserver:logAppend';
  entries: Array<{ line: string; timestamp: number; isError: boolean }>;
  hasErrors: boolean;
}

// AI chat (Logs & AI panel webview -> extension)
export type AIChatMessage =
  | {
      type: 'ai:chat';
      requestId: string;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    }
  | { type: 'ai:abort'; requestId: string };

// AI stream events (extension -> Logs & AI panel webview)
export interface AIChatDelta {
  type: 'ai:delta';
  requestId: string;
  text: string;
}

export interface AIChatToolUse {
  type: 'ai:toolUse';
  requestId: string;
  toolUseId: string;
  toolName: string;
  input: unknown;
}

export interface AIChatToolResult {
  type: 'ai:toolResult';
  requestId: string;
  toolUseId: string;
  result: { success: boolean; output?: string; error?: string };
}

export interface AIChatDone {
  type: 'ai:done';
  requestId: string;
}

export interface AIChatError {
  type: 'ai:error';
  requestId: string;
  error: string;
}

// Style reading operations (right panel inspector)
export type StylesMessage = {
  type: 'styles:readClassName';
  requestId: string;
  elementId: string;
  componentPath: string;
};

export interface StylesResponse {
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

// Combined platform message type
export type PlatformMessage =
  | EditorMessage
  | AstMessage
  | ComponentMessage
  | FileMessage
  | DevServerMessage
  | AIMessage
  | CompositionMessage
  | DevServerLogsMessage
  | AIChatMessage
  | StylesMessage;

// ============================================
// Canvas Composition Storage
// ============================================

export interface CanvasInstance {
  id: string;
  name: string;
  props: Record<string, unknown>;
}

export interface CanvasComposition {
  componentPath: string;
  instances: CanvasInstance[];
  updatedAt: string;
}

// ============================================
// AI Chat Storage
// ============================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolCalls?: Array<{
    name: string;
    input: unknown;
    result: unknown;
  }>;
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ============================================
// AST Types (re-exported from lib/types.ts)
// ============================================

export type {
  ParsedFile,
  JSXElementWithPath,
  FindElementResult,
  ParseOptions,
  PrintOptions,
  SharedEditorState,
} from '@lib/types';
