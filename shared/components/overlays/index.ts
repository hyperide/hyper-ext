/**
 * @file Barrel exports for shared overlay components.
 *
 * Accessed via: `@shared/components/overlays` imports from SaaS (client/) and
 *   the VS Code extension webview (vscode-extension/.../webview-preview-panel/).
 *
 * This barrel is the EXTERNAL surface. Intra-package files (e.g.
 *   ComponentErrorOverlay importing PropsForm) and tests import siblings via
 *   their direct paths to avoid a circular dependency through the barrel.
 */

export { ComponentErrorOverlay } from './ComponentErrorOverlay';
export { ConnectionErrorOverlay } from './ConnectionErrorOverlay';
export { LoadingOverlay } from './LoadingOverlay';
export { NoComponentOverlay } from './NoComponentOverlay';
export {
  NonPreviewableFileOverlay,
  type NonPreviewableReason,
  type NonPreviewableRecommendation,
} from './NonPreviewableFileOverlay';
export { ParseErrorOverlay } from './ParseErrorOverlay';
export { FrameworkUnsupportedContent, PreviewSetupOverlay } from './PreviewSetupOverlay';
export type { SimplePropInfo } from './PropsForm';
export { RuntimeErrorOverlay } from './RuntimeErrorOverlay';
