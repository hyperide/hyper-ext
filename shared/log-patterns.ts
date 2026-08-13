/**
 * Build/runtime log pattern matching.
 *
 * Neutral, dependency-free helpers for classifying dev-server log output as
 * error or success. Used by the VS Code extension's DevServerManager to track
 * build health from raw stdout/stderr lines.
 */

// Error patterns to detect in dev-server logs
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

// Success patterns to detect in dev-server logs
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
