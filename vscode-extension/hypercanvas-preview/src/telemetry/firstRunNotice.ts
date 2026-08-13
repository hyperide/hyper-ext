/**
 * One-time telemetry privacy notice.
 *
 * WHAT: shows a single `showInformationMessage` privacy toast the first time the
 * extension activates on a machine, gated on a `context.globalState` flag so it
 * never re-appears. Offers OK / Open Settings / Disable.
 * HOW REACHED: called once from `extension.ts` `activate()` after the
 * `TelemetryService` is constructed. Fire-and-forget; never blocks activation.
 * INVARIANT: shows at most once per machine (globalState flag). Best-effort — any
 * failure is swallowed so a UI hiccup can't break activation.
 * PII RULE: contains no dynamic data; static copy only.
 */

import * as vscode from 'vscode';

/**
 * globalState key recording that the one-time notice was shown. Exported as
 * the stable reference for future reset/opt-in flows and tests (the telemetry
 * plan spec tracks the notice feature).
 * @public
 */
export const TELEMETRY_NOTICE_SHOWN_KEY = 'hypercanvas.telemetry.noticeShown';
const ENABLED_SETTING = 'hypercanvas.telemetry.enabled';

const NOTICE_TEXT =
  'HyperIDE collects anonymous usage and error telemetry to improve the product. ' +
  'It respects your VS Code telemetry setting and sends no source code or personal data. ' +
  'Disable any time via the hypercanvas.telemetry.enabled setting.';

/**
 * Show the privacy notice once. Resolves immediately if it was already shown.
 * Returns a promise that resolves when the toast (if any) is dismissed.
 */
export async function showFirstRunNoticeOnce(context: vscode.ExtensionContext): Promise<void> {
  const alreadyShown = context.globalState.get<boolean>(TELEMETRY_NOTICE_SHOWN_KEY, false);
  if (alreadyShown) return;

  // Mark shown BEFORE awaiting the modal so a slow/never-dismissed toast can't
  // cause a duplicate on the next activation in the same install.
  await context.globalState.update(TELEMETRY_NOTICE_SHOWN_KEY, true);

  try {
    const choice = await vscode.window.showInformationMessage(NOTICE_TEXT, 'OK', 'Open Settings', 'Disable');
    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', ENABLED_SETTING);
    } else if (choice === 'Disable') {
      await vscode.workspace
        .getConfiguration('hypercanvas.telemetry')
        .update('enabled', false, vscode.ConfigurationTarget.Global);
    }
  } catch {
    // Best effort — never let a notice failure affect activation.
  }
}
