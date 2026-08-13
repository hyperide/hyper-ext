/**
 * @file Barrel exports for shared overlay components.
 *
 * Accessed via: `@shared/components/overlays` imports from SaaS (client/) and
 *   the VS Code extension webview (vscode-extension/.../webview-preview-panel/).
 *
 * Note: ComponentErrorOverlay + PropsForm are NOT here yet — they move to shared
 *   together with the extension wiring (see HYP-359 follow-up tickets).
 */

export { ConnectionErrorOverlay } from './ConnectionErrorOverlay';
export { LoadingOverlay } from './LoadingOverlay';
export { NoComponentOverlay } from './NoComponentOverlay';
export { ParseErrorOverlay } from './ParseErrorOverlay';
export { PreviewSetupOverlay } from './PreviewSetupOverlay';
export { RuntimeErrorOverlay } from './RuntimeErrorOverlay';
