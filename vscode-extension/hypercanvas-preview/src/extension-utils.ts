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
  // If our extension appears anywhere in the stack, always treat as ours — even if
  // a foreign extension's frame also appears (e.g. cross-extension async callbacks).
  if (/[/\\]\.vscode(?:-server)?[/\\]extensions[/\\]hyperide\.hypercanvas[-./]/.test(stack)) {
    return false;
  }
  // A stack mentioning .vscode/extensions/ (local) or .vscode-server/extensions/
  // (Remote SSH/WSL/Codespaces) without our ID is a foreign error.
  return /[/\\]\.vscode(?:-server)?[/\\]extensions[/\\]/.test(stack);
}

export type SerializedReason = { name: string; message: string; stack?: string; [key: string]: unknown } | string;

/**
 * Converts an unhandled rejection / uncaught exception reason to a
 * JSON-safe value for structured log sinks.
 *
 * Returns `{ name, message, stack? }` for Error instances.
 * Returns a JSON string for everything else; falls back to `String(reason)`
 * when the value contains circular references or is otherwise not serialisable.
 */
export function serializeRejectionReason(reason: unknown): SerializedReason {
  if (reason instanceof Error) {
    const base: Record<string, unknown> = { name: reason.name, message: reason.message, stack: reason.stack };
    // Include enumerable own properties (e.g. code/errno/syscall/path on Node.js system errors).
    for (const key of Object.keys(reason)) {
      if (!(key in base)) {
        base[key] = (reason as unknown as Record<string, unknown>)[key];
      }
    }
    return base as { name: string; message: string; stack?: string; [key: string]: unknown };
  }
  try {
    // JSON.stringify returns undefined for `undefined` itself (not a string) —
    // fall through to String() for that case too.
    const s = JSON.stringify(reason);
    return s !== undefined ? s : String(reason);
  } catch {
    return String(reason);
  }
}
