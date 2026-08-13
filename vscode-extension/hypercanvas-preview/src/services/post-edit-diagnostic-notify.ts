/**
 * @file HYP-991 — text builders for the post-edit diagnostic PLATFORM notification.
 *
 * Per the CTO UX directive (tg#9122): the warning MESSAGE is a STANDARD platform notification
 * (`vscode.window.showWarningMessage` on the extension host), NOT a custom in-Inspector banner.
 * This module builds the notification message and the "Auto fix via AI" prompt so the wiring in
 * extension.ts stays thin and the strings are unit-testable. (The on-canvas element highlight is
 * separate — it stays an overlay, driven by the StateHub `diagnostic:postEditError` broadcast.)
 */

import type { PostEditDiagnostic, PostEditDiagnosticWarning } from '@shared/types/post-edit-diagnostic-warning';

/** Action label on the native warning notification. */
export const AUTO_FIX_ACTION = 'Auto fix via AI';

/** Short `basename:line` tail for a diagnostic, keeping the notification readable. */
function locationLabel(d: PostEditDiagnostic): string {
  const base = d.filePath.split('/').pop() ?? d.filePath;
  return `${base}:${d.line}`;
}

/**
 * The single-line native-notification message: the headline error plus a "+N more" tail when the
 * edit introduced several. Native toasts render one line well, so only the first error is spelled
 * out; the AI-fix prompt (below) carries the full list.
 */
export function buildPostEditNotificationMessage(warning: PostEditDiagnosticWarning): string {
  const [first] = warning.diagnostics;
  if (!first) return 'HyperIDE: this edit left a code error.';
  // Use the TRUE total, not the (capped) payload length, so "+N more" is accurate (review).
  const others = warning.totalErrorCount - 1;
  const more = others > 0 ? ` (+${others} more)` : '';
  // Native toasts render one line; collapse any newlines in the diagnostic message.
  const headline = first.message.replace(/\s*\n\s*/g, ' ');
  return `HyperIDE: this edit left a code error — ${headline} [${locationLabel(first)}]${more}`;
}

/** The AI-fix prompt: name the mutation, the element, and every new error, then ask AI to fix. */
export function buildPostEditAiFixPrompt(warning: PostEditDiagnosticWarning): string {
  const errorList = warning.diagnostics.map((d) => `- ${locationLabel(d)}: ${d.message}`).join('\n');
  const target = warning.elementId ? `on element "${warning.elementId}" ` : '';
  // Be honest when the payload was capped: name the true total and note the list is a sample.
  const capped = warning.totalErrorCount > warning.diagnostics.length;
  const listNote = capped ? ` (showing the first ${warning.diagnostics.length}):` : ':';
  return (
    `A change I just made in the visual editor (${warning.mutationType}) ${target}in ` +
    `${warning.componentPath} left the code with ${warning.totalErrorCount} new ` +
    `TypeScript/language-server error(s)${listNote}\n\n${errorList}\n\n` +
    `Please:\n1. Inspect WHY the edit introduced these errors.\n` +
    `2. Fix the code so the errors are gone while preserving the intent of my edit, OR — if the ` +
    `edit cannot be made valid — explain why and offer to revert it.\nShow me the fix before applying.`
  );
}
