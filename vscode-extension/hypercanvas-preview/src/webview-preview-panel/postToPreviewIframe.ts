/**
 * Single sanctioned channel for webview -> preview-iframe messaging.
 *
 * The preview <iframe> is loaded directly from the user's dev-server URL
 * (e.g. http://localhost:3000/test-preview?component=...), so its origin is a
 * real, derivable HTTP origin — NOT the opaque vscode-webview:// origin of the
 * host webview. Every outbound postMessage therefore targets that derived
 * origin instead of the '*' wildcard: a stray cross-origin window can never
 * receive these messages, and the browser silently drops the post if the iframe
 * ever navigates away from the expected origin.
 *
 * Routing all outbound calls through this one helper keeps the wildcard-free
 * guarantee in a single, testable place and lets Semgrep scan the rest of the
 * webview-preview-panel subtree without a blanket .semgrepignore.
 */

/** Derive the iframe's current origin from its src, or null if not derivable. */
export function getPreviewIframeOrigin(frame: HTMLIFrameElement): string | null {
  const src = frame.getAttribute('src') || frame.src;
  if (!src || src === 'about:blank') return null;
  try {
    // Parse the src as an ABSOLUTE URL only. The preview iframe is always loaded
    // from a fully-qualified dev-server URL, so a relative src (which would
    // resolve against the webview's own vscode-webview:// origin) is not a valid
    // target and is rejected here.
    const url = new URL(src);
    const { origin, protocol } = url;
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return origin && origin !== 'null' ? origin : null;
  } catch {
    return null;
  }
}

/**
 * Post a message to the preview iframe, targeting its real derived origin.
 *
 * @returns true if the message was dispatched, false if it was skipped
 *   (no frame, no contentWindow, or origin not yet derivable). Skipping is
 *   behavior-preserving: a wildcard post to an unloaded/blank frame reaches
 *   nothing either.
 */
export function postToPreviewIframe(frame: HTMLIFrameElement | null, message: unknown): boolean {
  if (!frame) return false;
  const targetWindow = frame.contentWindow;
  if (!targetWindow) return false;
  const origin = getPreviewIframeOrigin(frame);
  if (!origin) return false;
  targetWindow.postMessage(message, origin);
  return true;
}
