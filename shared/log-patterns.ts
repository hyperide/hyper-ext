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
  /compiled with \d+ error/i, // webpack/CRA "compiled with 1 error" — must beat the success pattern
  // Port-in-use crashes. A dev server that loses the port-assignment race (an
  // orphaned previous instance still holds the port, or another server is bound
  // to it) exits with one of these. Bun is the motivating case: it hardcodes
  // serve({ port: 3000 }), ignores PORT/--port, and on collision prints
  // "error: Failed to start server. Is port 3000 in use?" then exits. That string
  // matched none of the patterns above, so the failure was invisible and
  // _waitForReady() timed out with a generic "Server startup timeout" instead of
  // surfacing the real cause (HYP-753, orphan-reap-on-reload). Node/Vite/webpack
  // emit EADDRINUSE / "address already in use" for the same condition.
  /EADDRINUSE/i, // Node/libuv address-in-use error code
  /address already in use/i, // libuv / common server message
  /Failed to start server\. Is port \d+ in use/i, // Bun.serve port collision
  /port \d+ (?:is )?(?:already )?in use/i, // generic "port 3000 is already in use"
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
  // Vite / Next.js / Remix / esbuild HMR rebuild markers. These mirror the VS
  // Code DevServerManager._isRecompileReadyMessage() set so the AI agent's
  // build_status wait recognizes a settled rebuild on those dev servers instead
  // of timing out. Note: bare "compiled with" is intentionally NOT included —
  // it can mean "compiled with errors", and ERROR_PATTERNS must win that case.
  /compiled in \d+/i, // Next.js post-HMR "Compiled in 200ms"
  /compiled client/i, // Next.js post-HMR
  /hmr update/i, // Vite "[vite] hmr update"
  /page reload/i, // Vite / Remix "[vite] page reload"
  /rebuilt in \d+/i, // esbuild
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
