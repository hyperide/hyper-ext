/**
 * @file Barrel exports for shared app-preview chrome.
 *
 * Accessed via: `@shared/components/preview-chrome` from the SaaS canvas (client/) and the
 *   VS Code extension webview (vscode-extension/.../webview-preview-panel/). The address bar
 *   and its suggestions popover are a single shared source consumed by both surfaces — never
 *   forked. See AddressBar.tsx for behavior.
 */

export { AddressBar } from './AddressBar';
// RouteSuggestionList is consumed only by AddressBar (same dir, direct import) — not re-exported
// here to keep the barrel to its live cross-surface consumers (knip: no unused barrel export).
export type { RouteSuggestionItem } from './types';
// Barrel surface consumed by the SaaS canvas (useAppPreviewMode / IframeCanvas /
// iframe-canvas-hooks). The remaining nav-strategy helpers (NAV_STRATEGIES, parseNavStrategy,
// stripPreviewPrefix, applyPreviewRoute) are imported directly from './nav-strategy' by the
// generator-mirror tests and any future strategy-picker UI — not re-exported here to keep the
// barrel to its live consumers.
export { DEFAULT_NAV_STRATEGY, detectPreviewPrefix, type NavStrategy } from './nav-strategy';
