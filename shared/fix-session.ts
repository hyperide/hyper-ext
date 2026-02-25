/**
 * Types for AI Auto-Fix sessions
 */

// Event types emitted during fix session
export type FixEventType =
  | 'session_started'
  | 'iteration_start'
  | 'checking_logs'
  | 'error_detected'
  | 'no_errors_found'
  | 'ai_thinking'
  | 'ai_tool_use'
  | 'ai_tool_result'
  | 'ai_text'
  | 'file_modified'
  | 'waiting_rebuild'
  | 'iteration_complete'
  | 'session_success'
  | 'session_failed'
  | 'session_cancelled'
  | 'request_iframe_html';

// Event payload sent via SSE
export interface FixEvent {
  type: FixEventType;
  sessionId: string;
  iteration?: number;
  maxIterations?: number;
  message?: string;
  error?: string;
  dockerLogs?: string;
  filesModified?: string[];
  toolName?: string;
  toolInput?: unknown;
  toolResult?: {
    success: boolean;
    output?: string;
    error?: string;
  };
  // For request_iframe_html event
  requestId?: string;
}

// Session status
export type FixSessionStatus = 'running' | 'success' | 'failed' | 'cancelled';

// Database model for fix session
export interface FixSession {
  id: string;
  projectId: string;
  projectPath: string;
  componentPath: string | null;
  canvasPreviewPath: string;
  originalTask: string;
  status: FixSessionStatus;
  currentIteration: number;
  maxIterations: number;
  startedAt: number;
  completedAt: number | null;
  finalError: string | null;
}

// Database model for fix attempt
export interface FixAttempt {
  id: string;
  sessionId: string;
  iteration: number;
  dockerLogs: string;
  filesModified: string; // JSON array
  aiConversation: string; // JSON
  result: 'success' | 'failed' | 'error';
  errorAfterFix: string | null;
  createdAt: number;
  durationMs: number;
}

// Request to start a fix session
export interface StartFixRequest {
  projectId: string;
  projectPath: string;
  componentPath: string | null;
  canvasPreviewPath: string;
  originalTask: string;
  forceRetry?: boolean; // Cancel existing session and start new one
}

// Error patterns to detect in Docker logs
export const ERROR_PATTERNS = [
  /error TS\d+:/i, // TypeScript errors
  /SyntaxError:/i, // Syntax errors
  /Cannot find module/i, // Module errors
  /Module not found/i, // Webpack/Vite errors
  /does not provide an export named/i, // ESM export errors
  /Transform failed/i, // esbuild errors
  /Build failed/i, // Build errors
  /Failed to compile/i, // Next.js errors
  /ReferenceError:/i, // Reference errors
  /TypeError:/i, // Type errors at runtime
  /Unexpected token/i, // Parse errors
  /is not defined/i, // Undefined variables
  /Cannot read propert/i, // Property access errors
  /is not a function/i, // Function call errors
];

// Success patterns to detect in Docker logs
export const SUCCESS_PATTERNS = [
  /compiled successfully/i,
  /ready in \d+/i,
  /Local:/i,
  /hot reloaded/i,
  /✓ Ready/i,
  /built in \d+/i,
  /webpack.*compiled/i,
];

/**
 * Check if logs contain errors
 */
export function hasErrorsInLogs(logs: string): boolean {
  return ERROR_PATTERNS.some((pattern) => pattern.test(logs));
}

/**
 * Check if logs indicate successful build
 */
export function hasSuccessInLogs(logs: string): boolean {
  return SUCCESS_PATTERNS.some((pattern) => pattern.test(logs));
}

/**
 * Extract error messages from logs
 */
export function extractErrors(logs: string): string[] {
  const lines = logs.split('\n');
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ERROR_PATTERNS.some((pattern) => pattern.test(line))) {
      // Include some context (current line + next 2 lines)
      const contextLines = lines.slice(i, Math.min(i + 3, lines.length));
      errors.push(contextLines.join('\n'));
      i += 2; // Skip the context lines
    }
  }

  return errors;
}
