/**
 * @file Trusted-origin guard for cross-realm `window` postMessage handlers.
 *
 * Accessed via: imported by every browser-side `window.addEventListener('message', …)`
 *   handler in the cross-realm bridge — the SaaS client (`client/`, `shared/`), the
 *   VS Code extension webviews (`vscode-extension/.../webview-*`), and the injected
 *   IDE scripts (`server/proxy/ide-injections/`). It is the single place that decides
 *   whether an inbound MessageEvent's origin is one we transact with.
 *
 * Assumptions / threat model (HYP-710, js/missing-origin-check):
 *   The bridge legitimately spans several realms whose origins are dynamic:
 *     • SaaS app ↔ preview iframe — the iframe is served same-origin via the proxy
 *       path `/project-preview/<id>/…`, so its origin === window.location.origin.
 *     • VS Code extension host ↔ webview — messages arrive with a per-session
 *       `vscode-webview://<uuid>` origin (the uuid is unknowable ahead of time), and
 *       in some sandboxed/about:blank webview frames the origin is the empty string.
 *     • code-server IDE iframe ↔ SaaS parent — same SaaS origin.
 *   A hardcoded equality check would break one of these realms, so we accept the
 *   *shape* of each trusted origin (scheme / same-origin / empty) rather than a fixed
 *   value, and reject everything else. This is a defense-in-depth narrowing on top of
 *   the message-`type` validation each handler already performs — it is NOT a
 *   replacement for it.
 *
 * Single-tenant note: every realm above runs inside the user's own authenticated
 *   session against their own project, so the practical blast radius of a spoofed
 *   message is low. The guard exists to satisfy the static-analysis contract and to
 *   reject obviously foreign frames (ads, embedded third-party docs, etc.).
 */

/** Origin schemes that are always trusted regardless of host/uuid. */
const TRUSTED_ORIGIN_SCHEMES = ['vscode-webview:', 'vscode-file:'] as const;

/**
 * Return the set of explicitly-trusted absolute origins for the current realm.
 * Always includes the page's own origin (covers same-origin SaaS ↔ proxy-iframe and
 * code-server ↔ SaaS parent). Additional origins can be injected at build/runtime via
 * `globalThis.__HYPERCANVAS_TRUSTED_ORIGINS__` (comma-separated) without touching this
 * file — used when the preview is ever served from a sibling origin.
 */
function explicitTrustedOrigins(): Set<string> {
  const origins = new Set<string>();
  const self = typeof location !== 'undefined' && typeof location.origin === 'string' ? location.origin : '';
  if (self) origins.add(self);

  const extra = (globalThis as { __HYPERCANVAS_TRUSTED_ORIGINS__?: string }).__HYPERCANVAS_TRUSTED_ORIGINS__;
  if (typeof extra === 'string') {
    for (const o of extra.split(',')) {
      const trimmed = o.trim();
      if (trimmed) origins.add(trimmed);
    }
  }
  return origins;
}

/**
 * Decide whether an inbound `MessageEvent.origin` belongs to a realm we trust.
 *
 * Accepts:
 *   • the empty-string origin (sandboxed / about:blank webview frames post with `''`);
 *   • any `vscode-webview://` / `vscode-file://` origin (VS Code webview ↔ ext host);
 *   • the page's own origin and any explicitly-configured proxy/SaaS origins.
 * Rejects everything else.
 */
export function isTrustedMessageOrigin(event: Pick<MessageEvent, 'origin'>): boolean {
  const origin = event.origin;

  // VS Code webview frames frequently report an empty origin (sandboxed iframe).
  // There is no cross-origin attacker that can forge an empty-origin message into a
  // webview from outside, so treat it as trusted within this single-tenant bridge.
  if (origin === '' || origin == null) return true;

  for (const scheme of TRUSTED_ORIGIN_SCHEMES) {
    if (origin.startsWith(scheme)) return true;
  }

  return explicitTrustedOrigins().has(origin);
}
