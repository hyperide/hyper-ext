/**
 * AI Agent types for code assistance
 * Based on Anthropic SDK tool calling patterns
 */

/**
 * Available tools for the AI agent
 */
export type ToolName =
  | 'read_file'
  | 'edit_file'
  | 'grep_search'
  | 'glob_search'
  | 'bash_exec'
  | 'git_command'
  // Extended tools
  | 'list_directory'
  | 'tree'
  | 'write_file'
  | 'move_file'
  | 'delete_file'
  // Interactive tools
  | 'ask_user'
  // Browser tools (Playwright MCP)
  | 'browser_navigate'
  | 'browser_take_screenshot'
  | 'browser_click'
  | 'browser_type'
  | 'browser_snapshot'
  | 'browser_hover'
  // Canvas tools (UX flow)
  | 'canvas_create_instance'
  | 'canvas_update_instance'
  | 'canvas_delete_instance'
  | 'canvas_list_instances'
  | 'canvas_connect_instances'
  | 'canvas_add_annotation'
  | 'canvas_modify_map_items'
  | 'canvas_modify_cond_item'
  | 'canvas_auto_generate_variants'
  | 'analyze_component_props'
  | 'suggest_flow_states'
  // Test generation tools
  | 'generate_tests'
  | 'analyze_component_tests'
  | 'run_tests'
  // Server management tools
  | 'restart_dev_server'
  | 'get_diagnostics'
  // Web tools
  | 'brave_web_search'
  | 'url_fetch'
  // Package management
  | 'add_dependency';

/**
 * Tool input schemas.
 *
 * These are the per-tool input contracts wired into the executor via
 * `ToolInputMap` below. They are the public contract surface for tool calls
 * (consumed by the agent worker/container over HTTP and by the executor);
 * `@public` marks them as intentional API so knip doesn't flag them — knip
 * can't see the cross-boundary (HTTP/runtime) consumers.
 */

/** @public */
export interface ReadFileInput {
  path: string;
  startLine?: number;
  endLine?: number;
}

/** @public */
export interface EditFileInput {
  path: string;
  oldContent: string;
  newContent: string;
  replaceAll?: boolean;
}

/** @public */
export interface GrepSearchInput {
  pattern: string;
  path?: string;
  filePattern?: string;
  caseSensitive?: boolean;
}

/** @public */
export interface GlobSearchInput {
  pattern: string;
  path?: string;
}

/** @public */
export interface BashExecInput {
  command: string;
  timeout?: number;
}

/** @public */
export interface GitCommandInput {
  command: 'status' | 'diff' | 'log' | 'show' | 'blame';
  args?: string[];
}

/** @public */
export interface AskUserInput {
  question: string;
  options?: string[]; // Optional predefined choices
}

/** @public */
export interface RunTestsInput {
  testPaths: string[]; // Paths to test files to run
  installDeps?: boolean; // Auto-install missing packages
}

/** @public */
export interface BraveWebSearchInput {
  query: string;
  count?: number; // Number of results (1-20, default: 10)
}

/** @public */
export interface UrlFetchInput {
  url: string;
  selector?: string; // Optional CSS selector to extract specific content
}

// ── Canvas tool inputs (mirror schemas in shared/ai-agent-tools.ts) ──

/** @public */
export interface CanvasCreateInstanceInput {
  componentPath: string;
  instanceId: string;
  x: number;
  y: number;
  props: Record<string, unknown>;
  label?: string;
  width?: number;
  height?: number;
}

/**
 * Updatable fields of an instance (mirrors CANVAS_UPDATE_INSTANCE.updates schema).
 * @public — part of the `canvas_update_instance` contract surface.
 */
export interface CanvasInstanceUpdates {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  props?: Record<string, unknown>;
  label?: string;
}

/** @public */
export interface CanvasUpdateInstanceInput {
  componentPath: string;
  instanceId: string;
  updates: CanvasInstanceUpdates;
}

/** @public */
export interface CanvasDeleteInstanceInput {
  componentPath: string;
  instanceId: string;
}

/** @public */
export interface CanvasListInstancesInput {
  componentPath: string;
}

/** @public */
export interface CanvasConnectInstancesInput {
  componentPath: string;
  fromInstanceId: string;
  toInstanceId: string;
  label?: string;
}

/** @public */
export interface CanvasAddAnnotationInput {
  componentPath: string;
  x: number;
  y: number;
  text: string;
}

/** @public */
export interface CanvasModifyMapItemsInput {
  componentPath: string;
  instanceId: string;
  arrayPropName: string;
  targetCount: number;
}

/** @public */
export interface CanvasModifyCondItemInput {
  componentPath: string;
  instanceId: string;
  booleanPropName: string;
  value: boolean;
}

/** @public */
export interface CanvasAutoGenerateVariantsInput {
  componentPath: string;
  strategy?: 'minimal' | 'comprehensive';
  layout?: 'grid' | 'horizontal' | 'vertical';
  spacing?: number;
}

/** @public */
export interface AnalyzeComponentPropsInput {
  componentPath: string;
}

/** @public */
export interface SuggestFlowStatesInput {
  componentPath: string;
  context?: string;
}

// ── Browser tool inputs (mirror Playwright MCP schemas) ──

/** @public */
export interface BrowserNavigateInput {
  url: string;
}

/** @public */
export interface BrowserTakeScreenshotInput {
  filename?: string;
  element?: string;
  ref?: string;
  fullPage?: boolean;
}

/** @public */
export interface BrowserClickInput {
  element: string;
  ref: string;
}

/** @public */
export interface BrowserTypeInput {
  element: string;
  ref: string;
  text: string;
}

/** @public */
export type BrowserSnapshotInput = Record<string, never>;

/** @public */
export interface BrowserHoverInput {
  element: string;
  ref: string;
}

// ── Test tool inputs (mirror schemas in shared/ai-agent-tools.ts) ──

/** @public */
export interface GenerateTestsInput {
  componentPath: string;
  types?: Array<'unit' | 'e2e' | 'variants' | 'demo'>;
  force?: boolean;
}

/** @public */
export interface AnalyzeComponentTestsInput {
  componentPath: string;
}

/**
 * Maps every tool that has a typed input contract to its `*Input` shape.
 *
 * This is the single source of truth wiring the contract interfaces above to
 * the executor in `server/services/ai-agent.ts`. Each `*Input` shape mirrors
 * the authoritative tool JSON schema in `shared/ai-agent-tools.ts` (required vs
 * optional, field types). Tools without an entry (`restart_dev_server`,
 * `get_diagnostics`, `add_dependency`, etc.) narrow fields ad hoc in their
 * handlers.
 *
 * Keyed by `ToolName` so a typo in a tool key fails to compile.
 */
export interface ToolInputMap {
  read_file: ReadFileInput;
  edit_file: EditFileInput;
  grep_search: GrepSearchInput;
  glob_search: GlobSearchInput;
  bash_exec: BashExecInput;
  git_command: GitCommandInput;
  ask_user: AskUserInput;
  run_tests: RunTestsInput;
  brave_web_search: BraveWebSearchInput;
  url_fetch: UrlFetchInput;
  // Canvas tools
  canvas_create_instance: CanvasCreateInstanceInput;
  canvas_update_instance: CanvasUpdateInstanceInput;
  canvas_delete_instance: CanvasDeleteInstanceInput;
  canvas_list_instances: CanvasListInstancesInput;
  canvas_connect_instances: CanvasConnectInstancesInput;
  canvas_add_annotation: CanvasAddAnnotationInput;
  canvas_modify_map_items: CanvasModifyMapItemsInput;
  canvas_modify_cond_item: CanvasModifyCondItemInput;
  canvas_auto_generate_variants: CanvasAutoGenerateVariantsInput;
  analyze_component_props: AnalyzeComponentPropsInput;
  suggest_flow_states: SuggestFlowStatesInput;
  // Browser tools
  browser_navigate: BrowserNavigateInput;
  browser_take_screenshot: BrowserTakeScreenshotInput;
  browser_click: BrowserClickInput;
  browser_type: BrowserTypeInput;
  browser_snapshot: BrowserSnapshotInput;
  browser_hover: BrowserHoverInput;
  // Test tools
  generate_tests: GenerateTestsInput;
  analyze_component_tests: AnalyzeComponentTestsInput;
}

/**
 * Tool names that carry a typed input contract (a `ToolInputMap` entry).
 */
export type ContractedToolName = keyof ToolInputMap;

/**
 * Tool result types
 */
export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Message types for chat.
 *
 * History is persisted in the Anthropic block shape by both protocol paths:
 * assistant turns may carry tool_use blocks, user turns may carry tool_result
 * blocks (the follow-up "user" message of a tool round trip).
 */
interface UserMessage {
  role: 'user';
  content: string | Array<{ type: 'text' | 'tool_result'; [key: string]: unknown }>;
}

interface AssistantMessage {
  role: 'assistant';
  content: string | Array<{ type: 'text' | 'tool_use'; [key: string]: unknown }>;
}

export type ChatMessage = UserMessage | AssistantMessage;

/**
 * Request to AI agent chat endpoint
 * Supports single message or batch of messages
 */
export interface AIAgentChatRequest {
  message?: string; // Single message (legacy)
  messages?: string[]; // Batch of messages (new)
  projectPath: string;
  chatId?: string;
  componentPath?: string; // Current component being developed (for browser tools)
  selectedElementIds?: string[]; // Currently selected elements' nodeRef values
  // conversationHistory is loaded from DB when chatId is provided
}

/**
 * User response to ask_user tool
 */
export interface AskUserResponse {
  toolUseId: string;
  response: string;
}

/**
 * Queued message for sending while AI is streaming
 */
export interface QueuedMessage {
  id: string;
  content: string;
  status: 'pending' | 'sending' | 'cancelled';
  createdAt: number;
}
