/**
 * @file HYP-901 — shared shape for the "style write could not be verified to land anywhere"
 * warning, surfaced ONLY once the verify-and-retry chain (direct write, then auto-wrap) is
 * exhausted — the master-spec Level-4 "can't-style" last resort
 * (docs/specs/2026-06-12-styles-system-master-spec.md §8.4), never the first response to a
 * non-forwarding custom component.
 *
 * Accessed via: produced host-side by the VS Code extension's style-write path
 * (services/style-forwarding-check.ts + ast-update-utils.ts → AstBridge's ast:updateStyles
 * response `data.warning`), carried across the webview RPC boundary, and consumed client-side
 * (RightSidebar) to show an honest "this could not be applied" notice.
 * Assumptions: by the time this value exists, the write pipeline has ALREADY tried (a) the
 * direct write + runtime verify and (b) the auto-wrap candidate + runtime verify (when eligible)
 * and rolled both back — the file is unchanged from before the edit. This is not a "we wrote
 * something, hope it works" notice; it means nothing was written.
 */
export interface StyleForwardingWarning {
  /** JSX tag name of the custom component the edit targeted, e.g. "HostRoutePage". */
  componentName: string;
  /** User-facing explanation, already formatted for display (toast / AI chat prompt). */
  message: string;
}
