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
  | 'get_container_logs'
  // Web tools
  | 'brave_web_search'
  | 'url_fetch'
  // Extension-only tools
  | 'check_build_status';

/**
 * Tool input schemas
 */
export interface ReadFileInput {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface EditFileInput {
  path: string;
  oldContent: string;
  newContent: string;
  replaceAll?: boolean;
}

export interface GrepSearchInput {
  pattern: string;
  path?: string;
  filePattern?: string;
  caseSensitive?: boolean;
}

export interface GlobSearchInput {
  pattern: string;
  path?: string;
}

export interface BashExecInput {
  command: string;
  timeout?: number;
}

export interface GitCommandInput {
  command: 'status' | 'diff' | 'log' | 'show' | 'blame';
  args?: string[];
}

export interface AskUserInput {
  question: string;
  options?: string[]; // Optional predefined choices
}

export interface RunTestsInput {
  testPaths: string[]; // Paths to test files to run
  installDeps?: boolean; // Auto-install missing packages
}

export interface BraveWebSearchInput {
  query: string;
  count?: number; // Number of results (1-20, default: 10)
}

export interface UrlFetchInput {
  url: string;
  selector?: string; // Optional CSS selector to extract specific content
}

export interface GetContainerLogsInput {
  lines?: number; // Number of log lines (default: 100, max: 500)
  includePrevious?: boolean; // Include logs from before last restart (K8s only)
  includeEvents?: boolean; // Include K8s pod events (K8s only)
}

/**
 * Tool result types
 */
export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Message types for chat
 */
export interface UserMessage {
  role: 'user';
  content: string;
}

export interface AssistantMessage {
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
  selectedElementIds?: string[]; // Currently selected elements' data-uniq-id values
  // conversationHistory is loaded from DB when chatId is provided
}

/**
 * Stream events from AI agent
 */
export type AIAgentStreamEvent =
  | { type: 'message_start' }
  | { type: 'content_block_start'; content: string }
  | { type: 'content_block_delta'; delta: string }
  | { type: 'content_block_stop' }
  | { type: 'tool_use_start'; toolName: ToolName; toolUseId: string; input: unknown }
  | { type: 'tool_use_result'; toolUseId: string; result: ToolResult }
  | { type: 'ask_user'; toolUseId: string; question: string; options?: string[] }
  | { type: 'keepalive' }
  | { type: 'message_stop' }
  | { type: 'messages_to_save'; messages: ChatMessage[] }
  | { type: 'chat_title_updated'; title: string }
  | { type: 'error'; error: string };

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
