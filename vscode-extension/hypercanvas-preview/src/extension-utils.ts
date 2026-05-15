/**
 * @file Pure utility functions extracted from extension.ts for testability.
 *
 * Accessed via: extension.ts activate() — called at extension startup
 * Assumptions: no VS Code API dependencies; pure functions only
 * Past bugs: HYP-363 — global unhandledRejection handler mislabeled foreign
 *            extension errors (open.bun-vscode, github.copilot-chat) as
 *            [HyperIDE] failures. Fixed by filtering via stack-trace origin.
 */

/**
 * Returns true when the rejection stack trace originates from a foreign VS Code
 * extension, not from HyperIDE preview extension code. Foreign extension errors
 * must not be logged as [HyperIDE] because the extension host is shared across
 * all installed extensions.
 */
export function isForeignExtensionError(reason: unknown): boolean {
  const stack = reason instanceof Error ? (reason.stack ?? '') : String(reason);
  // A stack mentioning .vscode/extensions/ (local) or .vscode-server/extensions/
  // (Remote SSH/WSL/Codespaces) but not our extension ID is a foreign error.
  return /[/\\]\.vscode(?:-server)?[/\\]extensions[/\\](?!hyperide\.hypercanvas[-./])/.test(stack);
}
