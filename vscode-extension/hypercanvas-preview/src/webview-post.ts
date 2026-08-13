/**
 * Disposed-safe webview posting.
 *
 * Why this exists: a `vscode.WebviewPanel` reference can outlive the webview it
 * wraps. VS Code disposes the underlying webview (tab closed, workspace switched,
 * or — under E2E load — the harness tearing the panel down between specs) and fires
 * `onDidDispose` ASYNCHRONOUSLY. The host's cached `_panel` field is only nulled
 * inside that callback, so between the disposal and the callback running there is a
 * window where `_panel` is non-null but `_panel.webview` is already dead.
 *
 * `panel?.webview.postMessage(...)` guards `panel === undefined`, NOT "panel is
 * disposed" — posting to a disposed webview throws `Error: Webview is disposed`.
 * On the async ensure-sample/preview pipeline that throw escaped the per-call
 * guards and poisoned the shared extension-host worker, cascading into hundreds of
 * dead-preview failures from a single webview-lifecycle race (one disposed webview,
 * not hundreds of bugs).
 *
 * `postToWebviewSafe` converts that worker-poisoning throw into a graceful no-op:
 * it posts, and if the webview is disposed it swallows the error and signals the
 * caller (via `onDisposed`) to drop the stale reference so the NEXT ensure rebuilds
 * a fresh panel instead of reusing the dead one. Non-disposal errors still propagate
 * — we only neutralize the lifecycle race, not real bugs.
 */

import type * as vscode from 'vscode';

/**
 * Heuristic for the "Webview is disposed" error VS Code throws when posting to a
 * webview whose panel has been disposed. VS Code does not export an error type for
 * it, so match on the message (and tolerate a plain string throw, just in case).
 */
export function isWebviewDisposedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /webview is disposed/i.test(message);
}

/**
 * Post a message to the panel's webview, tolerating a disposed webview.
 *
 * Returns `true` when the post was attempted on a live panel (the post itself is
 * fire-and-forget — VS Code returns a Promise we don't await), `false` when there
 * was no panel or the webview was disposed. On a disposed webview, `onDisposed` is
 * invoked so the caller can clear its stale reference; the error is NOT rethrown.
 * Any OTHER error is rethrown unchanged (it is not the lifecycle race this guards).
 */
export function postToWebviewSafe(
  panel: vscode.WebviewPanel | undefined,
  message: unknown,
  onDisposed?: () => void,
): boolean {
  if (!panel) return false;
  return postToWebviewRawSafe(panel.webview, message, onDisposed);
}

/**
 * Like `postToWebviewSafe` but for a bare `vscode.Webview` (no enclosing panel).
 *
 * Some sites hold only the `webview` — e.g. a file-system watcher that posts an
 * `errorOverlay:sampleDeleted` on a later change/delete event, long after the call
 * that registered it. Those events can fire after the webview is disposed, throwing
 * the same `Webview is disposed`. This swallows that throw, invokes `onDisposed` (so
 * the caller can tear down the now-pointless watcher), and rethrows anything else.
 */
export function postToWebviewRawSafe(
  webview: vscode.Webview | undefined,
  message: unknown,
  onDisposed?: () => void,
): boolean {
  if (!webview) return false;
  try {
    void webview.postMessage(message);
    return true;
  } catch (err) {
    if (isWebviewDisposedError(err)) {
      onDisposed?.();
      return false;
    }
    throw err;
  }
}
