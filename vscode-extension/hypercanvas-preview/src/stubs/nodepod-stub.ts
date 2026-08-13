/**
 * Webview stub for `client/lib/platform/nodepod/nodepodRetargetTransport`.
 *
 * The real transport imports `@babel/traverse` + `@babel/types` (via
 * `@shared/i18n-text/retarget/core`). `@babel/types` reads `process.env` at module
 * init, which throws `ReferenceError: process is not defined` in a webview (no Node
 * runtime) — crashing the bundle before React mounts (blank preview / dead panel).
 *
 * NodePod retarget is a browser-SaaS-only i18n feature. The VS Code webview uses
 * `createVSCodeAdapters()` and delegates all AST / i18n work to the extension host
 * via canvasRPC, so these functions are never reached here. Resolving them to this
 * stub at esbuild bundle time (see `createWebviewPlugins` in esbuild.js) keeps
 * @babel out of the browser graph. Enforced by `scripts/check-webview-bundles.mjs`.
 */
function unavailable(name: string): never {
  throw new Error(`[hypercanvas] ${name} is browser-SaaS-only and unavailable in the VS Code webview`);
}

export async function runNodePodRetarget(): Promise<never> {
  return unavailable('runNodePodRetarget');
}

export async function scanNodePodBindings(): Promise<never> {
  return unavailable('scanNodePodBindings');
}

export async function listNodePodLocaleKeys(): Promise<never> {
  return unavailable('listNodePodLocaleKeys');
}
